import re
from django import forms


class LoginForm(forms.Form):
    email = forms.RegexField(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', max_length=80)
    password = forms.CharField(max_length=24, strip=False)
    remember = forms.BooleanField(required=False)

    def clean_email(self):
        return self.cleaned_data['email'].lower()

    def clean_password(self):
        password = self.cleaned_data['password']
        if len(password.encode('utf-8')) > 72:
            raise forms.ValidationError('Используйте более короткий пароль.')
        return password


class RegisterForm(LoginForm):
    firstName = forms.RegexField(r'^[А-ЯЁA-Z][а-яёa-z]{1,29}$', error_messages={'invalid': 'Только буквы: первая заглавная, остальные строчные.'})
    lastName = forms.RegexField(r'^[А-ЯЁA-Z][а-яёa-z]{1,29}$', error_messages={'invalid': 'Только буквы: первая заглавная, остальные строчные.'})
    phone = forms.RegexField(r'^\+7 \([0-9]{3}\) [0-9]{3}-[0-9]{2}-[0-9]{2}$')
    age = forms.IntegerField(min_value=14, max_value=100)
    favoriteMovie = forms.CharField(required=False, min_length=2, max_length=60)
    confirmPassword = forms.CharField(strip=False)
    terms = forms.BooleanField(required=True)

    def clean_password(self):
        password = super().clean_password()
        if not re.fullmatch(r'(?=.*[A-ZА-ЯЁ])(?=.*[a-zа-яё])(?=.*[0-9]).{8,24}', password):
            raise forms.ValidationError('Нужно 8–24 символа, заглавная, строчная буква и цифра.')
        return password

    def clean(self):
        data = super().clean()
        if data.get('password') and data.get('password') != data.get('confirmPassword'):
            self.add_error('confirmPassword', 'Пароли не совпадают.')
        return data
