import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AudioWaveformPlayer } from "@/components/audio-waveform-player";

describe("AudioWaveformPlayer", () => {
  it("seeks only for unmodified seek shortcuts", () => {
    const { container } = render(<AudioWaveformPlayer audioUrl="/audio/test.mp3" />);
    const audio = container.querySelector("audio") as HTMLAudioElement;

    audio.currentTime = 10;
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    expect(audio.currentTime).toBe(10);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(audio.currentTime).toBe(15);
  });
});
