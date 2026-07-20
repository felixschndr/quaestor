# FinTS vs Enable Banking

Some banks (mostly German ones) are offered through **both** [FinTS](fints.md) and [Enable Banking](enable_banking.md). When that happens, the bank shows up **twice** in the picker, each row carrying a badge naming its handler and you have to decide which
one to use.

## Advantages of FinTS

- **No third party:** Quaestor talks **directly** to your bank; your credentials are only ever exchanged between your Quaestor server and the bank. Nobody sits in between.
- **No account with an external service** needs to be registered.

## Advantages of Enable Banking

- **Far less 2FA:** You authorize the connection once and that authorization is usually valid for up to 180 days, so ongoing syncs need no repeated 2FA. FinTS, by contrast, may prompt for 2FA on every sync (depending on the bank).
- **More history:** Enable Banking can fetch transactions **further into the past** than FinTS typically exposes.

## Rule of thumb

- Value **privacy / directness** and don't mind the occasional 2FA prompt → **FinTS**.
- Value **convenience** (rare 2FA) and want **more transaction history** → **Enable Banking**.

Note that Enable Banking requires Quaestor to be served over **HTTPS** and a one-time free registration (see the [Enable Banking Docs](enable_banking.md) for the setup).
