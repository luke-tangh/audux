from fastapi import APIRouter

from .routes.activity_routes import router as activity_router
from .routes.ai_routes import router as ai_router
from .routes.asr_routes import router as asr_router
from .routes.audio_routes import router as audio_router
from .routes.backup_routes import router as backup_router
from .routes.export_routes import router as export_router
from .routes.health_routes import router as health_router
from .routes.library_routes import router as library_router
from .routes.playlist_routes import router as playlist_router
from .routes.saved_view_routes import router as saved_view_router
from .routes.settings_routes import router as settings_router
from .routes.statistics_routes import router as statistics_router
from .routes.tag_routes import router as tag_router
from .routes.transcript_routes import router as transcript_router
from .routes.retrieval_routes import router as retrieval_router
from .routes.agent_routes import router as agent_router


router = APIRouter()

router.include_router(activity_router)
router.include_router(library_router)
router.include_router(health_router)
router.include_router(audio_router)
router.include_router(tag_router)
router.include_router(playlist_router)
router.include_router(saved_view_router)
router.include_router(transcript_router)
router.include_router(retrieval_router)
router.include_router(agent_router)
router.include_router(ai_router)
router.include_router(asr_router)
router.include_router(settings_router)
router.include_router(statistics_router)
router.include_router(export_router)
router.include_router(backup_router)
