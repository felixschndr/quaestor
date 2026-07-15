# FinTS

FinTS is a _standardized_ banking protocol that mostly German banks use (because they are legally
obligated to do so). Quaestor connects **directly** to your bank's FinTS server (your credentials
are only ever exchanged between your Quaestor server and the bank, no third party is involved).

Quaestor offers every bank listed in the upstream FinTS database, so all of them _should_ work.
However, not all banks implement the standard the same way. **Tested** are:

- ING-DiBa
- Deutsche Kreditbank Berlin (DKB)
- Sparkasse Karlsruhe
- Volksbank Mittelhessen

If a bank does not work, common reasons are:

- The bank uses a (yet) unsupported way to implement 2FA.
- The FinTS URL of the bank is not correct in the upstream database.
- The bank is not listed in the upstream database at all. For this case there is
  [bank_info_updater.py](../../source/backend/services/banking/bank_info_updater.py), which holds
  additional tested banks that are missing upstream.

If you encounter such a bank, please open an issue and we can work together to implement it.
