import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PIIAnnotator } from "@/components/pii-annotator";

describe("PIIAnnotator", () => {
  function selectText(textElement: HTMLElement, start: number, end: number) {
    const textNode = textElement.firstChild;
    if (!textNode) {
      throw new Error("Expected selectable transcript text");
    }
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  it("adds a PII annotation from selected transcript text instead of range sliders", () => {
    const onChange = vi.fn();

    render(
      <PIIAnnotator
        transcript="alpha 1234567890 omega"
        annotations={[]}
        onChange={onChange}
        onDetect={vi.fn()}
        onClear={vi.fn()}
      />
    );

    selectText(screen.getByText("alpha 1234567890 omega"), 6, 16);
    fireEvent.mouseUp(screen.getByText("alpha 1234567890 omega"));

    expect(screen.queryByLabelText(/PII start handle/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/PII end handle/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("New PII label"), {
      target: { value: "PHONE" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add Selection/i }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        label: "PHONE",
        start: 6,
        end: 16,
        value: "1234567890",
        source: "manual",
        confidence: null,
      }),
    ]);
  });
});
