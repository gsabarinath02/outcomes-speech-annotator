#!/usr/bin/env sh
set -e

export PYTHONPATH=/app

alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000
