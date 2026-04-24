import hashlib
import json
import math
import re
import shutil
import tempfile
import wave
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.models.task import AnnotationTask
from app.services.errors import ServiceError
from app.storage.audio_resolver import AudioResolver

settings = get_settings()

ALIGNMENT_MODEL_NAME = "torchaudio.WAV2VEC2_ASR_BASE_960H"
MASK_PADDING_SECONDS = 0.04


@dataclass(frozen=True)
class TranscriptWord:
    index: int
    text: str
    normalized_text: str
    start_char: int
    end_char: int


@dataclass(frozen=True)
class AlignedWord:
    index: int
    text: str
    normalized_text: str
    start_char: int
    end_char: int
    start_seconds: float
    end_seconds: float
    score: float | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "text": self.text,
            "normalized_text": self.normalized_text,
            "start_char": self.start_char,
            "end_char": self.end_char,
            "start_seconds": round(self.start_seconds, 3),
            "end_seconds": round(self.end_seconds, 3),
            "score": round(self.score, 4) if self.score is not None else None,
        }


@dataclass(frozen=True)
class MaskInterval:
    start_seconds: float
    end_seconds: float
    labels: list[str]
    text: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "start_seconds": round(self.start_seconds, 3),
            "end_seconds": round(self.end_seconds, 3),
            "labels": self.labels,
            "text": self.text,
        }


@dataclass(frozen=True)
class _Point:
    token_index: int
    time_index: int
    score: float


@dataclass(frozen=True)
class _Segment:
    label: str
    start: int
    end: int
    score: float

    @property
    def length(self) -> int:
        return self.end - self.start


_MODEL_CACHE: dict[str, Any] = {}


def transcript_hash(transcript: str) -> str:
    return hashlib.sha256(transcript.encode("utf-8")).hexdigest()


def pii_hash(pii_annotations: list[dict[str, Any]]) -> str:
    normalized = [
        {
            "label": str(item.get("label") or ""),
            "start": int(item.get("start") or 0),
            "end": int(item.get("end") or 0),
            "value": str(item.get("value") or ""),
        }
        for item in pii_annotations
    ]
    normalized.sort(key=lambda item: (item["start"], item["end"], item["label"], item["value"]))
    return hashlib.sha256(json.dumps(normalized, sort_keys=True).encode("utf-8")).hexdigest()


def tokenize_transcript_words(transcript: str) -> list[TranscriptWord]:
    words: list[TranscriptWord] = []
    for match in re.finditer(r"\S+", transcript):
        text = match.group(0)
        normalized = normalize_alignment_word(text)
        if not normalized:
            continue
        words.append(
            TranscriptWord(
                index=len(words),
                text=text,
                normalized_text=normalized,
                start_char=match.start(),
                end_char=match.end(),
            )
        )
    return words


def normalize_alignment_word(text: str) -> str:
    return re.sub(r"[^A-Z']", "", text.upper())


def build_mask_intervals(
    words: list[dict[str, Any]],
    pii_annotations: list[dict[str, Any]],
    *,
    audio_duration: float | None = None,
    padding_seconds: float = MASK_PADDING_SECONDS,
) -> list[MaskInterval]:
    raw_intervals: list[MaskInterval] = []

    for annotation in pii_annotations:
        annotation_start = int(annotation.get("start") or 0)
        annotation_end = int(annotation.get("end") or 0)
        matched_words = [
            word
            for word in words
            if int(word.get("start_char") or 0) < annotation_end and annotation_start < int(word.get("end_char") or 0)
        ]
        if not matched_words:
            continue

        start_seconds = min(float(word["start_seconds"]) for word in matched_words) - padding_seconds
        end_seconds = max(float(word["end_seconds"]) for word in matched_words) + padding_seconds
        if audio_duration is not None:
            start_seconds = max(0.0, min(start_seconds, audio_duration))
            end_seconds = max(0.0, min(end_seconds, audio_duration))
        else:
            start_seconds = max(0.0, start_seconds)
        if end_seconds <= start_seconds:
            continue

        raw_intervals.append(
            MaskInterval(
                start_seconds=start_seconds,
                end_seconds=end_seconds,
                labels=[str(annotation.get("label") or "PII")],
                text=" ".join(str(word.get("text") or "") for word in matched_words).strip(),
            )
        )

    return merge_mask_intervals(raw_intervals)


def merge_mask_intervals(intervals: list[MaskInterval]) -> list[MaskInterval]:
    if not intervals:
        return []

    sorted_intervals = sorted(intervals, key=lambda item: (item.start_seconds, item.end_seconds))
    merged: list[MaskInterval] = [sorted_intervals[0]]
    for interval in sorted_intervals[1:]:
        previous = merged[-1]
        if interval.start_seconds <= previous.end_seconds:
            labels = sorted({*previous.labels, *interval.labels})
            text_parts = [part for part in [previous.text, interval.text] if part]
            merged[-1] = MaskInterval(
                start_seconds=previous.start_seconds,
                end_seconds=max(previous.end_seconds, interval.end_seconds),
                labels=labels,
                text=" / ".join(dict.fromkeys(text_parts)),
            )
        else:
            merged.append(interval)
    return merged


class AudioAlignmentService:
    def __init__(self) -> None:
        self.audio_resolver = AudioResolver()

    def align_task_audio(self, task: AnnotationTask, *, force: bool = False) -> list[dict[str, Any]]:
        transcript = task.final_transcript or ""
        current_hash = transcript_hash(transcript)
        if (
            not force
            and task.alignment_words
            and task.alignment_transcript_hash == current_hash
            and task.alignment_model == ALIGNMENT_MODEL_NAME
        ):
            return task.alignment_words

        words = tokenize_transcript_words(transcript)
        if not words:
            raise ServiceError("Final transcript has no alignable words", status_code=422)

        aligned_words = self._run_wav2vec_alignment(task.file_location, words)
        if not aligned_words:
            raise ServiceError("Forced alignment produced no word timings", status_code=422)

        task.alignment_words = [word.to_dict() for word in aligned_words]
        task.alignment_transcript_hash = current_hash
        task.alignment_model = ALIGNMENT_MODEL_NAME
        task.alignment_updated_at = datetime.now(UTC)
        return task.alignment_words

    def build_pii_masked_audio(self, task: AnnotationTask, *, force: bool = False) -> tuple[str, list[dict[str, Any]]]:
        if not task.pii_annotations:
            raise ServiceError("No PII annotations are available to mask", status_code=422)

        words = self.align_task_audio(task, force=force)
        current_pii_hash = pii_hash(task.pii_annotations or [])
        if (
            not force
            and task.masked_audio_location
            and task.masked_audio_pii_hash == current_pii_hash
            and Path(task.masked_audio_location).is_file()
        ):
            intervals = build_mask_intervals(words, task.pii_annotations or [])
            return task.masked_audio_location, [interval.to_dict() for interval in intervals]

        with self._materialized_audio_path(task.file_location) as source_path:
            duration = self._get_audio_duration(source_path)
            intervals = build_mask_intervals(words, task.pii_annotations or [], audio_duration=duration)
            if not intervals:
                raise ServiceError("PII annotations could not be mapped to aligned audio words", status_code=422)

            output_path = self._masked_audio_path(task.id, current_pii_hash)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            self._write_masked_audio(source_path, output_path, intervals)

        task.masked_audio_location = str(output_path)
        task.masked_audio_pii_hash = current_pii_hash
        task.masked_audio_updated_at = datetime.now(UTC)
        return str(output_path), [interval.to_dict() for interval in intervals]

    def _run_wav2vec_alignment(self, file_location: str, words: list[TranscriptWord]) -> list[AlignedWord]:
        torch, torchaudio = self._load_torch_audio()
        bundle = torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H
        labels = bundle.get_labels()
        dictionary = {label: index for index, label in enumerate(labels)}
        transcript = "|" + "|".join(word.normalized_text for word in words) + "|"
        missing = sorted({char for char in transcript if char not in dictionary})
        if missing:
            raise ServiceError(
                "Transcript contains characters unsupported by the alignment model",
                status_code=422,
                extra={"unsupported_characters": missing},
            )

        tokens = [dictionary[char] for char in transcript]
        model = self._get_model(bundle)
        device = next(model.parameters()).device

        with self._materialized_audio_path(file_location) as audio_path:
            waveform, sample_rate = torchaudio.load(str(audio_path))

        if waveform.size(0) > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        if sample_rate != bundle.sample_rate:
            waveform = torchaudio.functional.resample(waveform, sample_rate, bundle.sample_rate)
            sample_rate = bundle.sample_rate

        with torch.inference_mode():
            emissions, _ = model(waveform.to(device))
            emissions = torch.log_softmax(emissions, dim=-1)
        emission = emissions[0].cpu()

        trellis = _get_trellis(torch, emission, tokens, blank_id=0)
        path = _backtrack(emission, trellis, tokens, blank_id=0)
        token_segments = _merge_repeats(path, transcript)
        word_segments = _merge_words(token_segments)

        if len(word_segments) != len(words):
            raise ServiceError(
                "Forced alignment word count did not match transcript words",
                status_code=422,
                extra={"expected_words": len(words), "aligned_words": len(word_segments)},
            )

        samples_per_frame = waveform.size(1) / emission.size(0)
        aligned: list[AlignedWord] = []
        for word, segment in zip(words, word_segments, strict=True):
            start_seconds = (segment.start * samples_per_frame) / sample_rate
            end_seconds = (segment.end * samples_per_frame) / sample_rate
            aligned.append(
                AlignedWord(
                    index=word.index,
                    text=word.text,
                    normalized_text=word.normalized_text,
                    start_char=word.start_char,
                    end_char=word.end_char,
                    start_seconds=start_seconds,
                    end_seconds=end_seconds,
                    score=segment.score,
                )
            )
        return aligned

    def _load_torch_audio(self):
        try:
            import torch
            import torchaudio
        except ImportError as exc:
            raise ServiceError(
                "Forced alignment is not installed. Rebuild the backend with torch and torchaudio dependencies.",
                status_code=503,
            ) from exc
        return torch, torchaudio

    def _get_model(self, bundle):
        import torch

        if "model" not in _MODEL_CACHE:
            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            model = bundle.get_model().to(device)
            model.eval()
            _MODEL_CACHE["model"] = model
        return _MODEL_CACHE["model"]

    def _materialized_audio_path(self, file_location: str):
        location = self.audio_resolver.resolve(file_location)
        if location.scheme == "local" and location.local_path:
            path = Path(location.local_path).expanduser()
            if not path.is_file():
                raise ServiceError("Audio file not found", status_code=404)
            return _ExistingPathContext(path)

        suffix = Path(location.key or "audio.wav").suffix or ".wav"
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        temp_path = Path(temp_file.name)
        try:
            with temp_file:
                source = self.audio_resolver.open_audio(location)
                try:
                    shutil.copyfileobj(source, temp_file)
                finally:
                    source.close()
            return _TemporaryPathContext(temp_path)
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise

    def _get_audio_duration(self, path: Path) -> float | None:
        if path.suffix.lower() == ".wav":
            try:
                with wave.open(str(path), "rb") as wav_file:
                    return wav_file.getnframes() / float(wav_file.getframerate())
            except wave.Error:
                return None
        try:
            torch, torchaudio = self._load_torch_audio()
            info = torchaudio.info(str(path))
            return info.num_frames / float(info.sample_rate) if info.sample_rate else None
        except ServiceError:
            return None

    def _masked_audio_path(self, task_id: str, current_pii_hash: str) -> Path:
        return settings.upload_path / "masked-audio" / f"{task_id}-{current_pii_hash[:16]}.wav"

    def _write_masked_audio(self, source_path: Path, output_path: Path, intervals: list[MaskInterval]) -> None:
        if source_path.suffix.lower() == ".wav" and self._try_mask_wav_file(source_path, output_path, intervals):
            return
        self._mask_with_torchaudio(source_path, output_path, intervals)

    def _try_mask_wav_file(self, source_path: Path, output_path: Path, intervals: list[MaskInterval]) -> bool:
        try:
            with wave.open(str(source_path), "rb") as reader:
                params = reader.getparams()
                frames = bytearray(reader.readframes(reader.getnframes()))
                frame_rate = reader.getframerate()
                sample_width = reader.getsampwidth()
                channels = reader.getnchannels()
                frame_width = sample_width * channels
                for interval in intervals:
                    start_frame = max(0, int(math.floor(interval.start_seconds * frame_rate)))
                    end_frame = min(params.nframes, int(math.ceil(interval.end_seconds * frame_rate)))
                    for frame_index in range(start_frame, end_frame):
                        offset = frame_index * frame_width
                        frames[offset : offset + frame_width] = b"\x00" * frame_width
            with wave.open(str(output_path), "wb") as writer:
                writer.setparams(params)
                writer.writeframes(bytes(frames))
            return True
        except wave.Error:
            return False

    def _mask_with_torchaudio(self, source_path: Path, output_path: Path, intervals: list[MaskInterval]) -> None:
        torch, torchaudio = self._load_torch_audio()
        waveform, sample_rate = torchaudio.load(str(source_path))
        masked = waveform.clone()
        total_samples = masked.size(1)
        for interval in intervals:
            start_sample = max(0, min(total_samples, int(math.floor(interval.start_seconds * sample_rate))))
            end_sample = max(start_sample, min(total_samples, int(math.ceil(interval.end_seconds * sample_rate))))
            masked[:, start_sample:end_sample] = 0
        torchaudio.save(str(output_path), masked.cpu(), sample_rate)


class _ExistingPathContext:
    def __init__(self, path: Path):
        self.path = path

    def __enter__(self) -> Path:
        return self.path

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


class _TemporaryPathContext:
    def __init__(self, path: Path):
        self.path = path

    def __enter__(self) -> Path:
        return self.path

    def __exit__(self, exc_type, exc, tb) -> None:
        self.path.unlink(missing_ok=True)


def _get_trellis(torch, emission, tokens: list[int], blank_id: int = 0):
    num_frame = emission.size(0)
    num_tokens = len(tokens)
    trellis = torch.zeros((num_frame, num_tokens))
    trellis[1:, 0] = torch.cumsum(emission[1:, blank_id], 0)
    trellis[0, 1:] = -float("inf")
    trellis[-num_tokens + 1 :, 0] = float("inf")
    for time_index in range(num_frame - 1):
        trellis[time_index + 1, 1:] = torch.maximum(
            trellis[time_index, 1:] + emission[time_index, blank_id],
            trellis[time_index, :-1] + emission[time_index, tokens[1:]],
        )
    return trellis


def _backtrack(emission, trellis, tokens: list[int], blank_id: int = 0) -> list[_Point]:
    time_index = trellis.size(0) - 1
    token_index = trellis.size(1) - 1
    path = [_Point(token_index, time_index, emission[time_index, blank_id].exp().item())]
    while token_index > 0:
        if time_index <= 0:
            raise ServiceError("Forced alignment could not backtrack through the transcript", status_code=422)
        stay_score = emission[time_index - 1, blank_id]
        change_score = emission[time_index - 1, tokens[token_index]]
        stayed = trellis[time_index - 1, token_index] + stay_score
        changed = trellis[time_index - 1, token_index - 1] + change_score
        time_index -= 1
        changed_token = changed > stayed
        if changed_token:
            token_index -= 1
        probability = (change_score if changed_token else stay_score).exp().item()
        path.append(_Point(token_index, time_index, probability))

    while time_index > 0:
        probability = emission[time_index - 1, blank_id].exp().item()
        path.append(_Point(token_index, time_index - 1, probability))
        time_index -= 1

    return path[::-1]


def _merge_repeats(path: list[_Point], transcript: str) -> list[_Segment]:
    index = 0
    segments: list[_Segment] = []
    while index < len(path):
        end_index = index
        while end_index < len(path) and path[index].token_index == path[end_index].token_index:
            end_index += 1
        score = sum(path[item].score for item in range(index, end_index)) / (end_index - index)
        segments.append(
            _Segment(
                label=transcript[path[index].token_index],
                start=path[index].time_index,
                end=path[end_index - 1].time_index + 1,
                score=score,
            )
        )
        index = end_index
    return segments


def _merge_words(segments: list[_Segment], separator: str = "|") -> list[_Segment]:
    words: list[_Segment] = []
    start_index = 0
    end_index = 0
    while start_index < len(segments):
        if end_index >= len(segments) or segments[end_index].label == separator:
            if start_index != end_index:
                word_segments = segments[start_index:end_index]
                word = "".join(segment.label for segment in word_segments)
                total_length = sum(segment.length for segment in word_segments)
                score = sum(segment.score * segment.length for segment in word_segments) / total_length
                words.append(_Segment(word, segments[start_index].start, segments[end_index - 1].end, score))
            start_index = end_index + 1
            end_index = start_index
        else:
            end_index += 1
    return words
