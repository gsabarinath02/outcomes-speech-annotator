import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminMetricsPage from "@/app/(dashboard)/admin/metrics/page";

const {
  createPIILabel,
  fetchAdminMetrics,
  fetchAdminPIILabels,
  fetchUsers,
  updatePIILabel,
} = vi.hoisted(() => ({
  createPIILabel: vi.fn(),
  fetchAdminMetrics: vi.fn(),
  fetchAdminPIILabels: vi.fn(),
  fetchUsers: vi.fn(),
  updatePIILabel: vi.fn(),
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
  createPIILabel: (...args: unknown[]) => createPIILabel(...args),
  fetchAdminMetrics: (...args: unknown[]) => fetchAdminMetrics(...args),
  fetchAdminPIILabels: (...args: unknown[]) => fetchAdminPIILabels(...args),
  fetchUsers: (...args: unknown[]) => fetchUsers(...args),
  updatePIILabel: (...args: unknown[]) => updatePIILabel(...args),
}));

describe("AdminMetricsPage", () => {
  beforeEach(() => {
    fetchUsers.mockResolvedValue({
      items: [
        {
          id: "annotator-1",
          email: "annotator@test.com",
          full_name: "Annotator",
          role: "ANNOTATOR",
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });
    fetchAdminPIILabels.mockResolvedValue({
      items: [
        {
          id: "label-1",
          key: "NAME",
          display_name: "Name",
          color: "#a16207",
          description: null,
          is_active: true,
          sort_order: 10,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });
    fetchAdminMetrics.mockResolvedValue({
      generated_at: new Date().toISOString(),
      filters: {
        status: null,
        assignee_id: null,
        job_id: null,
        language: null,
        date_from: null,
        date_to: null,
      },
      overview: {
        total_tasks: 2,
        scored_tasks: 1,
        scored_pairs: 2,
        average_wer: 0.125,
        average_cer: 0.05,
        total_pii_annotations: 3,
        low_confidence_annotations: 1,
        overlap_warnings: 0,
      },
      status_counts: { "In Progress": 1, Approved: 1 },
      model_metrics: [
        {
          source_key: "model_1",
          source_label: "Model 1",
          tasks_scored: 1,
          word_errors: 1,
          reference_words: 8,
          character_errors: 3,
          reference_characters: 60,
          average_wer: 0.125,
          average_cer: 0.05,
        },
      ],
      pii_metrics: {
        total_annotations: 3,
        average_annotations_per_task: 1.5,
        low_confidence_annotations: 1,
        overlap_warnings: 0,
        by_label: { NAME: 2, EMAIL: 1 },
        by_source: { manual: 2, auto: 1 },
      },
      tagger_metrics: [
        {
          user_id: "annotator-1",
          user_name: "Annotator",
          user_email: "annotator@test.com",
          tasks_touched: 1,
          completed_tasks: 1,
          reviewed_tasks: 0,
          approved_tasks: 0,
          pii_annotations: 3,
        },
      ],
      worst_tasks: [
        {
          task_id: "task-1",
          external_id: "ROW-001",
          status: "In Progress",
          language: "en",
          upload_job_id: "upload-1",
          assignee_name: "Annotator",
          last_tagger_name: "Annotator",
          max_wer: 0.125,
          average_wer: 0.125,
          source_metrics: [
            {
              source_key: "model_1",
              source_label: "Model 1",
              wer: 0.125,
              cer: 0.05,
              word_errors: 1,
              reference_words: 8,
              character_errors: 3,
              reference_characters: 60,
            },
          ],
        },
      ],
    });
    createPIILabel.mockResolvedValue({});
    updatePIILabel.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders model, PII, and tagger metrics", async () => {
    render(<AdminMetricsPage />);

    expect(await screen.findByText("Model Accuracy")).toBeInTheDocument();
    expect(screen.getAllByText("12.5%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("5.0%").length).toBeGreaterThan(0);
    expect(screen.getByText("Model 1")).toBeInTheDocument();
    expect(screen.getAllByText("Annotator").length).toBeGreaterThan(0);
    expect(screen.getByText("ROW-001")).toBeInTheDocument();
  });

  it("creates admin-managed PII labels for annotator dropdowns", async () => {
    render(<AdminMetricsPage />);
    await screen.findByText("PII Label Management");

    fireEvent.change(screen.getByLabelText("New label key"), { target: { value: "passport" } });
    fireEvent.change(screen.getByLabelText("New label name"), { target: { value: "Passport" } });
    fireEvent.change(screen.getByLabelText("New label description"), {
      target: { value: "Government passport identifier" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Label" }));

    await waitFor(() =>
      expect(createPIILabel).toHaveBeenCalledWith("test-token", {
        key: "PASSPORT",
        display_name: "Passport",
        color: "#0f766e",
        description: "Government passport identifier",
      })
    );
  });
});
