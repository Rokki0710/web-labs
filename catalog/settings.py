import os

SECRET_KEY = 'catalog-has-no-sessions-or-signed-data'
DEBUG = False
ALLOWED_HOSTS = ['catalog', 'localhost', '127.0.0.1', 'testserver']
ROOT_URLCONF = 'catalog.urls'
INSTALLED_APPS = []
MIDDLEWARE = []
DATABASES = {}
USE_TZ = True
DEFAULT_CHARSET = 'utf-8'
OMDB_API_KEY = os.getenv('OMDB_API_KEY', '')
CACHES = {'omdb': {
    'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
    'LOCATION': 'catalog', 'OPTIONS': {'MAX_ENTRIES': 100},
}}
