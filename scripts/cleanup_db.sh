#!/opt/homebrew/bin/bash

source .env

rm bank_app.db
rm -rf source/backend/alembic/versions/*

poetry run alembic revision --autogenerate -m "Initial"
poetry run alembic upgrade head