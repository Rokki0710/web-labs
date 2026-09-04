from django.urls import path
from portal import views
from portal.comments import comments

urlpatterns = [
    path('', views.page, name='home'),
    *[path(f'{name}.html', views.page, {'name': name}, name=name) for name in ('index', 'movies', 'movie', 'about', 'auth', 'profile')],
    path('api/health', views.health),
    path('api/auth/csrf', views.csrf),
    path('api/auth/register', views.authenticate, {'action': 'register'}),
    path('api/auth/login', views.authenticate, {'action': 'login'}),
    path('api/auth/me', views.me),
    path('api/auth/logout', views.logout),
    path('api/movies', views.movies),
    path('api/movies/<str:imdb_id>/comments', comments),
    path('api/movies/<str:imdb_id>', views.movies),
    path('api/<path:path>', views.api_not_found),
]
