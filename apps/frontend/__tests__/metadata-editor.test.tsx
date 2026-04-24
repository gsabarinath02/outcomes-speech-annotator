import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MetadataEditor } from "@/components/metadata-editor";

describe("MetadataEditor", () => {
  it("emits core and custom metadata edits", () => {
    const onCoreChange = vi.fn();
    const onCustomChange = vi.fn();
    render(
      <MetadataEditor
        value={{
          speaker_gender: "female",
          speaker_role: "caller",
          language: "en",
          channel: "mono",
          duration_seconds: "12.4"
        }}
        original={{
          speaker_gender: "female",
          speaker_role: "caller",
          language: "en",
          channel: "mono",
          duration_seconds: "12.4"
        }}
        customMetadata={{ custom_tag: "A1" }}
        originalCustomMetadata={{ custom_tag: "A1" }}
        onCoreChange={onCoreChange}
        onCustomChange={onCustomChange}
      />
    );

    fireEvent.change(screen.getByDisplayValue("caller"), { target: { value: "agent" } });
    fireEvent.change(screen.getByDisplayValue("A1"), { target: { value: "A2" } });

    expect(onCoreChange).toHaveBeenCalledWith("speaker_role", "agent");
    expect(onCustomChange).toHaveBeenCalledWith("custom_tag", "A2");
  });
});
