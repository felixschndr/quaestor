#!/bin/bash

# Resolves the database path and encryption key.
#
# Optional environment variables:
#   DB_PATH  - path to the database (default: ${DATA_DIR}/Quaestor.db if DATA_DIR is set, else ./data/Quaestor.db)
#   ENV_FILE - file to read DATABASE_ENCRYPTION_KEY from if it is not already set (default: .env)

if [[ -z "${DB_PATH:-}" ]]; then
    if [[ -n "${DATA_DIR:-}" ]]; then
        DB_PATH="${DATA_DIR}/Quaestor.db"
    else
        DB_PATH="./data/Quaestor.db"
    fi
fi

ENV_FILE="${ENV_FILE:-.env}"
if [[ -z "${DATABASE_ENCRYPTION_KEY:-}" ]]; then
    if [[ ! -f "${ENV_FILE}" ]]; then
        echo "DATABASE_ENCRYPTION_KEY is not set and ${ENV_FILE} does not exist" >&2
        exit 1
    fi
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
fi
DATABASE_ENCRYPTION_KEY="${DATABASE_ENCRYPTION_KEY:?DATABASE_ENCRYPTION_KEY is not set and could not be read from ${ENV_FILE}}"

if [[ ! -f "${DB_PATH}" ]]; then
    echo "Database not found at ${DB_PATH}" >&2
    exit 1
fi
