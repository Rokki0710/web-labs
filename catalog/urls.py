import re
from django.http import JsonResponse
from django.urls import path
from django.views.decorators.http import require_GET
from . import omdb


@require_GET
def health(request):
    return JsonResponse({'ok': True, 'service': 'catalog'})


@require_GET
def movies(request, imdb_id=None):
    try:
        if imdb_id is not None:
            if not omdb.IMDB_ID.fullmatch(imdb_id):
                return JsonResponse({'ok': False}, status=400)
            return JsonResponse({'ok': True, 'movie': omdb.details(imdb_id)})
        query = request.GET.get('query', '').strip()
        year = request.GET.get('year', '')
        page = request.GET.get('page', '1')
        if (any(len(request.GET.getlist(k)) > 1 for k in ('query', 'year', 'page'))
                or not 2 <= len(query) <= 100
                or (year and not re.fullmatch(r'(18|19|20|21)[0-9]{2}', year))
                or not re.fullmatch(r'[1-9][0-9]{0,2}', page) or int(page) > 100):
            return JsonResponse({'ok': False}, status=400)
        return JsonResponse({'ok': True, **omdb.search(query, year, int(page))})
    except omdb.MovieApiError as error:
        return JsonResponse({'ok': False, 'message': str(error)}, status=error.status)


urlpatterns = [path('api/health', health), path('api/movies', movies),
               path('api/movies/<str:imdb_id>', movies)]
