## DB-Migrations

- Create DB migration
  - With message: `poetry run alembic revision --autogenerate`
  - Without message: `poetry run alembic revision --autogenerate -m "<message>"`
- Apply DB migration: `poetry run alembic upgrade head`
