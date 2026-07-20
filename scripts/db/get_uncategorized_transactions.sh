#!/usr/bin/env bash

# List all transactions that could not be assigned a category.
#
# Usage:
#   Native:    ./scripts/db/get_uncategorized_transactions.sh
#   Container: docker exec -it quaestor scripts/db/get_uncategorized_transactions.sh
#
# Optional environment variables: see scripts/db/db_common.sh

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/db_common.sh"

# .output /dev/null swallows the "ok" that PRAGMA key prints on newer sqlcipher versions
exec sqlcipher -batch \
    -cmd ".output /dev/null" \
    -cmd "PRAGMA key='${DATABASE_ENCRYPTION_KEY}'" \
    -cmd ".output stdout" \
    -cmd ".mode box" \
    "${DB_PATH}" "
SELECT transactions.id,
       transactions.date,
       transactions.amount,
       transactions.other_party,
       transactions.purpose,
       accounts.display_name AS account,
       accounts.id AS account_id
  FROM transactions
  JOIN accounts ON accounts.id = transactions.account_id
 WHERE transactions.category = 'UNKNOWN'
 ORDER BY transactions.date DESC;
"
