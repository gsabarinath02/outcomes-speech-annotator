export interface CoreMetadataState {
  speaker_gender: string;
  speaker_role: string;
  language: string;
  channel: string;
  duration_seconds: string;
}

interface MetadataEditorProps {
  value: CoreMetadataState;
  original: CoreMetadataState;
  customMetadata: Record<string, string>;
  originalCustomMetadata: Record<string, string>;
  onCoreChange: (field: keyof CoreMetadataState, value: string) => void;
  onCustomChange: (field: string, value: string) => void;
}

const coreFields: Array<{ key: keyof CoreMetadataState; label: string; type?: string }> = [
  { key: "speaker_gender", label: "Speaker Gender" },
  { key: "speaker_role", label: "Speaker Role" },
  { key: "language", label: "Language" },
  { key: "channel", label: "Channel" },
  { key: "duration_seconds", label: "Duration (sec)", type: "number" }
];

export function MetadataEditor({
  value,
  original,
  customMetadata,
  originalCustomMetadata,
  onCoreChange,
  onCustomChange
}: MetadataEditorProps) {
  const customKeys = Array.from(new Set([...Object.keys(customMetadata), ...Object.keys(originalCustomMetadata)])).sort();

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#e5e7eb] bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4b5563]">Core Metadata</p>
          <span className="rounded-full border border-[#e5e7eb] bg-[#f8fafc] px-2.5 py-1 text-[11px] text-[#6b7280]">Editable</span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {coreFields.map((field) => {
            const dirty = value[field.key] !== original[field.key];
            return (
              <label key={field.key} className="flex flex-col gap-1.5">
                <span className="flex items-center justify-between text-xs font-medium text-[#4b5563]">
                  {field.label}
                  {dirty ? <span className="rounded-full border border-[#d1fae5] bg-[#ecfdf3] px-2 py-0.5 text-[10px] text-[#047857]">Edited</span> : null}
                </span>
                <input
                  type={field.type ?? "text"}
                  value={value[field.key]}
                  onChange={(event) => onCoreChange(field.key, event.target.value)}
                  className={`oa-input ${dirty ? "border-[#86efac] bg-[#f6fff8]" : ""}`}
                />
              </label>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-[#e5e7eb] bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4b5563]">Custom Metadata</h3>
          <span className="text-[11px] text-[#6b7280]">{customKeys.length} fields</span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {customKeys.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#d1d5db] bg-[#f8fafc] px-3 py-2 text-sm text-[#6b7280]">
              No custom metadata columns for this task.
            </p>
          ) : (
            customKeys.map((key) => {
              const current = customMetadata[key] ?? "";
              const originalValue = originalCustomMetadata[key] ?? "";
              const dirty = current !== originalValue;
              return (
                <label key={key} className="flex flex-col gap-1.5">
                  <span className="flex items-center justify-between text-xs font-medium text-[#4b5563]">
                    {key}
                    {dirty ? <span className="rounded-full border border-[#d1fae5] bg-[#ecfdf3] px-2 py-0.5 text-[10px] text-[#047857]">Edited</span> : null}
                  </span>
                  <input
                    value={current}
                    onChange={(event) => onCustomChange(key, event.target.value)}
                    className={`oa-input ${dirty ? "border-[#86efac] bg-[#f6fff8]" : ""}`}
                  />
                </label>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
