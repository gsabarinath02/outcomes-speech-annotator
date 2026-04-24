import type { TranscriptVariant } from "@outcomes/shared-types";

function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
}

function computeTokenFrequency(transcripts: TranscriptVariant[]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const transcript of transcripts) {
    const uniqueTokens = new Set(
      transcript.transcript_text
        .split(/\s+/)
        .map((token) => normalizeToken(token.trim()))
        .filter(Boolean)
    );
    uniqueTokens.forEach((token) => {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    });
  }
  return frequency;
}

export function TranscriptComparison({
  transcripts,
  onCopy
}: {
  transcripts: TranscriptVariant[];
  onCopy: (text: string) => void;
}) {
  const tokenFrequency = computeTokenFrequency(transcripts);
  const totalSources = transcripts.length;

  if (transcripts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#d1d5db] bg-[#f8fafc] px-4 py-3 text-sm text-[#6b7280]">
        No transcript variants were imported for this task.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      {transcripts.map((transcript) => (
        <article key={transcript.id} className="rounded-xl border border-[#e5e7eb] bg-white p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[#111827]">{transcript.source_label}</span>
              <span className="rounded-full border border-[#e5e7eb] bg-[#f8fafc] px-2 py-0.5 text-[11px] text-[#6b7280]">
                {transcript.source_key}
              </span>
            </div>
            <span className="rounded-full border border-[#e5e7eb] bg-[#f8fafc] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">
              ASR Variant
            </span>
          </div>

          <p className="h-[140px] overflow-auto rounded-lg border border-[#e5e7eb] bg-[#f8fafc] px-3 py-2 text-sm font-mono leading-6 text-[#111827]">
            {transcript.transcript_text.split(/\s+/).map((token, index, tokens) => {
              const normalized = normalizeToken(token);
              const isDisagreement = normalized && (tokenFrequency.get(normalized) ?? 0) < totalSources;
              return (
                <span
                  key={`${transcript.id}-${index}`}
                  className={isDisagreement ? "rounded bg-[#ffe9d8] px-0.5 text-[#7f3f2f]" : ""}
                >
                  {token}
                  {index < tokens.length - 1 ? " " : ""}
                </span>
              );
            })}
          </p>

          <button
            type="button"
            onClick={() => onCopy(transcript.transcript_text)}
            className="oa-btn-primary mt-3 w-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em]"
          >
            Copy to Final Transcript
          </button>
        </article>
      ))}
    </div>
  );
}
