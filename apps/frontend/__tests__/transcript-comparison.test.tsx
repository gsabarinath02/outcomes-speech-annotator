import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TranscriptComparison } from "@/components/transcript-comparison";

describe("TranscriptComparison", () => {
  it("copies transcript text to final transcript callback", () => {
    const onCopy = vi.fn();
    render(
      <TranscriptComparison
        transcripts={[
          {
            id: "1",
            source_key: "whisper",
            source_label: "Whisper",
            transcript_text: "hello world"
          },
          {
            id: "2",
            source_key: "qwen",
            source_label: "Qwen",
            transcript_text: "hello brave world"
          }
        ]}
        onCopy={onCopy}
      />
    );

    fireEvent.click(screen.getAllByText("Copy to Final Transcript")[0]);
    expect(onCopy).toHaveBeenCalledWith("hello world");
  });
});
