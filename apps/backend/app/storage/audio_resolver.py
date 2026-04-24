from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO
from urllib.parse import urlparse

import boto3
from botocore.client import BaseClient
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import get_settings

settings = get_settings()


@dataclass
class AudioLocation:
    scheme: str
    bucket: str | None
    key: str | None
    local_path: str | None


class AudioResolver:
    def __init__(self) -> None:
        self._s3_client: BaseClient | None = None
        if settings.s3_enabled:
            self._s3_client = boto3.client(
                "s3",
                endpoint_url=settings.s3_endpoint_url,
                region_name=settings.s3_region,
                aws_access_key_id=settings.s3_access_key_id,
                aws_secret_access_key=settings.s3_secret_access_key,
            )

    def resolve(self, file_location: str) -> AudioLocation:
        if file_location.startswith("s3://"):
            parsed = urlparse(file_location)
            return AudioLocation(
                scheme="s3",
                bucket=parsed.netloc,
                key=parsed.path.lstrip("/"),
                local_path=None,
            )
        if file_location.startswith("local://"):
            return AudioLocation(
                scheme="local",
                bucket=None,
                key=None,
                local_path=file_location.replace("local://", "", 1),
            )
        return AudioLocation(
            scheme="local",
            bucket=None,
            key=None,
            local_path=file_location,
        )

    def can_validate_s3(self) -> bool:
        return self._s3_client is not None

    def location_exists(self, location: AudioLocation) -> bool:
        if location.scheme == "local" and location.local_path:
            return Path(location.local_path).expanduser().is_file()
        if location.scheme == "s3" and location.bucket and location.key and self._s3_client:
            try:
                self._s3_client.head_object(Bucket=location.bucket, Key=location.key)
                return True
            except (ClientError, BotoCoreError):
                return False
        return False

    def open_audio(self, location: AudioLocation) -> BinaryIO:
        if location.scheme == "local" and location.local_path:
            return Path(location.local_path).expanduser().open("rb")
        if location.scheme == "s3" and location.bucket and location.key and self._s3_client:
            response = self._s3_client.get_object(Bucket=location.bucket, Key=location.key)
            return response["Body"]
        raise FileNotFoundError("Unable to resolve audio file location")
