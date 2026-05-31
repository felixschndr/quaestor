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
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

RUN apt-get update && apt-get install -y --no-install-recommends sqlcipher \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1000 ${USER_TO_USE} \
    && useradd  --system --uid 1000 --gid ${USER_TO_USE} --home /app --shell /usr/bin/bash ${USER_TO_USE}

WORKDIR /app
RUN chown ${USER_TO_USE}:${USER_TO_USE} /app

COPY --from=backend-builder /app/.venv /app/.venv
COPY --chown=${USER_TO_USE}:${USER_TO_USE} alembic.ini ./
COPY --chown=${USER_TO_USE}:${USER_TO_USE} pyproject.toml ./
COPY --chown=${USER_TO_USE}:${USER_TO_USE} source/backend ./source/backend
COPY --from=frontend-builder --chown=${USER_TO_USE}:${USER_TO_USE} /build/source/frontend/dist ./source/frontend/dist

RUN mkdir -p /data && chown ${USER_TO_USE}:${USER_TO_USE} /data

# We install everything that playwright needs and bake it into the image
# We could think about only loading it if we need it in the future
RUN playwright install --with-deps chromium \
    && chmod -R a+rX ${PLAYWRIGHT_BROWSERS_PATH} \
    && rm -rf /var/lib/apt/lists/*

USER ${USER_TO_USE}

EXPOSE 8000

CMD ["python", "-m", "source.backend.server"]
