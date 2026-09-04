from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone


class Account(models.Model):
    """MovieHub account; legacy bcrypt hashes are upgraded on the next login."""
    first_name = models.CharField(max_length=30)
    last_name = models.CharField(max_length=30)
    email = models.EmailField(max_length=80)
    phone = models.CharField(max_length=18)
    age = models.PositiveSmallIntegerField()
    favorite_movie = models.CharField(max_length=60, null=True, blank=True)
    password_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(Lower('email'), name='account_email_unique'),
            models.CheckConstraint(condition=models.Q(age__gte=14, age__lte=100), name='account_age_range'),
        ]

    def public_data(self):
        return {
            'id': self.pk, 'firstName': self.first_name, 'lastName': self.last_name,
            'email': self.email, 'phone': self.phone, 'age': self.age,
            'favoriteMovie': self.favorite_movie,
            'createdAt': self.created_at.astimezone(timezone.get_default_timezone()).strftime('%Y-%m-%d %H:%M:%S'),
        }


class LoginSession(models.Model):
    token_hash = models.CharField(max_length=64, primary_key=True)
    user = models.ForeignKey(Account, on_delete=models.CASCADE)
    # Epoch milliseconds preserve compatibility with existing browser sessions.
    expires_at = models.BigIntegerField(db_index=True)
    created_at = models.DateTimeField(default=timezone.now)
