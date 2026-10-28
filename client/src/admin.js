import './admin.css';
import { setupAdminManagement } from './admin-management.js';

let csrfToken = '';
let editingId = null;
let managementInitialized = false;

const loginView = document.querySelector('#login-view');
const passwordChangeView = document.querySelector('#password-change-view');
const dashboard = document.querySelector('#dashboard-view');
const loginForm = document.querySelector('#login-form');
const loginMessage = document.querySelector('#login-message');
const passwordChangeForm = document.querySelector('#password-change-form');
const passwordChangeMessage = document.querySelector('#password-change-message');
const newsForm = document.querySelector('#news-form');
const newsMessage = document.querySelector('#news-message');
const newsList = document.querySelector('#admin-news-list');

function element(tagName, className = '', text = '') {
  const item = document.createElement(tagName);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}

async function request(path, { method = 'GET', body, csrf = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (csrf) headers['X-CSRF-Token'] = csrfToken;

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'No se pudo completar la petición.');
  return data;
}

function showDashboard(user) {
  loginView.hidden = true;
  passwordChangeView.hidden = true;
  dashboard.hidden = false;
  document.querySelector('#staff-name').textContent = `${user.username} · ${user.role === 'administrator' ? 'Administración' : 'Personal'}`;
  document.querySelector('.editor-panel').hidden = user.role !== 'administrator';
  if (!managementInitialized) {
    setupAdminManagement({ csrfToken, role: user.role });
    managementInitialized = true;
  }
  loadNews();
}

function showPasswordChange() {
  loginView.hidden = true;
  passwordChangeView.hidden = false;
  dashboard.hidden = true;
  passwordChangeForm.elements.newPassword.focus();
}

function resetEditor() {
  editingId = null;
  newsForm.reset();
  newsForm.elements.status.value = 'draft';
  document.querySelector('#editor-title').textContent = 'Nueva noticia';
  document.querySelector('#reset-news').hidden = true;
}

function editNews(post) {
  editingId = post.id;
  newsForm.elements.title.value = post.title;
  newsForm.elements.excerpt.value = post.excerpt;
  newsForm.elements.body.value = post.body;
  newsForm.elements.imageUrl.value = post.imageUrl;
  newsForm.elements.status.value = post.status;
  document.querySelector('#editor-title').textContent = 'Editar noticia';
  document.querySelector('#reset-news').hidden = false;
  newsForm.elements.title.focus();
}

function renderNews(posts) {
  newsList.replaceChildren();
  document.querySelector('#news-count').textContent = String(posts.length).padStart(2, '0');

  if (!posts.length) {
    newsList.append(element('p', 'list-empty', 'Aún no hay noticias. Crea un borrador o publica la primera.'));
    return;
  }

  posts.forEach((post) => {
    const row = element('article', 'admin-news-row');
    const headline = element('div', 'admin-news-headline');
    const status = element('span', `status-label status-${post.status}`, post.status === 'published' ? 'Publicada' : 'Borrador');
    headline.append(status, element('h3', '', post.title));
    headline.append(element('p', '', post.excerpt));
    const actions = element('div', 'admin-news-actions');
    const edit = element('button', 'news-action', 'Editar');
    edit.type = 'button';
    edit.addEventListener('click', () => editNews(post));
    const remove = element('button', 'news-action news-action-delete', 'Eliminar');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar «${post.title}»? Esta acción no se puede deshacer.`)) return;
      try {
        await request(`/api/admin/news/${post.id}`, { method: 'DELETE', csrf: true });
        if (editingId === post.id) resetEditor();
        await loadNews();
      } catch (error) {
        newsMessage.textContent = error.message;
      }
    });
    actions.append(edit, remove);
    row.append(headline, actions);
    newsList.append(row);
  });
}

async function loadNews() {
  newsList.replaceChildren(element('p', 'list-loading', 'Cargando noticias…'));
  try {
    const data = await request('/api/admin/news');
    renderNews(data.news);
  } catch (error) {
    newsList.replaceChildren(element('p', 'list-empty', error.message));
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginMessage.textContent = 'Comprobando acceso…';
  const values = new FormData(loginForm);

  try {
    const data = await request('/api/admin/login', {
      method: 'POST',
      body: Object.fromEntries(values.entries()),
    });
    csrfToken = data.csrfToken;
    loginForm.reset();
    loginMessage.textContent = '';
    if (data.mustChangePassword) {
      passwordChangeForm.dataset.username = data.user.username;
      showPasswordChange();
    } else {
      showDashboard(data.user);
    }
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

passwordChangeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = new FormData(passwordChangeForm);
  const newPassword = values.get('newPassword');
  const confirmPassword = values.get('confirmPassword');

  if (newPassword !== confirmPassword) {
    passwordChangeMessage.textContent = 'Las contraseñas no coinciden.';
    return;
  }

  passwordChangeMessage.textContent = 'Actualizando contraseña…';
  try {
    const data = await request('/api/admin/password', {
      method: 'POST',
      body: { newPassword },
      csrf: true,
    });
    csrfToken = data.csrfToken;
    passwordChangeForm.reset();
    showDashboard({ username: passwordChangeForm.dataset.username, role: 'administrator' });
  } catch (error) {
    passwordChangeMessage.textContent = error.message;
  }
});

newsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  newsMessage.textContent = 'Guardando…';
  const values = new FormData(newsForm);
  const input = Object.fromEntries(values.entries());
  const path = editingId ? `/api/admin/news/${editingId}` : '/api/admin/news';

  try {
    await request(path, {
      method: editingId ? 'PUT' : 'POST',
      body: input,
      csrf: true,
    });
    newsMessage.textContent = input.status === 'published' ? 'Noticia publicada en la web.' : 'Borrador guardado.';
    resetEditor();
    await loadNews();
  } catch (error) {
    newsMessage.textContent = error.message;
  }
});

document.querySelector('#reset-news').addEventListener('click', () => {
  resetEditor();
  newsMessage.textContent = '';
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  try {
    await request('/api/admin/logout', { method: 'POST', csrf: true });
  } finally {
    csrfToken = '';
    dashboard.hidden = true;
    loginView.hidden = false;
    loginMessage.textContent = 'Has cerrado la sesión.';
  }
});

try {
  const session = await request('/api/admin/session');
  csrfToken = session.csrfToken;
  if (session.mustChangePassword) {
    passwordChangeForm.dataset.username = session.user.username;
    showPasswordChange();
  } else {
    showDashboard(session.user);
  }
} catch {
  loginView.hidden = false;
  dashboard.hidden = true;
}
