FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY catalog/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home app
COPY catalog ./catalog
USER app
EXPOSE 8001
CMD ["gunicorn", "catalog.wsgi:application", "--bind", "0.0.0.0:8001", "--workers", "1", "--threads", "4", "--timeout", "30"]
