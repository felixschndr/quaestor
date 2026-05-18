## Command

- Run the application: `poetry run uvicorn main:app --reload`
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

## TODO
- Logging with fields
- Web Frontend
- Sparkasse Login
- DKB Login
- Tests
- Make timestamps TZ aware?
- Make credentials auto-sync
- FIXMEs in code
- The trade republic session state COULD include the information about how long until a new 2FA is required (.traderepublic.com	TRUE	/	TRUE	1779099997	aws-waf-token)