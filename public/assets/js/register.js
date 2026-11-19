import { api, $, formData, formError, busy } from './common.js';

const form = $('#register-form');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(form, null);
  await busy(form.querySelector('button[type=submit]'), async () => {
    try {
      await api('/api/auth/register', { method: 'POST', body: formData(form) });
      location.href = '/dashboard';
    } catch (err) {
      formError(form, err);
    }
  });
});
