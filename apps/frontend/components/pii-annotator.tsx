import type { PIIAnnotation } from "@outcomes/shared-types";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import {
  labelColor,
  labelDisplayName,
  labelsWithAnnotationKeys,
  toPIILabelOptions,
  type PIILabelOption,
} from "@/lib/pii-labels";

interface PIIAnnotatorProps {
  transcript: string;
  annotations: PIIAnnotation[];
  onChange: (annotations: PIIAnnotation[]) => void;
  onDetect: () => void;
  onClear: () => void;
  labels?: PIILabelOption[];
}

interface SelectedTranscriptRange {
  start: number;
  end: number;
  text: string;
}

function createManualPIIId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSelectedTranscriptRange(
  container: HTMLElement,
  transcript: string
): SelectedTranscriptRange | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const selectedNode =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (!selectedNode || !container.contains(selectedNode)) {
    return null;
  }

  const beforeSelection = document.createRange();
  beforeSelection.selectNodeContents(container);
  beforeSelection.setEnd(range.startContainer, range.startOffset);

  const rawText = range.toString();
  const leadingWhitespace = rawText.length - rawText.trimStart().length;
  const trailingWhitespace = rawText.length - rawText.trimEnd().length;
  const start = Math.max(
    0,
    Math.min(transcript.length, beforeSelection.toString().length + leadingWhitespace)
  );
  const end = Math.max(
    start,
    Math.min(transcript.length, start + rawText.length - leadingWhitespace - trailingWhitespace)
  );

  if (end <= start) {
    return null;
  }

  return { start, end, text: transcript.slice(start, end) };
}

function renderHighlightedTranscript(
  transcript: string,
  annotations: PIIAnnotation[],
  labelOptions: PIILabelOption[]
) {
  if (!transcript) {
    return <span className="text-[#7b7696]">No final transcript yet.</span>;
  }
  if (annotations.length === 0) {
    return <span>{transcript}</span>;
  }

  const safeAnnotations = [...annotations].sort((a, b) => a.start - b.start || a.end - b.end);
  const nodes: ReactNode[] = [];
  let cursor = 0;

  safeAnnotations.forEach((annotation) => {
    if (annotation.start > cursor) {
      nodes.push(
        <span key={`txt-${cursor}`}>{transcript.slice(cursor, annotation.start)}</span>
      );
    }
    nodes.push(
      <mark
        key={`pii-${annotation.id}`}
        className="rounded border px-0.5"
        style={labelColorStyle(annotation.label, labelOptions)}
        title={`${labelDisplayName(annotation.label, labelOptions)}${
          annotation.confidence !== null ? ` (${Math.round(annotation.confidence * 100)}%)` : ""
        }`}
      >
        {transcript.slice(annotation.start, annotation.end)}
      </mark>
    );
    cursor = annotation.end;
  });

  if (cursor < transcript.length) {
    nodes.push(<span key={`tail-${cursor}`}>{transcript.slice(cursor)}</span>);
  }
  return nodes;
}

function labelColorStyle(label: string, labelOptions: PIILabelOption[]): CSSProperties {
  const color = labelColor(label, labelOptions);
  return {
    backgroundColor: `${color}1f`,
    borderColor: `${color}55`,
    color,
  };
}

function overlappingIds(annotations: PIIAnnotation[]): Set<string> {
  const ids = new Set<string>();
  annotations.forEach((current, index) => {
    annotations.slice(index + 1).forEach((next) => {
      if (current.start < next.end && next.start < current.end) {
        ids.add(current.id);
        ids.add(next.id);
      }
    });
  });
  return ids;
}

export function PIIAnnotator({
  transcript,
  annotations,
  onChange,
  onDetect,
  onClear,
  labels,
}: PIIAnnotatorProps) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [selectedRange, setSelectedRange] = useState<SelectedTranscriptRange | null>(null);
  const labelOptions = useMemo(() => toPIILabelOptions(labels), [labels]);
  const annotationLabelOptions = useMemo(
    () => labelsWithAnnotationKeys(labelOptions, annotations),
    [annotations, labelOptions]
  );
  const [newLabel, setNewLabel] = useState("PERSON");
  const overlaps = overlappingIds(annotations);

  useEffect(() => {
    if (labelOptions.some((label) => label.key === newLabel)) {
      return;
    }
    setNewLabel(labelOptions[0]?.key ?? "OTHER");
  }, [labelOptions, newLabel]);

  const captureSelection = useCallback(() => {
    if (!transcriptRef.current) {
      return;
    }
    setSelectedRange(getSelectedTranscriptRange(transcriptRef.current, transcript));
  }, [transcript]);

  function clearTranscriptSelection() {
    window.getSelection()?.removeAllRanges();
    setSelectedRange(null);
  }

  function addSelectedAnnotation() {
    if (!selectedRange) {
      return;
    }
    onChange([
      ...annotations,
      {
        id: createManualPIIId(),
        label: newLabel,
        start: selectedRange.start,
        end: selectedRange.end,
        value: selectedRange.text,
        source: "manual",
        confidence: null,
      },
    ].sort((a, b) => a.start - b.start || a.end - b.end));
    clearTranscriptSelection();
  }

  function updateAnnotation(annotationId: string, patch: Partial<PIIAnnotation>) {
    onChange(
      annotations.map((item) => {
        if (item.id !== annotationId) return item;
        const start = Math.max(0, Math.min(transcript.length, Number(patch.start ?? item.start)));
        const end = Math.max(start + 1, Math.min(transcript.length, Number(patch.end ?? item.end)));
        return {
          ...item,
          ...patch,
          start,
          end,
          value: transcript.slice(start, end),
          source: patch.source !== undefined ? patch.source : item.source,
        };
      })
    );
  }

  function applySelectionToAnnotation(annotationId: string) {
    if (!selectedRange) {
      return;
    }
    updateAnnotation(annotationId, {
      start: selectedRange.start,
      end: selectedRange.end,
      source: "manual",
      confidence: null,
    });
    clearTranscriptSelection();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-[#111827]">PII Detection</h4>
          <p className="text-xs text-[#6b7280]">
            Highlighted entities can be reviewed, reselected, or removed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onDetect} className="oa-btn-secondary px-2.5 py-1.5 text-xs font-medium">
            Detect PII
          </button>
          <button type="button" onClick={onClear} className="oa-btn-quiet px-2.5 py-1.5 text-xs font-medium">
            Clear All
          </button>
        </div>
      </div>

      <div
        ref={transcriptRef}
        aria-label="Selectable transcript for PII"
        tabIndex={0}
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
        className="max-h-36 select-text overflow-auto rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-sm leading-6 text-[#111827] focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#bfdbfe]"
      >
        {renderHighlightedTranscript(transcript, annotations, annotationLabelOptions)}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#e5e7eb] bg-[#f8fafc] px-3 py-2">
        <span className="max-w-full truncate text-xs text-[#4b5563]">
          {selectedRange ? (
            <>
              Selected <span className="font-mono text-[#111827]">"{selectedRange.text}"</span>
            </>
          ) : (
            "No text selected"
          )}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            aria-label="New PII label"
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            className="oa-select py-1.5 text-xs"
            style={labelColorStyle(newLabel, labelOptions)}
          >
            {labelOptions.map((label) => (
              <option key={label.key} value={label.key}>
                {label.display_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addSelectedAnnotation}
            disabled={!selectedRange}
            className="oa-btn-primary px-2.5 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add Selection
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {annotations.length === 0 ? (
          <p className="rounded-md border border-dashed border-[#d1d5db] bg-[#f8fafc] px-3 py-2 text-xs text-[#6b7280]">
            No PII entities added yet.
          </p>
        ) : (
          annotations.map((annotation) => (
            <div
              key={annotation.id}
              className={`grid grid-cols-1 gap-2 rounded-md border bg-white p-2 md:grid-cols-[0.9fr_1fr_auto_auto] ${
                overlaps.has(annotation.id) ? "border-[#f59e0b]" : "border-[#e5e7eb]"
              }`}
            >
              <select
                aria-label={`PII label for ${annotation.value}`}
                value={annotation.label}
                onChange={(event) =>
                  updateAnnotation(annotation.id, { label: event.target.value })
                }
                className="oa-select py-1.5"
                style={labelColorStyle(annotation.label, annotationLabelOptions)}
              >
                {annotationLabelOptions.map((label) => (
                  <option key={label.key} value={label.key}>
                    {label.display_name}
                  </option>
                ))}
              </select>
              <input
                value={annotation.value}
                readOnly
                aria-label={`PII value for ${annotation.label}`}
                className="oa-input py-1.5 text-xs font-mono text-[#4b5563]"
              />
              <button
                type="button"
                onClick={() => applySelectionToAnnotation(annotation.id)}
                disabled={!selectedRange}
                className="rounded-md border border-[#c7d2fe] bg-white px-2.5 py-1.5 text-xs font-medium text-[#3730a3] hover:bg-[#eef2ff] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Use Selection
              </button>
              <button
                type="button"
                onClick={() => onChange(annotations.filter((item) => item.id !== annotation.id))}
                className="rounded-md border border-[#f0c8c8] bg-white px-2.5 py-1.5 text-xs font-medium text-[#a13a3a] hover:bg-[#fff2f2]"
              >
                Remove
              </button>
              <div className="flex flex-wrap items-center gap-2 md:col-span-4 text-[11px] text-[#6b7280]">
                <span>{annotation.source ? `Source: ${annotation.source}` : "Source: manual"}</span>
                <span>Range {annotation.start}-{annotation.end}</span>
                {annotation.confidence !== null ? (
                  <span className="rounded-full border border-[#dbeafe] bg-[#eff6ff] px-2 py-0.5 text-[#1d4ed8]">
                    Confidence {Math.round(annotation.confidence * 100)}%
                  </span>
                ) : null}
                {overlaps.has(annotation.id) ? (
                  <span className="rounded-full border border-[#fcd9a4] bg-[#fff7ed] px-2 py-0.5 text-[#9a3412]">
                    Overlap warning
                  </span>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
