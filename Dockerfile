FROM node:22-alpine AS frontend-builder

RUN corepack enable

WORKDIR /build/source/frontend

COPY source/frontend/package.json source/frontend/pnpm-lock.yaml source/frontend/pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

COPY source/frontend/ ./
RUN pnpm build


# The release commit bumps `version` in pyproject.toml, which would invalidate the
# poetry-install layer even when no dependency changed.
FROM python:3.14-slim-trixie AS lockfiles

WORKDIR /app

COPY pyproject.toml poetry.lock ./
RUN sed -i 's/^version = ".*"/version = "0.0.0"/' pyproject.toml


FROM python:3.14-slim-trixie AS backend-builder

ENV POETRY_VIRTUALENVS_IN_PROJECT=true \
    POETRY_NO_INTERACTION=1

RUN pip install poetry

WORKDIR /app

COPY --from=lockfiles /app/ ./
RUN poetry install --no-root --without dev


FROM python:3.14-slim-trixie AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/app/.venv/bin:${PATH} \
    HOST=0.0.0.0 \
    PORT=8000 \
    USER_TO_USE=app \
    DATA_DIR=/data

RUN apt-get update && apt-get install -y --no-install-recommends sqlcipher \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1000 ${USER_TO_USE} \
    && useradd  --system --uid 1000 --gid ${USER_TO_USE} --home /app --shell /usr/bin/bash ${USER_TO_USE}

WORKDIR /app
RUN mkdir -p /data && chown ${USER_TO_USE}:${USER_TO_USE} /app /data

COPY --from=backend-builder /app/.venv /app/.venv

RUN playwright install-deps chromium \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=${USER_TO_USE}:${USER_TO_USE} pyproject.toml ./
COPY --chown=${USER_TO_USE}:${USER_TO_USE} source/backend ./source/backend
COPY --chown=${USER_TO_USE}:${USER_TO_USE} scripts/db/db_common.sh scripts/db/db.sh scripts/db/resetpw.sh scripts/db/get_uncategorized_transactions.sh ./scripts/db/
COPY --from=frontend-builder --chown=${USER_TO_USE}:${USER_TO_USE} /build/source/frontend/dist ./source/frontend/dist

USER ${USER_TO_USE}

EXPOSE 8000

CMD ["python", "-m", "source.backend.server"]
