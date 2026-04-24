"use client";

import type { PIIAnnotation, TaskDetail, TaskStatus } from "@outcomes/shared-types";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { AudioWaveformPlayer } from "@/components/audio-waveform-player";
import { ConflictModal, type ConflictMergeResolution } from "@/components/conflict-modal";
import { CoreMetadataState, MetadataEditor } from "@/components/metadata-editor";
import { PIIAnnotator } from "@/components/pii-annotator";
import { SaveIndicator } from "@/components/save-indicator";
import { StatusBadge } from "@/components/status-badge";
import { TranscriptComparison } from "@/components/transcript-comparison";
import {
  APIError,
  fetchAudioURL,
  fetchTask,
  fetchTaskActivity,
  patchTaskCombined,
  type TaskActivityItem
} from "@/lib/api";
import { detectPIIAnnotations, sanitizePIIAnnotations } from "@/lib/pii";

const statusOptions: TaskStatus[] = [
  "Not Started",
  "In Progress",
  "Completed",
  "Needs Review",
  "Reviewed",
  "Approved"
];

type InspectorPanelKey = "compare" | "metadata" | "pii" | "notes" | "activity" | "details";

const inspectorTabs: Array<{ key: InspectorPanelKey; label: string }> = [
  { key: "compare", label: "Compare" },
  { key: "metadata", label: "Metadata" },
  { key: "pii", label: "PII" },
  { key: "notes", label: "Notes" },
  { key: "activity", label: "Activity" },
  { key: "details", label: "Details" },
];

const piiLabelOptions = [
  "EMAIL",
  "PHONE",
  "SSN",
  "CREDIT_CARD",
  "IP_ADDRESS",
  "URL",
  "PERSON",
  "ADDRESS",
  "OTHER",
] as const;

type SaveState = "idle" | "unsaved" | "saving" | "saved" | "error";
type SaveSectionKey = "transcript" | "metadata" | "notes" | "status" | "pii";

const saveSectionLabels: Record<SaveSectionKey, string> = {
  transcript: "Transcript",
  metadata: "Metadata",
  notes: "Notes",
  status: "Status",
  pii: "PII",
};

const LOCAL_DRAFT_SCHEMA_VERSION = 1;
const MAX_AUTOSAVE_RETRY_DELAY_MS = 30000;

interface LocalTaskDraft {
  schema_version: number;
  task_id: string;
  user_id: string | null;
  base_version: number;
  base_updated_at: string;
  saved_at: string;
  final_transcript: string;
  notes: string;
  status: TaskStatus;
  metadata: CoreMetadataState;
  custom_metadata: Record<string, string>;
  pii_annotations: PIIAnnotation[];
}

function formatDurationLabel(durationSeconds: string | null | undefined): string {
  if (!durationSeconds || Number.isNaN(Number(durationSeconds))) {
    return "—";
  }
  const seconds = Number(durationSeconds);
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function buildDraftKey(taskId: string, userId: string | null | undefined): string {
  return `outcomes-ai:speech-annotator:draft:${userId ?? "anonymous"}:${taskId}`;
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function parseLocalDraft(rawValue: string | null): LocalTaskDraft | null {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as Partial<LocalTaskDraft>;
    if (
      parsed.schema_version !== LOCAL_DRAFT_SCHEMA_VERSION ||
      typeof parsed.task_id !== "string" ||
      typeof parsed.base_version !== "number" ||
      typeof parsed.base_updated_at !== "string" ||
      typeof parsed.saved_at !== "string" ||
      typeof parsed.final_transcript !== "string" ||
      typeof parsed.notes !== "string" ||
      typeof parsed.status !== "string" ||
      typeof parsed.metadata !== "object" ||
      parsed.metadata === null ||
      typeof parsed.custom_metadata !== "object" ||
      parsed.custom_metadata === null
    ) {
      return null;
    }
    return {
      schema_version: parsed.schema_version,
      task_id: parsed.task_id,
      user_id: typeof parsed.user_id === "string" ? parsed.user_id : null,
      base_version: parsed.base_version,
      base_updated_at: parsed.base_updated_at,
      saved_at: parsed.saved_at,
      final_transcript: parsed.final_transcript,
      notes: parsed.notes,
      status: parsed.status as TaskStatus,
      metadata: {
        speaker_gender: String((parsed.metadata as CoreMetadataState).speaker_gender ?? ""),
        speaker_role: String((parsed.metadata as CoreMetadataState).speaker_role ?? ""),
        language: String((parsed.metadata as CoreMetadataState).language ?? ""),
        channel: String((parsed.metadata as CoreMetadataState).channel ?? ""),
        duration_seconds: String((parsed.metadata as CoreMetadataState).duration_seconds ?? "")
      },
      custom_metadata: Object.fromEntries(
        Object.entries(parsed.custom_metadata as Record<string, unknown>).map(([key, value]) => [
          key,
          String(value ?? "")
        ])
      ),
      pii_annotations: Array.isArray(parsed.pii_annotations)
        ? (parsed.pii_annotations as unknown[]).map((entry) => {
            const item =
              typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
            return {
              id: String(item.id ?? ""),
              label: String(item.label ?? "OTHER"),
              start: Number(item.start ?? 0),
              end: Number(item.end ?? 0),
              value: String(item.value ?? ""),
              source: item.source !== undefined && item.source !== null ? String(item.source) : null,
              confidence:
                item.confidence !== undefined && item.confidence !== null ? Number(item.confidence) : null,
            };
          })
        : [],
    };
  } catch {
    return null;
  }
}

export default function TaskWorkspacePage() {
  const { accessToken, user } = useAuth();
  const params = useParams<{ taskId: string }>();
  const router = useRouter();
  const taskIdParam = params.taskId;
  const taskId = Array.isArray(taskIdParam) ? (taskIdParam[0] ?? "") : (taskIdParam ?? "");
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [version, setVersion] = useState(1);
  const [finalTranscript, setFinalTranscript] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<TaskStatus>("Not Started");
  const [metadata, setMetadata] = useState<CoreMetadataState>({
    speaker_gender: "",
    speaker_role: "",
    language: "",
    channel: "",
    duration_seconds: ""
  });
  const [customMetadata, setCustomMetadata] = useState<Record<string, string>>({});
  const [piiAnnotations, setPiiAnnotations] = useState<PIIAnnotation[]>([]);
  const [originalMetadata, setOriginalMetadata] = useState<CoreMetadataState>({
    speaker_gender: "",
    speaker_role: "",
    language: "",
    channel: "",
    duration_seconds: ""
  });
  const [originalCustomMetadata, setOriginalCustomMetadata] = useState<Record<string, string>>({});
  const [originalPIIAnnotations, setOriginalPIIAnnotations] = useState<PIIAnnotation[]>([]);
  const [originalTranscript, setOriginalTranscript] = useState("");
  const [originalNotes, setOriginalNotes] = useState("");
  const [originalStatus, setOriginalStatus] = useState<TaskStatus>("Not Started");
  const [transcriptDirty, setTranscriptDirty] = useState(false);
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  const [statusDirty, setStatusDirty] = useState(false);
  const [piiDirty, setPiiDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});
  const [activity, setActivity] = useState<TaskActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [conflict, setConflict] = useState<{
    open: boolean;
    serverTask: TaskDetail | null;
    conflictingFields: string[];
  }>({
    open: false,
    serverTask: null,
    conflictingFields: []
  });
  const [draftState, setDraftState] = useState<{
    mode: "none" | "restored" | "pending";
    savedAt: string | null;
  }>({
    mode: "none",
    savedAt: null
  });
  const savingRef = useRef(false);
  const transcriptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [transcriptSelection, setTranscriptSelection] = useState<{
    start: number;
    end: number;
    value: string;
  } | null>(null);
  const [activeInspectorPanel, setActiveInspectorPanel] = useState<InspectorPanelKey>("compare");
  const [selectionLabel, setSelectionLabel] = useState<string>("OTHER");
  const hasUnsavedChangesRef = useRef(false);
  const retryTimeoutRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const saveAllRef = useRef<(versionOverride?: number) => Promise<void>>(async () => undefined);

  const hasUnsavedChanges = transcriptDirty || metadataDirty || notesDirty || statusDirty || piiDirty;
  const draftStorageKey = taskId ? buildDraftKey(taskId, user?.id) : null;
  const backendBase = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1").replace(
    /\/api\/v1$/,
    ""
  );
  const saveSectionStatuses = (Object.entries(saveSectionLabels) as Array<[SaveSectionKey, string]>).map(
    ([key, label]) => {
      const isDirty =
        key === "transcript"
          ? transcriptDirty
          : key === "metadata"
            ? metadataDirty
            : key === "notes"
              ? notesDirty
              : key === "status"
                ? statusDirty
                : piiDirty;
      const failedMessage = sectionErrors[key];
      return {
        key,
        label,
        failedMessage,
        state: failedMessage ? "failed" : isDirty ? "pending" : "saved",
      };
    }
  );

  useEffect(() => {
    if (!accessToken || !taskId) return;
    const token: string = accessToken;
    const resolvedTaskId: string = taskId;
    let cancelled = false;

    async function loadTask() {
      setLoading(true);
      try {
        const fetchedTask = await fetchTask(token, resolvedTaskId);
        const signedAudio = await fetchAudioURL(token, resolvedTaskId);
        const activityResponse = await fetchTaskActivity(token, resolvedTaskId);
        if (cancelled) return;
        applyTaskState(fetchedTask);
        setActivity(activityResponse.items);
        retryAttemptRef.current = 0;
        clearRetryTimer();

        if (draftStorageKey) {
          let parsedDraft: LocalTaskDraft | null = null;
          try {
            parsedDraft = parseLocalDraft(localStorage.getItem(draftStorageKey));
          } catch {
            parsedDraft = null;
          }
          if (parsedDraft && parsedDraft.task_id === fetchedTask.id) {
            const sameServerRevision =
              parsedDraft.base_version === fetchedTask.version ||
              parsedDraft.base_updated_at === fetchedTask.updated_at;

            if (sameServerRevision) {
              applyLocalDraftState(parsedDraft);
              setDraftState({ mode: "restored", savedAt: parsedDraft.saved_at });
            } else {
              setDraftState({ mode: "pending", savedAt: parsedDraft.saved_at });
            }
          } else {
            setDraftState({ mode: "none", savedAt: null });
          }
        } else {
          setDraftState({ mode: "none", savedAt: null });
        }

        setAudioUrl(`${backendBase}${signedAudio.url}`);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof APIError ? err.message : "Failed to load task");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadTask();
    return () => {
      cancelled = true;
    };
  }, [accessToken, taskId, backendBase, draftStorageKey]);

  useEffect(() => {
    if (!hasUnsavedChanges || !taskId) return;
    const timeout = window.setTimeout(() => {
      void saveAll();
    }, 1500);
    return () => window.clearTimeout(timeout);
  }, [hasUnsavedChanges, finalTranscript, piiAnnotations, metadata, customMetadata, notes, status, taskId]);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    setTranscriptDirty(finalTranscript !== originalTranscript);
  }, [finalTranscript, originalTranscript]);

  useEffect(() => {
    setPiiAnnotations((prev) => {
      const sanitized = sanitizePIIAnnotations(finalTranscript, prev);
      if (JSON.stringify(sanitized) === JSON.stringify(prev)) {
        return prev;
      }
      return sanitized;
    });
  }, [finalTranscript]);

  useEffect(() => {
    setNotesDirty(notes !== originalNotes);
  }, [notes, originalNotes]);

  useEffect(() => {
    setStatusDirty(status !== originalStatus);
  }, [status, originalStatus]);

  useEffect(() => {
    const normalizedCurrent = sanitizePIIAnnotations(finalTranscript, piiAnnotations);
    const normalizedOriginal = sanitizePIIAnnotations(finalTranscript, originalPIIAnnotations);
    setPiiDirty(JSON.stringify(normalizedCurrent) !== JSON.stringify(normalizedOriginal));
  }, [finalTranscript, piiAnnotations, originalPIIAnnotations]);

  useEffect(() => {
    const coreChanged =
      metadata.speaker_gender !== originalMetadata.speaker_gender ||
      metadata.speaker_role !== originalMetadata.speaker_role ||
      metadata.language !== originalMetadata.language ||
      metadata.channel !== originalMetadata.channel ||
      metadata.duration_seconds !== originalMetadata.duration_seconds;

    const allCustomKeys = new Set([
      ...Object.keys(customMetadata),
      ...Object.keys(originalCustomMetadata)
    ]);
    let customChanged = false;
    allCustomKeys.forEach((key) => {
      if ((customMetadata[key] ?? "") !== (originalCustomMetadata[key] ?? "")) {
        customChanged = true;
      }
    });
    setMetadataDirty(coreChanged || customChanged);
  }, [customMetadata, metadata, originalCustomMetadata, originalMetadata]);

  useEffect(() => {
    if (!task || !draftStorageKey) return;
    if (!hasUnsavedChanges) {
      clearLocalDraft();
      return;
    }

    const draft: LocalTaskDraft = {
      schema_version: LOCAL_DRAFT_SCHEMA_VERSION,
      task_id: task.id,
      user_id: user?.id ?? null,
      base_version: version,
      base_updated_at: task.updated_at,
      saved_at: new Date().toISOString(),
      final_transcript: finalTranscript,
      notes,
      status,
      metadata,
      custom_metadata: customMetadata,
      pii_annotations: sanitizePIIAnnotations(finalTranscript, piiAnnotations),
    };

    try {
      localStorage.setItem(draftStorageKey, JSON.stringify(draft));
    } catch {
      // Ignore quota/storage access errors.
    }
  }, [
    task,
    draftStorageKey,
    hasUnsavedChanges,
    user?.id,
    version,
    finalTranscript,
    notes,
    status,
    metadata,
    customMetadata,
    piiAnnotations,
  ]);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsavedChangesRef.current) return;
      void saveAllRef.current();
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden" && hasUnsavedChangesRef.current) {
        void saveAllRef.current();
      }
    }

    function handlePageHide() {
      if (hasUnsavedChangesRef.current) {
        void saveAllRef.current();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  useEffect(
    () => () => {
      clearRetryTimer();
    },
    []
  );

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const editableTarget = isEditableShortcutTarget(event.target);
      const transcriptTarget = event.target === transcriptTextareaRef.current;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveAllRef.current();
        return;
      }

      if (event.altKey && key === "m" && (!editableTarget || transcriptTarget)) {
        event.preventDefault();
        handleAddPIIFromSelection(selectionLabel);
        return;
      }

      if (editableTarget) {
        return;
      }

      if (event.altKey && event.key === "ArrowLeft" && task?.prev_task_id) {
        event.preventDefault();
        router.push(`/tasks/${task.prev_task_id}`);
        return;
      }

      if (event.altKey && event.key === "ArrowRight" && task?.next_task_id) {
        event.preventDefault();
        router.push(`/tasks/${task.next_task_id}`);
        return;
      }

      if (event.altKey && /^[1-6]$/.test(event.key)) {
        const nextStatus = statusOptions[Number(event.key) - 1];
        if (nextStatus) {
          event.preventDefault();
          setStatus(nextStatus);
          setSaveState("unsaved");
        }
        return;
      }

      if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === "n" && task?.next_task_id) {
        event.preventDefault();
        router.push(`/tasks/${task.next_task_id}`);
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  function applyTaskState(nextTask: TaskDetail) {
    setTask(nextTask);
    setVersion(nextTask.version);
    const nextCoreMetadata: CoreMetadataState = {
      speaker_gender: nextTask.speaker_gender ?? "",
      speaker_role: nextTask.speaker_role ?? "",
      language: nextTask.language ?? "",
      channel: nextTask.channel ?? "",
      duration_seconds:
        nextTask.duration_seconds !== null && nextTask.duration_seconds !== undefined
          ? String(nextTask.duration_seconds)
          : ""
    };
    const nextCustomMetadata = Object.fromEntries(
      Object.entries(nextTask.custom_metadata ?? {}).map(([key, value]) => [key, String(value ?? "")])
    );
    const nextTranscript = nextTask.final_transcript ?? "";
    const persistedPII = sanitizePIIAnnotations(nextTranscript, nextTask.pii_annotations ?? []);
    const nextPIIAnnotations =
      persistedPII.length > 0 ? persistedPII : detectPIIAnnotations(nextTranscript);

    setFinalTranscript(nextTranscript);
    setNotes(nextTask.notes ?? "");
    setStatus(nextTask.status);
    setMetadata(nextCoreMetadata);
    setCustomMetadata(nextCustomMetadata);
    setPiiAnnotations(nextPIIAnnotations);
    setTranscriptSelection(null);

    setOriginalTranscript(nextTranscript);
    setOriginalNotes(nextTask.notes ?? "");
    setOriginalStatus(nextTask.status);
    setOriginalMetadata(nextCoreMetadata);
    setOriginalCustomMetadata(nextCustomMetadata);
    setOriginalPIIAnnotations(nextPIIAnnotations);

    setTranscriptDirty(false);
    setMetadataDirty(false);
    setNotesDirty(false);
    setStatusDirty(false);
    setPiiDirty(false);
    setSaveState("saved");
    setSectionErrors({});
  }

  function applyLocalDraftState(draft: LocalTaskDraft) {
    setFinalTranscript(draft.final_transcript);
    setNotes(draft.notes);
    setStatus(draft.status);
    setMetadata({
      speaker_gender: draft.metadata.speaker_gender ?? "",
      speaker_role: draft.metadata.speaker_role ?? "",
      language: draft.metadata.language ?? "",
      channel: draft.metadata.channel ?? "",
      duration_seconds: draft.metadata.duration_seconds ?? ""
    });
    setCustomMetadata(draft.custom_metadata);
    setPiiAnnotations(sanitizePIIAnnotations(draft.final_transcript, draft.pii_annotations));
    setTranscriptSelection(null);
    setSaveState("unsaved");
  }

  function clearRetryTimer() {
    if (retryTimeoutRef.current) {
      window.clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }

  function clearLocalDraft() {
    if (!draftStorageKey) return;
    try {
      localStorage.removeItem(draftStorageKey);
    } catch {
      // Ignore quota/storage access errors.
    }
  }

  function scheduleRetrySave() {
    if (!accessToken || !taskId || retryTimeoutRef.current || !hasUnsavedChangesRef.current) return;
    const attempt = retryAttemptRef.current + 1;
    retryAttemptRef.current = attempt;
    const delay = Math.min(MAX_AUTOSAVE_RETRY_DELAY_MS, 2000 * 2 ** (attempt - 1));

    retryTimeoutRef.current = window.setTimeout(() => {
      retryTimeoutRef.current = null;
      if (!hasUnsavedChangesRef.current) return;
      void saveAllRef.current();
    }, delay);

    setError(`Save failed. Retrying in ${Math.round(delay / 1000)}s.`);
  }

  async function saveAll(versionOverride?: number) {
    if (!accessToken || !taskId || savingRef.current) return;
    const token: string = accessToken;
    const resolvedTaskId: string = taskId;
    if (!hasUnsavedChanges && !versionOverride) return;

    savingRef.current = true;
    setSaveState("saving");
    setError(null);
    setSectionErrors({});

    const sanitizedPIIAnnotations = sanitizePIIAnnotations(finalTranscript, piiAnnotations);
    let currentVersion = versionOverride ?? version;
    const dirtySections: string[] = [];
    try {
      const payload: Parameters<typeof patchTaskCombined>[2] = { version: currentVersion };
      if (transcriptDirty) {
        payload.final_transcript = finalTranscript;
        dirtySections.push("transcript");
      }

      if (metadataDirty) {
        const parsedDuration = metadata.duration_seconds.trim() ? Number(metadata.duration_seconds) : null;
        payload.speaker_gender = metadata.speaker_gender || null;
        payload.speaker_role = metadata.speaker_role || null;
        payload.language = metadata.language || null;
        payload.channel = metadata.channel || null;
        payload.duration_seconds = Number.isNaN(parsedDuration) ? null : parsedDuration;
        payload.custom_metadata = customMetadata;
        dirtySections.push("metadata");
      }

      if (notesDirty) {
        payload.notes = notes || null;
        dirtySections.push("notes");
      }

      if (statusDirty) {
        payload.status = status;
        dirtySections.push("status");
      }

      if (piiDirty) {
        payload.pii_annotations = sanitizedPIIAnnotations;
        dirtySections.push("pii");
      }

      if (dirtySections.length === 0) {
        setSaveState("saved");
        clearRetryTimer();
        retryAttemptRef.current = 0;
        clearLocalDraft();
        setDraftState({ mode: "none", savedAt: null });
        return;
      }

      const response = await patchTaskCombined(token, resolvedTaskId, payload);
      currentVersion = response.task.version;
      setVersion(currentVersion);
      applyTaskState(response.task);
      setSaveState("saved");
      clearRetryTimer();
      retryAttemptRef.current = 0;
      clearLocalDraft();
      setDraftState({ mode: "none", savedAt: null });
      const activityResponse = await fetchTaskActivity(token, resolvedTaskId);
      setActivity(activityResponse.items);
    } catch (err) {
      if (err instanceof APIError && err.status === 409) {
        const detail = (err.payload as { detail?: { server_task?: TaskDetail; conflicting_fields?: string[] } })
          ?.detail;
        setConflict({
          open: true,
          serverTask: detail?.server_task ?? null,
          conflictingFields: detail?.conflicting_fields ?? []
        });
        setSaveState("error");
        clearRetryTimer();
        retryAttemptRef.current = 0;
      } else {
        setSaveState("error");
        const message = err instanceof APIError ? err.message : "Save failed";
        setError(message);
        setSectionErrors(
          Object.fromEntries(
            (dirtySections.length ? dirtySections : ["transcript", "metadata", "notes", "status", "pii"]).map(
              (section) => [section, message]
            )
          )
        );
        const shouldRetry = !(err instanceof APIError) || err.status >= 500;
        if (shouldRetry) {
          scheduleRetrySave();
        } else {
          clearRetryTimer();
          retryAttemptRef.current = 0;
        }
      }
    } finally {
      savingRef.current = false;
    }
  }
  saveAllRef.current = saveAll;

  function handleUseServer() {
    if (!conflict.serverTask) return;
    applyTaskState(conflict.serverTask);
    setConflict({ open: false, serverTask: null, conflictingFields: [] });
  }

  function handleUseMine() {
    if (!conflict.serverTask) return;
    const serverVersion = conflict.serverTask.version;
    setVersion(serverVersion);
    setConflict({ open: false, serverTask: null, conflictingFields: [] });
    void saveAll(serverVersion);
  }

  function handleMerge(resolution?: ConflictMergeResolution) {
    if (!conflict.serverTask) return;
    const mergedTask = conflict.serverTask;
    const serverMetadata: CoreMetadataState = {
      speaker_gender: mergedTask.speaker_gender ?? "",
      speaker_role: mergedTask.speaker_role ?? "",
      language: mergedTask.language ?? "",
      channel: mergedTask.channel ?? "",
      duration_seconds:
        mergedTask.duration_seconds !== null && mergedTask.duration_seconds !== undefined
          ? String(mergedTask.duration_seconds)
          : "",
    };
    const serverCustomMetadata = Object.fromEntries(
      Object.entries(mergedTask.custom_metadata ?? {}).map(([key, value]) => [key, String(value ?? "")])
    );

    Object.entries(resolution ?? {}).forEach(([field, choice]) => {
      if (choice !== "server") return;
      if (field === "final_transcript") {
        const serverTranscript = mergedTask.final_transcript ?? "";
        setFinalTranscript(serverTranscript);
        setOriginalTranscript(serverTranscript);
        setTranscriptDirty(false);
      }
      if (field === "notes") {
        const serverNotes = mergedTask.notes ?? "";
        setNotes(serverNotes);
        setOriginalNotes(serverNotes);
        setNotesDirty(false);
      }
      if (field === "status") {
        setStatus(mergedTask.status);
        setOriginalStatus(mergedTask.status);
        setStatusDirty(false);
      }
      if (field === "pii_annotations") {
        const serverPII = sanitizePIIAnnotations(mergedTask.final_transcript ?? finalTranscript, mergedTask.pii_annotations ?? []);
        setPiiAnnotations(serverPII);
        setOriginalPIIAnnotations(serverPII);
        setPiiDirty(false);
      }
      if (field in serverMetadata) {
        setMetadata((prev) => ({ ...prev, [field]: serverMetadata[field as keyof CoreMetadataState] }));
        setOriginalMetadata((prev) => ({ ...prev, [field]: serverMetadata[field as keyof CoreMetadataState] }));
        setMetadataDirty(false);
      }
      if (field === "custom_metadata") {
        setCustomMetadata(serverCustomMetadata);
        setOriginalCustomMetadata(serverCustomMetadata);
        setMetadataDirty(false);
      }
    });

    setVersion(mergedTask.version);
    setConflict({ open: false, serverTask: null, conflictingFields: [] });
    window.setTimeout(() => void saveAll(mergedTask.version), 0);
  }

  function handleDetectPII() {
    const detected = detectPIIAnnotations(finalTranscript);
    setPiiAnnotations(detected);
    setTranscriptSelection(null);
    setSaveState("unsaved");
  }

  function syncTranscriptSelection() {
    const textarea = transcriptTextareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selectedValue = finalTranscript.slice(start, end);

    if (end <= start || !selectedValue.trim()) {
      setTranscriptSelection(null);
      return;
    }

    setTranscriptSelection({ start, end, value: selectedValue });
  }

  function handleAddPIIFromSelection(label: string = selectionLabel) {
    const activeSelection =
      transcriptSelection ??
      (() => {
        const textarea = transcriptTextareaRef.current;
        if (!textarea) return null;
        const start = textarea.selectionStart ?? 0;
        const end = textarea.selectionEnd ?? 0;
        const selectedValue = finalTranscript.slice(start, end);
        if (end <= start || !selectedValue.trim()) return null;
        return { start, end, value: selectedValue };
      })();

    if (!activeSelection) {
      setError("Select text in the final transcript to add a PII entity.");
      return;
    }

    const { start, end, value } = activeSelection;
    const existingAnnotation = piiAnnotations.find((item) => item.start === start && item.end === end);

    const next = sanitizePIIAnnotations(
      finalTranscript,
      existingAnnotation
        ? piiAnnotations.map((item) =>
            item.id === existingAnnotation.id
              ? { ...item, label, value, start, end, source: "manual", confidence: null }
              : item
          )
        : [
            ...piiAnnotations,
            {
              id:
                typeof crypto !== "undefined" && "randomUUID" in crypto
                  ? crypto.randomUUID()
                  : `pii-${Date.now()}`,
              label,
              start,
              end,
              value,
              source: "manual",
              confidence: null,
            },
          ]
    );
    setPiiAnnotations(next);
    setTranscriptSelection(null);
    setActiveInspectorPanel("pii");
    setSaveState("unsaved");
    setError(null);
  }

  function handleChangePII(annotations: PIIAnnotation[]) {
    const sanitized = sanitizePIIAnnotations(finalTranscript, annotations);
    setPiiAnnotations(sanitized);
    setSaveState("unsaved");
  }

  function handleRestoreLocalDraft() {
    if (!draftStorageKey) return;
    let draft: LocalTaskDraft | null = null;
    try {
      draft = parseLocalDraft(localStorage.getItem(draftStorageKey));
    } catch {
      draft = null;
    }
    if (!draft || draft.task_id !== task?.id) {
      setDraftState({ mode: "none", savedAt: null });
      return;
    }
    applyLocalDraftState(draft);
    setDraftState({ mode: "restored", savedAt: draft.saved_at });
  }

  function handleDiscardLocalDraft() {
    clearLocalDraft();
    setDraftState({ mode: "none", savedAt: null });
  }

  const detailRows = task
    ? [
        { label: "Task ID", value: task.external_id },
        { label: "Audio Source", value: task.file_location },
        { label: "ASR Sources", value: `${task.transcript_variants.length} model${task.transcript_variants.length === 1 ? "" : "s"}` },
        { label: "PII Entities", value: String(piiAnnotations.length) },
        {
          label: "Assigned To",
          value: task.assignee_name
            ? `${task.assignee_name}${task.assignee_email ? ` (${task.assignee_email})` : ""}`
            : "Unassigned",
        },
        {
          label: "Last Tagged By",
          value: task.last_tagger_name
            ? `${task.last_tagger_name}${task.last_tagger_email ? ` (${task.last_tagger_email})` : ""}`
            : "Not tagged yet",
        },
        { label: "Duration", value: formatDurationLabel(metadata.duration_seconds) },
      ]
    : [];

  if (loading) {
    return (
      <section className="oa-card max-w-xl px-4 py-3 text-sm text-[#676280]">Loading task workspace...</section>
    );
  }

  if (!task) {
    return (
      <section className="rounded-lg border border-[#f0c8c8] bg-[#fff3f3] px-4 py-3 text-sm text-[#a13a3a]">
        {error ?? "Task not found"}
      </section>
    );
  }

  return (
    <section className="animate-fade-in space-y-4">
      <div className="relative overflow-hidden rounded-[1.35rem] border border-[#e4e7ee] bg-[linear-gradient(135deg,#ffffff_0%,#f6f8fb_100%)] shadow-[0_22px_48px_-40px_rgba(15,23,42,0.45)]">
        <div className="pointer-events-none absolute -left-28 top-8 h-56 w-56 rounded-full bg-[#eef2ff] blur-3xl" />
        <div className="pointer-events-none absolute -right-16 -top-12 h-44 w-44 rounded-full bg-[#fce7f3] blur-3xl" />
        <div className="relative z-10 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b7280]">Annotation Workspace</p>
              <div className="mt-1 flex items-center gap-2">
                <h2 className="oa-title text-xl font-semibold">Task {task.external_id}</h2>
                <StatusBadge status={status} />
              </div>
              <p className="mt-1 max-w-[840px] break-all text-xs text-[#6b7280]">{task.file_location}</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!task.prev_task_id}
                onClick={() => task.prev_task_id && router.push(`/tasks/${task.prev_task_id}`)}
                className="oa-btn-secondary px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!task.next_task_id}
                onClick={() => task.next_task_id && router.push(`/tasks/${task.next_task_id}`)}
                className="oa-btn-secondary px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
              <button type="button" onClick={() => void saveAll()} className="oa-btn-primary px-4 py-1.5 text-sm font-medium">
                Save
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs font-medium text-[#374151]">
              {task.transcript_variants.length} ASR source{task.transcript_variants.length === 1 ? "" : "s"}
            </span>
            <span className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs font-medium text-[#374151]">
              {piiAnnotations.length} PII label{piiAnnotations.length === 1 ? "" : "s"}
            </span>
            <span className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs font-medium text-[#374151]">
              {task.assignee_name ? `Assignee: ${task.assignee_name}` : "Unassigned"}
            </span>
            <span className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs font-medium text-[#374151]">
              {task.last_tagger_name ? `Last Tagger: ${task.last_tagger_name}` : "Last Tagger: —"}
            </span>
            <span className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs font-medium text-[#374151]">
              Duration {formatDurationLabel(metadata.duration_seconds)}
            </span>
          </div>

          <div className="mt-4 grid gap-3 border-t border-[#e5e7eb] pt-3 lg:grid-cols-[auto,1fr,auto] lg:items-center">
            <SaveIndicator state={saveState} lastSavedAt={task.last_saved_at} />
            <span aria-live="polite" className="text-xs text-[#6b7280]">
              {hasUnsavedChanges ? "Pending save" : "All edits saved"}
            </span>
            <label className="flex items-center gap-2 text-sm text-[#4b5563]">
              <span>Status</span>
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as TaskStatus);
                  setSaveState("unsaved");
                }}
                className="oa-select min-w-[180px] py-1.5"
              >
                {statusOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            aria-label="Autosave section status"
            aria-live="polite"
            className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5"
          >
            {saveSectionStatuses.map((section) => {
              const stateLabel =
                section.state === "failed" ? "Failed" : section.state === "pending" ? "Pending" : "Saved";
              const stateClass =
                section.state === "failed"
                  ? "border-[#f0c8c8] bg-[#fff3f3] text-[#a13a3a]"
                  : section.state === "pending"
                    ? "border-[#ffd9a8] bg-[#fff8ec] text-[#925b17]"
                    : "border-[#d7eadf] bg-[#f1fbf5] text-[#266544]";

              return (
                <div key={section.key} className={`rounded-lg border px-2.5 py-2 text-xs ${stateClass}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{section.label}</span>
                    <span>{stateLabel}</span>
                  </div>
                  {section.failedMessage ? (
                    <p className="mt-1 line-clamp-2 text-[11px] opacity-90">{section.failedMessage}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {draftState.mode !== "none" ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            draftState.mode === "pending"
              ? "border-[#ffd9a8] bg-[#fff5e7] text-[#925b17]"
              : "border-[#d8c2ef] bg-[#f5eeff] text-[#533b7f]"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              {draftState.mode === "pending"
                ? `Unsaved local draft found from ${draftState.savedAt ? new Date(draftState.savedAt).toLocaleString() : "a previous session"}.`
                : `Recovered unsaved draft from ${draftState.savedAt ? new Date(draftState.savedAt).toLocaleString() : "this device"}.`}
            </p>
            <div className="flex items-center gap-2">
              {draftState.mode === "pending" ? (
                <button type="button" onClick={handleRestoreLocalDraft} className="oa-btn-secondary px-3 py-1.5 text-xs font-medium">
                  Restore Draft
                </button>
              ) : null}
              <button type="button" onClick={handleDiscardLocalDraft} className="oa-btn-secondary px-3 py-1.5 text-xs font-medium">
                Discard Local Draft
              </button>
              {draftState.mode === "restored" ? (
                <button type="button" onClick={() => void saveAll()} className="oa-btn-primary px-3 py-1.5 text-xs font-medium">
                  Save Now
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.95fr)]">
        <div className="space-y-4">
          <div className="oa-card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="oa-title text-sm font-semibold uppercase tracking-[0.1em] text-[#4b5563]">Audio</h3>
              <span className="rounded-full border border-[#e5e7eb] bg-[#f8fafc] px-2.5 py-1 text-[11px] text-[#64748b]">
                Playback + Review
              </span>
            </div>
            <AudioWaveformPlayer audioUrl={audioUrl} />
          </div>

          <div className="oa-card p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="oa-title text-sm font-semibold">Final Transcript</h3>
              <span className="text-xs text-[#6b7280]">Primary editing area</span>
            </div>
            <textarea
              ref={transcriptTextareaRef}
              aria-label="Final Transcript"
              value={finalTranscript}
              onChange={(event) => {
                setFinalTranscript(event.target.value);
                setTranscriptSelection(null);
                setSaveState("unsaved");
              }}
              onSelect={syncTranscriptSelection}
              onKeyUp={syncTranscriptSelection}
              onMouseUp={syncTranscriptSelection}
              onBlur={() => void saveAll()}
              rows={14}
              className="oa-textarea min-h-[460px] bg-white font-mono text-[15px]"
            />
            <div className="mt-3 rounded-xl border border-[#e5e7eb] bg-[#f8fafc] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#4b5563]">Inline PII Label</p>
                <p className="text-xs text-[#6b7280]">
                  {transcriptSelection
                    ? `Selected: "${transcriptSelection.value.slice(0, 80)}${
                        transcriptSelection.value.length > 80 ? "..." : ""
                      }" (${transcriptSelection.start}-${transcriptSelection.end})`
                    : "Select text in transcript, pick a label, and add it."}
                </p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  aria-label="Inline PII Label"
                  value={selectionLabel}
                  onChange={(event) => setSelectionLabel(event.target.value)}
                  className="oa-select min-w-[170px] py-1.5 text-sm"
                >
                  {piiLabelOptions.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleAddPIIFromSelection(selectionLabel)}
                  disabled={!transcriptSelection}
                  className="oa-btn-secondary px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add Label To Selection
                </button>
                <button
                  type="button"
                  onClick={handleDetectPII}
                  className="oa-btn-quiet px-3 py-1.5 text-xs font-medium"
                >
                  Auto Detect PII
                </button>
                <button
                  type="button"
                  onClick={() => setActiveInspectorPanel("pii")}
                  className="oa-btn-quiet px-3 py-1.5 text-xs font-medium"
                >
                  Open PII Panel
                </button>
              </div>
            </div>
          </div>
        </div>

        <aside className="oa-card p-3 sm:p-4">
          <div className="rounded-xl border border-[#e5e7eb] bg-[#f8fafc] p-1">
            <div className="grid grid-cols-6 gap-1">
              {inspectorTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveInspectorPanel(tab.key)}
                  className={`rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                    activeInspectorPanel === tab.key
                      ? "bg-white text-[#111827] shadow-[0_8px_20px_-18px_rgba(15,23,42,0.9)]"
                      : "text-[#6b7280] hover:bg-white/70"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-[#e5e7eb] bg-[#fbfcfe] p-3">
            {activeInspectorPanel === "compare" ? (
              <>
                <h3 className="oa-title mb-2 text-sm font-semibold">ASR Transcript Comparison</h3>
                <TranscriptComparison
                  transcripts={task.transcript_variants}
                  onCopy={(text) => {
                    setFinalTranscript(text);
                    setSaveState("unsaved");
                  }}
                />
              </>
            ) : null}

            {activeInspectorPanel === "metadata" ? (
              <>
                <h3 className="oa-title mb-2 text-sm font-semibold">Metadata</h3>
                <MetadataEditor
                  value={metadata}
                  original={originalMetadata}
                  customMetadata={customMetadata}
                  originalCustomMetadata={originalCustomMetadata}
                  onCoreChange={(field, value) => {
                    setMetadata((prev) => ({ ...prev, [field]: value }));
                    setSaveState("unsaved");
                  }}
                  onCustomChange={(field, value) => {
                    setCustomMetadata((prev) => ({ ...prev, [field]: value }));
                    setSaveState("unsaved");
                  }}
                />
              </>
            ) : null}

            {activeInspectorPanel === "pii" ? (
              <PIIAnnotator
                transcript={finalTranscript}
                annotations={piiAnnotations}
                onChange={handleChangePII}
                onDetect={handleDetectPII}
                onClear={() => {
                  setPiiAnnotations([]);
                  setTranscriptSelection(null);
                  setSaveState("unsaved");
                }}
              />
            ) : null}

            {activeInspectorPanel === "notes" ? (
              <div className="space-y-2">
                <h3 className="oa-title text-sm font-semibold">Notes</h3>
                <textarea
                  aria-label="Notes"
                  value={notes}
                  onChange={(event) => {
                    setNotes(event.target.value);
                    setSaveState("unsaved");
                  }}
                  onBlur={() => void saveAll()}
                  rows={8}
                  className="oa-textarea"
                />
              </div>
            ) : null}

            {activeInspectorPanel === "activity" ? (
              <div>
                <h3 className="oa-title mb-2 text-sm font-semibold">Activity</h3>
                <div className="space-y-2">
                  {activity.length > 0 ? (
                    activity.map((item) => (
                      <div key={`${item.type}-${item.id}`} className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#4b5563]">
                            {item.type === "status" ? "Status" : item.action.replaceAll("_", " ")}
                          </span>
                          <span className="text-[11px] text-[#6b7280]">{new Date(item.changed_at).toLocaleString()}</span>
                        </div>
                        <p className="mt-1 text-xs text-[#6b7280]">
                          {item.type === "status"
                            ? `${item.old_status ?? "Imported"} -> ${item.new_status ?? "-"}`
                            : Object.keys(item.changed_fields ?? {}).join(", ") || "Task updated"}
                        </p>
                        {item.comment ? <p className="mt-1 text-xs text-[#4b5563]">{item.comment}</p> : null}
                      </div>
                    ))
                  ) : (
                    <p className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-sm text-[#6b7280]">
                      No activity recorded yet.
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            {activeInspectorPanel === "details" ? (
              <div>
                <h3 className="oa-title mb-2 text-sm font-semibold">Task Details</h3>
                <dl className="space-y-2">
                  {detailRows.map((row) => (
                    <div key={row.label} className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-2">
                      <dt className="text-[11px] uppercase tracking-[0.12em] text-[#6b7280]">{row.label}</dt>
                      <dd className="mt-0.5 break-all text-sm font-medium text-[#111827]">{row.value || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      {error ? (
        <div className="rounded-lg border border-[#f0c8c8] bg-[#fff3f3] px-3 py-2 text-sm text-[#a13a3a]">
          <p>{error}</p>
          {Object.keys(sectionErrors).length > 0 ? (
            <ul className="mt-1 flex flex-wrap gap-2 text-xs">
              {Object.entries(sectionErrors).map(([section, message]) => (
                <li key={section} className="rounded-full bg-white/70 px-2 py-0.5">
                  {section}: {message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <ConflictModal
        open={conflict.open}
        serverTask={conflict.serverTask}
        conflictingFields={conflict.conflictingFields}
        localValues={{
          final_transcript: finalTranscript,
          notes,
          status,
          speaker_gender: metadata.speaker_gender || null,
          speaker_role: metadata.speaker_role || null,
          language: metadata.language || null,
          channel: metadata.channel || null,
          duration_seconds: metadata.duration_seconds ? Number(metadata.duration_seconds) : null,
          custom_metadata: customMetadata,
          pii_annotations: piiAnnotations,
        }}
        onUseServer={handleUseServer}
        onUseMine={handleUseMine}
        onMerge={handleMerge}
      />
    </section>
  );
}
