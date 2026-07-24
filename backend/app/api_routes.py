from fastapi import APIRouter

from .routes.ai_routes import router as ai_router
from .routes.audio_routes import router as audio_router
from .routes.export_routes import router as export_router
from .routes.library_routes import router as library_router
from .routes.playlist_routes import router as playlist_router
from .routes.settings_routes import router as settings_router
from .routes.tag_routes import router as tag_router
from .routes.transcript_routes import router as transcript_router


router = APIRouter()

router.include_router(library_router)
router.include_router(audio_router)
router.include_router(tag_router)
router.include_router(playlist_router)
router.include_router(transcript_router)
router.include_router(ai_router)
router.include_router(settings_router)
router.include_router(export_router)
