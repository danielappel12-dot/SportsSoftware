"""FastAPI application entry point."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import config
from .api import bursts, exports, people, photos, projects
from .db import get_conn
from .security import PathNotAllowed
from .services import jobs

log = logging.getLogger("sideline")
FRONTEND_DIST = config.BACKEND_DIR.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_conn()  # create + migrate the database
    jobs.runner.recover()
    log.info("%s %s ready – data dir %s", config.APP_NAME, config.VERSION, config.data_dir())
    yield


def create_app() -> FastAPI:
    app = FastAPI(title=config.APP_NAME, version=config.VERSION, lifespan=lifespan)
    # Local-only service: refuse foreign Host headers (DNS rebinding) and cross-site mutating requests (CSRF).
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"])
    app.add_middleware(CORSMiddleware, allow_origins=config.allowed_origins(), allow_methods=["*"], allow_headers=["*"])

    @app.middleware("http")
    async def origin_guard(request: Request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            if origin and origin not in config.allowed_origins():
                return JSONResponse({"detail": "Cross-origin request blocked."}, status_code=403)
        return await call_next(request)

    @app.exception_handler(PathNotAllowed)
    async def _path_err(_req, exc: PathNotAllowed):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    for r in (projects.router, photos.router, people.router, bursts.router, exports.router):
        app.include_router(r)

    @app.get("/api/health")
    def health():
        return {"ok": True, "version": config.VERSION}

    if FRONTEND_DIST.exists():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

        @app.get("/{full_path:path}")
        def spa(full_path: str):
            if full_path.startswith("api/"):
                return JSONResponse({"detail": "Not found"}, status_code=404)
            f = (FRONTEND_DIST / full_path).resolve()
            if full_path and f.is_file() and FRONTEND_DIST.resolve() in f.parents:
                return FileResponse(f)
            return FileResponse(FRONTEND_DIST / "index.html")
    return app


app = create_app()


def run() -> None:  # python -m sideline.main
    import os
    import uvicorn
    uvicorn.run("sideline.main:app", host="127.0.0.1", port=int(os.environ.get("SIDELINE_PORT", "8000")), log_level="info")


if __name__ == "__main__":
    run()
