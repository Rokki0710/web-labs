#!/bin/sh
set -eu
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm ci
npm run build
.venv/bin/python manage.py collectstatic --noinput
