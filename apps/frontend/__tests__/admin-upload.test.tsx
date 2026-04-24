import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminUploadPage from "@/app/(dashboard)/admin/upload/page";

const {
  createUser,
  downloadJobOutput,
  enqueueExportJob,
  enqueueImportJob,
  fetchJob,
  fetchUsers,
  previewUpload,
  resetUserPassword,
  uploadExcel,
  updateUser,
  validateUpload,
} = vi.hoisted(() => ({
  createUser: vi.fn(),
  downloadJobOutput: vi.fn(),
  enqueueExportJob: vi.fn(),
  enqueueImportJob: vi.fn(),
  fetchJob: vi.fn(),
  fetchUsers: vi.fn(),
  previewUpload: vi.fn(),
  resetUserPassword: vi.fn(),
  uploadExcel: vi.fn(),
  updateUser: vi.fn(),
  validateUpload: vi.fn(),
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    accessToken: "test-token",
    user: {
      id: "admin-1",
      email: "admin@test.com",
      full_name: "Admin",
      role: "ADMIN",
    },
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
  createUser: (...args: unknown[]) => createUser(...args),
  downloadJobOutput: (...args: unknown[]) => downloadJobOutput(...args),
  enqueueExportJob: (...args: unknown[]) => enqueueExportJob(...args),
  enqueueImportJob: (...args: unknown[]) => enqueueImportJob(...args),
  fetchJob: (...args: unknown[]) => fetchJob(...args),
  fetchUsers: (...args: unknown[]) => fetchUsers(...args),
  previewUpload: (...args: unknown[]) => previewUpload(...args),
  resetUserPassword: (...args: unknown[]) => resetUserPassword(...args),
  uploadExcel: (...args: unknown[]) => uploadExcel(...args),
  updateUser: (...args: unknown[]) => updateUser(...args),
  validateUpload: (...args: unknown[]) => validateUpload(...args),
}));

describe("AdminUploadPage async export", () => {
  beforeEach(() => {
    const reviewer = {
      id: "reviewer-1",
      email: "reviewer@test.com",
      full_name: "Reviewer",
      role: "REVIEWER",
      is_active: true,
      last_login_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      assigned_task_count: 8,
      open_assigned_task_count: 3,
      completed_task_count: 5,
      approved_task_count: 2,
      assignment_load: "light",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    fetchUsers.mockResolvedValue({
      items: [reviewer],
    });
    updateUser.mockResolvedValue({ ...reviewer, role: "ADMIN" });
    resetUserPassword.mockResolvedValue(reviewer);
    enqueueExportJob.mockResolvedValue({ job_id: "job-1", status: "QUEUED" });
    fetchJob.mockResolvedValue({
      id: "job-1",
      job_id: "job-1",
      job_type: "export",
      status: "COMPLETED",
      payload: {},
      result: { filename: "annotations.csv" },
      error_message: null,
      output_available: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("enqueues exports with all filter fields", async () => {
    render(<AdminUploadPage />);
    await screen.findByText("Export Annotations");
    await waitFor(() => expect(screen.getByLabelText("Assignee")).toHaveTextContent("Reviewer"));

    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "xlsx" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "Approved" } });
    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: "reviewer-1" } });
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "en" } });
    fireEvent.change(screen.getByLabelText("Upload Job"), { target: { value: "upload-1" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-04-24" } });

    fireEvent.click(screen.getByRole("button", { name: "Start Export" }));

    await waitFor(() =>
      expect(enqueueExportJob).toHaveBeenCalledWith("test-token", {
        format: "xlsx",
        status: "Approved",
        assignee_id: "reviewer-1",
        job_id: "upload-1",
        language: "en",
        date_from: "2026-04-01",
        date_to: "2026-04-24",
      })
    );
    expect(await screen.findByText("COMPLETED")).toBeInTheDocument();
  });

  it("filters users and performs admin user actions", async () => {
    render(<AdminUploadPage />);
    await screen.findByLabelText("Role for reviewer@test.com");

    fireEvent.change(screen.getByLabelText("Search Users"), { target: { value: "reviewer" } });
    fireEvent.change(screen.getByLabelText("Role Filter"), { target: { value: "REVIEWER" } });
    fireEvent.change(screen.getByLabelText("Status Filter"), { target: { value: "active" } });

    await waitFor(() =>
      expect(fetchUsers).toHaveBeenCalledWith("test-token", {
        search: "reviewer",
        role: "REVIEWER",
        status: "active",
      })
    );

    fireEvent.change(screen.getByLabelText("Role for reviewer@test.com"), { target: { value: "ADMIN" } });
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith("test-token", "reviewer-1", { role: "ADMIN" })
    );

    fireEvent.click(screen.getByLabelText("Active status for reviewer@test.com"));
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith("test-token", "reviewer-1", { is_active: false })
    );

    fireEvent.change(screen.getByLabelText("Reset password for reviewer@test.com"), {
      target: { value: "NewPass@123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() =>
      expect(resetUserPassword).toHaveBeenCalledWith("test-token", "reviewer-1", "NewPass@123")
    );
  });
});
