from unittest.mock import Mock, patch
import requests
from django.core.cache import caches
from django.test import SimpleTestCase, override_settings
from portal import omdb
from portal.tests.test_omdb import MOVIE


@override_settings(CATALOG_URL='http://catalog:8001')
class CatalogClientTests(SimpleTestCase):
    def test_remote_search(self):
        payload = {'ok': True, 'movies': [], 'page': 1, 'totalResults': 0, 'totalPages': 0}
        with patch('portal.omdb.requests.get', return_value=Mock(status_code=200, json=lambda: payload)) as fetch:
            self.assertEqual(omdb.search('test', '', 1)['movies'], [])
            self.assertEqual(fetch.call_args.args[0], 'http://catalog:8001/api/movies')
            self.assertNotIn('apikey', fetch.call_args.kwargs['params'])
            self.assertEqual(fetch.call_args.kwargs['timeout'], 10)
            self.assertFalse(fetch.call_args.kwargs['allow_redirects'])

    def test_details(self):
        with patch('portal.omdb.requests.get', return_value=Mock(status_code=200, json=lambda: {'ok': True, 'movie': {'id': 'tt0816692'}})):
            self.assertEqual(omdb.details('tt0816692')['id'], 'tt0816692')

    def test_service_failure_safe(self):
        for failure, status in ((requests.Timeout('secret'), 504), (requests.ConnectionError('secret'), 502), (ValueError('secret'), 502)):
            with patch('portal.omdb.requests.get', side_effect=failure), self.assertRaises(omdb.MovieApiError) as caught:
                omdb.search('test', '', 1)
            self.assertEqual(caught.exception.status, status)
            self.assertNotIn('secret', str(caught.exception))

    def test_bad_status_and_payload(self):
        for code, payload in ((302, {}), (500, {'message': 'secret'}), (200, []), (200, {'ok': True}), (200, {'ok': False})):
            with patch('portal.omdb.requests.get', return_value=Mock(status_code=code, json=lambda: payload)), self.assertRaises(omdb.MovieApiError) as caught:
                omdb.search('test', '', 1)
            self.assertEqual(caught.exception.status, 502)
            self.assertNotIn('secret', str(caught.exception))


@override_settings(ROOT_URLCONF='catalog.urls', OMDB_API_KEY='fake-test-key')
class CatalogServiceTests(SimpleTestCase):
    def setUp(self):
        caches['omdb'].clear()
        caches['default'].clear()

    def test_health_does_not_call_upstream(self):
        with patch('catalog.omdb.requests.get') as fetch:
            self.assertEqual(self.client.get('/api/health').json()['service'], 'catalog')
            fetch.assert_not_called()

    def test_search_details_and_cache(self):
        with patch('catalog.omdb.requests.get', return_value=Mock(status_code=200, json=lambda: {'Response': 'True', 'Search': [MOVIE], 'totalResults': '1'})) as fetch:
            for _ in range(2):
                self.assertEqual(self.client.get('/api/movies?query=Interstellar').json()['movies'][0]['id'], 'tt0816692')
            self.assertEqual(fetch.call_count, 1)
        with patch('catalog.omdb.requests.get', return_value=Mock(status_code=200, json=lambda: MOVIE)):
            self.assertEqual(self.client.get('/api/movies/tt0816692').json()['movie']['title'], 'Interstellar')

    def test_isolated_routes_and_validation(self):
        self.assertEqual(self.client.get('/api/auth/me').status_code, 404)
        self.assertEqual(self.client.get('/api/movies/tt0816692/comments').status_code, 404)
        for query in ('query=a', 'query=test&page=0', 'query=test&page=101', 'query=test&year=1799', 'query=test&page=1&page=2'):
            self.assertEqual(self.client.get('/api/movies?' + query).status_code, 400)
        self.assertEqual(self.client.post('/api/movies').status_code, 405)
