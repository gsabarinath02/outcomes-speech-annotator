import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TasksPage from "@/app/(dashboard)/tasks/page";

const {
  push,
  authState,
  bulkAssignTasks,
  claimNextTask,
  claimTask,
  fetchNextTask,
  fetchTasks,
  fetchUsers,
  patchTaskAssignee,
} = vi.hoisted(() => ({
  push: vi.fn(),
  authState: {
    user: {
      id: "admin-1",
      email: "admin@test.com",
      full_name: "Admin",
      role: "ADMIN",
    },
  },
  bulkAssignTasks: vi.fn(),
  claimNextTask: vi.fn(),
  claimTask: vi.fn(),
  fetchNextTask: vi.fn(),
  fetchTasks: vi.fn(),
  fetchUsers: vi.fn(),
  patchTaskAssignee: vi.fn(),
}));

const task = {
  id: "task-1",
  external_id: "OUT-001",
  file_location: "local:///tmp/audio.mp3",
  status: "Not Started",
  assignee_id: null,
  assignee_name: null,
  assignee_email: null,
  last_tagger_id: null,
  last_tagger_name: null,
  last_tagger_email: null,
  updated_at: new Date().toISOString(),
  last_saved_at: new Date().toISOString(),
  language: "en",
  speaker_role: "caller",
  version: 4,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    accessToken: "test-token",
    user: authState.user,
  }),
}));

vi.mock("@/lib/api", () => ({
  APIError: class APIError extends Error {
    status: number;
    payload: unknown;
    constructor(message: string, status: number, payload: unknown) {
      super(message);
      this.status = status;
      this.payload = payload;
    }
  },
  bulkAssignTasks: (...args: unknown[]) => bulkAssignTasks(...args),
  claimNextTask: (...args: unknown[]) => claimNextTask(...args),
  claimTask: (...args: unknown[]) => claimTask(...args),
  fetchNextTask: (...args: unknown[]) => fetchNextTask(...args),
  fetchTasks: (...args: unknown[]) => fetchTasks(...args),
  fetchUsers: (...args: unknown[]) => fetchUsers(...args),
  patchTaskAssignee: (...args: unknown[]) => patchTaskAssignee(...args),
}));

describe("TasksPage queue workflows", () => {
  beforeEach(() => {
    authState.user = {
      id: "admin-1",
      email: "admin@test.com",
      full_name: "Admin",
      role: "ADMIN",
    };
    fetchTasks.mockResolvedValue({
      items: [task],
      page: 1,
      page_size: 25,
      total: 1,
      status_counts: { "Not Started": 1 },
    });
    fetchUsers.mockResolvedValue({
      items: [
        {
          id: "reviewer-1",
          email: "reviewer@test.com",
          full_name: "Reviewer",
          role: "REVIEWER",
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });
    fetchNextTask.mockResolvedValue({ task_id: "task-1" });
    claimNextTask.mockResolvedValue({ task: { ...task, id: "task-1" } });
    claimTask.mockResolvedValue({ task: { ...task, assignee_id: "annotator-1", assignee_name: "Annotator" } });
    patchTaskAssignee.mockResolvedValue({ task: { ...task, assignee_id: "reviewer-1", assignee_name: "Reviewer", version: 5 } });
    bulkAssignTasks.mockResolvedValue({
      updated: [{ task: { ...task, assignee_id: "reviewer-1", assignee_name: "Reviewer", version: 5 } }],
      errors: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses backend unassigned filtering instead of client-side page filtering", async () => {
    render(<TasksPage />);
    await screen.findByText("Annotation Queue");

    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: "unassigned" } });

    await waitFor(() =>
      expect(fetchTasks).toHaveBeenLastCalledWith(
        "test-token",
        expect.objectContaining({ assigneeId: "unassigned" })
      )
    );
  });

  it("claims and opens the next task for annotators", async () => {
    authState.user = {
      id: "annotator-1",
      email: "annotator@test.com",
      full_name: "Annotator",
      role: "ANNOTATOR",
    };
    render(<TasksPage />);
    await screen.findByText("Annotation Queue");

    fireEvent.click(screen.getByRole("button", { name: "Claim Next" }));

    await waitFor(() => expect(claimNextTask).toHaveBeenCalledWith("test-token"));
    expect(push).toHaveBeenCalledWith("/tasks/task-1");
  });

  it("bulk assigns selected tasks with their current versions", async () => {
    render(<TasksPage />);
    await screen.findByText("OUT-001");

    fireEvent.click(screen.getByLabelText("Select task OUT-001"));
    fireEvent.change(screen.getByLabelText("Bulk assignee"), { target: { value: "reviewer-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(bulkAssignTasks).toHaveBeenCalledWith("test-token", [
        { task_id: "task-1", version: 4, assignee_id: "reviewer-1" },
      ])
    );
    expect(await screen.findByText(/1 assigned, 0 conflict/)).toBeInTheDocument();
  });
});
