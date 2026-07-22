#!/usr/bin/env bash

# List all transactions that could not be assigned a category.
#
# Usage:
#   Native:    ./scripts/db/get_uncategorized_transactions.sh [--detailed]
#   Container: docker exec -it quaestor scripts/db/get_uncategorized_transactions.sh [--detailed]
#
# --detailed also shows ids, date and account.
#
# Optional environment variables: see scripts/db/db_common.sh

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/db_common.sh"

COLUMNS="transactions.amount, transactions.transaction_type, transactions.other_party, transactions.purpose"
if [[ "${1:-}" == "--detailed" ]]; then
    COLUMNS="transactions.id, transactions.date, ${COLUMNS}, accounts.display_name AS account, accounts.id AS account_id"
fi

# .output /dev/null swallows the "ok" that PRAGMA key prints on newer sqlcipher versions
exec sqlcipher -batch \
    -cmd ".output /dev/null" \
    -cmd "PRAGMA key='${DATABASE_ENCRYPTION_KEY}'" \
    -cmd ".output stdout" \
    -cmd ".mode box" \
    "${DB_PATH}" "
SELECT ${COLUMNS}
  FROM transactions
  JOIN accounts ON accounts.id = transactions.account_id
 WHERE transactions.category = 'UNKNOWN'
 ORDER BY transactions.date DESC;
"
