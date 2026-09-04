FROM node:22-bookworm-slim AS assets
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run typecheck && npm run build

FROM python:3.11-slim-bookworm AS web
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home app
COPY config ./config
COPY portal ./portal
COPY catalog ./catalog
COPY templates ./templates
COPY public ./public
COPY manage.py ./
COPY --from=assets /build/dist ./dist
RUN DJANGO_DEBUG=true python manage.py collectstatic --noinput && mkdir -p /app/data && chown -R app:app /app/data
USER app
EXPOSE 8000
CMD ["sh", "-c", "python manage.py migrate --noinput && exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 1 --threads 4 --timeout 30"]
