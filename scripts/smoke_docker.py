"""Create synthetic accounts/comments ONLY in the separate Docker deployment."""
import os
import re
import uuid
import requests

base = 'http://127.0.0.1:' + os.getenv('MOVIEHUB_PORT', '8080')
assert requests.get(base + '/api/health', timeout=5).json()['ok']
for page in ('/', '/movies.html', '/movie.html?id=tt0816692', '/auth.html'):
    response = requests.get(base + page, timeout=5)
    assert response.status_code == 200
    for asset in re.findall(r'(?:src|href)="(/static/[^"?#]+)', response.text):
        assert requests.get(base + asset, timeout=5).status_code == 200, asset


def post(session, path, body):
    token = session.get(base + '/api/auth/csrf', timeout=5).json()['csrfToken']
    return session.post(base + path, json=body, headers={'X-CSRFToken': token}, timeout=15)


writer, reader = requests.Session(), requests.Session()
email = f'docker-{uuid.uuid4().hex}@example.test'
password = 'DockerTest123'
account = {'firstName': 'Анна', 'lastName': 'Иванова', 'email': email,
           'phone': '+7 (999) 123-45-67', 'age': 20, 'favoriteMovie': '',
           'password': password, 'confirmPassword': password, 'terms': True}
assert post(writer, '/api/auth/register', account).status_code == 201
assert writer.get(base + '/api/auth/me', timeout=5).json()['user']['email'] == email
assert post(writer, '/api/auth/logout', {}).status_code == 200
assert post(writer, '/api/auth/login', {'email': email, 'password': password}).status_code == 200
path = '/api/movies/tt0816692/comments'
body = {'text': 'Docker smoke ' + uuid.uuid4().hex, 'requestId': str(uuid.uuid4())}
sent = post(writer, path, body)
assert sent.status_code == 201, sent.status_code
assert post(writer, path, body).status_code == 200
cursor = 0
found = False
while True:
    data = reader.get(base + path, params={'after': cursor}, timeout=5).json()
    found |= any(comment['text'] == body['text'] for comment in data['comments'])
    cursor = data['nextCursor']
    if not data['hasMore']:
        break
assert found, 'Independent reader did not receive the comment'
# Without a real key CI expects a safe 503; local configured OMDb returns 200.
response = reader.get(base + '/api/movies?query=Interstellar', timeout=15)
assert response.status_code in (200, 503), response.status_code
assert isinstance(response.json()['ok'], bool)
print('Docker smoke passed: pages, registration, login, JSON comments, catalog boundary.')
