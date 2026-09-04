import os
from pathlib import Path
import dj_database_url

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')
DEBUG = os.getenv('DJANGO_DEBUG', 'true').lower() == 'true'
SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', '')
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured('Set DJANGO_SECRET_KEY for production.')
    SECRET_KEY = 'django-insecure-local-development-only-moviehub-lab-four'
ALLOWED_HOSTS = [v.strip() for v in os.getenv('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1,[::1]').split(',') if v.strip()]
CSRF_TRUSTED_ORIGINS = [v.strip() for v in os.getenv('DJANGO_CSRF_TRUSTED_ORIGINS', '').split(',') if v.strip()]
# Replit supplies exact preview domains; do not allow arbitrary Host headers.
for domain in (os.getenv('REPLIT_DEV_DOMAIN', '') + ',' + os.getenv('REPLIT_DOMAINS', '')).split(','):
    if domain.strip():
        ALLOWED_HOSTS.append(domain.strip())
        CSRF_TRUSTED_ORIGINS.append('https://' + domain.strip())

INSTALLED_APPS = ['django.contrib.contenttypes', 'django.contrib.staticfiles', 'portal']
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'portal.middleware.ApiMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]
ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'
TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [BASE_DIR / 'templates'], 'APP_DIRS': True,
    'OPTIONS': {'context_processors': ['django.template.context_processors.request']},
}]
DATABASE_PATH = Path(os.getenv('MOVIEHUB_DB_PATH', str(BASE_DIR / 'data/moviehub.db')))
DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': DATABASE_PATH, 'OPTIONS': {'timeout': 20}}}
if os.getenv('DATABASE_URL'):
    DATABASES['default'] = dj_database_url.parse(os.environ['DATABASE_URL'], conn_max_age=60, conn_health_checks=True)
DEFAULT_AUTO_FIELD = 'django.db.models.AutoField'
LANGUAGE_CODE = 'ru-ru'
TIME_ZONE = 'UTC'
USE_TZ = True
APPEND_SLASH = False
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'dist', BASE_DIR / 'public']
WHITENOISE_USE_FINDERS = DEBUG
WHITENOISE_AUTOREFRESH = DEBUG
STORAGES = {'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedStaticFilesStorage'}}
CACHES = {
    'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache', 'LOCATION': 'limits', 'OPTIONS': {'MAX_ENTRIES': 10000}},
    'omdb': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache', 'LOCATION': 'omdb', 'OPTIONS': {'MAX_ENTRIES': 100}},
}
OMDB_API_KEY = os.getenv('OMDB_API_KEY', '')
DATA_UPLOAD_MAX_MEMORY_SIZE = 16 * 1024
CSRF_FAILURE_VIEW = 'portal.views.csrf_failure'
CSRF_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_SECURE = not DEBUG
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
SECURE_SSL_REDIRECT = not DEBUG
SECURE_HSTS_SECONDS = 31536000 if not DEBUG else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = not DEBUG
# Enable only behind a trusted proxy that overwrites X-Forwarded-Proto (Replit).
if os.getenv('DJANGO_TRUST_PROXY', 'false').lower() == 'true':
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
