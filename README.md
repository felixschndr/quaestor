# Quaestor

> "The Quaestor [...] is a senior executive, and is responsible for the finances [...]; the equivalent of treasurer, Finance Director." Source: [Wikipedia](https://en.wikipedia.org/wiki/Quaestor_(University_of_St_Andrews))

Quaestor consolidates the balances and transactions from all your banks into a single view → no more juggling a separate app per bank. Click any account to browse its transactions, grouped by date.

This app is heavily inspired by [Finanzguru](https://finanzguru.de/), with the key benefit that it is completely free, open source, and **private** since all the data stays on your own server.

The tool is strictly read-only: it only ever *reads* your data and can **never** make changes to your accounts or move money.

> [!NOTE]
> This project is still in early development and [might include major changes in the near future](#future-changes).

This app is primarily intended for German users. You can find the reason for this in the [supported banks](#supported-banks) section.

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

**Creation of Transaction in manual account**: Create a single or recurring transaction in your manual account

<img src="docs/screenshots/account_manual_transaction.png" width="400" alt="Creation of Transaction in manual account">

**Transaction**: The detail view of a transaction with a personal note

<img src="docs/screenshots/transaction.png" width="400" alt="Transaction detail">

**Search**: Search for transactions across all accounts with specific filters such as keywords, dates, categories, notes, etc.

<img src="docs/screenshots/transaction_search.png" width="400" alt="Search">

**Statistics**: View diagrams about your financial data, grouped by account, time, and category

<img src="docs/screenshots/statistics.png" width="400" alt="Statistics">

**Settings Overview**

<img src="docs/screenshots/settings.png" width="400" alt="Settings entry point">

**Bank connections**: The list of connected banks

<img src="docs/screenshots/settings_credentials.png" width="400" alt="Bank connections">

**Adding a bank connection**: Search for a bank and add it

<img src="docs/screenshots/settings_credentials_new.png" width="400" alt="Adding a bank connection">

**Bank connection details**: Settings for a single connection

<img src="docs/screenshots/settings_credentials_single.png" width="400" alt="Bank connection details">

**Account groups**: Drag accounts into custom groups to control how they are organized in the overview

<img src="docs/screenshots/settings_credentials_groups.png" width="400" alt="Account groups">

**User settings**

<img src="docs/screenshots/settings_user.png" width="400" alt="User settings">

**2FA support**: Create a token to enable 2FA for your account (and get backup codes in case you lose access to your device)

<img src="docs/screenshots/settings_user_2fa.png" width="400" alt="2FA settings">

</details>

## Features

- **Unified overview** of all your bank accounts and their balances in one place
- **Multiple connection types**: Connects to multiple banks to fetch your data, see the [supported banks](#supported-banks) section
- **Automatic background syncing** on a configurable interval, plus on-demand sync
- **Transactions grouped by date**, covering past, today, and future entries (some bank apps, such as ING, don't show future transactions)
- **Balance on any date**: see what an account's balance or the sum of multiple account balances were on a given day
- **Statistics**: View diagrams about your financial data, grouped by account, time, and category.
- **Search** for transactions across all accounts
- **Automatic and manual categorization** of transactions
- **Account balance at date**: see what an account's balance was on a given day
  - This includes your normal bank accounts with simple incoming and outgoing transactions,
  - But also banks such as Trade Republic. For e.g. Trade Republic in Questor you can see how much your holdings of an individual stock were worth on a given date.
  - This information is not even visible in their app as their api does not provide it. Questor fetches all relevant data and calculates the balance on the fly.
- **Custom notes** on transactions
- **Account groups**: drag accounts into your own groups to organize the overview
- **Multi-language** interface (English & German (add an issue for another requested language))
- **Session management**: review active logins and sign out individual sessions
- **Light & dark mode**
- **API keys**: Create personal API keys in your settings to interact with the backend programmatically with the same access as the frontend; keys are shown once, stored as hashed values, and can be revoked at any time. The docs are available on `<your instance url>/redoc` and on [GitHub](https://quaestordocs.fschneider.me/).

## Supported banks

The following connections are currently supported:

- Trade Republic
- _All_ FinTS banks
  - FinTS is a _standardized_ protocol for banking. It allows this app to fetch balances and transactions from any bank that supports it. It's a standard that mostly German banks use (because they are legally obligated to do so). However, not all banks implement it the same way.
  - Thus, **tested** are
    - ING-DiBa
    - Deutsche Kreditbank Berlin (DKB)
    - Sparkasse Karlsruhe
  - But the app gets a list of all banks that support FinTS and they _should_ work. If they don't, please open an issue.
    - This can have some common reasons:
      - The bank uses a (yet) unsupported way to implement 2FA.
      - The FinTS url of the bank is not correct in the upstream database.
      - The Bank is not listed in the upstream database.
    - If you encounter such a bank, please open an issue and we can work together to implement it.
- Manual accounts: These allow the user to set the balance and add transactions manually.
- Deutsche Flugsicherung GmbH retirement plan (http://www.dfs-vorsorgeplan.de / https://www.value-account.eu)
- fin4u retirement plan (https://www.alte-leipziger.de/service/rund-um-ihre-vertraege/kundenportal-fin4u)

You can browse the full list of every supported bank [here](https://quaestordocs.fschneider.me/banks.html).

### Why are some banks not supported?

This is a hobby project. Apps such as Finanzguru can support more banks because they use the `PSD2` standard, which exposes more data and supports more banks than FinTS does. However, it requires an expensive banking license (several thousand dollars) to use.

This is the reason why PayPal is not supported by this App. To fetch PayPal personal accounts, you need a PSD2 license. I could implement business accounts of PayPal, please open an issue if you need this.

## Security

I understand that any project with access to your bank accounts is, by nature, handling sensitive information.
Security measures in place:

 - Encryption at rest: The SQLite database is fully encrypted, meaning its contents cannot be read without the encryption key (no matter whether the software is currently running or not). This applies not only to your account credentials but to **all** data stored in the database.
 - Secure communication with banks: All communication with banking servers is exclusively done via HTTP**S**.
 - Secure access to the server: I strongly recommend accessing the server only via HTTP**S** as well. Set `SSL_CERTFILE` and `SSL_KEYFILE` to enable it (see `Environment`); without them the server runs plain HTTP. Alternatively use a reverse proxy.
 - Two-factor authentication: A user is able to enable two-factor authentication for their account.
 - Read-only operations: The software only performs read requests; it **never** writes, updates, or deletes any resources on your accounts.
 - All the dependencies are pinned and automatically updated via Dependabot: All the updates for dependencies do have to be at least 3 days old to prevent supply chain attacks before being automatically merged.
 - There is no administration account/interface: A user can only access his/her own accounts/credentials/transactions. There is no possibility for an admin to access the data of another user (other than by accessing the database directly).
 - CSRF protection: state-changing requests require a `csrf_token` cookie + matching `X-CSRF-Token` header.
 - Rate limiting: auth endpoints are throttled heavily per source IP. Set `FORWARDED_ALLOW_IPS` if behind a reverse proxy.
 - Hardened headers and cookies: `Content-Security-Policy`, `HttpOnly`, `SameSite=Lax`, CSRF: `SameSite=Strict`, `Secure` flag when (`SESSION_COOKIE_SECURE=true`).
 - The container image runs as an unprivileged user.

## Deployment

In all cases you have to create an encryption key for the database with `python -c 'import secrets; print(secrets.token_hex(32))'` and add it to your `.env` as `${DATABASE_ENCRYPTION_KEY}`.

If you are running this app behind a reverse proxy ensure to allow the usage of websockets (the application needs it).

### Container image

|                  | Existing image                                                                                                         | Build image yourself                                                                                                                                                                                                        |
|------------------|------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `docker run`     | `docker run -e DATABASE_ENCRYPTION_KEY=${DATABASE_ENCRYPTION_KEY} -v ./data/:/data ghcr.io/felixschndr/quaestor`       | `git clone git@github.com:felixschndr/quaestor.git && cd quaestor && docker build . -t quaestor && docker run -e DATABASE_ENCRYPTION_KEY=${DATABASE_ENCRYPTION_KEY} -e HOST=0.0.0.0 -v ./data/:/data -p 8080:8080 quaestor` |
| `docker compose` | `wget https://raw.githubusercontent.com/felixschndr/quaestor/refs/heads/main/docker-compose.yaml && docker compose up` | `git clone git@github.com:felixschndr/quaestor.git && cd quaestor && sed -i 's,image: ghcr.io/felixschndr/quaestor,build: .,' docker-compose.yaml && docker compose up`                                                     |

As this image does not run as `root` you **MUST** ensure that the user with the ID `1000` has permissions to write onto the location where you mount the `data` directory to on the host. As an alternative you can use a named volume instead. A commented out volume mount is already present in the `docker-compose.yaml`.

### Native

#### Requirements

- [Task](https://github.com/go-task/task)
- [Python 3.14](https://www.python.org/)
- [Poetry](https://python-poetry.org/)
- [pnpm](https://pnpm.io/)

#### Running

1. Clone the repository: `git clone git@github.com:felixschndr/quaestor.git`
2. Change to the directory: `cd quaestor`
3. Create a db key and add it to `.env`: `echo -n "DATABASE_ENCRYPTION_KEY=" >> .env && python -c 'import secrets; print(secrets.token_hex(32))' >> .env`
4. Install the requirements: `poetry install`
5. Run the application: `task run:prod`
6. Access the application on [127.0.0.1:8000](http://127.0.0.1:8000)


### Access the DB

If you need/want to access the database you can to so with

| Native                                                                                                           | Container                                                                    |
|------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------|
| `source .env && sqlcipher -cmd "PRAGMA key='${DATABASE_ENCRYPTION_KEY}'" <path to db> # e.g. ./data/Quaestor.db` | `sqlcipher -cmd "PRAGMA key='${DATABASE_ENCRYPTION_KEY}'" /data/Quaestor.db` |

Then you can use standard sqlite syntax such as
````
sqlite> .tables
sqlite> SELECT id, user_id, bank, username FROM credentials;
````

`sqlcipher` is installed in the container image.

## Environment Variables

| Name                          | Description                                                                                                                                                                                                 | Default value                                                   |
|-------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------|
| `HOST`                        | The host the server is listening on                                                                                                                                                                         | `127.0.0.1`                                                     |
| `PORT`                        | The port the server is listening on                                                                                                                                                                         | `8000`                                                          |
| `DATA_DIR`                    | Directory holding all persistent data                                                                                                                                                                       | `<REPO_ROOT>/data` or `/data` (when running inside a container) |
| `DATABASE_ENCRYPTION_KEY`     | The key to encrypt the database with. **Must** be provided.                                                                                                                                                 | -                                                               |
| `SSL_CERTFILE`                | The path to SSL certfile to use for HTTPS, only valid in combination with `SSL_KEYFILE`                                                                                                                     | -                                                               |
| `SSL_KEYFILE`                 | The path to SSL certfile to use for HTTPS, only valid in combination with `SSL_CERTFILE`                                                                                                                    | -                                                               |
| `ALLOW_NEW_USER_REGISTRATION` | Whether new users may register; set to anything other than `true` to disable                                                                                                                                | `true`                                                          |
| `DEFAULT_LANGUAGE`            | The language new users start with (e.g. `en`, `de`). Each user can change it later in their settings. Unsupported values fall back to `en`.                                                                 | `en`                                                            |
| `LOG_LEVEL`                   | The level to log at. When set to `DEBUG` all the http request and response data is logged. The app tries (but not ensures) to redact all sensible data. Don't set the `LOG_LEVEL` to `DEBUG` in production. | `INFO`                                                          |
| `SYNC_INTERVAL_HOURS`         | How often (in hours) the server automatically syncs all credentials that don't require 2FA. Accepts fractional values (e.g. `0.5`).                                                                         | `12`                                                            |
| `SESSION_COOKIE_SECURE`       | Whether to set the `Secure` flag on the session and CSRF cookies. Set to `true` whenever the app is reachable over HTTPS.                                                                                   | `false`                                                         |
| `FORWARDED_ALLOW_IPS`         | Comma-separated list of reverse-proxy IPs whose `X-Forwarded-For` / `X-Forwarded-Proto` headers the server trusts. Use `*` if the proxy IP is unpredictable (e.g. in container networks).                   | `127.0.0.1`                                                     |

## Future changes

Ideas I might want to implement in the future are tracked as [`enhancement` issues](https://github.com/felixschndr/quaestor/issues?q=is%3Aissue+state%3Aopen+label%3Aenhancement). If you think anything is missing, feel free to open an issue/PR.
