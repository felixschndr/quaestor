# Finanzguru clone

This project aims to give the user an overview of his bank accounts with their balances and transactions (coming in the future).

> [!WARNING]  
> This project is still in early development and should not be used for production purposes.

## Security

I understand that any project with access to your bank accounts is, by nature, handling sensitive information.
Security measures in place:

 - Encryption at rest: The SQLite database is fully encrypted, meaning its contents cannot be read without the encryption key (no matter whether the software is currently running or not). This applies not only to your account credentials but to **all** data stored in the database. 
 - Secure communication with banks: All communication with banking servers is exclusively done via HTTP**S**. 
 - Secure access to the server: I strongly recommend accessing the server only via HTTP**S** as well. Set `SSL_CERTFILE` and `SSL_KEYFILE` to enable it (see `Environment`); without them the server runs plain HTTP. Alternatively use a reverse proxy. 
 - Read-only operations: The software only performs read requests; it **never** writes, updates, or deletes any resources on your accounts.
 - All the dependencies are pinned and automatically updated via Dependabot. All the updates for dependencies do have to be at least 3 days old to prevent supply chain attacks before being automatically merged.
 - There is no administration account/interface. A user can only access his/her own accounts/credentials/transactions. There is no possibility for an admin to access the data of another user (other than by accessing the database directly).

## Commands

- Run the application: `poetry run python -m source.backend.server`
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
| `LOG_LEVEL`                   | The level to log at. When set to `DEBUG` all the http request and response data is logged. The app tries (but not ensures) to redact all sensible data. Don't set the `LOG_LEVEL` to `DEBUG` in production. | `true`        |
| `SYNC_INTERVAL_HOURS`         | How often (in hours) the server automatically syncs all credentials that don't require 2FA. Accepts fractional values (e.g. `0.5`).                                                                         | `12`          |


## TODO
- Transaction Categorization
- Web Frontend
- Sparkasse Login
- DKB Login
- Handling for wrong banking credentials
- FIXMEs in code
- The trade republic session state COULD include the information about how long until a new 2FA is required (.traderepublic.com	TRUE	/	TRUE	1779099997	aws-waf-token)
- Make application async?