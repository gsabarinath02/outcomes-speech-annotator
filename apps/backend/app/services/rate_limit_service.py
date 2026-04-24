import time
from dataclasses import dataclass

from app.core.config import get_settings

_memory_attempts: dict[str, tuple[int, float]] = {}


@dataclass
class LoginRateLimiter:
    key_prefix: str = "login"

    def __post_init__(self) -> None:
        self.settings = get_settings()
        self._redis = None
        if self.settings.redis_url:
            try:
                import redis

                self._redis = redis.Redis.from_url(self.settings.redis_url, socket_connect_timeout=0.1)
                self._redis.ping()
            except Exception:
                self._redis = None

    def _key(self, email: str, client_host: str | None) -> str:
        normalized_email = email.strip().lower()
        return f"{self.key_prefix}:{client_host or 'unknown'}:{normalized_email}"

    def is_blocked(self, email: str, client_host: str | None) -> bool:
        if not self.settings.login_rate_limit_enabled:
            return False
        key = self._key(email, client_host)
        if self._redis is not None:
            value = self._redis.get(key)
            return bool(value and int(value) >= self.settings.login_rate_limit_max_attempts)

        count, expires_at = _memory_attempts.get(key, (0, 0))
        if expires_at <= time.time():
            _memory_attempts.pop(key, None)
            return False
        return count >= self.settings.login_rate_limit_max_attempts

    def record_failure(self, email: str, client_host: str | None) -> None:
        if not self.settings.login_rate_limit_enabled:
            return
        key = self._key(email, client_host)
        window = self.settings.login_rate_limit_window_seconds
        if self._redis is not None:
            count = self._redis.incr(key)
            if count == 1:
                self._redis.expire(key, window)
            return

        now = time.time()
        count, expires_at = _memory_attempts.get(key, (0, now + window))
        if expires_at <= now:
            count = 0
            expires_at = now + window
        _memory_attempts[key] = (count + 1, expires_at)

    def reset(self, email: str, client_host: str | None) -> None:
        key = self._key(email, client_host)
        if self._redis is not None:
            self._redis.delete(key)
            return
        _memory_attempts.pop(key, None)
