#!/usr/bin/env bash

# Open a sqlcipher shell on the (encrypted) database
#
# Usage:
#   Native:    ./scripts/db.sh [SQL]
#   Container: docker exec -it quaestor scripts/db.sh [SQL]
#
# Examples:
#   ./scripts/db.sh
#   ./scripts/db.sh "SELECT id, user_name FROM users;"
#
# Optional environment variables: see scripts/db_common.sh

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/db_common.sh"

exec sqlcipher -cmd "PRAGMA key='${DATABASE_ENCRYPTION_KEY}'" "${DB_PATH}" "$@"
