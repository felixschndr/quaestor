FROM node:26-alpine AS frontend-builder

RUN npm install -g pnpm

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
RUN python -m compileall -q /app/.venv/lib || true


FROM python:3.14-slim-trixie AS scalable-cli-builder

ARG TARGETARCH
ARG SC_VERSION=v1.0.0
ARG SC_SHA256_AMD64=f572bf49b853be35c56bc59b7ab2f4576be2ed524a1a3a0b0658ed69a54a6180
ARG SC_SHA256_ARM64=414761301b7f8c68df919484769d7086aa1477afbf2fd62e009ca792a796a0b8

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates

RUN set -eux; \
    case "${TARGETARCH}" in \
        amd64) SC_ARCH="linux-x86_64-gnu"; SC_SHA256="${SC_SHA256_AMD64}" ;; \
        arm64) SC_ARCH="linux-aarch64-gnu"; SC_SHA256="${SC_SHA256_ARM64}" ;; \
        *) echo "unsupported TARGETARCH ${TARGETARCH} for scalable-cli" >&2; exit 1 ;; \
    esac; \
    SC_DIR="sc-${SC_VERSION}-${SC_ARCH}"; \
    curl -fsSL "https://github.com/ScalableCapital/scalable-cli/releases/download/${SC_VERSION}/${SC_DIR}.tar.gz" \
        -o /tmp/scalable-cli.tar.gz; \
    echo "${SC_SHA256}  /tmp/scalable-cli.tar.gz" | sha256sum -c -; \
    mkdir -p /opt/scalable-cli; \
    tar -xzf /tmp/scalable-cli.tar.gz -C /opt/scalable-cli --strip-components=1 "${SC_DIR}/sc"; \
    chmod +x /opt/scalable-cli/sc; \
    /opt/scalable-cli/sc --version


FROM python:3.14-slim-trixie AS runtime

ENV PYTHONUNBUFFERED=1 \
    PATH=/app/.venv/bin:${PATH} \
    HOST=0.0.0.0 \
    PORT=8000 \
    USER_TO_USE=app \
    DATA_DIR=/data \
    SCALABLE_CLI_INSTALL_DIR=/opt/scalable-cli

RUN apt-get update && apt-get install -y --no-install-recommends sqlcipher \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1000 ${USER_TO_USE} \
    && useradd  --system --uid 1000 --gid ${USER_TO_USE} --home /app --shell /usr/bin/bash ${USER_TO_USE}

WORKDIR /app
RUN mkdir -p /data && chown ${USER_TO_USE}:${USER_TO_USE} /app /data

COPY --from=backend-builder /app/.venv /app/.venv

RUN playwright install-deps chromium \
    && rm -rf /var/lib/apt/lists/*

COPY --from=scalable-cli-builder --chown=${USER_TO_USE}:${USER_TO_USE} /opt/scalable-cli /opt/scalable-cli

COPY --chown=${USER_TO_USE}:${USER_TO_USE} pyproject.toml ./
COPY --chown=${USER_TO_USE}:${USER_TO_USE} source/backend ./source/backend
COPY --chown=${USER_TO_USE}:${USER_TO_USE} scripts/db/db_common.sh scripts/db/db.sh scripts/db/resetpw.sh scripts/db/get_uncategorized_transactions.sh ./scripts/db/
COPY --from=frontend-builder --chown=${USER_TO_USE}:${USER_TO_USE} /build/source/frontend/dist ./source/frontend/dist

RUN python -m compileall -q ./source/backend \
    && chown -R ${USER_TO_USE}:${USER_TO_USE} ./source/backend

USER ${USER_TO_USE}

EXPOSE 8000

CMD ["python", "-m", "source.backend.server"]
