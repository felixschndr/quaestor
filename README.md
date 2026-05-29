# Quaestor

Your self-hosted, read-only treasurer: a personal finance overview across all your bank accounts.

Quaestor consolidates the balances and transactions from all your banks into a single view → no more juggling a separate app per bank. Click any account to browse its transactions, grouped by date.

The tool is strictly read-only: it only ever *reads* your data and can **never** make changes to your accounts or move money.

> [!NOTE]
> This project is still in early development and might include major changes in the near future.

## Screenshots

<details>
<summary>Click to expand</summary>

**Overview**: Dark mode

<img src="docs/screenshots/overview_dark.png" width="400" alt="Overview (dark mode)">

**Overview**: Light mode

<img src="docs/screenshots/overview_light.png" width="400" alt="Overview (light mode)">

**Account**: A single account showing its current balance and its transactions grouped by date

<img src="docs/screenshots/account.png" width="400" alt="Account">

**Manual account**: A manually managed account where you can add and edit transactions yourself

<img src="docs/screenshots/account_manual.png" width="400" alt="Manual account">

**Transaction**: The detail view of a transaction with a personal note

<img src="docs/screenshots/transaction.png" width="400" alt="Transaction detail">

**Settings**

<img src="docs/screenshots/settings.png" width="400" alt="Settings entry point">

**Bank connections**: The list of connected banks

<img src="docs/screenshots/settings_credentials.png" width="400" alt="Bank connections">

**Bank connection details**: Settings for a single connection

<img src="docs/screenshots/settings_credentials_single.png" width="400" alt="Bank connection details">

**Account groups**: Drag accounts into custom groups to control how they are organized in the overview

<img src="docs/screenshots/settings_credentials_groups.png" width="400" alt="Account groups">

**User settings**

<img src="docs/screenshots/settings_user.png" width="400" alt="User settings">

**Sessions**: Active login sessions with options to log out individual sessions

<img src="docs/screenshots/settings_sessions.png" width="400" alt="Sessions">

</details>

## Features

- **Unified overview** of all your bank accounts and their balances in one place
- **Multiple connection types**: Trade Republic, FinTS (Sparkasse, DKB, ING and more) and manual accounts for cash or assets you track yourself
- **Automatic background syncing** on a configurable interval, plus on-demand sync
- **Transactions grouped by date**, covering past, today, and scheduled entries
- **Balance on any date**: see what an account's balance was on a given day
- **Search** for transactions across all accounts
- **Automatic and manual categorization** of transactions
- **Custom notes** on transactions
- **Account groups**: drag accounts into your own groups to organize the overview
- **Multi-language** interface (English & German (add an issue for another requested language))
- **Session management**: review active logins and sign out individual sessions
- **Light & dark mode**


## Security

I understand that any project with access to your bank accounts is, by nature, handling sensitive information.
Security measures in place:

 - Encryption at rest: The SQLite database is fully encrypted, meaning its contents cannot be read without the encryption key (no matter whether the software is currently running or not). This applies not only to your account credentials but to **all** data stored in the database.
 - Secure communication with banks: All communication with banking servers is exclusively done via HTTP**S**.
 - Secure access to the server: I strongly recommend accessing the server only via HTTP**S** as well. Set `SSL_CERTFILE` and `SSL_KEYFILE` to enable it (see `Environment`); without them the server runs plain HTTP. Alternatively use a reverse proxy.
 - Read-only operations: The software only performs read requests; it **never** writes, updates, or deletes any resources on your accounts.
 - All the dependencies are pinned and automatically updated via Dependabot: All the updates for dependencies do have to be at least 3 days old to prevent supply chain attacks before being automatically merged.
 - There is no administration account/interface: A user can only access his/her own accounts/credentials/transactions. There is no possibility for an admin to access the data of another user (other than by accessing the database directly).
 - CSRF protection: state-changing requests require a `csrf_token` cookie + matching `X-CSRF-Token` header.
 - Rate limiting: auth endpoints are throttled heavily per source IP. Set `FORWARDED_ALLOW_IPS` if behind a reverse proxy.
 - Hardened headers and cookies: `Content-Security-Policy`, `HttpOnly`, `SameSite=Lax`, CSRF: `SameSite=Strict`, `Secure` flag when (`SESSION_COOKIE_SECURE=true`).

## Commands

- Generate a DB Encryption secret: `python -c 'import secrets; print(secrets.token_hex(32))'`
- Run the application
  - Native: `poetry run python -m source.backend.server`
  - Docker: `docker build . -t app && docker run -e DATABASE_ENCRYPTION_KEY=${DATABASE_ENCRYPTION_KEY} -it app`
- DB
  - CLI-Access:
    ````shell
    source .env
    sqlcipher -cmd "PRAGMA key='$DATABASE_ENCRYPTION_KEY'" bank_app.db
    sqlite> .tables
    sqlite> SELECT id, user_id, bank, username FROM credentials;
    ````
  - Migrations:
    - Create DB migration
      - With message: `poetry run alembic revision --autogenerate`
      - Without message: `poetry run alembic revision --autogenerate -m "<message>"`
    - Apply DB migration: `poetry run alembic upgrade head`

## Environment Variables

| Name                          | Description                                                                                                                                                                                                 | Default value |
|-------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------|
| `HOST`                        | The host the server is listening on                                                                                                                                                                         | `127.0.0.1`   |
| `PORT`                        | The port the server is listening on                                                                                                                                                                         | `8000`        |
| `SSL_CERTFILE`                | The path to SSL certfile to use for HTTPS, only valid in combination with `SSL_KEYFILE`                                                                                                                     | None          |
| `SSL_KEYFILE`                 | The path to SSL certfile to use for HTTPS, only valid in combination with `SSL_CERTFILE`                                                                                                                    | None          |
| `ALLOW_NEW_USER_REGISTRATION` | Whether new users may register; set to anything other than `true` to disable                                                                                                                                | `true`        |
| `LOG_LEVEL`                   | The level to log at. When set to `DEBUG` all the http request and response data is logged. The app tries (but not ensures) to redact all sensible data. Don't set the `LOG_LEVEL` to `DEBUG` in production. | `INFO`        |
| `SYNC_INTERVAL_HOURS`         | How often (in hours) the server automatically syncs all credentials that don't require 2FA. Accepts fractional values (e.g. `0.5`).                                                                         | `12`          |
| `SESSION_COOKIE_SECURE`       | Whether to set the `Secure` flag on the session and CSRF cookies. Set to `true` whenever the app is reachable over HTTPS.                                                                                   | `false`       |
| `FORWARDED_ALLOW_IPS`         | Comma-separated list of reverse-proxy IPs whose `X-Forwarded-For` / `X-Forwarded-Proto` headers the server trusts. Use `*` if the proxy IP is unpredictable (e.g. in container networks).                   | `127.0.0.1`   |


## TODO
- ING VL
- Handling for wrong banking credentials
- The trade republic session state COULD include the information about how long until a new 2FA is required (.traderepublic.com	TRUE	/	TRUE	1779099997	aws-waf-token)
- Detect transfer transactions
