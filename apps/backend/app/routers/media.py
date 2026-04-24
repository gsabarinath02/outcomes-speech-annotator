from fastapi import APIRouter, Header, HTTPException

from app.services.errors import ServiceError
from app.services.media_service import MediaService

router = APIRouter(prefix="/media", tags=["media"])


def _http_error(exc: ServiceError) -> HTTPException:
    detail = {"message": exc.message}
    detail.update(exc.extra)
    return HTTPException(status_code=exc.status_code, detail=detail)


@router.get("/audio/{token}")
def stream_audio(token: str, range_header: str | None = Header(default=None, alias="Range")):
    service = MediaService()
    try:
        payload = service.decode_audio_token(token)
        file_location = payload["file_location"]
        return service.build_audio_response(file_location, range_header)
    except (ServiceError, KeyError, FileNotFoundError) as exc:
        if isinstance(exc, ServiceError):
            raise _http_error(exc) from exc
        raise HTTPException(status_code=404, detail="Audio file not found") from exc
