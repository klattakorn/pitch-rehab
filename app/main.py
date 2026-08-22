from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Importing the models package registers every table on Base.metadata.
import app.models  # noqa: F401
from app import __version__
from app.api.routers import api_router
from app.core.config import settings
from app.db.base import Base
from app.db.seed import seed_all
from app.db.session import SessionLocal, engine

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("rtp")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # create_all is fine while the schema is still moving. Swap in Alembic
    # before the first real deployment -- see README.
    Base.metadata.create_all(bind=engine)
    if settings.seed_on_startup:
        with SessionLocal() as db:
            seed_all(db)
    if settings.is_prod and settings.secret_key == "dev-only-insecure-change-me":
        raise RuntimeError("RTP_SECRET_KEY must be set in production")
    yield


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    description=(
        "Backend for คืนสู่สนาม / Return-To-Pitch: position-specific football "
        "rehabilitation with MediaPipe form checking and measurable exit criteria."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_prefix)


@app.get("/healthz", tags=["meta"])
def healthz() -> dict[str, str]:
    return {"status": "ok", "version": __version__, "env": settings.env}
