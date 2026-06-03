FROM node:22-alpine AS frontend-builder

RUN corepack enable

WORKDIR /build/source/frontend

COPY source/frontend/package.json source/frontend/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

COPY source/frontend/ ./
RUN pnpm build


FROM python:3.14-slim-trixie AS backend-builder

ENV POETRY_VERSION=1.8.4 \
    POETRY_VIRTUALENVS_IN_PROJECT=true \
    POETRY_NO_INTERACTION=1

RUN pip install "poetry==${POETRY_VERSION}"

WORKDIR /app

COPY pyproject.toml poetry.lock ./
RUN poetry install --no-root --without dev


FROM python:3.14-slim-trixie AS runtime

LABEL org.opencontainers.image.source="https://github.com/felixschndr/quaestor"
LABEL org.opencontainers.image.description="Your self-hosted, read-only treasurer: a personal finance overview across all your bank accounts (https://github.com/felixschndr/quaestor)"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/app/.venv/bin:${PATH} \
    HOST=0.0.0.0 \
    PORT=8000 \
    USER_TO_USE=app \
    DATABASE_PATH=/data/Quaestor.db \
    PLAYWRIGHT_BROWSERS_PATH=/data/playwright

RUN apt-get update && apt-get install -y --no-install-recommends sqlcipher \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1000 ${USER_TO_USE} \
    && useradd  --system --uid 1000 --gid ${USER_TO_USE} --home /app --shell /usr/bin/bash ${USER_TO_USE}

WORKDIR /app
RUN chown ${USER_TO_USE}:${USER_TO_USE} /app

RUN mkdir -p /data && chown ${USER_TO_USE}:${USER_TO_USE} /data

COPY --from=backend-builder /app/.venv /app/.venv

# Install only the system libraries Chromium needs (fonts, codecs, ...). The browser binary itself is
# NOT baked into the image: it is downloaded on first start into PLAYWRIGHT_BROWSERS_PATH (=/data/playwright),
# which lives in the mounted data volume, so it survives container restarts and recreations. See
# source/backend/services/playwright_browser.py. On a Playwright version bump just rebuild the image
# (refreshes these deps) — the matching browser revision is then fetched automatically on the next start.
RUN playwright install-deps chromium \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=${USER_TO_USE}:${USER_TO_USE} alembic.ini ./
COPY --chown=${USER_TO_USE}:${USER_TO_USE} pyproject.toml ./
COPY --chown=${USER_TO_USE}:${USER_TO_USE} source/backend ./source/backend
COPY --from=frontend-builder --chown=${USER_TO_USE}:${USER_TO_USE} /build/source/frontend/dist ./source/frontend/dist

USER ${USER_TO_USE}

EXPOSE 8000

CMD ["python", "-m", "source.backend.server"]
