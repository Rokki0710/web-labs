from unittest.mock import Mock, patch
import requests
from django.core.cache import caches
from django.test import TestCase, override_settings
from portal import omdb

MOVIE = {'Response': 'True', 'imdbID': 'tt0816692', 'Title': 'Interstellar', 'Year': '2014', 'Poster': 'https://m.media-amazon.com/poster.jpg'}


@override_settings(OMDB_API_KEY='fake-test-key')
class OmdbTests(TestCase):
    def setUp(self):
        caches['default'].clear()
        caches['omdb'].clear()

    def upstream(self, data, status=200):
        return patch('portal.omdb.requests.get', return_value=Mock(status_code=status, json=Mock(return_value=data)))

    def test_search_and_cache(self):
        with self.upstream({'Response': 'True', 'Search': [MOVIE], 'totalResults': '21'}) as fetch:
            for _ in range(2):
                response = self.client.get('/api/movies?query=Interstellar&year=2014&page=2')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['totalPages'], 3)
                self.assertEqual(response.json()['movies'][0]['id'], MOVIE['imdbID'])
            self.assertEqual(fetch.call_count, 1)
            self.assertEqual(fetch.call_args.kwargs['timeout'], 8)
            self.assertFalse(fetch.call_args.kwargs['allow_redirects'])
            self.assertEqual(fetch.call_args.kwargs['params']['y'], '2014')

    def test_details_and_untrusted_poster(self):
        for poster in ('javascript:alert(1)', 'https://evil.example/x', 'https://secret@m.media-amazon.com/x', 'N/A', None):
            with self.subTest(poster=poster), self.upstream({**MOVIE, 'Poster': poster, 'Plot': 'N/A'}):
                caches['omdb'].clear()
                response = self.client.get('/api/movies/tt0816692')
                self.assertEqual(response.status_code, 200)
                self.assertIsNone(response.json()['movie']['poster'])
                self.assertEqual(response.json()['movie']['plot'], 'Нет данных')

    def test_validation(self):
        for query in ('query=a', 'query=abc&year=1799', 'query=abc&page=0', 'query=abc&page=101', 'query=abc&page=1&page=2'):
            self.assertEqual(self.client.get('/api/movies?' + query).status_code, 400)
        self.assertEqual(self.client.get('/api/movies/bad-id').status_code, 400)

    def test_not_found(self):
        with self.upstream({'Response': 'False', 'Error': 'Movie not found!'}):
            self.assertEqual(self.client.get('/api/movies?query=missing').json()['movies'], [])
            self.assertEqual(self.client.get('/api/movies/tt99999999').status_code, 404)

    def test_upstream_http_errors(self):
        for upstream, expected in ((401,503), (403,503), (429,503), (500,502), (302,502)):
            with self.subTest(status=upstream), self.upstream({}, upstream):
                self.assertEqual(self.client.get('/api/movies?query=test').status_code, expected)

    def test_upstream_body_errors(self):
        for message, status in (('Too many results',400), ('Request limit reached',503), ('Invalid API key',503), ('other secret upstream error',502)):
            with self.subTest(message=message), self.upstream({'Response':'False','Error':message}):
                response = self.client.get('/api/movies?query=test')
                self.assertEqual(response.status_code, status)
                self.assertNotIn(message, response.content.decode())

    def test_malformed_response(self):
        for data in ([], {}, {'Response':'True'}, {'Response':'True','Search':[{}],'totalResults':'1'}):
            with self.subTest(data=data), self.upstream(data):
                caches['omdb'].clear()
                self.assertEqual(self.client.get('/api/movies?query=test').status_code, 502)

    def test_network_errors(self):
        for error, status in ((requests.Timeout('secret-url'),504), (requests.ConnectionError('secret-url'),502), (ValueError('secret-url'),502)):
            with self.subTest(status=status), patch('portal.omdb.requests.get', side_effect=error):
                response = self.client.get('/api/movies?query=test')
                self.assertEqual(response.status_code, status)
                self.assertNotIn('secret-url', response.content.decode())

    @override_settings(OMDB_API_KEY='')
    def test_missing_key(self):
        self.assertEqual(self.client.get('/api/movies?query=test').status_code, 503)

    def test_rate_limit(self):
        for _ in range(30):
            self.client.get('/api/movies?query=a')
        self.assertEqual(self.client.get('/api/movies?query=a').status_code, 429)
