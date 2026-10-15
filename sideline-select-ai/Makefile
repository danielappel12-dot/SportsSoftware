.PHONY: start dev test test-fast build models
start:        ; ./scripts/start.sh
dev:          ; ./scripts/dev.sh
build:        ; cd frontend && npm ci && npm run build
test:         ; cd backend && python -m pytest -q
test-fast:    ; cd backend && python -m pytest -q tests/test_quality.py tests/test_hashing_burst.py tests/test_jersey.py tests/test_db.py tests/test_export.py tests/test_detector_plumbing.py
models:       ; cd backend && python manage_models.py status
