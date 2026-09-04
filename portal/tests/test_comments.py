import hashlib
import time
from uuid import uuid4
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client, TestCase

from portal.models import Account, Comment, LoginSession


class CommentTests(TestCase):
    path = '/api/movies/tt0816692/comments'

    def setUp(self):
        cache.clear()
        self.alice = Account.objects.create(first_name='Анна', last_name='Иванова', email='alice@example.test', phone='+7 (999) 123-45-67', age=22, password_hash='unused')
        self.bob = Account.objects.create(first_name='Иван', last_name='Петров', email='bob@example.test', phone='+7 (999) 123-45-67', age=23, password_hash='unused')
        self.writer = self.client_for(self.alice, 'alice-test-token')
        self.reader = self.client_for(self.bob, 'bob-test-token')

    def client_for(self, account, token):
        LoginSession.objects.create(user=account, token_hash=hashlib.sha256(token.encode()).hexdigest(), expires_at=int(time.time()*1000)+60000)
        client = Client(enforce_csrf_checks=True)
        client.cookies['moviehub_session'] = token
        return client

    def post(self, client=None, body=None, path=None):
        client = client or self.writer
        token = client.get('/api/auth/csrf').json()['csrfToken']
        return client.post(path or self.path, body if body is not None else {'text':'Хороший фильм!', 'requestId':str(uuid4())}, content_type='application/json', HTTP_X_CSRFTOKEN=token)

    def test_two_users_and_public_polling(self):
        initial = self.reader.get(self.path).json()
        self.assertEqual(initial['comments'], [])
        self.assertTrue(initial['canWrite'])
        created = self.post()
        self.assertEqual(created.status_code, 201)
        saved = Comment.objects.get()
        self.assertEqual(saved.author, self.alice)
        for client in (self.reader, Client()):
            response = client.get(self.path, {'after':initial['nextCursor']})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response['Content-Type'], 'application/json')
            self.assertEqual(response['Cache-Control'], 'no-store')
            self.assertEqual(response.json()['comments'][0], created.json()['comment'])
            self.assertNotIn('email', str(response.json()))
        self.assertFalse(Client().get(self.path).json()['canWrite'])

    def test_author_comes_from_session(self):
        response = self.post(body={'text':'От Анны', 'requestId':str(uuid4()), 'author':self.bob.pk})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Comment.objects.get().author_id, self.alice.pk)

    def test_guest_and_expired_session_cannot_write(self):
        self.assertEqual(self.post(client=Client(enforce_csrf_checks=True)).status_code, 401)
        LoginSession.objects.filter(user=self.alice).update(expires_at=0)
        self.assertEqual(self.post().status_code, 401)
        self.assertFalse(self.writer.get(self.path).json()['canWrite'])
        self.assertFalse(Comment.objects.exists())

    def test_csrf_is_required(self):
        response = self.writer.post(self.path, {'text':'test', 'requestId':str(uuid4())}, content_type='application/json')
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Comment.objects.exists())

    def test_invalid_body(self):
        for body in ([], {}, {'text':False}, {'text':'   '}, {'text':'x'*2001}, {'text':'x\x00y'}, {'text':'hello','requestId':'bad'}):
            cache.clear()
            with self.subTest(body_type=type(body).__name__):
                self.assertEqual(self.post(body=body).status_code, 400)
        self.assertEqual(self.post(body={'text':'x'*17000}).status_code, 413)
        token = self.writer.get('/api/auth/csrf').json()['csrfToken']
        self.assertEqual(self.writer.post(self.path, '{', content_type='application/json', HTTP_X_CSRFTOKEN=token).status_code, 400)
        self.assertEqual(self.writer.post(self.path, {'text':'test'}, HTTP_X_CSRFTOKEN=token).status_code, 415)
        self.assertFalse(Comment.objects.exists())

    def test_length_boundaries_and_plain_text(self):
        for text in ('x', 'x'*2000, '<script>alert("hello")</script>\nВторая строка'):
            response = self.post(body={'text':text,'requestId':str(uuid4())})
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.json()['comment']['text'], text)

    def test_cursor_and_movie_isolation(self):
        first = self.post().json()['comment']['id']
        self.post(path='/api/movies/tt0133093/comments')
        second = self.post().json()['comment']['id']
        self.assertEqual([row['id'] for row in self.reader.get(self.path, {'after':first}).json()['comments']], [second])
        empty = self.reader.get(self.path, {'after':second}).json()
        self.assertEqual(empty['comments'], [])
        self.assertEqual(empty['nextCursor'], second)
        for suffix in ('?after=-1','?after=a','?after=1&after=2','?after=9'*20):
            self.assertEqual(self.reader.get(self.path+suffix).status_code, 400)
        self.assertEqual(self.reader.get('/api/movies/bad/comments').status_code, 400)
        self.assertEqual(self.reader.put(self.path).status_code, 403)  # CSRF middleware before view.
        self.assertEqual(Client().put(self.path).status_code, 405)

    def test_batched_read_catches_up_without_gaps(self):
        Comment.objects.bulk_create([Comment(author=self.alice,movie_id='tt0816692',text=str(i),request_id=uuid4()) for i in range(123)])
        received = []
        cursor = 0
        for _ in range(3):
            response = self.reader.get(self.path, {'after':cursor}).json()
            self.assertLessEqual(len(response['comments']), 50)
            received.extend(row['id'] for row in response['comments'])
            cursor = response['nextCursor']
        self.assertEqual(len(received), 123)
        self.assertEqual(len(set(received)), 123)
        self.assertFalse(response['hasMore'])

    def test_retry_does_not_duplicate_and_conflict_is_rejected(self):
        body = {'text':'Сохранить один раз', 'requestId':str(uuid4())}
        first = self.post(body=body)
        again = self.post(body=body)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(again.status_code, 200)
        self.assertEqual(first.json(), again.json())
        self.assertEqual(Comment.objects.count(), 1)
        self.assertEqual(self.post(body={**body,'text':'Другой текст'}).status_code, 409)

    def test_polling_does_not_use_omdb_or_its_limit(self):
        with patch('portal.omdb.requests.get') as fetch:
            for _ in range(35):
                self.assertEqual(self.reader.get(self.path).status_code, 200)
            fetch.assert_not_called()
        self.assertEqual(self.reader.get('/api/movies?query=x').status_code, 400)

    def test_post_rate_limit_and_reader_stays_available(self):
        for _ in range(10):
            self.assertEqual(self.post().status_code, 201)
        self.assertEqual(self.post().status_code, 429)
        self.assertEqual(self.reader.get(self.path).status_code, 200)
