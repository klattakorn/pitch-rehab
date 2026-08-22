from fastapi import APIRouter

from app.api.routers import auth, catalog, health, injuries, players, sessions

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(players.router)
api_router.include_router(catalog.router)
api_router.include_router(injuries.router)
api_router.include_router(sessions.router)
api_router.include_router(health.router)

__all__ = ["api_router"]
