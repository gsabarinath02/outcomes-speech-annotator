from pathlib import Path

import pytest

from app.main import app


def _find_shared_types() -> Path | None:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "packages" / "shared-types" / "src" / "index.ts"
        if candidate.exists():
            return candidate
    return None


def test_openapi_and_shared_types_include_new_workflow_contracts():
    schema = app.openapi()
    paths = schema["paths"]
    assert "/api/v1/tasks/{task_id}" in paths
    assert "patch" in paths["/api/v1/tasks/{task_id}"]
    assert "/api/v1/tasks/{task_id}/claim" in paths
    assert "/api/v1/tasks/{task_id}/start" in paths
    assert "/api/v1/tasks/next/claim" in paths
    assert "/api/v1/tasks/bulk-assignee" in paths
    assert "/api/v1/tasks/{task_id}/activity" in paths
    assert "/api/v1/exports/tasks/jobs" in paths
    assert "/api/v1/uploads/{upload_job_id}/import/jobs" in paths
    assert "/api/v1/jobs/{job_id}" in paths

    shared_types = _find_shared_types()
    if shared_types is None:
        pytest.skip("shared-types package is not available in this backend-only test image")

    content = shared_types.read_text()
    for expected in ["interface TaskDetail", "interface TaskListResponse", "interface JobStatus", "last_tagger_email"]:
        assert expected in content
