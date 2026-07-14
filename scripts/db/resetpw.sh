#!/usr/bin/env bash

# Reset a user's password and disable their two-factor authentication.
#
# Usage:
#   Native:    USERNAME=felix PW=secret ./scripts/db/resetpw.sh
#   Container: docker exec -e USERNAME=felix -e PW=secret quaestor scripts/db/resetpw.sh
#
# Optional environment variables: see scripts/db/db_common.sh

set -euo pipefail

USERNAME="${USERNAME:?Set USERNAME to the user whose password should be reset}"
PW="${PW:?Set PW to the new password}"

source "$(dirname "${BASH_SOURCE[0]}")/db_common.sh"

# Native development uses the in-project poetry virtualenv ("poetry run" mangles -c arguments),
# the container image has the venv python on its PATH.
if [[ -x .venv/bin/python ]]; then
    python=.venv/bin/python
else
    python=python
fi

password_hash=$(PW="${PW}" "${python}" -c "import os; from argon2 import PasswordHasher; print(PasswordHasher().hash(os.environ['PW']))")

run_sql() {
    sqlcipher -batch -noheader -cmd "PRAGMA key='${DATABASE_ENCRYPTION_KEY}'" "${DB_PATH}" "${1}"
}

username_sql="${USERNAME//\'/\'\'}"

# PRAGMA key prints "ok" on newer sqlcipher versions, so extract the plain numeric id.
user_id=$(run_sql "SELECT id FROM users WHERE user_name = '${username_sql}';" | grep -Ex '[0-9]+' | head -n 1 || true)
if [[ -z "${user_id}" ]]; then
    echo "No user named '${USERNAME}' in ${DB_PATH}" >&2
    exit 1
fi

run_sql "
UPDATE users
   SET password_hash      = '${password_hash}',
       two_factor_enabled = 0,
       two_factor_secret  = NULL
 WHERE id = ${user_id};
DELETE FROM backup_codes          WHERE user_id = ${user_id};
DELETE FROM two_factor_challenges WHERE user_id = ${user_id};
" >/dev/null

echo "Password of user '${USERNAME}' (id ${user_id}) has been reset and two-factor authentication has been disabled."
