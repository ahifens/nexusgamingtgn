import './member-gate.css';

function element(tagName, className = '', text = '') {
  const item = document.createElement(tagName);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}

function releasePublicPage() {
  document.body.classList.remove('auth-checking');
  [...document.body.children].forEach((child) => {
    child.style.visibility = 'visible';
  });
}

export function renderMemberBanGate(member, csrfToken, appeal = null) {
  document.body.classList.remove('auth-checking');
  const gate = element('main', 'member-ban-gate');
  gate.setAttribute('role', 'main');
  const logout = element('button', 'member-ban-logout', 'Cerrar sesión');
  logout.type = 'button';
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      await fetch('/api/members/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
        credentials: 'same-origin',
      });
    } finally {
      window.location.assign('/');
    }
  });

  const content = element('section', 'member-ban-content');
  content.setAttribute('aria-labelledby', 'ban-title');
  content.append(element('p', 'member-ban-eyebrow', 'ACCESO A LA COMUNIDAD'));
  content.append(element('h1', '', 'Estás baneado'));
  content.querySelector('h1').id = 'ban-title';
  content.append(element('p', 'member-ban-name', member.displayName ?? ''));
  content.append(element('p', 'member-ban-copy', 'Tu cuenta no puede acceder a la web mientras el equipo revisa el caso. Si crees que se trata de un error, puedes enviar una apelación.'));

  if (appeal?.status === 'pending') {
    const pending = element('div', 'appeal-state');
    pending.append(element('strong', '', 'Apelación en revisión'));
    pending.append(element('p', '', appeal.reason));
    pending.append(element('small', '', 'El equipo revisará tu solicitud. Vuelve a iniciar sesión más tarde para consultar el estado.'));
    content.append(pending);
  } else {
    const appealForm = element('form', 'member-appeal-form');
    appealForm.append(element('label', '', 'Cuéntanos por qué solicitas una revisión'));
    const reason = element('textarea');
    reason.name = 'reason';
    reason.minLength = 30;
    reason.maxLength = 2000;
    reason.rows = 6;
    reason.required = true;
    reason.placeholder = 'Explica el contexto para que el equipo pueda revisar tu caso…';
    appealForm.append(reason);
    const submit = element('button', 'member-appeal-submit', 'Enviar apelación');
    submit.type = 'submit';
    const feedback = element('p', 'member-appeal-feedback', '');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    appealForm.append(submit, feedback);
    appealForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      feedback.textContent = 'Enviando apelación…';
      submit.disabled = true;
      try {
        const response = await fetch('/api/members/appeals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          credentials: 'same-origin',
          body: JSON.stringify({ reason: reason.value }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'No se pudo enviar la apelación.');
        appealForm.replaceChildren(
          element('strong', '', 'Apelación enviada'),
          element('p', '', 'El equipo revisará tu solicitud.'),
        );
      } catch (error) {
        feedback.textContent = error.message;
        submit.disabled = false;
      }
    });
    content.append(appealForm);
  }

  gate.append(logout, content);
  document.body.replaceChildren(gate);
}

export async function enforceMemberBanGate() {
  document.body.classList.add('auth-checking');
  try {
    const response = await fetch('/api/members/session', { credentials: 'same-origin' });
    const result = await response.json();
    if (result.status === 'banned') {
      renderMemberBanGate(result.member, result.csrfToken, result.appeal);
      return true;
    }
  } catch {
    releasePublicPage();
    return false;
  }
  releasePublicPage();
  return false;
}

export async function syncMemberAccessLink(link) {
  if (!link) return;
  try {
    const response = await fetch('/api/members/session', { credentials: 'same-origin' });
    if (!response.ok) return;
    const session = await response.json();
    if (session.status === 'banned') return;
    link.textContent = 'Cerrar sesión';
    link.setAttribute('aria-label', `Cerrar sesión de ${session.member.displayName}`);
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      link.setAttribute('aria-busy', 'true');
      try {
        await fetch('/api/members/logout', {
          method: 'POST',
          headers: { 'X-CSRF-Token': session.csrfToken },
          credentials: 'same-origin',
        });
      } finally {
        window.location.assign('/');
      }
    });
  } catch {
    link.textContent = 'Entrar / registrarse';
  }
}
