import type { TaskDetail } from "@outcomes/shared-types";
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";

export type ConflictMergeChoice = "mine" | "server";
export type ConflictMergeResolution = Record<string, ConflictMergeChoice>;

export function ConflictModal({
  open,
  serverTask,
  conflictingFields,
  localValues,
  onUseMine,
  onUseServer,
  onMerge
}: {
  open: boolean;
  serverTask: TaskDetail | null;
  conflictingFields: string[];
  localValues?: Partial<TaskDetail>;
  onUseMine: () => void;
  onUseServer: () => void;
  onMerge: (resolution?: ConflictMergeResolution) => void;
}) {
  const [resolution, setResolution] = useState<ConflictMergeResolution>({});
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();
  }, [open]);

  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter((element) => !element.hasAttribute("disabled"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open || !serverTask) {
    return null;
  }
  const fields = conflictingFields.length > 0 ? conflictingFields : ["Changed field"];
  const effectiveResolution = Object.fromEntries(fields.map((field) => [field, resolution[field] ?? "mine"]));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#110f24]/45 p-4 backdrop-blur-[1.5px]" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
      <div ref={panelRef} onKeyDown={trapFocus} className="oa-card max-h-[90vh] w-full max-w-3xl overflow-auto p-6">
        <h2 id="conflict-title" className="oa-title text-lg font-semibold">Save Conflict Detected</h2>
        <p className="mt-1 text-sm text-[#5f5b77]">
          Another user saved this task before your latest save. Choose how to proceed.
        </p>

        <div className="mt-4 rounded-xl border border-[#e5dbf2] bg-[#f9f5ff] p-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.1em] text-[#625d7f]">Conflicting fields</p>
          <div className="flex flex-wrap gap-1.5">
            {fields.map((field) => (
              <span key={field} className="oa-chip">
                {field}
              </span>
            ))}
          </div>
          <p className="mt-1 text-xs text-[#777292]">{fields.join(", ")}</p>
          <p className="mt-2 text-xs text-[#6f6a89]">
            Server version: {serverTask.version} | Last update:{" "}
            {new Date(serverTask.updated_at).toLocaleString()}
          </p>
        </div>

        <div className="mt-4 space-y-2">
          {fields.map((field) => (
            <div key={field} className="grid gap-2 rounded-xl border border-[#e5dbf2] bg-white p-3 md:grid-cols-[150px_1fr_1fr_130px]">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#625d7f]">{field}</div>
              <PreviewValue label="Mine" value={localValues ? readConflictValue(localValues, field) : undefined} />
              <PreviewValue label="Server" value={readConflictValue(serverTask, field)} />
              <select
                aria-label={`Merge choice for ${field}`}
                value={effectiveResolution[field]}
                onChange={(event) =>
                  setResolution((prev) => ({ ...prev, [field]: event.target.value as ConflictMergeChoice }))
                }
                className="oa-select py-1.5 text-xs"
              >
                <option value="mine">Use Mine</option>
                <option value="server">Use Server</option>
              </select>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onUseServer}
            className="oa-btn-secondary px-3 py-2 text-sm font-medium"
          >
            Use Server Version
          </button>
          <button
            type="button"
            onClick={onUseMine}
            className="oa-btn-primary px-3 py-2 text-sm font-medium"
          >
            Keep My Changes
          </button>
          <button
            type="button"
            onClick={() => onMerge(effectiveResolution)}
            className="oa-btn-quiet px-3 py-2 text-sm font-medium"
          >
            Merge and Save
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#777292]">{label}</p>
      <p className="mt-1 max-h-20 overflow-auto break-words rounded-md bg-[#f8fafc] px-2 py-1 text-xs text-[#2f2a49]">
        {formatConflictValue(value)}
      </p>
    </div>
  );
}

function readConflictValue(task: Partial<TaskDetail>, field: string): unknown {
  if (field === "metadata") {
    return {
      speaker_gender: task.speaker_gender,
      speaker_role: task.speaker_role,
      language: task.language,
      channel: task.channel,
      duration_seconds: task.duration_seconds,
      custom_metadata: task.custom_metadata,
    };
  }
  return (task as Record<string, unknown>)[field];
}

function formatConflictValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
