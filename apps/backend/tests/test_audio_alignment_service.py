import math
import struct
import wave
from types import SimpleNamespace

import pytest
from app.services.audio_alignment_service import (
    AudioAlignmentService,
    MaskInterval,
    build_mask_intervals,
    tokenize_transcript_words,
)


def test_transcript_tokenization_preserves_original_offsets():
    words = tokenize_transcript_words("Call John-Doe, at 5pm.")

    assert [(word.text, word.normalized_text, word.start_char, word.end_char) for word in words] == [
        ("Call", "CALL", 0, 4),
        ("John-Doe,", "JOHNDOE", 5, 14),
        ("at", "AT", 15, 17),
        ("5pm.", "PM", 18, 22),
    ]


def test_pii_mask_intervals_cover_aligned_words_and_merge_overlaps():
    words = [
        {
            "text": "Call",
            "start_char": 0,
            "end_char": 4,
            "start_seconds": 0.1,
            "end_seconds": 0.3,
        },
        {
            "text": "John",
            "start_char": 5,
            "end_char": 9,
            "start_seconds": 0.32,
            "end_seconds": 0.6,
        },
        {
            "text": "Doe",
            "start_char": 10,
            "end_char": 13,
            "start_seconds": 0.62,
            "end_seconds": 0.8,
        },
    ]
    annotations = [
        {"label": "NAME", "start": 5, "end": 9, "value": "John"},
        {"label": "NAME", "start": 10, "end": 13, "value": "Doe"},
    ]

    intervals = build_mask_intervals(words, annotations, audio_duration=2.0, padding_seconds=0.04)

    assert len(intervals) == 1
    assert intervals[0].start_seconds == 0.28
    assert round(intervals[0].end_seconds, 2) == 0.84
    assert intervals[0].labels == ["NAME"]
    assert intervals[0].text == "John / Doe"


def test_alignment_loads_pcm_wav_without_torchcodec(tmp_path):
    torch = pytest.importorskip("torch")
    source_path = tmp_path / "source.wav"
    sample_rate = 8000
    samples = [0, 8192, -8192, 16384]
    with wave.open(str(source_path), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.writeframes(b"".join(struct.pack("<h", sample) for sample in samples))

    torchaudio = SimpleNamespace(load=lambda _: (_ for _ in ()).throw(AssertionError("torchaudio.load used")))
    waveform, loaded_sample_rate = AudioAlignmentService()._load_waveform(source_path, torch, torchaudio)

    assert loaded_sample_rate == sample_rate
    assert tuple(waveform.shape) == (1, len(samples))
    assert waveform[0, 0].item() == 0
    assert round(waveform[0, 1].item(), 2) == 0.25
    assert round(waveform[0, 2].item(), 2) == -0.25


def test_wav_masking_silences_only_selected_audio(tmp_path):
    source_path = tmp_path / "source.wav"
    output_path = tmp_path / "masked.wav"
    sample_rate = 8000
    samples = [
        int(12000 * math.sin(2 * math.pi * 440 * index / sample_rate))
        for index in range(sample_rate)
    ]
    with wave.open(str(source_path), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.writeframes(b"".join(struct.pack("<h", sample) for sample in samples))

    service = AudioAlignmentService()
    wrote = service._try_mask_wav_file(
        source_path,
        output_path,
        [MaskInterval(start_seconds=0.2, end_seconds=0.4, labels=["PHONE"], text="1234")],
    )

    assert wrote is True
    with wave.open(str(output_path), "rb") as reader:
        frames = reader.readframes(reader.getnframes())
    masked_samples = struct.unpack(f"<{len(frames) // 2}h", frames)

    assert any(abs(sample) > 0 for sample in masked_samples[: int(sample_rate * 0.15)])
    assert set(masked_samples[int(sample_rate * 0.2) : int(sample_rate * 0.4)]) == {0}
    assert any(abs(sample) > 0 for sample in masked_samples[int(sample_rate * 0.45) : int(sample_rate * 0.6)])
