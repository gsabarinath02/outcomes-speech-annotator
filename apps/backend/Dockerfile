FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore

WORKDIR /app

COPY requirements.txt /app/requirements.txt
COPY requirements-alignment.txt /app/requirements-alignment.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
ARG INSTALL_ALIGNMENT_DEPS=true
RUN if [ "$INSTALL_ALIGNMENT_DEPS" = "true" ]; then pip install --no-cache-dir -r /app/requirements-alignment.txt; fi

COPY . /app

EXPOSE 8000

CMD ["sh", "/app/scripts/start.sh"]
