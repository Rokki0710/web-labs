"""OMDb adapter. Never expose upstream errors/URLs containing the API key."""
import hashlib
import json
import math
import re
from urllib.parse import urlsplit

import requests
from django.conf import settings
from django.core.cache import caches

IMDB_ID = re.compile(r'tt[0-9]{7,10}')


class MovieApiError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def text(value):
    return value if isinstance(value, str) and value != 'N/A' else 'Нет данных'


def summary(value):
    if not isinstance(value, dict) or not isinstance(value.get('imdbID'), str) or not IMDB_ID.fullmatch(value['imdbID']) or not isinstance(value.get('Title'), str):
        raise MovieApiError(502, 'OMDb вернул некорректную карточку фильма.')
    poster = None
    try:
        url = urlsplit(value.get('Poster', ''))
        if url.scheme == 'https' and url.hostname in ('m.media-amazon.com', 'ia.media-imdb.com') and not url.username and not url.password:
            poster = value['Poster']
    except (ValueError, TypeError, AttributeError):
        pass
    return {'id': value['imdbID'], 'title': value['Title'], 'year': text(value.get('Year')), 'poster': poster}


def request(params):
    if not settings.OMDB_API_KEY.strip():
        raise MovieApiError(503, 'Поиск не настроен: добавьте OMDB_API_KEY и перезапустите сервер.')
    cache_key = hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()
    cached = caches['omdb'].get(cache_key)
    if cached is not None:
        return cached
    try:
        response = requests.get('https://www.omdbapi.com/', params={**params, 'apikey': settings.OMDB_API_KEY, 'r': 'json'}, timeout=8, allow_redirects=False)
        if response.status_code in (401, 403):
            raise MovieApiError(503, 'Ключ OMDb недействителен или ещё не активирован.')
        if response.status_code == 429:
            raise MovieApiError(503, 'Лимит OMDb исчерпан. Повторите запрос позже.')
        if response.status_code != 200:
            raise MovieApiError(502, 'OMDb временно недоступен. Попробуйте позже.')
        data = response.json()
    except requests.Timeout:
        raise MovieApiError(504, 'OMDb не ответил вовремя. Повторите запрос.') from None
    except (requests.RequestException, ValueError):
        raise MovieApiError(502, 'Не удалось связаться с OMDb. Повторите запрос позже.') from None
    if not isinstance(data, dict):
        raise MovieApiError(502, 'OMDb вернул некорректный ответ.')
    if data.get('Response') == 'False':
        message = str(data.get('Error', ''))
        for pattern, status, safe in [
            ('not found|incorrect imdb', 404, 'Фильм не найден.'),
            ('too many results', 400, 'Слишком много результатов. Уточните название или год.'),
            ('limit', 503, 'Дневной лимит OMDb исчерпан. Попробуйте завтра.'),
            ('key|activat', 503, 'Ключ OMDb недействителен или ещё не активирован.'),
        ]:
            if re.search(pattern, message, re.I):
                raise MovieApiError(status, safe)
        raise MovieApiError(502, 'OMDb не смог выполнить запрос.')
    if data.get('Response') != 'True':
        raise MovieApiError(502, 'OMDb вернул некорректный ответ.')
    caches['omdb'].set(cache_key, data, 600)
    return data


def search(query, year, page):
    try:
        data = request({'s': query, 'type': 'movie', 'page': str(page), **({'y': year} if year else {})})
    except MovieApiError as error:
        if error.status == 404:
            return {'movies': [], 'totalResults': 0, 'page': page, 'totalPages': 0}
        raise
    if not isinstance(data.get('Search'), list) or not re.fullmatch(r'[0-9]+', str(data.get('totalResults', ''))):
        raise MovieApiError(502, 'OMDb вернул некорректный список фильмов.')
    total = int(data['totalResults'])
    return {'movies': [summary(v) for v in data['Search']], 'totalResults': total, 'page': page, 'totalPages': min(100, math.ceil(total / 10))}


def details(imdb_id):
    data = request({'i': imdb_id, 'plot': 'full', 'type': 'movie'})
    return {**summary(data), **{dest: text(data.get(source)) for dest, source in {
        'plot': 'Plot', 'genre': 'Genre', 'director': 'Director', 'actors': 'Actors',
        'runtime': 'Runtime', 'rating': 'imdbRating', 'country': 'Country',
    }.items()}}
