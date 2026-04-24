from redis import Redis
from rq import Queue, Worker

from app.core.config import get_settings


def main() -> None:
    settings = get_settings()
    redis_conn = Redis.from_url(settings.redis_url)
    queue = Queue("speech-annotator", connection=redis_conn)
    Worker([queue], connection=redis_conn).work()


if __name__ == "__main__":
    main()
