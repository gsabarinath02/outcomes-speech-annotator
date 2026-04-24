export type Role = "ADMIN" | "ANNOTATOR" | "REVIEWER";

export type UserStatusFilter = "all" | "active" | "inactive";
export type AssignmentLoad = "none" | "light" | "normal" | "heavy";

export type TaskStatus =
  | "Not Started"
  | "In Progress"
  | "Completed"
  | "Needs Review"
  | "Reviewed"
  | "Approved";

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  user: User;
}

export interface TranscriptVariant {
  id: string;
  source_key: string;
  source_label: string;
  transcript_text: string;
}

export interface PIIAnnotation {
  id: string;
  label: string;
  start: number;
  end: number;
  value: string;
  source: string | null;
  confidence: number | null;
}

export interface PIILabel {
  id: string;
  key: string;
  display_name: string;
  color: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PIILabelCreateRequest {
  key: string;
  display_name: string;
  color?: string;
  description?: string | null;
  is_active?: boolean;
  sort_order?: number | null;
}

export interface PIILabelUpdateRequest {
  display_name?: string | null;
  color?: string | null;
  description?: string | null;
  is_active?: boolean | null;
  sort_order?: number | null;
}

export interface TaskDetail {
  id: string;
  external_id: string;
  file_location: string;
  final_transcript: string | null;
  notes: string | null;
  status: TaskStatus;
  speaker_gender: string | null;
  speaker_role: string | null;
  language: string | null;
  channel: string | null;
  duration_seconds: number | null;
  custom_metadata: Record<string, unknown>;
  original_row: Record<string, unknown>;
  pii_annotations: PIIAnnotation[];
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  last_tagger_id: string | null;
  last_tagger_name: string | null;
  last_tagger_email: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  last_saved_at: string | null;
  transcript_variants: TranscriptVariant[];
  prev_task_id: string | null;
  next_task_id: string | null;
}

export interface TaskListItem {
  id: string;
  external_id: string;
  file_location: string;
  status: TaskStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  last_tagger_id: string | null;
  last_tagger_name: string | null;
  last_tagger_email: string | null;
  updated_at: string;
  last_saved_at: string | null;
  language: string | null;
  speaker_role: string | null;
  version: number;
}

export interface TaskListResponse {
  items: TaskListItem[];
  page: number;
  page_size: number;
  total: number;
  status_counts: Record<string, number>;
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  last_login_at: string | null;
  last_activity_at: string | null;
  assigned_task_count: number;
  open_assigned_task_count: number;
  completed_task_count: number;
  approved_task_count: number;
  assignment_load: AssignmentLoad;
  created_at: string;
  updated_at: string;
}

export interface ColumnMappingRequest {
  id_column: string;
  file_location_column: string;
  transcript_columns: Array<{
    source_key: string;
    column_name: string;
    source_label?: string | null;
  }>;
  final_transcript_column?: string | null;
  notes_column?: string | null;
  status_column?: string | null;
  core_metadata_columns?: Record<string, string>;
  custom_metadata_columns?: string[] | null;
}

export interface UploadValidationError {
  row_number: number;
  field_name: string | null;
  error_message: string;
  raw_value: string | null;
}

export interface ValidationGateResult {
  gate_key: string;
  status: "pass" | "warning" | "fail";
  message: string;
  checked_count: number | null;
  failed_count: number | null;
}

export interface UploadValidationResult {
  upload_job_id: string;
  status: string;
  valid_rows: number;
  invalid_rows: number;
  total_rows: number;
  transcript_sources: string[];
  custom_metadata_columns: string[];
  import_allowed: boolean;
  gates: ValidationGateResult[];
  errors: UploadValidationError[];
}

export interface JobStatus {
  id: string;
  job_id: string;
  job_type: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error_message: string | null;
  output_available: boolean;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface MetricsFilters {
  status: TaskStatus | null;
  assignee_id: string | null;
  job_id: string | null;
  language: string | null;
  date_from: string | null;
  date_to: string | null;
}

export interface MetricsOverview {
  total_tasks: number;
  scored_tasks: number;
  scored_pairs: number;
  average_wer: number | null;
  average_cer: number | null;
  total_pii_annotations: number;
  low_confidence_annotations: number;
  overlap_warnings: number;
}

export interface ModelTranscriptMetric {
  source_key: string;
  source_label: string;
  tasks_scored: number;
  word_errors: number;
  reference_words: number;
  character_errors: number;
  reference_characters: number;
  average_wer: number | null;
  average_cer: number | null;
}

export interface PIIMetrics {
  total_annotations: number;
  average_annotations_per_task: number;
  low_confidence_annotations: number;
  overlap_warnings: number;
  by_label: Record<string, number>;
  by_source: Record<string, number>;
}

export interface TaggerMetric {
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  tasks_touched: number;
  completed_tasks: number;
  reviewed_tasks: number;
  approved_tasks: number;
  pii_annotations: number;
}

export interface TaskSourceErrorMetric {
  source_key: string;
  source_label: string;
  wer: number | null;
  cer: number | null;
  word_errors: number;
  reference_words: number;
  character_errors: number;
  reference_characters: number;
}

export interface WorstTaskMetric {
  task_id: string;
  external_id: string;
  status: TaskStatus;
  language: string | null;
  upload_job_id: string;
  assignee_name: string | null;
  last_tagger_name: string | null;
  max_wer: number | null;
  average_wer: number | null;
  source_metrics: TaskSourceErrorMetric[];
}

export interface AdminMetricsResponse {
  generated_at: string;
  filters: MetricsFilters;
  overview: MetricsOverview;
  status_counts: Record<string, number>;
  model_metrics: ModelTranscriptMetric[];
  pii_metrics: PIIMetrics;
  tagger_metrics: TaggerMetric[];
  worst_tasks: WorstTaskMetric[];
}
