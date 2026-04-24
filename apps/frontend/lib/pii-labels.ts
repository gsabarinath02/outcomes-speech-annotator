import type { PIIAnnotation, PIILabel } from "@outcomes/shared-types";

export interface PIILabelOption {
  key: string;
  display_name: string;
  color: string;
}

export const fallbackPIILabels: PIILabelOption[] = [
  { key: "EMAIL", display_name: "Email", color: "#2563eb" },
  { key: "PHONE", display_name: "Phone", color: "#16a34a" },
  { key: "SSN", display_name: "SSN", color: "#dc2626" },
  { key: "CREDIT_CARD", display_name: "Credit Card", color: "#ea580c" },
  { key: "IP_ADDRESS", display_name: "IP Address", color: "#4f46e5" },
  { key: "URL", display_name: "URL", color: "#0891b2" },
  { key: "PERSON", display_name: "Person", color: "#ca8a04" },
  { key: "NAME", display_name: "Name", color: "#a16207" },
  { key: "ADDRESS", display_name: "Address", color: "#9333ea" },
  { key: "OTHER", display_name: "Other", color: "#64748b" },
];

export function toPIILabelOptions(labels: PIILabel[] | PIILabelOption[] | undefined): PIILabelOption[] {
  const source = labels && labels.length > 0 ? labels : fallbackPIILabels;
  return source
    .map((label) => ({
      key: label.key,
      display_name: label.display_name,
      color: label.color || "#64748b",
    }))
    .filter((label) => label.key.trim().length > 0);
}

export function labelsWithAnnotationKeys(
  options: PIILabelOption[],
  annotations: PIIAnnotation[]
): PIILabelOption[] {
  const byKey = new Map(options.map((label) => [label.key, label]));
  annotations.forEach((annotation) => {
    if (!byKey.has(annotation.label)) {
      byKey.set(annotation.label, {
        key: annotation.label,
        display_name: annotation.label,
        color: "#64748b",
      });
    }
  });
  return Array.from(byKey.values());
}

export function labelDisplayName(key: string, options: PIILabelOption[]): string {
  return options.find((label) => label.key === key)?.display_name ?? key;
}

export function labelColor(key: string, options: PIILabelOption[]): string {
  return options.find((label) => label.key === key)?.color ?? "#64748b";
}
