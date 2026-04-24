type SaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

export function SaveIndicator({
  state,
  lastSavedAt
}: {
  state: SaveState;
  lastSavedAt: string | null;
}) {
  const descriptor =
    state === "saving"
      ? { label: "Saving...", className: "border-[#bfd8ff] bg-[#eaf2ff] text-[#2d4f82]", dot: "bg-[#5b8bdf]" }
      : state === "unsaved"
        ? {
            label: "Unsaved changes",
            className: "border-[#ffd9a8] bg-[#fff5e7] text-[#965d13]",
            dot: "bg-[#f2aa43]"
          }
        : state === "saved"
          ? {
              label: `Saved${lastSavedAt ? ` at ${new Date(lastSavedAt).toLocaleTimeString()}` : ""}`,
              className: "border-[#bfe7cf] bg-[#eafaf0] text-[#1f5f3d]",
              dot: "bg-[#2dbb71]"
            }
          : state === "error"
            ? { label: "Save failed", className: "border-[#f4c1c1] bg-[#fdeeee] text-[#a23a3a]", dot: "bg-[#d24a4a]" }
            : { label: "No changes", className: "border-[#e8e1f3] bg-[#f8f5fd] text-[#5d5874]", dot: "bg-[#a59bbc]" };

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${descriptor.className}`}>
      <span className={`h-2 w-2 rounded-full ${descriptor.dot}`} aria-hidden />
      {descriptor.label}
    </span>
  );
}
