"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const WAVEFORM_BAR_COUNT = 160;

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function buildWaveformPeaks(buffer: AudioBuffer, barCount: number): number[] {
  const channels = Math.min(buffer.numberOfChannels, 2);
  if (channels === 0) return [];

  const blockSize = Math.max(1, Math.floor(buffer.length / barCount));
  const rawPeaks: number[] = [];

  for (let barIndex = 0; barIndex < barCount; barIndex += 1) {
    const start = barIndex * blockSize;
    const end = Math.min(start + blockSize, buffer.length);
    let peak = 0;

    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      const channelData = buffer.getChannelData(channelIndex);
      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        const magnitude = Math.abs(channelData[sampleIndex] ?? 0);
        if (magnitude > peak) peak = magnitude;
      }
    }

    rawPeaks.push(peak);
  }

  const maxPeak = Math.max(...rawPeaks, 0.001);
  return rawPeaks.map((value) => value / maxPeak);
}

export function AudioWaveformPlayer({ audioUrl }: { audioUrl: string | null }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const [waveformError, setWaveformError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      const audio = audioRef.current;
      if (!audio || !audioUrl) return;
      if (event.key === " " || event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (audio.paused) {
          void audio.play().catch(() => undefined);
        } else {
          audio.pause();
        }
      }
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "j") {
        event.preventDefault();
        audio.currentTime = Math.max(0, audio.currentTime - 5);
        setCurrentTime(audio.currentTime);
      }
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "l") {
        event.preventDefault();
        audio.currentTime = Math.min(duration || audio.duration || Number.POSITIVE_INFINITY, audio.currentTime + 5);
        setCurrentTime(audio.currentTime);
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [audioUrl, duration]);

  useEffect(() => {
    setCurrentTime(0);
    if (!audioUrl) {
      setPeaks([]);
      setDuration(0);
      setWaveformLoading(false);
      setWaveformError("Audio not available.");
      return;
    }
    const resolvedAudioUrl: string = audioUrl;

    const AudioContextConstructor =
      typeof window !== "undefined"
        ? (window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;

    if (!AudioContextConstructor) {
      setPeaks([]);
      setWaveformLoading(false);
      setWaveformError("Waveform preview is not supported in this browser.");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function loadWaveform() {
      const LocalAudioContextConstructor = AudioContextConstructor;
      if (!LocalAudioContextConstructor) {
        setWaveformLoading(false);
        setWaveformError("Waveform preview is not supported in this browser.");
        return;
      }

      setWaveformLoading(true);
      setWaveformError(null);
      try {
        const response = await fetch(resolvedAudioUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Waveform fetch failed: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const context = new LocalAudioContextConstructor();

        try {
          const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
          if (cancelled) return;
          setDuration(decoded.duration || 0);
          setPeaks(buildWaveformPeaks(decoded, WAVEFORM_BAR_COUNT));
        } finally {
          void context.close().catch(() => undefined);
        }
      } catch (error) {
        if (cancelled) return;
        if ((error as { name?: string }).name === "AbortError") return;
        setPeaks([]);
        setWaveformError("Could not render waveform for this audio.");
      } finally {
        if (!cancelled) {
          setWaveformLoading(false);
        }
      }
    }

    void loadWaveform();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [audioUrl]);

  const progress = useMemo(
    () => (duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0),
    [currentTime, duration]
  );

  const activeBars = Math.floor(progress * peaks.length);

  return (
    <div className="rounded-xl border border-[#e5e7eb] bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] p-3">
      <div className="flex items-center justify-between gap-2 text-xs text-[#6b7280]">
        <span className="font-medium text-[#374151]">Waveform</span>
        <span>
          {formatClock(currentTime)} / {formatClock(duration)}
        </span>
      </div>

      <div className="relative mt-2 h-24 overflow-hidden rounded-lg border border-[#e5e7eb] bg-white px-2 py-2">
        {waveformLoading ? (
          <div className="flex h-full items-end gap-[2px]">
            {Array.from({ length: WAVEFORM_BAR_COUNT }).map((_, index) => (
              <span
                key={`loading-bar-${index}`}
                style={{ height: `${20 + ((index * 13) % 60)}%` }}
                className="w-[4px] rounded-full bg-[#d1d5db] opacity-70"
              />
            ))}
          </div>
        ) : peaks.length > 0 ? (
          <button
            type="button"
            aria-label="Waveform seek area"
            className="block h-full w-full cursor-pointer border-0 bg-transparent p-0"
            onClick={(event) => {
              if (!audioRef.current || duration <= 0) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
              audioRef.current.currentTime = ratio * duration;
              setCurrentTime(audioRef.current.currentTime);
            }}
          >
            <div className="relative flex h-full items-end gap-[2px]">
              {peaks.map((peak, index) => {
                const heightPercent = Math.max(8, Math.round(peak * 100));
                const isPlayed = index <= activeBars;
                return (
                  <span
                    key={`peak-${index}`}
                    style={{ height: `${heightPercent}%` }}
                    className={`w-[4px] rounded-full transition-colors ${
                      isPlayed
                        ? "bg-[linear-gradient(180deg,#475569_0%,#334155_100%)]"
                        : "bg-[linear-gradient(180deg,#d1d5db_0%,#9ca3af_100%)]"
                    }`}
                  />
                );
              })}
              <span
                style={{ left: `${progress * 100}%` }}
                className="pointer-events-none absolute inset-y-0 w-[2px] -translate-x-1/2 rounded-full bg-[#0f172a]/30"
              />
            </div>
          </button>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[#6b7280]">
            {waveformError ?? "Waveform unavailable."}
          </div>
        )}
      </div>

      {audioUrl ? (
        <audio
          ref={audioRef}
          controls
          preload="metadata"
          className="mt-3 w-full"
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
          onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
          onEnded={() => setCurrentTime(0)}
        >
          <source src={audioUrl} />
        </audio>
      ) : null}
    </div>
  );
}
