from importlib import import_module
from types import SimpleNamespace
from django.apps import apps
from django.db import connection
from django.test import TransactionTestCase
from portal.models import Account, LoginSession


class LegacyMigrationTests(TransactionTestCase):
    def test_copies_without_changing_legacy(self):
        with connection.cursor() as cursor:
            cursor.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, phone TEXT, age INTEGER, favorite_movie TEXT, password_hash TEXT, created_at TEXT)')
            cursor.execute('CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER, expires_at INTEGER, created_at TEXT)')
            cursor.execute('INSERT INTO users VALUES (42, %s, %s, %s, %s, 20, NULL, %s, %s)', ['Анна', 'Иванова', 'legacy@example.test', '+7 (999) 123-45-67', 'original-bcrypt-hash', '2026-01-01 10:00:00'])
            cursor.execute('INSERT INTO sessions VALUES (%s, 42, 9999999999999, %s)', ['a'*64, '2026-01-01 10:00:00'])
        try:
            import_module('portal.migrations.0002_import_legacy').import_legacy(apps, SimpleNamespace(connection=connection))
            self.assertEqual(Account.objects.get(pk=42).password_hash, 'original-bcrypt-hash')
            self.assertEqual(LoginSession.objects.get().user_id, 42)
            self.assertEqual(Account.objects.get().public_data()['createdAt'], '2026-01-01 10:00:00')
            with connection.cursor() as cursor:
                cursor.execute('SELECT COUNT(*) FROM users')
                self.assertEqual(cursor.fetchone()[0], 1)
        finally:
            with connection.cursor() as cursor:
                cursor.execute('DROP TABLE sessions')
                cursor.execute('DROP TABLE users')
