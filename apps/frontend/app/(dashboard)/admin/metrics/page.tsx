"use client";

import Link from "next/link";
import type { AdminMetricsResponse, AdminUser, PIILabel, TaskStatus } from "@outcomes/shared-types";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { StatusBadge } from "@/components/status-badge";
import {
  APIError,
  createPIILabel,
  fetchAdminMetrics,
  fetchAdminPIILabels,
  fetchUsers,
  updatePIILabel,
} from "@/lib/api";

const taskStatuses: Array<TaskStatus | "All"> = [
  "All",
  "Not Started",
  "In Progress",
  "Completed",
  "Needs Review",
  "Reviewed",
  "Approved",
];

interface MetricFilters {
  status: TaskStatus | "All";
  assigneeId: string;
  jobId: string;
  language: string;
  dateFrom: string;
  dateTo: string;
}

interface LabelDraft {
  display_name: string;
  color: string;
  description: string;
  is_active: boolean;
  sort_order: number;
}

const emptyFilters: MetricFilters = {
  status: "All",
  assigneeId: "all",
  jobId: "",
  language: "",
  dateFrom: "",
  dateTo: "",
};

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "No data";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatRate(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "No data";
  }
  return value.toFixed(4);
}

function labelDraftFrom(label: PIILabel): LabelDraft {
  return {
    display_name: label.display_name,
    color: label.color,
    description: label.description ?? "",
    is_active: label.is_active,
    sort_order: label.sort_order,
  };
}

export default function AdminMetricsPage() {
  const { accessToken, user } = useAuth();
  const [metrics, setMetrics] = useState<AdminMetricsResponse | null>(null);
  const [labels, setLabels] = useState<PIILabel[]>([]);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, LabelDraft>>({});
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [filters, setFilters] = useState<MetricFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<MetricFilters>(emptyFilters);
  const [newLabelKey, setNewLabelKey] = useState("");
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#0f766e");
  const [newLabelDescription, setNewLabelDescription] = useState("");
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [labelBusy, setLabelBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canAdmin = user?.role === "ADMIN";

  const metricCards = useMemo(() => {
    const overview = metrics?.overview;
    return [
      { label: "Tasks", value: String(overview?.total_tasks ?? 0), detail: "matching filters" },
      { label: "Scored Tasks", value: String(overview?.scored_tasks ?? 0), detail: `${overview?.scored_pairs ?? 0} source pairs` },
      { label: "Average WER", value: formatPercent(overview?.average_wer ?? null), detail: "corrected transcript as ground truth" },
      { label: "Average CER", value: formatPercent(overview?.average_cer ?? null), detail: "character-level error" },
      { label: "PII Entities", value: String(overview?.total_pii_annotations ?? 0), detail: `${overview?.low_confidence_annotations ?? 0} low confidence` },
      { label: "Overlap Warnings", value: String(overview?.overlap_warnings ?? 0), detail: "PII spans needing review" },
    ];
  }, [metrics]);

  useEffect(() => {
    if (!accessToken || !canAdmin) return;
    let cancelled = false;

    async function loadAdminLookups() {
      try {
        const [labelResponse, userResponse] = await Promise.all([
          fetchAdminPIILabels(accessToken as string),
          fetchUsers(accessToken as string),
        ]);
        if (cancelled) return;
        setLabels(labelResponse.items);
        setLabelDrafts(Object.fromEntries(labelResponse.items.map((label) => [label.id, labelDraftFrom(label)])));
        setUsers(userResponse.items);
      } catch (err) {
        if (!cancelled) setError(err instanceof APIError ? err.message : "Failed to load admin lookups");
      }
    }

    void loadAdminLookups();
    return () => {
      cancelled = true;
    };
  }, [accessToken, canAdmin]);

  useEffect(() => {
    if (!accessToken || !canAdmin) return;
    let cancelled = false;

    async function loadMetrics() {
      setLoadingMetrics(true);
      setError(null);
      try {
        const data = await fetchAdminMetrics(accessToken as string, {
          status: appliedFilters.status,
          assigneeId: appliedFilters.assigneeId === "all" ? null : appliedFilters.assigneeId,
          jobId: appliedFilters.jobId.trim() || null,
          language: appliedFilters.language.trim() || null,
          dateFrom: appliedFilters.dateFrom || null,
          dateTo: appliedFilters.dateTo || null,
        });
        if (!cancelled) setMetrics(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof APIError ? err.message : "Failed to load metrics");
      } finally {
        if (!cancelled) setLoadingMetrics(false);
      }
    }

    void loadMetrics();
    return () => {
      cancelled = true;
    };
  }, [accessToken, appliedFilters, canAdmin]);

  async function reloadLabels() {
    if (!accessToken) return;
    const response = await fetchAdminPIILabels(accessToken);
    setLabels(response.items);
    setLabelDrafts(Object.fromEntries(response.items.map((label) => [label.id, labelDraftFrom(label)])));
  }

  async function handleCreateLabel() {
    if (!accessToken || !newLabelKey.trim() || !newLabelName.trim()) return;
    setLabelBusy(true);
    setError(null);
    setMessage(null);
    try {
      await createPIILabel(accessToken, {
        key: newLabelKey,
        display_name: newLabelName,
        color: newLabelColor,
        description: newLabelDescription.trim() || null,
      });
      setNewLabelKey("");
      setNewLabelName("");
      setNewLabelColor("#0f766e");
      setNewLabelDescription("");
      setMessage("PII label added.");
      await reloadLabels();
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to create PII label");
    } finally {
      setLabelBusy(false);
    }
  }

  async function handleSaveLabel(label: PIILabel) {
    if (!accessToken) return;
    const draft = labelDrafts[label.id];
    if (!draft) return;
    setLabelBusy(true);
    setError(null);
    setMessage(null);
    try {
      await updatePIILabel(accessToken, label.id, {
        display_name: draft.display_name,
        color: draft.color,
        description: draft.description.trim() || null,
        is_active: draft.is_active,
        sort_order: Number(draft.sort_order),
      });
      setMessage("PII label saved.");
      await reloadLabels();
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to update PII label");
    } finally {
      setLabelBusy(false);
    }
  }

  if (!canAdmin) {
    return (
      <div className="oa-card p-5">
        <h2 className="oa-title text-lg font-semibold">Admin Metrics</h2>
        <p className="mt-2 text-sm text-[#6b7280]">Only admins can view metrics and manage PII labels.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7c7895]">Admin</p>
          <h2 className="oa-title text-2xl font-semibold">Metrics</h2>
          <p className="mt-1 text-sm text-[#6b7280]">
            WER and CER compare each model transcript against the corrected final transcript.
          </p>
        </div>
        <div className="text-xs text-[#6b7280]">
          {metrics ? `Updated ${new Date(metrics.generated_at).toLocaleString()}` : "Loading metrics..."}
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#991b1b]">{error}</div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-sm text-[#166534]">{message}</div>
      ) : null}

      <section className="oa-card p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {metricCards.map((card) => (
            <div key={card.label} className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6b7280]">{card.label}</div>
              <div className="mt-2 text-2xl font-semibold text-[#111827]">{loadingMetrics ? "..." : card.value}</div>
              <div className="mt-1 text-xs text-[#6b7280]">{card.detail}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="oa-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="oa-title text-sm font-semibold">Filters</h3>
          <button
            type="button"
            onClick={() => setAppliedFilters(filters)}
            className="oa-btn-primary px-3 py-1.5 text-xs font-medium"
          >
            Apply Filters
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <label className="text-xs font-medium text-[#4b5563]">
            Status
            <select
              aria-label="Status"
              value={filters.status}
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value as TaskStatus | "All" }))}
              className="oa-select mt-1 w-full"
            >
              {taskStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-[#4b5563]">
            Assignee
            <select
              aria-label="Assignee"
              value={filters.assigneeId}
              onChange={(event) => setFilters((prev) => ({ ...prev, assigneeId: event.target.value }))}
              className="oa-select mt-1 w-full"
            >
              <option value="all">All</option>
              <option value="unassigned">Unassigned</option>
              {users.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-[#4b5563]">
            Language
            <input
              aria-label="Language"
              value={filters.language}
              onChange={(event) => setFilters((prev) => ({ ...prev, language: event.target.value }))}
              className="oa-input mt-1 w-full"
              placeholder="Language code"
            />
          </label>
          <label className="text-xs font-medium text-[#4b5563]">
            Upload Job
            <input
              aria-label="Upload Job"
              value={filters.jobId}
              onChange={(event) => setFilters((prev) => ({ ...prev, jobId: event.target.value }))}
              className="oa-input mt-1 w-full"
              placeholder="Upload job ID"
            />
          </label>
          <label className="text-xs font-medium text-[#4b5563]">
            From
            <input
              aria-label="From"
              type="date"
              value={filters.dateFrom}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))}
              className="oa-input mt-1 w-full"
            />
          </label>
          <label className="text-xs font-medium text-[#4b5563]">
            To
            <input
              aria-label="To"
              type="date"
              value={filters.dateTo}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))}
              className="oa-input mt-1 w-full"
            />
          </label>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <div className="oa-card p-4">
          <h3 className="oa-title mb-3 text-sm font-semibold">Model Accuracy</h3>
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.08em] text-[#6b7280]">
                <tr>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Tasks</th>
                  <th className="px-3 py-2">WER</th>
                  <th className="px-3 py-2">CER</th>
                  <th className="px-3 py-2">Word Edits</th>
                  <th className="px-3 py-2">Char Edits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2f7]">
                {(metrics?.model_metrics ?? []).map((item) => (
                  <tr key={item.source_key}>
                    <td className="px-3 py-2 font-medium text-[#111827]">{item.source_label}</td>
                    <td className="px-3 py-2 text-[#4b5563]">{item.tasks_scored}</td>
                    <td className="px-3 py-2 text-[#4b5563]">{formatPercent(item.average_wer)}</td>
                    <td className="px-3 py-2 text-[#4b5563]">{formatPercent(item.average_cer)}</td>
                    <td className="px-3 py-2 text-[#4b5563]">
                      {item.word_errors}/{item.reference_words}
                    </td>
                    <td className="px-3 py-2 text-[#4b5563]">
                      {item.character_errors}/{item.reference_characters}
                    </td>
                  </tr>
                ))}
                {metrics?.model_metrics.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-5 text-center text-sm text-[#6b7280]">
                      No corrected transcripts with model sources match these filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="oa-card p-4">
          <h3 className="oa-title mb-3 text-sm font-semibold">PII Metrics</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-2">
              <div className="text-xs text-[#6b7280]">Average per task</div>
              <div className="mt-1 text-xl font-semibold text-[#111827]">
                {loadingMetrics ? "..." : metrics ? metrics.pii_metrics.average_annotations_per_task.toFixed(2) : "No data"}
              </div>
            </div>
            <div className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-2">
              <div className="text-xs text-[#6b7280]">Low confidence</div>
              <div className="mt-1 text-xl font-semibold text-[#111827]">
                {loadingMetrics ? "..." : metrics ? metrics.pii_metrics.low_confidence_annotations : "No data"}
              </div>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {Object.entries(metrics?.pii_metrics.by_label ?? {}).map(([label, count]) => (
              <div key={label} className="flex items-center justify-between rounded-lg border border-[#e5e7eb] bg-white px-3 py-2">
                <span className="text-sm font-medium text-[#111827]">{label}</span>
                <span className="text-sm text-[#4b5563]">{count}</span>
              </div>
            ))}
            {Object.keys(metrics?.pii_metrics.by_label ?? {}).length === 0 ? (
              <p className="rounded-lg border border-dashed border-[#d1d5db] px-3 py-3 text-sm text-[#6b7280]">
                No PII annotations match these filters.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="oa-card p-4">
          <h3 className="oa-title mb-3 text-sm font-semibold">Tagger Metrics</h3>
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.08em] text-[#6b7280]">
                <tr>
                  <th className="px-3 py-2">Tagger</th>
                  <th className="px-3 py-2">Touched</th>
                  <th className="px-3 py-2">Completed</th>
                  <th className="px-3 py-2">Reviewed</th>
                  <th className="px-3 py-2">Approved</th>
                  <th className="px-3 py-2">PII</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2f7]">
                {(metrics?.tagger_metrics ?? []).map((item, index) => (
                  <tr key={item.user_id ?? item.user_email ?? `tagger-${index}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-[#111827]">
                        {item.user_name ?? item.user_email ?? item.user_id ?? "Deleted user"}
                      </div>
                      {item.user_email && item.user_name ? (
                        <div className="text-xs text-[#6b7280]">{item.user_email}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-[#4b5563]">{item.tasks_touched}</td>
                    <td className="px-3 py-2 text-[#4b5563]">{item.completed_tasks}</td>
                    <td className="px-3 py-2 text-[#4b5563]">{item.reviewed_tasks}</td>
                    <td className="px-3 py-2 text-[#4b5563]">{item.approved_tasks}</td>
                    <td className="px-3 py-2 text-[#4b5563]">{item.pii_annotations}</td>
                  </tr>
                ))}
                {metrics?.tagger_metrics.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-5 text-center text-sm text-[#6b7280]">
                      No tagger activity matches these filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="oa-card p-4">
          <h3 className="oa-title mb-3 text-sm font-semibold">Highest WER Tasks</h3>
          <div className="space-y-2">
            {(metrics?.worst_tasks ?? []).slice(0, 8).map((task) => (
              <div key={task.task_id} className="rounded-lg border border-[#e5e7eb] bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link href={`/tasks/${task.task_id}`} className="text-sm font-semibold text-[#2563eb] hover:underline">
                      {task.external_id}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#6b7280]">
                      <StatusBadge status={task.status} />
                      <span>{task.language ?? "Language not set"}</span>
                      <span>{task.last_tagger_name ?? "No tagger recorded"}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-[#6b7280]">Max WER</div>
                    <div className="text-lg font-semibold text-[#111827]">{formatPercent(task.max_wer)}</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {task.source_metrics.map((source) => (
                    <span
                      key={source.source_key}
                      className="rounded-full border border-[#e5e7eb] bg-[#f8fafc] px-2 py-0.5 text-xs text-[#4b5563]"
                    >
                      {source.source_label}: {formatRate(source.wer)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {metrics?.worst_tasks.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[#d1d5db] px-3 py-3 text-sm text-[#6b7280]">
                No scored tasks match these filters.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="oa-card p-4">
        <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="oa-title text-sm font-semibold">PII Label Management</h3>
            <p className="mt-1 text-xs text-[#6b7280]">
              Active labels appear in the annotator dropdown for taggers.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[150px_180px_90px_minmax(200px,1fr)_auto]">
            <input
              aria-label="New label key"
              value={newLabelKey}
              onChange={(event) => setNewLabelKey(event.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, "_"))}
              className="oa-input"
              placeholder="Label key"
            />
            <input
              aria-label="New label name"
              value={newLabelName}
              onChange={(event) => setNewLabelName(event.target.value)}
              className="oa-input"
              placeholder="Display name"
            />
            <input
              aria-label="New label color"
              type="color"
              value={newLabelColor}
              onChange={(event) => setNewLabelColor(event.target.value)}
              className="h-10 w-full rounded-lg border border-[#d1d5db] bg-white px-2"
            />
            <input
              aria-label="New label description"
              value={newLabelDescription}
              onChange={(event) => setNewLabelDescription(event.target.value)}
              className="oa-input"
              placeholder="Optional description"
            />
            <button
              type="button"
              onClick={handleCreateLabel}
              disabled={labelBusy || !newLabelKey.trim() || !newLabelName.trim()}
              className="oa-btn-primary px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add Label
            </button>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.08em] text-[#6b7280]">
              <tr>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Display</th>
                <th className="px-3 py-2">Color</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef2f7]">
              {labels.map((label) => {
                const draft = labelDrafts[label.id] ?? labelDraftFrom(label);
                return (
                  <tr key={label.id}>
                    <td className="px-3 py-2">
                      <span
                        className="rounded-full border px-2 py-0.5 text-xs font-semibold"
                        style={{ borderColor: `${draft.color}55`, color: draft.color, backgroundColor: `${draft.color}14` }}
                      >
                        {label.key}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        aria-label={`Display name for ${label.key}`}
                        value={draft.display_name}
                        onChange={(event) =>
                          setLabelDrafts((prev) => ({
                            ...prev,
                            [label.id]: { ...draft, display_name: event.target.value },
                          }))
                        }
                        className="oa-input min-w-[150px] py-1.5"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        aria-label={`Color for ${label.key}`}
                        type="color"
                        value={draft.color}
                        onChange={(event) =>
                          setLabelDrafts((prev) => ({
                            ...prev,
                            [label.id]: { ...draft, color: event.target.value },
                          }))
                        }
                        className="h-9 w-14 rounded-md border border-[#d1d5db] bg-white px-1"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        aria-label={`Description for ${label.key}`}
                        value={draft.description}
                        onChange={(event) =>
                          setLabelDrafts((prev) => ({
                            ...prev,
                            [label.id]: { ...draft, description: event.target.value },
                          }))
                        }
                        className="oa-input min-w-[220px] py-1.5"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        aria-label={`Sort order for ${label.key}`}
                        type="number"
                        min={0}
                        value={draft.sort_order}
                        onChange={(event) =>
                          setLabelDrafts((prev) => ({
                            ...prev,
                            [label.id]: { ...draft, sort_order: Number(event.target.value) },
                          }))
                        }
                        className="oa-input w-24 py-1.5"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        aria-label={`Active ${label.key}`}
                        type="checkbox"
                        checked={draft.is_active}
                        onChange={(event) =>
                          setLabelDrafts((prev) => ({
                            ...prev,
                            [label.id]: { ...draft, is_active: event.target.checked },
                          }))
                        }
                        className="h-4 w-4 rounded border-[#d1d5db]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => handleSaveLabel(label)}
                        disabled={labelBusy}
                        className="oa-btn-secondary px-2.5 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
