#!/bin/sh
set -eu
if [ "${REPLIT_DEPLOYMENT:-}" = "1" ] && [ -z "${DATABASE_URL:-}" ]; then
  echo "Set DATABASE_URL for published Replit apps: deployment filesystems are not persistent." >&2
  exit 1
fi
.venv/bin/python manage.py migrate --noinput
exec .venv/bin/gunicorn config.wsgi:application --bind "0.0.0.0:${PORT:-3000}" --workers 1 --threads 4 --timeout 30 --access-logfile -
