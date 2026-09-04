import json
from django import template
from django.conf import settings
from django.utils.html import format_html

register = template.Library()


@register.simple_tag
def vite_asset(entry):
    """Read Vite's manifest, so templates never hard-code hashed build filenames."""
    manifest = json.loads((settings.BASE_DIR / 'dist/.vite/manifest.json').read_text())
    url = settings.STATIC_URL + manifest[entry]['file']
    if entry.endswith('.css'):
        return format_html('<link rel="stylesheet" href="{}" />', url)
    return format_html('<script type="module" src="{}"></script>', url)
