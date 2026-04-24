import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TaskWorkspacePage from "@/app/(dashboard)/tasks/[taskId]/page";

const { push, fetchTask, fetchAudioURL, fetchTaskActivity, patchTaskCombined } = vi.hoisted(
  () => ({
    push: vi.fn(),
    fetchTask: vi.fn(),
    fetchAudioURL: vi.fn(),
    fetchTaskActivity: vi.fn(),
    patchTaskCombined: vi.fn()
  })
);

const mockTask = {
  id: "task-1",
  external_id: "OUT-001",
  file_location: "local:///tmp/audio.mp3",
  final_transcript: "",
  notes: "",
  status: "Not Started",
  speaker_gender: "female",
  speaker_role: "caller",
  language: "en",
  channel: "mono",
  duration_seconds: 12.4,
  custom_metadata: { custom_tag: "A1" },
  original_row: {},
  assignee_id: null,
  assignee_name: null,
  assignee_email: null,
  last_tagger_id: null,
  last_tagger_name: null,
  last_tagger_email: null,
  version: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  last_saved_at: new Date().toISOString(),
  transcript_variants: [
    {
      id: "tv-1",
      source_key: "whisper",
      source_label: "Whisper",
      transcript_text: "hello world"
    }
  ],
  pii_annotations: [],
  prev_task_id: null,
  next_task_id: null
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push }),
  useParams: () => ({ taskId: "task-1" })
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    accessToken: "test-token"
  })
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
  fetchTask: (...args: unknown[]) => fetchTask(...args),
  fetchAudioURL: (...args: unknown[]) => fetchAudioURL(...args),
  fetchTaskActivity: (...args: unknown[]) => fetchTaskActivity(...args),
  patchTaskCombined: (...args: unknown[]) => patchTaskCombined(...args)
}));

describe("TaskWorkspacePage", () => {
  beforeEach(() => {
    localStorage.removeItem("outcomes-ai:speech-annotator:draft:anonymous:task-1");
    vi.useRealTimers();
    fetchTask.mockResolvedValue(mockTask);
    fetchAudioURL.mockResolvedValue({ url: "/api/v1/media/audio/token", expires_in_seconds: 300 });
    fetchTaskActivity.mockResolvedValue({ items: [] });
    patchTaskCombined.mockResolvedValue({ task: { ...mockTask, version: 2 } });
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem("outcomes-ai:speech-annotator:draft:anonymous:task-1");
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("autosaves transcript edits after debounce", async () => {
    render(<TaskWorkspacePage />);
    await screen.findByText("Task OUT-001");

    fireEvent.change(screen.getByLabelText("Final Transcript"), {
      target: { value: "Corrected transcript" }
    });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await waitFor(() => expect(patchTaskCombined).toHaveBeenCalled(), { timeout: 3500 });
  });

  it("refreshes task details from successful save responses", async () => {
    patchTaskCombined.mockResolvedValueOnce({
      task: {
        ...mockTask,
        final_transcript: "Corrected transcript",
        assignee_id: "reviewer-1",
        assignee_name: "Reviewer One",
        assignee_email: "reviewer.one@test.com",
        version: 2,
      },
    });

    render(<TaskWorkspacePage />);
    await screen.findByText("Task OUT-001");

    fireEvent.change(screen.getByLabelText("Final Transcript"), {
      target: { value: "Corrected transcript" },
    });

    await waitFor(() => expect(patchTaskCombined).toHaveBeenCalled(), { timeout: 3500 });
    await waitFor(() => expect(screen.getByText("Assignee: Reviewer One")).toBeInTheDocument());
  });

  it("restores matching local drafts to avoid data loss after refresh", async () => {
    localStorage.setItem(
      "outcomes-ai:speech-annotator:draft:anonymous:task-1",
      JSON.stringify({
        schema_version: 1,
        task_id: "task-1",
        user_id: null,
        base_version: 1,
        base_updated_at: mockTask.updated_at,
        saved_at: new Date().toISOString(),
        final_transcript: "Recovered transcript from local draft",
        notes: "Recovered note",
        status: "In Progress",
        metadata: {
          speaker_gender: "female",
          speaker_role: "agent",
          language: "en",
          channel: "mono",
          duration_seconds: "12.4"
        },
        custom_metadata: {
          custom_tag: "drafted"
        }
      })
    );

    render(<TaskWorkspacePage />);
    await screen.findByText("Task OUT-001");

    expect(screen.getByDisplayValue("Recovered transcript from local draft")).toBeInTheDocument();
    expect(screen.getByText(/Recovered unsaved draft/i)).toBeInTheDocument();
  });

  it("retries autosave after transient failures", async () => {
    patchTaskCombined.mockReset();
    patchTaskCombined
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue({ task: { ...mockTask, version: 2 } });

    render(<TaskWorkspacePage />);
    await screen.findByText("Task OUT-001");
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Final Transcript"), {
      target: { value: "Retry this save" }
    });

    await act(async () => {
      vi.advanceTimersByTime(1700);
      await Promise.resolve();
    });

    expect(patchTaskCombined).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Retrying in/i)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2200);
      await Promise.resolve();
    });

    expect(patchTaskCombined).toHaveBeenCalledTimes(2);
  }, 10000);

  it("shows which workspace section failed to autosave", async () => {
    patchTaskCombined.mockReset();
    patchTaskCombined.mockRejectedValueOnce(new Error("network error"));

    render(<TaskWorkspacePage />);
    await screen.findByText("Task OUT-001");
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Final Transcript"), {
      target: { value: "Failed transcript save" }
    });

    await act(async () => {
      vi.advanceTimersByTime(1700);
      await Promise.resolve();
    });

    const autosaveStatus = screen.getByLabelText("Autosave section status");
    expect(autosaveStatus).toHaveTextContent("Transcript");
    expect(autosaveStatus).toHaveTextContent("Failed");
    expect(autosaveStatus).toHaveTextContent("Save failed");
  }, 10000);

  it("adds pii label inline from transcript selection", async () => {
    render(<TaskWorkspacePage />);
    await screen.findByText("Task OUT-001");

    const textarea = screen.getByLabelText("Final Transcript") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "my phone 1234567890" } });

    act(() => {
      textarea.setSelectionRange(9, 19);
      fireEvent.select(textarea);
    });

    fireEvent.change(screen.getByLabelText("Inline PII Label"), {
      target: { value: "PHONE" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add Label To Selection/i }));

    expect(screen.getByDisplayValue("1234567890")).toBeInTheDocument();
  });

  it("adds pii from the transcript selection with the keyboard shortcut", async () => {
    render(<TaskWorkspacePage />);
    await screen.findByText("Task OUT-001");

    const textarea = screen.getByLabelText("Final Transcript") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "call me at 1234567890" } });

    act(() => {
      textarea.setSelectionRange(11, 21);
      fireEvent.select(textarea);
    });

    fireEvent.change(screen.getByLabelText("Inline PII Label"), {
      target: { value: "PHONE" },
    });

    fireEvent.keyDown(textarea, { key: "m", altKey: true });

    expect(screen.getByDisplayValue("1234567890")).toBeInTheDocument();
  });

  it("changes task status with a keyboard shortcut", async () => {
    render(<TaskWorkspacePage />);
    await screen.findByText("Task OUT-001");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", altKey: true }));
    });

    expect(screen.getByDisplayValue("In Progress")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Unsaved changes")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(patchTaskCombined).toHaveBeenCalledWith(
        "test-token",
        "task-1",
        expect.objectContaining({ status: "In Progress" })
      )
    );
  });

  it("opens the next task from the keyboard when focus is not in an editor", async () => {
    fetchTask.mockResolvedValueOnce({ ...mockTask, next_task_id: "task-2" });

    render(<TaskWorkspacePage />);
    await screen.findByText("Task OUT-001");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
    });

    expect(push).toHaveBeenCalledWith("/tasks/task-2");
  });
});
