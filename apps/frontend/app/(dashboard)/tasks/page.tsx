"use client";

import type { AdminUser, TaskStatus } from "@outcomes/shared-types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { useAuth } from "@/components/auth-provider";
import { StatusBadge } from "@/components/status-badge";
import {
  APIError,
  bulkAssignTasks,
  claimNextTask,
  claimTask,
  fetchNextTask,
  fetchTasks,
  fetchUsers,
  patchTaskAssignee
} from "@/lib/api";

const statusOptions: Array<TaskStatus | "All"> = [
  "All",
  "Not Started",
  "In Progress",
  "Completed",
  "Needs Review",
  "Reviewed",
  "Approved"
];

export default function TasksPage() {
  const { accessToken, user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "All">("All");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchTasks>> | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [assigneeDraftByTask, setAssigneeDraftByTask] = useState<Record<string, string>>({});
  const [assignmentBusyTaskId, setAssignmentBusyTaskId] = useState<string | null>(null);
  const [claimBusyTaskId, setClaimBusyTaskId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [bulkAssigneeId, setBulkAssigneeId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startTransition] = useTransition();
  const router = useRouter();
  const isAdmin = user?.role === "ADMIN";
  const isReviewer = user?.role === "REVIEWER";
  const canClaim = user?.role === "ANNOTATOR" || user?.role === "REVIEWER";

  useEffect(() => {
    if (!accessToken || !isAdmin) {
      setUsers([]);
      return;
    }
    void (async () => {
      try {
        const response = await fetchUsers(accessToken);
        setUsers(response.items);
      } catch {
        setUsers([]);
      }
    })();
  }, [accessToken, isAdmin]);

  useEffect(() => {
    if (!accessToken) return;
    startTransition(async () => {
      try {
        const response = await fetchTasks(accessToken, {
          search: search || undefined,
          status: statusFilter === "All" ? undefined : statusFilter,
          assigneeId: assigneeFilter === "all" ? undefined : assigneeFilter,
          page,
          pageSize: 25
        });
        setData(response);
        setAssigneeDraftByTask((prev) => {
          const next = { ...prev };
          response.items.forEach((task) => {
            if (!Object.prototype.hasOwnProperty.call(next, task.id)) {
              next[task.id] = task.assignee_id ?? "";
            }
          });
          return next;
        });
        setSelectedTaskIds((prev) => prev.filter((taskId) => response.items.some((task) => task.id === taskId)));
        setError(null);
      } catch (err) {
        if (err instanceof APIError) {
          setError(err.message);
          return;
        }
        setError("Failed to load tasks");
      }
    });
  }, [accessToken, statusFilter, assigneeFilter, search, page]);

  const visibleTasks = data?.items ?? [];

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / data.page_size));
  }, [data]);

  async function openNextTask() {
    if (!accessToken) return;
    try {
      const next = await fetchNextTask(accessToken);
      if (next.task_id) {
        router.push(`/tasks/${next.task_id}`);
      }
    } catch {
      setError("Failed to fetch next task");
    }
  }

  async function claimAndOpenNextTask() {
    if (!accessToken || !canClaim) return;
    setClaimBusyTaskId("next");
    try {
      const response = await claimNextTask(accessToken);
      router.push(`/tasks/${response.task.id}`);
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to claim next task");
    } finally {
      setClaimBusyTaskId(null);
    }
  }

  async function claimVisibleTask(taskId: string) {
    if (!accessToken || !canClaim || claimBusyTaskId) return;
    setClaimBusyTaskId(taskId);
    try {
      const response = await claimTask(accessToken, taskId);
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  assignee_id: response.task.assignee_id,
                  assignee_name: response.task.assignee_name,
                  assignee_email: response.task.assignee_email,
                  version: response.task.version,
                }
              : task
          ),
        };
      });
      setError(null);
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to claim task");
    } finally {
      setClaimBusyTaskId(null);
    }
  }

  async function assignTask(taskId: string, currentVersion: number) {
    if (!accessToken || !isAdmin || assignmentBusyTaskId) return;
    const selectedAssignee = (assigneeDraftByTask[taskId] ?? "").trim();
    setAssignmentBusyTaskId(taskId);
    try {
      const response = await patchTaskAssignee(accessToken, taskId, {
        version: currentVersion,
        assignee_id: selectedAssignee || null,
      });
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  assignee_id: response.task.assignee_id,
                  assignee_name: response.task.assignee_name,
                  assignee_email: response.task.assignee_email,
                  version: response.task.version,
                  updated_at: response.task.updated_at,
                  last_saved_at: response.task.last_saved_at,
                }
              : task
          ),
        };
      });
      setAssigneeDraftByTask((prev) => ({ ...prev, [taskId]: response.task.assignee_id ?? "" }));
      setError(null);
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to assign task");
    } finally {
      setAssignmentBusyTaskId(null);
    }
  }

  async function applyBulkAssignment() {
    if (!accessToken || !isAdmin || bulkBusy || selectedTaskIds.length === 0) return;
    const taskById = new Map(visibleTasks.map((task) => [task.id, task]));
    const assignments = selectedTaskIds
      .map((taskId) => taskById.get(taskId))
      .filter((task): task is NonNullable<typeof task> => Boolean(task))
      .map((task) => ({
        task_id: task.id,
        version: task.version,
        assignee_id: bulkAssigneeId || null,
      }));
    if (assignments.length === 0) return;

    setBulkBusy(true);
    try {
      const response = await bulkAssignTasks(accessToken, assignments);
      const updatedById = new Map(response.updated.map((item) => [item.task.id, item.task]));
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((task) => {
            const updated = updatedById.get(task.id);
            return updated
              ? {
                  ...task,
                  assignee_id: updated.assignee_id,
                  assignee_name: updated.assignee_name,
                  assignee_email: updated.assignee_email,
                  version: updated.version,
                  updated_at: updated.updated_at,
                  last_saved_at: updated.last_saved_at,
                }
              : task;
          }),
        };
      });
      setSelectedTaskIds((prev) => prev.filter((taskId) => !updatedById.has(taskId)));
      setBulkResult(`${response.updated.length} assigned, ${response.errors.length} conflict/error${response.errors.length === 1 ? "" : "s"}.`);
      setError(response.errors[0]?.message ?? null);
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Bulk assignment failed");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <section className="animate-fade-in space-y-4">
      <div className="oa-card p-5 sm:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#797590]">Workspace</p>
            <h2 className="oa-title mt-1 text-xl font-semibold">Annotation Queue</h2>
            <p className="oa-subtext mt-1 text-sm">Search, filter, and open tasks for correction workflows.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canClaim ? (
              <button
                type="button"
                onClick={claimAndOpenNextTask}
                disabled={claimBusyTaskId === "next"}
                className="oa-btn-primary px-3.5 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
              >
                {claimBusyTaskId === "next" ? "Claiming..." : "Claim Next"}
              </button>
            ) : null}
            <button type="button" onClick={openNextTask} className="oa-btn-secondary px-3.5 py-2 text-sm font-medium">
              Open Next Unfinished
            </button>
          </div>
        </div>

        <div className={`mt-4 grid grid-cols-1 gap-3 ${isAdmin ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[#676280]">Search</span>
            <input
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
              placeholder="Search by task ID or file location"
              className="oa-input"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[#676280]">Status</span>
            <select
              value={statusFilter}
              onChange={(event) => {
                setPage(1);
                setStatusFilter(event.target.value as TaskStatus | "All");
              }}
              className="oa-select"
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          {isAdmin ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-[#676280]">Assignee</span>
              <select
                value={assigneeFilter}
                onChange={(event) => {
                  setPage(1);
                  setAssigneeFilter(event.target.value);
                }}
                className="oa-select"
              >
                <option value="all">All</option>
                <option value="unassigned">Unassigned</option>
                {users.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.full_name} ({account.role})
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="oa-card-soft flex flex-col justify-center px-3 py-2">
            <span className="text-xs font-medium text-[#676280]">Volume</span>
            <span className="mt-0.5 text-sm font-medium text-[#201d3f]">
              {data ? `Total ${data.total} tasks` : "Loading totals..."}
            </span>
          </div>
        </div>

        {isReviewer ? (
          <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Reviewer queue filters">
            {(["Needs Review", "Reviewed", "Approved"] as TaskStatus[]).map((reviewStatus) => (
              <button
                key={reviewStatus}
                type="button"
                onClick={() => {
                  setPage(1);
                  setStatusFilter(reviewStatus);
                }}
                className={statusFilter === reviewStatus ? "oa-btn-primary px-3 py-1.5 text-xs font-medium" : "oa-btn-secondary px-3 py-1.5 text-xs font-medium"}
              >
                {reviewStatus}
              </button>
            ))}
          </div>
        ) : null}

        {isAdmin ? (
          <div className="mt-4 rounded-xl border border-[#e6dcf2] bg-[#fbf8ff] px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#625d7f]">
                Bulk Assignment
              </span>
              <span className="text-xs text-[#6f6a89]">{selectedTaskIds.length} selected</span>
              <select
                aria-label="Bulk assignee"
                value={bulkAssigneeId}
                onChange={(event) => setBulkAssigneeId(event.target.value)}
                className="oa-select min-w-[190px] py-1.5 text-xs"
              >
                <option value="">Unassigned</option>
                {users.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.full_name} ({account.role})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={applyBulkAssignment}
                disabled={bulkBusy || selectedTaskIds.length === 0}
                className="oa-btn-primary px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60"
              >
                {bulkBusy ? "Applying..." : "Apply"}
              </button>
              {bulkResult ? <span className="text-xs text-[#5f5b77]">{bulkResult}</span> : null}
            </div>
          </div>
        ) : null}

        {data ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.entries(data.status_counts).map(([status, count]) => (
              <span key={status} className="oa-chip">
                {status}: {count}
              </span>
            ))}
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-lg border border-[#f0c8c8] bg-[#fff3f3] px-3 py-2 text-sm text-[#a13a3a]">
            {error}
          </p>
        ) : null}
      </div>

      <div className="oa-card overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full min-w-[780px] text-sm">
            <thead className="border-b border-[#ece2f7] bg-[linear-gradient(180deg,#faf6ff_0%,#f8f2ff_100%)]">
              <tr>
                {isAdmin ? (
                  <th className="px-3 py-2.5 text-left">
                    <input
                      aria-label="Select all visible tasks"
                      type="checkbox"
                      checked={visibleTasks.length > 0 && selectedTaskIds.length === visibleTasks.length}
                      onChange={(event) => {
                        setSelectedTaskIds(event.target.checked ? visibleTasks.map((task) => task.id) : []);
                      }}
                    />
                  </th>
                ) : null}
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.08em] text-[#696482]">
                  Task ID
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.08em] text-[#696482]">
                  Status
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.08em] text-[#696482]">
                  Assignee
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.08em] text-[#696482]">
                  Last Tagged By
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.08em] text-[#696482]">
                  Language
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.08em] text-[#696482]">
                  Role
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.08em] text-[#696482]">
                  Updated
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.08em] text-[#696482]">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map((task) => (
                <tr key={task.id} className="border-t border-[#eee5f7] text-[#2a2546] transition hover:bg-[#fbf8ff]">
                  {isAdmin ? (
                    <td className="px-3 py-2.5">
                      <input
                        aria-label={`Select task ${task.external_id}`}
                        type="checkbox"
                        checked={selectedTaskIds.includes(task.id)}
                        onChange={(event) => {
                          setSelectedTaskIds((prev) =>
                            event.target.checked ? [...prev, task.id] : prev.filter((id) => id !== task.id)
                          );
                        }}
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-2.5 font-medium">{task.external_id}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={task.status} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{task.assignee_name || "Unassigned"}</div>
                    <div className="text-xs text-[#6f6a89]">{task.assignee_email || "-"}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{task.last_tagger_name || "-"}</div>
                    <div className="text-xs text-[#6f6a89]">{task.last_tagger_email || "-"}</div>
                  </td>
                  <td className="px-3 py-2.5">{task.language || "-"}</td>
                  <td className="px-3 py-2.5">{task.speaker_role || "-"}</td>
                  <td className="px-3 py-2.5 text-[#6f6a89]">{new Date(task.updated_at).toLocaleString()}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-2">
                      <Link href={`/tasks/${task.id}`} className="oa-btn-secondary px-2.5 py-1 text-center text-xs font-medium">
                        Open
                      </Link>
                      {canClaim && !task.assignee_id ? (
                        <button
                          type="button"
                          onClick={() => void claimVisibleTask(task.id)}
                          disabled={Boolean(claimBusyTaskId)}
                          className="oa-btn-primary px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {claimBusyTaskId === task.id ? "Claiming..." : "Claim"}
                        </button>
                      ) : null}
                      {isAdmin ? (
                        <div className="flex items-center gap-1">
                          <select
                            value={assigneeDraftByTask[task.id] ?? task.assignee_id ?? ""}
                            onChange={(event) =>
                              setAssigneeDraftByTask((prev) => ({ ...prev, [task.id]: event.target.value }))
                            }
                            className="oa-select min-w-[160px] py-1 text-xs"
                          >
                            <option value="">Unassigned</option>
                            {users.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.full_name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => void assignTask(task.id, task.version)}
                            disabled={assignmentBusyTaskId === task.id}
                            className="oa-btn-primary px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {assignmentBusyTaskId === task.id ? "Saving..." : "Assign"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {data && visibleTasks.length === 0 ? (
                <tr>
                  <td className="px-3 py-7 text-center text-sm text-[#7c7795]" colSpan={isAdmin ? 9 : 8}>
                    No tasks found for the current filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-[#6f6a89]">
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            className="oa-btn-secondary px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!data || page >= totalPages}
            onClick={() => setPage((prev) => prev + 1)}
            className="oa-btn-secondary px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {loading ? (
        <p className="rounded-lg border border-[#e6dcf2] bg-[#f8f4ff] px-3 py-2 text-sm text-[#6e6987]">Loading tasks...</p>
      ) : null}
    </section>
  );
}
