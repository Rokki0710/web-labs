"""JSON-only discussion API; polling reads our DB, never OMDb."""
import json
import re
from uuid import UUID

from django.http import JsonResponse

from .models import Comment
from .omdb import IMDB_ID
from .views import current_account, failure


def serialize(comment):
    return {
        'id': comment.pk, 'movieId': comment.movie_id, 'text': comment.text,
        'author': {'name': f'{comment.author.first_name} {comment.author.last_name}'},
        'createdAt': comment.created_at.isoformat(),
    }


def comments(request, imdb_id):
    if not IMDB_ID.fullmatch(imdb_id):
        return failure('Неверный IMDb ID.')
    if request.method not in ('GET', 'POST'):
        response = failure('Используйте GET или POST.', 405)
        response['Allow'] = 'GET, POST'
        return response
    account = current_account(request)
    if request.method == 'GET':
        after = request.GET.get('after', '0')
        if len(request.GET.getlist('after')) > 1 or not re.fullmatch(r'[0-9]{1,15}', after):
            return failure('Курсор after должен быть неотрицательным целым числом.')
        rows = list(Comment.objects.filter(movie_id=imdb_id, id__gt=int(after)).select_related('author').order_by('id')[:51])
        page = rows[:50]
        return JsonResponse({
            'ok': True, 'comments': [serialize(row) for row in page],
            'nextCursor': page[-1].pk if page else int(after),
            'hasMore': len(rows) > 50, 'canWrite': account is not None,
        })
    if account is None:
        return failure('Войдите в аккаунт, чтобы оставить комментарий.', 401)
    if request.content_type != 'application/json':
        return failure('Ожидается JSON.', 415)
    try:
        body = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return failure('Некорректный JSON.')
    if not isinstance(body, dict) or not isinstance(body.get('text'), str):
        return failure('Передайте текст комментария в поле text.')
    text = body['text'].strip()
    if not 1 <= len(text) <= 2000 or '\x00' in text:
        return failure('Комментарий должен содержать от 1 до 2000 символов без нулевых символов.')
    try:
        request_id = UUID(body.get('requestId', ''))
    except (ValueError, TypeError, AttributeError):
        return failure('Передайте requestId в формате UUID.')
    comment, created = Comment.objects.get_or_create(
        author=account, request_id=request_id,
        defaults={'movie_id': imdb_id, 'text': text},
    )
    if comment.movie_id != imdb_id or comment.text != text:
        return failure('Этот requestId уже использован для другого сообщения.', 409)
    return JsonResponse({'ok': True, 'comment': serialize(comment)}, status=201 if created else 200)
