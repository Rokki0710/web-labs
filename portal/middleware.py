import hashlib
from django.core.cache import cache
from django.http import JsonResponse


class ApiMiddleware:
    """Single-process rate limits and the same CSP as in the previous lab."""
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        is_api = request.path.startswith('/api/')
        response = None
        if is_api:
            try:
                too_large = int(request.META.get('CONTENT_LENGTH') or 0) > 16384
            except ValueError:
                too_large = True
            if too_large:
                response = JsonResponse({'ok': False, 'message': 'Слишком большой запрос.'}, status=413)
            scope = 'movies' if request.path.startswith('/api/movies') else 'auth'
            limited = scope == 'movies' or request.path in ('/api/auth/register', '/api/auth/login')
            if response is None and limited:
                # Never trust a client-supplied X-Forwarded-For header.
                ip = request.META.get('REMOTE_ADDR', '')
                key = scope + ':' + hashlib.sha256(ip.encode()).hexdigest()
                limit, window = (30, 60) if scope == 'movies' else (20, 900)
                if cache.add(key, 1, window):
                    count = 1
                else:
                    try:
                        count = cache.incr(key)
                    except ValueError:
                        cache.set(key, 1, window)
                        count = 1
                if count > limit:
                    response = JsonResponse({'ok': False, 'message': 'Слишком много запросов. Попробуйте позже.'}, status=429)
                    response['Retry-After'] = str(window)
        response = response or self.get_response(request)
        if is_api or request.path.endswith('.html') or request.path == '/':
            response['Cache-Control'] = 'no-store'
        response['Content-Security-Policy'] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https://m.media-amazon.com https://ia.media-imdb.com; "
            "media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
        )
        return response
