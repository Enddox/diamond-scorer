"""FastAPI application factory: mounts the API and serves the frontend SPA."""
from __future__ import annotations

import base64
import os
import secrets
import asyncio
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .api import router as api_router
from .db import init_db

_FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


def _install_optional_basic_auth(app: FastAPI) -> None:
    """Enable HTTP Basic auth for the whole app when ``DIAMONDSCORER_AUTH`` is set.

    The variable format is ``user:password``. This is OFF by default so local /
    desktop use is unchanged; set it when hosting Diamond Scorer on a public
    website so the data is not world-writable. ``/health`` stays open so load
    balancers can probe it.
    """
    cred = os.environ.get("DIAMONDSCORER_AUTH", "").strip()
    if not cred or ":" not in cred:
        return
    want_user, want_pass = cred.split(":", 1)

    @app.middleware("http")
    async def _basic_auth(request, call_next):
        if request.url.path == "/health":
            return await call_next(request)
        header = request.headers.get("authorization", "")
        ok = False
        if header.lower().startswith("basic "):
            try:
                raw = base64.b64decode(header[6:]).decode("utf-8", "replace")
                user, _, pw = raw.partition(":")
                # Constant-time comparison to avoid leaking length/content.
                ok = (secrets.compare_digest(user, want_user)
                      and secrets.compare_digest(pw, want_pass))
            except Exception:
                ok = False
        if not ok:
            return Response(
                status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="Diamond Scorer"'},
                content="Authentication required.",
            )
        return await call_next(request)


def _install_write_serialization(app: FastAPI) -> None:
    """Serialize mutating requests so SQLite never sees two writers at once.

    The app is a single process whose sync endpoints run across Starlette's
    threadpool, so two write requests (e.g. the scorer saving the away and
    home lineups, or a save racing an in-flight action) can land on different
    threads and hit the DB concurrently. SQLite allows only ONE writer, so the
    second writer would either fail instantly with ``database is locked`` --
    surfacing to the UI as the ``Something went wrong, reload`` recovery
    overlay -- or, with a busy_timeout, stall for many seconds under WAL
    writer contention. Writes are inexpensive and infrequent for a scoring
    app, so we simply funnel every mutating (non-GET/HEAD/OPTIONS) request
    through one asyncio lock. Reads stay fully concurrent (WAL readers never
    block), so this adds no latency to the hot read path.
    """
    lock = asyncio.Lock()
    SAFE = {"GET", "HEAD", "OPTIONS"}

    @app.middleware("http")
    async def _serialize_writes(request, call_next):
        if request.method in SAFE:
            return await call_next(request)
        async with lock:
            return await call_next(request)


def create_app() -> FastAPI:
    app = FastAPI(title="Diamond Scorer", version="0.1.0")

    # Initialise the schema eagerly so the DB is ready regardless of how the
    # app is launched (uvicorn, TestClient, or PyInstaller bundle).
    init_db()

    # Optional auth for hosted/public deployments (no-op unless env var set).
    _install_optional_basic_auth(app)

    # Serialize writes to keep concurrent saves from colliding on SQLite.
    _install_write_serialization(app)

    app.include_router(api_router)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    # Serve static assets (css/js) and index.html for the SPA.
    app.mount("/css", StaticFiles(directory=str(_FRONTEND / "css")), name="css")
    app.mount("/js", StaticFiles(directory=str(_FRONTEND / "js")), name="js")

    @app.get("/")
    def index():
        return FileResponse(str(_FRONTEND / "index.html"))

    return app


app = create_app()
