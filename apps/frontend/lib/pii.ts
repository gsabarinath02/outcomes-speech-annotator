import type { PIIAnnotation } from "@outcomes/shared-types";

const PII_PATTERNS: Array<{ label: string; regex: RegExp; confidence: number }> = [
  { label: "EMAIL", regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, confidence: 0.97 },
  { label: "PHONE", regex: /(?:(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4})/g, confidence: 0.9 },
  { label: "SSN", regex: /\b\d{3}-\d{2}-\d{4}\b/g, confidence: 0.98 },
  { label: "CREDIT_CARD", regex: /\b(?:\d[ -]*?){13,16}\b/g, confidence: 0.86 },
  { label: "IP_ADDRESS", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, confidence: 0.84 },
  { label: "URL", regex: /\bhttps?:\/\/[^\s/$.?#].[^\s]*\b/gi, confidence: 0.9 },
];

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pii-${Math.random().toString(36).slice(2, 10)}`;
}

export function sanitizePIIAnnotations(transcript: string, annotations: PIIAnnotation[]): PIIAnnotation[] {
  const transcriptLength = transcript.length;
  const cleaned = annotations
    .map((annotation) => ({
      ...annotation,
      source: annotation.source ?? null,
      confidence: annotation.confidence ?? null
    }))
    .filter((annotation) => {
      if (!annotation.id || !annotation.label) return false;
      if (!Number.isInteger(annotation.start) || !Number.isInteger(annotation.end)) return false;
      if (annotation.start < 0 || annotation.end <= annotation.start) return false;
      if (annotation.end > transcriptLength) return false;
      const value = transcript.slice(annotation.start, annotation.end);
      return value.trim().length > 0;
    })
    .map((annotation) => ({
      ...annotation,
      value: transcript.slice(annotation.start, annotation.end)
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));

  const deduped: PIIAnnotation[] = [];
  for (const annotation of cleaned) {
    const duplicate = deduped.some(
      (item) =>
        item.start === annotation.start &&
        item.end === annotation.end &&
        item.label === annotation.label
    );
    if (!duplicate) {
      deduped.push(annotation);
    }
  }
  return deduped;
}

export function detectPIIAnnotations(transcript: string): PIIAnnotation[] {
  if (!transcript.trim()) {
    return [];
  }
  const detected: PIIAnnotation[] = [];

  for (const pattern of PII_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags.includes("g") ? pattern.regex.flags : `${pattern.regex.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(transcript)) !== null) {
      const value = match[0];
      if (!value.trim()) {
        continue;
      }
      const start = match.index;
      const end = start + value.length;
      detected.push({
        id: createId(),
        label: pattern.label,
        start,
        end,
        value,
        source: "auto",
        confidence: pattern.confidence
      });
      if (regex.lastIndex === match.index) {
        regex.lastIndex += 1;
      }
    }
  }

  detected.sort((a, b) => a.start - b.start || b.end - a.end);
  const nonOverlapping: PIIAnnotation[] = [];
  for (const annotation of detected) {
    const overlaps = nonOverlapping.some(
      (item) => annotation.start < item.end && item.start < annotation.end
    );
    if (!overlaps) {
      nonOverlapping.push(annotation);
    }
  }
  return sanitizePIIAnnotations(transcript, nonOverlapping);
}
