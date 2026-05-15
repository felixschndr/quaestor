#!/opt/homebrew/bin/bash

readonly URL=http://localhost:8000/

source .env

rm bank_app.db
rm -rf alembic/versions/*

poetry run alembic revision --autogenerate -m "Initial"
poetry run alembic upgrade head
poetry run uvicorn source.main:app --reload &
command_pid=$!
echo "Command PID: ${command_pid}"
sleep 1
echo -e "\n\n"

curl ${URL}users

curl ${URL}credentials/list_all_possible | jq

curl -X POST ${URL}users -H "Content-Type: application/json" -d '{"name": "Felix"}'

echo -e "\n\nKilling process"
kill $command_pid
sleep 1
echo