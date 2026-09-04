"""One-time copy. Keep original tables intact; never use --fake on a user's DB."""
from datetime import datetime, timezone
from django.db import migrations


def import_legacy(apps, schema_editor):
    connection = schema_editor.connection
    tables = connection.introspection.table_names()
    if 'users' not in tables:
        return
    Account = apps.get_model('portal', 'Account')
    LoginSession = apps.get_model('portal', 'LoginSession')
    alias = connection.alias

    def date(value):
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed

    with connection.cursor() as cursor:
        cursor.execute('SELECT id, first_name, last_name, email, phone, age, favorite_movie, password_hash, created_at FROM users')
        for row in cursor.fetchall():
            Account.objects.using(alias).create(id=row[0], first_name=row[1], last_name=row[2], email=row[3], phone=row[4], age=row[5], favorite_movie=row[6], password_hash=row[7], created_at=date(row[8]))
        if 'sessions' in tables:
            cursor.execute('SELECT token_hash, user_id, expires_at, created_at FROM sessions')
            for row in cursor.fetchall():
                LoginSession.objects.using(alias).create(token_hash=row[0], user_id=row[1], expires_at=row[2], created_at=date(row[3]))


class Migration(migrations.Migration):
    dependencies = [('portal', '0001_initial')]
    # Irreversible: going back to Express could discard new accounts or password changes.
    operations = [migrations.RunPython(import_legacy)]
