"""Web-side catalog client; embedded mode supports existing local development."""
import requests
from django.conf import settings
from catalog.omdb import IMDB_ID, MovieApiError


def remote(path, params=None):
    try:
        response = requests.get(settings.CATALOG_URL.rstrip('/') + path,
                                params=params, timeout=10, allow_redirects=False)
        data = response.json()
    except requests.Timeout:
        raise MovieApiError(504, 'Каталог не ответил вовремя. Повторите запрос.') from None
    except (requests.RequestException, ValueError):
        raise MovieApiError(502, 'Каталог временно недоступен. Попробуйте позже.') from None
    if not isinstance(data, dict):
        raise MovieApiError(502, 'Каталог вернул некорректный ответ.')
    if response.status_code != 200:
        status = response.status_code if response.status_code in (400, 404, 503, 504) else 502
        messages = {400: 'Уточните параметры поиска.', 404: 'Фильм не найден.',
                    503: 'Каталог не настроен или лимит OMDb исчерпан.',
                    504: 'Каталог не ответил вовремя.', 502: 'Каталог временно недоступен.'}
        raise MovieApiError(status, messages[status])
    if data.get('ok') is not True:
        raise MovieApiError(502, 'Каталог вернул некорректный ответ.')
    return data


def search(query, year, page):
    if not settings.CATALOG_URL:
        from catalog.omdb import search as embedded_search
        return embedded_search(query, year, page)
    data = remote('/api/movies', {'query': query, 'year': year, 'page': page})
    if not isinstance(data.get('movies'), list) or any(type(data.get(k)) is not int for k in ('totalResults', 'page', 'totalPages')):
        raise MovieApiError(502, 'Каталог вернул некорректный список.')
    return {k: data[k] for k in ('movies', 'totalResults', 'page', 'totalPages')}


def details(imdb_id):
    if not settings.CATALOG_URL:
        from catalog.omdb import details as embedded_details
        return embedded_details(imdb_id)
    data = remote('/api/movies/' + imdb_id)
    if not isinstance(data.get('movie'), dict) or data['movie'].get('id') != imdb_id:
        raise MovieApiError(502, 'Каталог вернул некорректную карточку.')
    return data['movie']
