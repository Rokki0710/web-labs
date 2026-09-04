import hashlib
import json
import re
import secrets
import time

import bcrypt
from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token, rotate_token
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.debug import sensitive_post_parameters, sensitive_variables
from django.views.decorators.http import require_GET

from . import omdb
from .forms import LoginForm, RegisterForm
from .models import Account, LoginSession

COOKIE = settings.MOVIEHUB_SESSION_COOKIE_NAME


def failure(message, status=400, **extra):
    return JsonResponse({'ok': False, 'message': message, **extra}, status=status)


def csrf_failure(request, reason=''):
    return failure('Проверка безопасности не пройдена. Обновите страницу и повторите.', 403)


@ensure_csrf_cookie
@require_GET
def page(request, name='index'):
    return render(request, f'portal/{name}.html', {'current_page': name})


@require_GET
def health(request):
    return JsonResponse({'ok': True})


@require_GET
def csrf(request):
    return JsonResponse({'ok': True, 'csrfToken': get_token(request)})


def token_hash(request):
    return hashlib.sha256(request.COOKIES.get(COOKIE, '').encode()).hexdigest()


def start_session(request, user, persistent, status=200):
    now = int(time.time() * 1000)
    token = secrets.token_urlsafe(32)
    with transaction.atomic():
        LoginSession.objects.filter(token_hash=token_hash(request)).delete()
        LoginSession.objects.filter(expires_at__lte=now).delete()
        LoginSession.objects.create(token_hash=hashlib.sha256(token.encode()).hexdigest(), user=user, expires_at=now + (7 if persistent else 1) * 86400000)
    rotate_token(request)
    response = JsonResponse({'ok': True, 'user': user.public_data()}, status=status)
    response.set_cookie(COOKIE, token, max_age=7 * 86400 if persistent else None, httponly=True, secure=not settings.DEBUG, samesite='Lax', path='/')
    return response


@sensitive_variables('body', 'data', 'password')
@sensitive_post_parameters()
def authenticate(request, action):
    if request.method != 'POST':
        response = failure('Используйте POST.', 405)
        response['Allow'] = 'POST'
        return response
    if request.content_type != 'application/json':
        return failure('Ожидается JSON.', 415)
    try:
        body = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return failure('Некорректный JSON.')
    if not isinstance(body, dict):
        return failure('Ожидается объект JSON.')
    # Enforce JSON types before Django's normal form coercion.
    if any(not isinstance(v, (str, int, float, bool, type(None))) for v in body.values()):
        return failure('Некорректные поля.')
    body['remember'] = body.get('remember') is True
    body['terms'] = body.get('terms') is True
    form = RegisterForm(body) if action == 'register' else LoginForm(body)
    if not form.is_valid():
        return failure('Проверьте заполненные поля.', errors={key: str(value[0]) for key, value in form.errors.items()})
    data = form.cleaned_data
    password = data['password']
    if action == 'register':
        try:
            with transaction.atomic():
                user = Account.objects.create(first_name=data['firstName'], last_name=data['lastName'], email=data['email'], phone=data['phone'], age=data['age'], favorite_movie=data['favoriteMovie'] or None, password_hash=make_password(password))
        except IntegrityError:
            return failure('Аккаунт с таким email уже существует.', 409, errors={'email': 'Этот email уже зарегистрирован.'})
        return start_session(request, user, True, 201)
    user = Account.objects.filter(email__iexact=data['email']).first()
    matches = False
    if user:
        if user.password_hash.startswith(('$2a$', '$2b$', '$2y$')):
            try:
                matches = bcrypt.checkpw(password.encode(), user.password_hash.encode())
            except ValueError:
                pass
            if matches:
                user.password_hash = make_password(password)
                user.save(update_fields=['password_hash'])
        else:
            matches = check_password(password, user.password_hash)
    else:
        make_password(password)  # Avoid a fast path revealing registered emails.
    if not matches:
        return failure('Неверный email или пароль.', 401)
    return start_session(request, user, data['remember'])


def current_account(request):
    session = LoginSession.objects.select_related('user').filter(token_hash=token_hash(request), expires_at__gt=int(time.time() * 1000)).first()
    return session.user if session else None


@require_GET
def me(request):
    account = current_account(request)
    if not account:
        return failure('Требуется вход в аккаунт.', 401)
    return JsonResponse({'ok': True, 'user': account.public_data()})


def logout(request):
    if request.method != 'POST':
        response = failure('Используйте POST.', 405)
        response['Allow'] = 'POST'
        return response
    LoginSession.objects.filter(token_hash=token_hash(request)).delete()
    rotate_token(request)
    response = JsonResponse({'ok': True})
    response.delete_cookie(COOKIE, path='/', samesite='Lax')
    return response


@require_GET
def movies(request, imdb_id=None):
    try:
        if imdb_id is not None:
            if not omdb.IMDB_ID.fullmatch(imdb_id):
                return failure('Неверный IMDb ID: ожидается tt и 7–10 цифр.')
            return JsonResponse({'ok': True, 'movie': omdb.details(imdb_id)})
        query = request.GET.get('query', '').strip()
        year = request.GET.get('year', '')
        page_number = request.GET.get('page', '1')
        if any(len(request.GET.getlist(key)) > 1 for key in ('query', 'year', 'page')) or not 2 <= len(query) <= 100 or (year and not re.fullmatch(r'(18|19|20|21)[0-9]{2}', year)) or not re.fullmatch(r'[1-9][0-9]{0,2}', page_number) or int(page_number) > 100:
            return failure('Название: 2–100 символов; год: 1800–2199; страница: 1–100.')
        return JsonResponse({'ok': True, **omdb.search(query, year, int(page_number))})
    except omdb.MovieApiError as error:
        return failure(str(error), error.status)


def api_not_found(request, path=''):
    return failure('API-маршрут не найден.', 404)
