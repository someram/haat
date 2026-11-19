import { api, $, $$, formData, formError, busy } from './common.js';

const form = $('#login-form');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(form, null);
  await busy(form.querySelector('button[type=submit]'), async () => {
    try {
      const { user } = await api('/api/auth/login', { method: 'POST', body: formData(form) });
      location.href = user.role === 'admin' ? '/admin' : '/dashboard';
    } catch (err) {
      formError(form, err);
    }
  });
});

$$('[data-demo]').forEach((b) => b.addEventListener('click', () => {
  const [email, password] = b.dataset.demo.split('|');
  form.email.value = email;
  form.password.value = password;
  form.querySelector('button[type=submit]').focus();
}));

// Already logged in? Go straight to the right place.
api('/api/auth/me').then(({ user }) => {
  location.href = user.role === 'admin' ? '/admin' : '/dashboard';
}).catch(() => {});
