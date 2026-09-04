import hashlib
import time
import bcrypt
from django.core.cache import cache
from django.test import Client, TestCase
from portal.models import Account, LoginSession

VALID = {'firstName': 'Анна', 'lastName': 'Иванова', 'email': 'lab4@example.test', 'phone': '+7 (999) 123-45-67', 'age': 20, 'favoriteMovie': '', 'password': 'Moviehub123', 'confirmPassword': 'Moviehub123', 'terms': True}


class AuthTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client(enforce_csrf_checks=True)

    def post(self, path, body):
        token = self.client.get('/api/auth/csrf').json()['csrfToken']
        return self.client.post(path, body, content_type='application/json', HTTP_X_CSRFTOKEN=token)

    def test_full_flow(self):
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)
        registered = self.post('/api/auth/register', VALID)
        self.assertEqual(registered.status_code, 201)
        self.assertNotIn('password', str(registered.json()))
        self.assertNotEqual(Account.objects.get().password_hash, VALID['password'])
        cookie = registered.cookies['moviehub_session']
        self.assertTrue(cookie['httponly'])
        self.assertEqual(cookie['samesite'], 'Lax')
        self.assertEqual(int(cookie['max-age']), 604800)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 200)
        self.assertEqual(self.post('/api/auth/logout', {}).status_code, 200)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)
        login = self.post('/api/auth/login', {'email': VALID['email'].upper(), 'password': VALID['password']})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.cookies['moviehub_session']['max-age'], '')
        previous = self.client.cookies['moviehub_session'].value
        remembered = self.post('/api/auth/login', {'email': VALID['email'], 'password': VALID['password'], 'remember': True})
        self.assertEqual(int(remembered.cookies['moviehub_session']['max-age']), 604800)
        self.assertFalse(LoginSession.objects.filter(token_hash=hashlib.sha256(previous.encode()).hexdigest()).exists())

    def test_csrf_required(self):
        for action in ('register', 'login', 'logout'):
            with self.subTest(action=action):
                self.assertEqual(self.client.post('/api/auth/' + action, VALID, content_type='application/json').status_code, 403)
        token = self.client.get('/api/auth/csrf').json()['csrfToken']
        self.assertEqual(self.client.post('/api/auth/register', VALID, content_type='application/json', HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN='https://evil.example').status_code, 403)

    def test_validation(self):
        cases = [('firstName', 'АнНа'), ('lastName', 'иванова'), ('phone', '123'), ('email', 'bad'), ('age', 13), ('age', 101), ('age', 20.5), ('favoriteMovie', 'x'), ('password', 'weak'), ('confirmPassword', 'Wrong123'), ('terms', False), ('terms', 'true')]
        for field, value in cases:
            with self.subTest(field=field, value=value):
                response = self.post('/api/auth/register', {**VALID, field: value})
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json()['errors'])
        self.assertFalse(Account.objects.exists())

    def test_duplicate_and_wrong_password(self):
        self.post('/api/auth/register', VALID)
        self.assertEqual(self.post('/api/auth/register', {**VALID, 'email': VALID['email'].upper()}).status_code, 409)
        self.assertEqual(self.post('/api/auth/login', {'email': VALID['email'], 'password': 'Wrong1234'}).status_code, 401)

    def test_legacy_bcrypt_and_expired_session(self):
        account = Account.objects.create(first_name='Анна', last_name='Иванова', email=VALID['email'], phone=VALID['phone'], age=20, password_hash=bcrypt.hashpw(VALID['password'].encode(), bcrypt.gensalt(rounds=4)).decode())
        LoginSession.objects.create(token_hash=hashlib.sha256(b'old-token').hexdigest(), user=account, expires_at=int(time.time()*1000)+100000)
        self.client.cookies['moviehub_session'] = 'old-token'
        self.assertEqual(self.client.get('/api/auth/me').status_code, 200)
        LoginSession.objects.update(expires_at=0)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)
        self.assertEqual(self.post('/api/auth/login', {'email': VALID['email'], 'password': VALID['password']}).status_code, 200)
        account.refresh_from_db()
        self.assertTrue(account.password_hash.startswith('pbkdf2_sha256$'))

    def test_json_and_limits(self):
        self.assertEqual(self.post('/api/auth/register', []).status_code, 400)
        self.assertEqual(self.post('/api/auth/register', {'password': 'a'*17000}).status_code, 413)
        cache.clear()
        for _ in range(20):
            self.assertEqual(self.post('/api/auth/login', {}).status_code, 400)
        self.assertEqual(self.post('/api/auth/login', {}).status_code, 429)

    def test_pages_templates_and_headers(self):
        for name in ('index', 'movies', 'movie', 'about', 'auth', 'profile'):
            with self.subTest(page=name):
                response = self.client.get('/' + name + '.html')
                self.assertEqual(response.status_code, 200)
                self.assertTemplateUsed(response, 'portal/base.html')
                self.assertTemplateUsed(response, 'portal/' + name + '.html')
                self.assertContains(response, '/static/assets/')
                self.assertContains(response, 'MOVIEHUB')
                self.assertNotContains(response, '/src/')
                self.assertNotContains(response, '{%')
                self.assertIn('Content-Security-Policy', response.headers)
        self.assertEqual(self.client.get('/').status_code, 200)
        self.assertEqual(self.client.get('/api/health').json(), {'ok': True})
        self.assertEqual(self.client.get('/api/missing').status_code, 404)
