"""Lab 5: verify actual SQL writes, password hashing and relational constraints."""
import hashlib

from django.contrib.auth.hashers import check_password, identify_hasher
from django.core.cache import cache
from django.db import IntegrityError, connection, transaction
from django.test import Client, TestCase

from portal.models import Account, LoginSession


class DatabaseTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client(enforce_csrf_checks=True)
        self.data = {
            'firstName': 'Анна', 'lastName': 'Иванова',
            'email': 'lab5@example.test', 'phone': '+7 (999) 123-45-67',
            'age': 22, 'favoriteMovie': 'Interstellar',
            'password': 'CinemaLab5123', 'confirmPassword': 'CinemaLab5123',
            'terms': True,
        }

    def register(self, **changes):
        token = self.client.get('/api/auth/csrf').json()['csrfToken']
        return self.client.post('/api/auth/register', {**self.data, **changes},
                                content_type='application/json', HTTP_X_CSRFTOKEN=token)

    def test_registration_persists_all_fields_in_sql(self):
        response = self.register()
        self.assertEqual(response.status_code, 201)
        user_id = response.json()['user']['id']
        # Parameterized SQL independently confirms the ORM write.
        with connection.cursor() as cursor:
            cursor.execute('SELECT first_name, last_name, email, phone, age, favorite_movie FROM portal_account WHERE id = %s', [user_id])
            self.assertEqual(cursor.fetchone(), ('Анна', 'Иванова', 'lab5@example.test', '+7 (999) 123-45-67', 22, 'Interstellar'))
        self.assertEqual(Account.objects.count(), 1)
        self.assertEqual(LoginSession.objects.get().user_id, user_id)
        self.assertEqual(self.client.get('/api/auth/me').json()['user']['id'], user_id)

    def test_password_verification_and_unique_salts(self):
        self.assertEqual(self.register().status_code, 201)
        first = Account.objects.get(email=self.data['email']).password_hash
        self.assertEqual(self.register(email='another@example.test').status_code, 201)
        second = Account.objects.get(email='another@example.test').password_hash
        for encoded in (first, second):
            self.assertEqual(identify_hasher(encoded).algorithm, 'pbkdf2_sha256')
            self.assertTrue(check_password(self.data['password'], encoded))
            self.assertFalse(check_password('WrongPassword123', encoded))
            self.assertNotIn(self.data['password'], encoded)
        self.assertNotEqual(first, second)
        self.assertNotEqual(first.split('$')[2], second.split('$')[2])

    def test_api_does_not_expose_credentials(self):
        response = self.register()
        account = Account.objects.get()
        raw_token = response.cookies['moviehub_session'].value
        session = LoginSession.objects.get()
        self.assertEqual(session.token_hash, hashlib.sha256(raw_token.encode()).hexdigest())
        self.assertNotEqual(session.token_hash, raw_token)
        for payload in (response.content.decode(), self.client.get('/api/auth/me').content.decode()):
            for secret in (self.data['password'], account.password_hash, raw_token, session.token_hash):
                self.assertNotIn(secret, payload)

    def test_database_rejects_duplicate_email_and_invalid_age(self):
        self.register()
        original = Account.objects.get()
        for email, age in ((original.email.upper(), 22), ('young@example.test', 13), ('old@example.test', 101)):
            with self.subTest(email=email, age=age):
                with self.assertRaises(IntegrityError), transaction.atomic():
                    Account.objects.create(first_name='Анна', last_name='Иванова', email=email,
                                           phone=original.phone, age=age, password_hash=original.password_hash)
        self.assertEqual(Account.objects.count(), 1)

    def test_session_foreign_key_and_cascade(self):
        self.register()
        with self.assertRaises(IntegrityError), transaction.atomic():
            LoginSession.objects.create(token_hash='a' * 64, user_id=999999, expires_at=9999999999999)
            connection.check_constraints()
        self.assertEqual(LoginSession.objects.count(), 1)
        Account.objects.get().delete()
        self.assertEqual(LoginSession.objects.count(), 0)
