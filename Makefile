PYTHON ?= python3

.PHONY: backend-install backend-test frontend-install frontend-test frontend-build e2e-test compose-up compose-down seed

backend-install:
	cd apps/backend && $(PYTHON) -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt

backend-test:
	cd apps/backend && . .venv/bin/activate && pytest

frontend-install:
	cd apps/frontend && npm install

frontend-test:
	cd apps/frontend && npm run test

frontend-build:
	cd apps/frontend && npm run build

e2e-test:
	npm run test:e2e

compose-up:
	docker compose up --build

compose-down:
	docker compose down -v

seed:
	docker compose exec backend python scripts/seed.py
