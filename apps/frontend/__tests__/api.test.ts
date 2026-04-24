import { describe, expect, it, vi } from "vitest";

import {
  APIError,
  fetchAdminMetrics,
  fetchTasks,
  fetchUsers,
  login,
  resetUserPassword,
  startTask,
  updateUser,
} from "@/lib/api";
import { readSession, writeSession } from "@/lib/session";

describe("API client error handling", () => {
  it("wraps non-JSON error responses in APIError", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("upstream unavailable", {
        status: 502,
        statusText: "Bad Gateway",
      })
    );

    await expect(login("admin@test.com", "password")).rejects.toMatchObject({
      name: "APIError",
      status: 502,
      message: "Bad Gateway",
    });

    fetchMock.mockRestore();
  });

  it("refreshes tokens and retries one authenticated request", async () => {
    writeSession("old-access", "old-refresh", {
      id: "user-1",
      email: "annotator@test.com",
      full_name: "Annotator",
      role: "ANNOTATOR",
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
            token_type: "bearer",
            user: {
              id: "user-1",
              email: "annotator@test.com",
              full_name: "Annotator",
              role: "ANNOTATOR",
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [], page: 1, page_size: 25, total: 0, status_counts: {} }),
          { status: 200 }
        )
      );

    await expect(fetchTasks("old-access", { page: 1 })).resolves.toMatchObject({ total: 0 });
    expect(readSession().accessToken).toBe("new-access");
    expect((fetchMock.mock.calls[2]?.[1]?.headers as Headers).get("Authorization")).toBe("Bearer new-access");

    fetchMock.mockRestore();
  });

  it("clears the session when refresh fails", async () => {
    writeSession("old-access", "bad-refresh", {
      id: "user-1",
      email: "annotator@test.com",
      full_name: "Annotator",
      role: "ANNOTATOR",
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "invalid refresh" }), { status: 401 }));

    await expect(fetchTasks("old-access", { page: 1 })).rejects.toMatchObject({ status: 401 });
    expect(readSession().accessToken).toBeNull();
    expect(readSession().refreshToken).toBeNull();

    fetchMock.mockRestore();
  });

  it("sends admin metrics filters using backend query names", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          generated_at: new Date().toISOString(),
          filters: {},
          overview: {},
          status_counts: {},
          model_metrics: [],
          pii_metrics: {},
          tagger_metrics: [],
          worst_tasks: [],
        }),
        { status: 200 }
      )
    );

    await fetchAdminMetrics("admin-token", {
      status: "Approved",
      assigneeId: "unassigned",
      jobId: "upload-1",
      language: "en",
      dateFrom: "2026-04-01",
      dateTo: "2026-04-24",
    });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/v1/metrics/admin");
    expect(url.searchParams.get("status")).toBe("Approved");
    expect(url.searchParams.get("assignee_id")).toBe("unassigned");
    expect(url.searchParams.get("job_id")).toBe("upload-1");
    expect(url.searchParams.get("language")).toBe("en");
    expect(url.searchParams.get("date_from")).toBe("2026-04-01");
    expect(url.searchParams.get("date_to")).toBe("2026-04-24");

    fetchMock.mockRestore();
  });

  it("sends user management filters and update requests", async () => {
    const userPayload = {
      id: "user-1",
      email: "annotator@test.com",
      full_name: "Annotator",
      role: "ANNOTATOR",
      is_active: true,
      last_login_at: null,
      last_activity_at: null,
      assigned_task_count: 0,
      open_assigned_task_count: 0,
      completed_task_count: 0,
      approved_task_count: 0,
      assignment_load: "none",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [userPayload] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...userPayload, role: "REVIEWER" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(userPayload), { status: 200 }));

    await fetchUsers("admin-token", {
      search: "annotator",
      role: "ANNOTATOR",
      status: "active",
    });
    await updateUser("admin-token", "user-1", { role: "REVIEWER", is_active: false });
    await resetUserPassword("admin-token", "user-1", "NewPass@123");

    const listUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(listUrl.pathname).toBe("/api/v1/users");
    expect(listUrl.searchParams.get("search")).toBe("annotator");
    expect(listUrl.searchParams.get("role")).toBe("ANNOTATOR");
    expect(listUrl.searchParams.get("status")).toBe("active");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PATCH");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/api/v1/users/user-1");
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/api/v1/users/user-1/reset-password");

    fetchMock.mockRestore();
  });

  it("starts a task through the backend workflow endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ task: { id: "task-1", status: "In Progress" } }), { status: 200 })
    );

    await expect(startTask("annotator-token", "task-1")).resolves.toMatchObject({
      task: { id: "task-1", status: "In Progress" },
    });

    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/v1/tasks/task-1/start");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    fetchMock.mockRestore();
  });
});
