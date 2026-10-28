import './style.css';
import './site-pages.css';
import './visual-refresh.css';
import { businessConfig, serviceVisuals, weekdayNames } from './config/business.js';
import { enforceMemberBanGate, renderMemberBanGate, syncMemberAccessLink } from './member-gate.js';

const euro = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const navigationItems = [
  { path: '/', label: 'Inicio', page: 'home' },
  { path: '/servicios/', label: 'Servicios', page: 'services' },
  { path: '/tarifas/', label: 'Tarifas', page: 'rates' },
  { path: '/torneos/', label: 'Torneos', page: 'tournaments' },
  { path: '/noticias/', label: 'Noticias', page: 'news' },
  { path: '/comunidad/', label: 'Comunidad', page: 'community' },
  { path: '/local/', label: 'El local', page: 'venue' },
  { path: '/reservar/', label: 'Reservar', page: 'booking' },
];
let passwordFieldCount = 0;

function el(tagName, className = '', text = '') {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function price(cents) {
  return euro.format(cents / 100);
}

function addPasswordVisibilityToggle(label) {
  const input = label.querySelector('input[type="password"]');
  if (!input) return label;

  const field = el('div', 'community-password-field');
  const fieldLabel = el('label', '', label.firstChild.textContent.trim());
  input.id = `member-password-${input.name}-${++passwordFieldCount}`;
  fieldLabel.htmlFor = input.id;
  const control = el('span', 'password-input-control');
  const button = el('button', 'password-visibility-toggle');
  button.type = 'button';
  button.setAttribute('aria-label', 'Mostrar contraseña');
  button.setAttribute('aria-pressed', 'false');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  outline.setAttribute('d', 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z');
  const pupil = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  pupil.setAttribute('cx', '12');
  pupil.setAttribute('cy', '12');
  pupil.setAttribute('r', '3');
  icon.append(outline, pupil);
  button.append(icon);
  button.addEventListener('click', () => {
    const showPassword = input.type === 'password';
    input.type = showPassword ? 'text' : 'password';
    button.setAttribute('aria-label', showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
    button.setAttribute('aria-pressed', String(showPassword));
  });
  control.append(input, button);
  field.append(fieldLabel, control);
  return field;
}

function dateLabel(dateString, options = {}) {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: businessConfig.timeZone,
    day: '2-digit',
    month: 'short',
    ...options,
  }).format(new Date(`${dateString}T12:00:00Z`)).replace('.', '').toUpperCase();
}

function createHeader(business, currentPage) {
  const header = el('header', 'site-header');
  const wrapper = el('div', 'nav-wrap');
  const brand = el('a', 'brand');
  brand.href = '/';
  brand.setAttribute('aria-label', `${business.name}, inicio`);
  const mark = el('span', 'brand-mark');
  mark.append(document.createTextNode('LG'));
  mark.append(el('span', '', '/'));
  mark.setAttribute('aria-hidden', 'true');
  const copy = el('span', 'brand-copy');
  copy.append(el('strong', '', business.name.toUpperCase()));
  copy.append(el('small', '', 'JUEGA A TU MANERA'));
  brand.append(mark, copy);

  const toggle = el('button', 'menu-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'main-nav');
  toggle.append(el('span', 'menu-icon'));
  const bars = toggle.querySelector('.menu-icon');
  bars.append(el('i'), el('i'));
  bars.setAttribute('aria-hidden', 'true');
  toggle.append(el('span', '', 'Menú'));
  const navigation = el('nav', 'main-nav');
  navigation.id = 'main-nav';
  navigation.setAttribute('aria-label', 'Navegación principal');

  navigationItems.forEach((item) => {
    const link = el('a', item.page === 'booking' ? 'nav-booking' : '', item.label);
    link.href = item.path;
    if (item.page === currentPage) link.setAttribute('aria-current', 'page');
    if (item.page === 'booking') link.append(el('span', '', '↗'));
    navigation.append(link);
  });
  const accountLink = el('a', 'nav-account', 'Entrar / registrarse');
  accountLink.href = '/comunidad/#cuenta';
  navigation.append(accountLink);
  syncMemberAccessLink(accountLink);
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    navigation.classList.toggle('is-open', !open);
  });
  navigation.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    toggle.setAttribute('aria-expanded', 'false');
    navigation.classList.remove('is-open');
  }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      toggle.setAttribute('aria-expanded', 'false');
      navigation.classList.remove('is-open');
    }
  });
  wrapper.append(brand, toggle, navigation);
  header.append(wrapper);
  return header;
}

function createFooter(business) {
  const footer = el('footer', 'site-footer');
  const top = el('div', 'page-width footer-main');
  const brand = el('a', 'brand footer-brand');
  brand.href = '/';
  const mark = el('span', 'brand-mark', 'LG/');
  mark.setAttribute('aria-hidden', 'true');
  const copy = el('span', 'brand-copy');
  copy.append(el('strong', '', business.name.toUpperCase()), el('small', '', 'JUEGA A TU MANERA'));
  brand.append(mark, copy);
  top.append(brand, el('p', '', 'Una pantalla más. Una historia nueva.'));
  const links = el('nav', 'footer-page-links');
  links.setAttribute('aria-label', 'Páginas del sitio');
  navigationItems.forEach((item) => {
    const link = el('a', '', item.label);
    link.href = item.path;
    links.append(link);
  });
  top.append(links);
  const bottom = el('div', 'page-width footer-bottom');
  bottom.append(el('span', '', `© ${new Date().getFullYear()} ${business.name}`));
  bottom.append(el('span', '', 'HECHO PARA JUGAR EN COMPAÑÍA'));
  const admin = el('a', '', 'ACCESO DEL PERSONAL');
  admin.href = '/admin/';
  bottom.append(admin);
  footer.append(top, bottom);
  return footer;
}

function pageHeading({ number, eyebrow, title, accent, description, action }) {
  const section = el('section', 'page-banner');
  const content = el('div', 'page-width page-banner-inner');
  const left = el('div');
  left.append(el('p', 'eyebrow', `${number} / ${eyebrow}`));
  const heading = el('h1', 'page-title');
  heading.append(document.createTextNode(title));
  if (accent) heading.append(el('em', '', accent));
  left.append(heading);
  const right = el('div', 'page-banner-aside');
  right.append(el('p', '', description));
  if (action) {
    const link = el('a', 'button button-acid', action.label);
    link.href = action.href;
    link.append(el('span', '', '↗'));
    right.append(link);
  }
  content.append(left, right);
  section.append(content);
  return section;
}

function serviceCard(seat, index) {
  const visual = serviceVisuals[seat.slug] ?? { number: String(index + 1).padStart(2, '0'), label: 'PUESTO DISPONIBLE', image: '', alt: seat.name };
  const card = el('article', 'service-card service-page-card');
  const figure = el('figure', 'service-image');
  if (visual.image) {
    const image = el('img');
    image.src = visual.image;
    image.alt = visual.alt;
    image.loading = 'lazy';
    figure.append(image);
  }
  figure.append(el('span', 'service-number', visual.number));
  const copy = el('div', 'service-copy');
  copy.append(el('p', 'service-kicker', visual.label), el('h2', '', seat.name), el('p', 'service-description', seat.description));
  const specs = Object.entries(seat.specs ?? {}).map(([name, value]) => `${name}: ${value}`);
  if (specs.length) copy.append(el('p', 'service-specs', specs.join(' · ')));
  const priceLine = seat.hourlyPriceCents === null ? 'Tarifa por confirmar' : `${price(seat.hourlyPriceCents)} / hora`;
  copy.append(el('p', 'service-card-price', priceLine));
  const capacity = seat.capacity === 1 ? '1 puesto disponible' : `${seat.capacity} puestos`;
  copy.append(el('span', 'service-capacity', capacity));
  card.append(figure, copy);
  return card;
}

function renderServices(data) {
  const main = document.querySelector('#page-content');
  main.append(pageHeading({
    number: '01', eyebrow: 'ELIGE TU ARENA', title: 'Tu manera de ', accent: 'jugar.',
    description: 'Cuatro espacios, cuatro maneras de entrar en partida. Elige el que encaje contigo.',
    action: { label: 'Ver disponibilidad', href: '/reservar/' },
  }));
  const section = el('section', 'page-content-section services-section');
  const grid = el('div', 'page-width services-grid');
  data.seatTypes.forEach((seat, index) => grid.append(serviceCard(seat, index)));
  section.append(grid);
  main.append(section);
}

function renderRates(data) {
  const main = document.querySelector('#page-content');
  main.append(pageHeading({
    number: '02', eyebrow: 'TARIFAS', title: 'Solo pagas ', accent: 'tu partida.',
    description: 'Tarifas cargadas desde la base de datos. Los importes actuales son de demostración y deben confirmarse antes de publicar.',
    action: { label: 'Elegir horario', href: '/reservar/' },
  }));
  const section = el('section', 'page-content-section rates-section');
  const layout = el('div', 'page-width rates-layout');
  const aside = el('div', 'rates-aside');
  aside.append(el('p', 'eyebrow', 'EUROS · SIN SUSCRIPCIÓN'), el('h2', '', 'Encuentra tu ritmo.'));
  aside.append(el('p', 'demo-note', 'Los precios, bonos y descuentos que aparecen son datos de ejemplo.'));
  const content = el('div', 'rates-content');
  content.append(el('p', 'rate-label', 'TARIFA POR HORA'));
  const rows = el('div', 'rate-list');
  data.seatTypes.forEach((seat) => {
    const row = el('div', 'rate-row');
    const name = el('div', 'rate-name');
    name.append(el('strong', '', seat.name), el('span', '', `${seat.capacity} puestos`));
    row.append(name, el('span', 'rate-price', seat.hourlyPriceCents === null ? 'Consultar' : price(seat.hourlyPriceCents)), el('span', 'rate-unit', '/ hora'));
    rows.append(row);
  });
  content.append(rows);
  const extrasTitle = el('div', 'extras-heading');
  extrasTitle.append(el('span', '', 'Bonos y franjas'), el('i'));
  content.append(extrasTitle);
  const extras = el('div', 'extra-rates');
  data.pricingRules.forEach((rule) => {
    const row = el('div', 'extra-rate-row');
    const detail = rule.kind === 'pack' ? `${rule.durationHours} horas · ${price(rule.priceCents)}` : `${rule.priceCents}% · ${rule.startsAt}–${rule.endsAt}`;
    row.append(el('strong', '', rule.label), el('span', '', detail));
    extras.append(row);
  });
  content.append(extras);
  layout.append(aside, content);
  section.append(layout);
  main.append(section);
}

function renderLeaderboard(players) {
  const panel = el('aside', 'ranking-panel');
  panel.append(el('div', 'ranking-head'), el('p', 'ranking-foot', 'Puntos acumulados en torneos completados.'));
  const heading = panel.querySelector('.ranking-head');
  heading.append(el('p', 'eyebrow', 'TEMPORADA ACTUAL'));
  const title = el('h2');
  title.append(document.createTextNode('Top '), el('span', '', '10'));
  heading.append(title, el('span', 'ranking-caption', 'CLASIFICACIÓN GENERAL'));
  const list = el('ol', 'leaderboard');
  if (!players.length) list.append(el('li', 'empty-state', 'Aún no hay resultados publicados.'));
  players.forEach((player, index) => {
    const row = el('li', 'leaderboard-row');
    const identity = el('span', 'leaderboard-player');
    identity.append(el('strong', '', player.gamertag), el('small', '', `${player.wins} ${player.wins === 1 ? 'victoria' : 'victorias'}`));
    row.append(el('span', 'leaderboard-rank', String(index + 1).padStart(2, '0')), identity, el('strong', 'leaderboard-points', String(player.points)));
    list.append(row);
  });
  panel.insertBefore(list, panel.querySelector('.ranking-foot'));
  return panel;
}

function tournamentSignup(tournament) {
  const details = el('details', 'tournament-signup');
  details.id = `signup-${tournament.id}`;
  details.append(el('summary', '', 'Inscribirme'));
  const form = el('form', 'tournament-signup-form');
  form.append(inputField('Nombre', 'name', 'text', { autocomplete: 'name', minlength: 2, maxlength: 100 }).label);
  form.append(inputField('Gamertag', 'gamertag', 'text', { maxlength: 40 }).label);
  form.append(inputField('Email', 'email', 'email', { autocomplete: 'email', maxlength: 254 }).label);
  form.append(inputField('Teléfono', 'phone', 'tel', { autocomplete: 'tel' }).label);
  const acceptRules = el('label', 'tournament-rules-accept');
  const checkbox = el('input');
  checkbox.type = 'checkbox';
  checkbox.name = 'acceptedRules';
  checkbox.required = true;
  acceptRules.append(checkbox, el('span', '', 'Acepto las normas del torneo.'));
  form.append(acceptRules);
  const button = el('button', 'text-button', 'Confirmar inscripción');
  button.type = 'submit';
  form.append(button, el('p', 'form-message', ''));
  const message = form.querySelector('[role="status"]');
  message?.remove();
  form.lastElementChild.setAttribute('role', 'status');
  form.lastElementChild.setAttribute('aria-live', 'polite');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const feedback = form.lastElementChild;
    feedback.textContent = 'Enviando inscripción…';
    const values = Object.fromEntries(new FormData(form).entries());
    values.acceptedRules = form.elements.acceptedRules.checked;
    try {
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.slug)}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'No se pudo completar la inscripción.');
      feedback.textContent = result.status === 'waitlisted'
        ? `Aforo completo. ${result.gamertag} está en lista de espera.`
        : `Inscripción confirmada para ${result.gamertag}.`;
      form.reset();
    } catch (error) {
      feedback.textContent = error.message;
    }
  });
  details.append(form);
  return details;
}

function renderTournaments(data) {
  const main = document.querySelector('#page-content');
  main.append(pageHeading({
    number: '03', eyebrow: 'HAY PARTIDA', title: '¿Listo para ', accent: 'competir?',
    description: 'Consulta los próximos encuentros, revisa las plazas y encuentra tu nombre en la clasificación.',
  }));
  const section = el('section', 'page-content-section events-section');
  const layout = el('div', 'page-width events-layout tournament-page-layout');
  const panel = el('div', 'tournament-panel');
  const topline = el('div', 'panel-topline');
  topline.append(el('span', '', 'PRÓXIMOS TORNEOS'), el('span', 'open-label', 'INSCRIPCIÓN ABIERTA'));
  panel.append(topline);
  if (!data.tournaments.length) panel.append(el('p', 'empty-state', 'Todavía no hay torneos anunciados.'));
  data.tournaments.forEach((tournament) => {
    const row = el('article', 'tournament-item');
    const date = el('div', 'tournament-date');
    date.append(el('span', '', dateLabel(tournament.startsOn, { weekday: 'short' })), el('strong', '', tournament.startsAt));
    const details = el('div', 'tournament-details');
    details.append(el('p', 'tournament-game', tournament.game), el('h2', '', tournament.title), el('p', 'tournament-meta', `${tournament.format} · ${tournament.registeredCount}/${tournament.capacity} plazas`));
    const prize = el('div', 'tournament-prize');
    prize.append(el('span', '', 'INSCRIPCIÓN'), el('strong', '', price(tournament.entryFeeCents)));
    row.append(date, details, prize, tournamentSignup(tournament));
    panel.append(row);
  });
  layout.append(panel, renderLeaderboard(data.leaderboard));
  section.append(layout);
  main.append(section);
}

function renderNews(data) {
  const main = document.querySelector('#page-content');
  main.append(pageHeading({
    number: '04', eyebrow: 'NOVEDADES DEL LOCAL', title: 'Lo que pasa entre ', accent: 'partidas.',
    description: 'Eventos, cambios de horario y noticias de la comunidad, publicadas desde el panel del local.',
  }));
  const section = el('section', 'page-content-section news-section');
  const grid = el('div', 'page-width multipage-news-grid');
  if (!data.news.length) grid.append(el('p', 'empty-state', 'Todavía no hay noticias publicadas. Vuelve pronto para ver las novedades del local.'));
  data.news.forEach((post, index) => {
    const card = el('article', 'news-card');
    if (post.imageUrl) {
      const image = el('img');
      image.src = post.imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      card.append(image);
    }
    const copy = el('div', 'news-card-copy');
    const date = post.publishedAt ? new Date(`${post.publishedAt.replace(' ', 'T')}Z`) : new Date();
    copy.append(el('p', 'news-date', new Intl.DateTimeFormat('es-ES', { timeZone: businessConfig.timeZone, dateStyle: 'long' }).format(date)));
    copy.append(el('h2', '', post.title), el('p', 'news-excerpt', post.excerpt));
    const details = el('details', 'news-readmore');
    details.append(el('summary', '', 'Leer noticia'), el('p', '', post.body));
    copy.append(details);
    card.append(copy, el('span', 'news-index', String(index + 1).padStart(2, '0')));
    grid.append(card);
  });
  section.append(grid);
  main.append(section);
}

function renderSpenders(players) {
  const list = el('ol', 'leaderboard community-leaderboard');
  if (!players.length) list.append(el('li', 'empty-state', 'Aún no hay puntos por gasto. Completa una sesión para aparecer en el Top.'));
  players.forEach((player, index) => {
    const row = el('li', 'leaderboard-row');
    const identity = el('span', 'leaderboard-player');
    identity.append(el('strong', '', player.displayName), el('small', '', `${player.completedVisits} ${player.completedVisits === 1 ? 'sesión completada' : 'sesiones completadas'}`));
    row.append(el('span', 'leaderboard-rank', String(index + 1).padStart(2, '0')), identity, el('strong', 'leaderboard-points', String(player.points)));
    list.append(row);
  });
  return list;
}

function renderCommunityIdeas(ideas, target) {
  target.replaceChildren();
  if (!ideas.length) {
    target.append(el('p', 'empty-state', 'Todavía no hay propuestas aprobadas.'));
    return;
  }
  ideas.forEach((idea) => {
    const card = el('article', 'idea-card');
    card.append(el('p', 'eyebrow', `IDEA DE ${idea.author.toUpperCase()}`), el('h3', '', idea.title), el('p', '', idea.description));
    if (idea.moderationNote) card.append(el('p', 'idea-response', `Respuesta del equipo: ${idea.moderationNote}`));
    target.append(card);
  });
}

function renderModerationIdeas(ideas, csrfToken, target, reload) {
  target.replaceChildren();
  const pending = ideas.filter((idea) => idea.status === 'pending');
  if (!pending.length) {
    target.append(el('p', 'empty-state', 'No hay sugerencias pendientes de revisar.'));
    return;
  }
  pending.forEach((idea) => {
    const item = el('article', 'moderation-idea');
    item.append(el('p', 'eyebrow', `PROPUESTA DE ${idea.author.toUpperCase()}`), el('h3', '', idea.title), el('p', '', idea.description));
    const note = el('input');
    note.type = 'text';
    note.maxLength = 500;
    note.placeholder = 'Nota opcional para el autor';
    note.setAttribute('aria-label', `Nota de moderación para ${idea.title}`);
    const actions = el('div', 'moderation-actions');
    [['approved', 'Aprobar'], ['rejected', 'Rechazar']].forEach(([status, label]) => {
      const button = el('button', status === 'approved' ? 'text-button' : 'text-button text-button-danger', label);
      button.type = 'button';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const response = await fetch(`/api/members/ideas/${idea.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify({ status, moderationNote: note.value }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? 'No se pudo revisar la idea.');
          await reload();
        } catch (error) {
          item.append(el('p', 'form-message', error.message));
          button.disabled = false;
        }
      });
      actions.append(button);
    });
    item.append(note, actions);
    target.append(item);
  });
}

function renderCommunity(data) {
  const main = document.querySelector('#page-content');
  main.append(pageHeading({
    number: '07', eyebrow: 'LA COMUNIDAD', title: 'Juega, suma y ', accent: 'decide.',
    description: 'Crea tu cuenta para acumular puntos por tus sesiones y proponer lo que te gustaría ver en el local.',
  }));
  const section = el('section', 'page-content-section community-section');
  const layout = el('div', 'page-width community-layout');
  const account = el('section', 'community-account');
  account.id = 'cuenta';
  account.setAttribute('aria-labelledby', 'community-account-title');
  const accountHeading = el('div', 'community-heading');
  accountHeading.append(el('p', 'eyebrow', 'TU CUENTA'), el('h2', '', 'Entra en la comunidad.'));
  account.append(accountHeading);

  const authView = el('div', 'community-auth');
  const authTabs = el('div', 'community-auth-tabs');
  const loginTab = el('button', 'auth-tab is-active', 'Iniciar sesión');
  const registerTab = el('button', 'auth-tab', 'Crear cuenta');
  loginTab.type = registerTab.type = 'button';
  authTabs.append(loginTab, registerTab);
  const loginForm = el('form', 'community-form');
  loginForm.id = 'member-login-form';
  loginForm.append(inputField('Email', 'email', 'email', { autocomplete: 'email' }).label);
  const loginPasswordField = inputField('Contraseña', 'password', 'password', { autocomplete: 'current-password' });
  loginForm.append(addPasswordVisibilityToggle(loginPasswordField.label));
  const forgotPasswordButton = el('button', 'text-button password-forgot-link', '¿Has olvidado tu contraseña?');
  forgotPasswordButton.type = 'button';
  loginForm.append(forgotPasswordButton);
  const rememberLabel = el('label', 'community-consent remember-member-row');
  const remember = el('input');
  remember.type = 'checkbox';
  remember.name = 'rememberMe';
  rememberLabel.append(remember, el('span', '', 'Recordarme en este dispositivo durante 30 días'));
  loginForm.append(rememberLabel);
  const loginButton = el('button', 'button button-dark', 'Entrar');
  loginButton.type = 'submit';
  loginForm.append(loginButton, el('p', 'form-message', ''));
  loginForm.lastElementChild.id = 'member-auth-message';

  const registerForm = el('form', 'community-form');
  registerForm.id = 'member-register-form';
  registerForm.hidden = true;
  registerForm.append(inputField('Nombre público', 'displayName', 'text', { autocomplete: 'name', minlength: 2, maxlength: 80 }).label);
  registerForm.append(inputField('Email', 'email', 'email', { autocomplete: 'email' }).label);
  const registerPasswordField = inputField('Contraseña · mínimo 12 caracteres', 'password', 'password', { autocomplete: 'new-password', minlength: 12 });
  registerForm.append(addPasswordVisibilityToggle(registerPasswordField.label));
  const privacyLabel = el('label', 'community-consent');
  const privacyCheck = el('input');
  privacyCheck.type = 'checkbox';
  privacyCheck.name = 'consent';
  privacyCheck.required = true;
  privacyLabel.append(privacyCheck, el('span', '', 'Acepto que mis datos se utilicen para gestionar mi cuenta y mis reservas.'));
  const registerButton = el('button', 'button button-dark', 'Crear cuenta');
  registerButton.type = 'submit';
  registerForm.append(privacyLabel, registerButton, el('p', 'form-message', ''));
  registerForm.lastElementChild.id = 'member-register-message';
  authView.append(authTabs, loginForm, registerForm);

  const passwordResetRequestForm = el('form', 'community-form password-recovery-form');
  passwordResetRequestForm.hidden = true;
  passwordResetRequestForm.append(el('h3', '', 'Restablecer contraseña'));
  passwordResetRequestForm.append(inputField('Email de tu cuenta', 'email', 'email', { autocomplete: 'email' }).label);
  const passwordResetRequestSubmit = el('button', 'button button-dark', 'Enviar enlace');
  passwordResetRequestSubmit.type = 'submit';
  const passwordResetRequestMessage = el('p', 'form-message', '');
  passwordResetRequestMessage.setAttribute('role', 'status');
  passwordResetRequestForm.append(passwordResetRequestSubmit, passwordResetRequestMessage);
  const backToLoginButton = el('button', 'text-button', 'Volver a iniciar sesión');
  backToLoginButton.type = 'button';
  passwordResetRequestForm.append(backToLoginButton);

  const passwordResetForm = el('form', 'community-form password-recovery-form');
  passwordResetForm.hidden = true;
  passwordResetForm.append(el('h3', '', 'Elige una nueva contraseña'));
  const resetToken = el('input');
  resetToken.type = 'hidden';
  resetToken.name = 'token';
  passwordResetForm.append(resetToken);
  const newPasswordField = inputField('Nueva contraseña · mínimo 12 caracteres', 'password', 'password', { autocomplete: 'new-password', minlength: 12 });
  passwordResetForm.append(addPasswordVisibilityToggle(newPasswordField.label));
  const confirmPasswordField = inputField('Repite la nueva contraseña', 'confirmPassword', 'password', { autocomplete: 'new-password', minlength: 12 });
  passwordResetForm.append(addPasswordVisibilityToggle(confirmPasswordField.label));
  const passwordResetSubmit = el('button', 'button button-dark', 'Guardar nueva contraseña');
  passwordResetSubmit.type = 'submit';
  const passwordResetMessage = el('p', 'form-message', '');
  passwordResetMessage.setAttribute('role', 'status');
  passwordResetForm.append(passwordResetSubmit, passwordResetMessage);
  passwordResetForm.append(backToLoginButton.cloneNode(true));
  authView.append(passwordResetRequestForm, passwordResetForm);

  const profile = el('div', 'community-profile');
  profile.hidden = true;
  const profileHeader = el('div', 'profile-header');
  profileHeader.append(el('div', 'profile-name'), el('button', 'text-button', 'Cambiar de usuario'));
  profileHeader.querySelector('.text-button').type = 'button';
  profileHeader.querySelector('.text-button').id = 'member-logout';
  const stats = el('div', 'profile-stats');
  const pointsStat = el('div', 'profile-stat');
  pointsStat.append(el('span', '', 'PUNTOS'), el('strong', '', '0'));
  pointsStat.querySelector('strong').id = 'member-points';
  const spendStat = el('div', 'profile-stat');
  spendStat.append(el('span', '', 'GASTO EN SESIONES'), el('strong', '', '0 €'));
  spendStat.querySelector('strong').id = 'member-spend';
  stats.append(pointsStat, spendStat);
  profile.append(profileHeader, stats, el('p', 'profile-note', '10 puntos por cada euro en reservas completadas.'));

  const accountSettings = el('details', 'account-settings');
  accountSettings.append(el('summary', '', 'Editar perfil o contraseña'));
  const profileForm = el('form', 'community-form account-settings-form');
  profileForm.id = 'member-profile-form';
  profileForm.append(inputField('Nombre público', 'displayName', 'text', { autocomplete: 'name', minlength: 2, maxlength: 80 }).label);
  profileForm.append(inputField('Email', 'email', 'email', { autocomplete: 'email', maxlength: 254 }).label);
  const profilePasswordField = inputField('Contraseña actual para guardar cambios', 'currentPassword', 'password', { autocomplete: 'current-password' });
  profileForm.append(addPasswordVisibilityToggle(profilePasswordField.label));
  const profileSave = el('button', 'button button-dark', 'Guardar perfil');
  profileSave.type = 'submit';
  profileForm.append(profileSave, el('p', 'form-message', ''));
  profileForm.lastElementChild.id = 'profile-message';

  const passwordForm = el('form', 'community-form account-settings-form');
  passwordForm.id = 'member-password-form';
  const oldPasswordField = inputField('Contraseña antigua', 'currentPassword', 'password', { autocomplete: 'current-password' });
  passwordForm.append(addPasswordVisibilityToggle(oldPasswordField.label));
  const changePasswordField = inputField('Nueva contraseña · mínimo 12 caracteres', 'newPassword', 'password', { autocomplete: 'new-password', minlength: 12 });
  passwordForm.append(addPasswordVisibilityToggle(changePasswordField.label));
  const confirmChangedPasswordField = inputField('Repite la nueva contraseña', 'confirmPassword', 'password', { autocomplete: 'new-password', minlength: 12 });
  passwordForm.append(addPasswordVisibilityToggle(confirmChangedPasswordField.label));
  const passwordSave = el('button', 'button button-dark', 'Cambiar contraseña');
  passwordSave.type = 'submit';
  passwordForm.append(passwordSave, el('p', 'form-message', ''));
  passwordForm.lastElementChild.id = 'password-message';
  accountSettings.append(profileForm, passwordForm);
  profile.append(accountSettings);

  const ideaForm = el('form', 'idea-form');
  ideaForm.id = 'suggestion-form';
  ideaForm.hidden = true;
  ideaForm.append(el('h3', '', '¿Qué idea tienes?'));
  ideaForm.append(inputField('Título de la propuesta', 'title', 'text', { minlength: 5, maxlength: 100 }).label);
  const description = el('label', '', 'Cuéntanos un poco más');
  const descriptionInput = el('textarea');
  descriptionInput.name = 'description';
  descriptionInput.rows = 4;
  descriptionInput.minLength = 20;
  descriptionInput.maxLength = 2000;
  descriptionInput.required = true;
  description.append(descriptionInput);
  ideaForm.append(description);
  const ideaSubmit = el('button', 'button button-dark', 'Enviar idea');
  ideaSubmit.type = 'submit';
  ideaForm.append(ideaSubmit, el('p', 'form-message', ''));
  ideaForm.lastElementChild.id = 'suggestion-message';
  profile.append(ideaForm);
  account.append(authView, profile);

  const top = el('aside', 'community-top-panel');
  top.append(el('p', 'eyebrow', 'PUNTOS POR GASTO'), el('h2', '', 'Top 10')); 
  const topCaption = el('p', 'community-top-caption', '10 puntos por euro en reservas completadas.');
  top.append(renderSpenders(data.topSpenders ?? []), topCaption);

  const approvedPanel = el('section', 'approved-ideas-panel');
  approvedPanel.append(el('div', 'community-heading'), el('div', 'approved-ideas-list'));
  approvedPanel.querySelector('.community-heading').append(el('p', 'eyebrow', 'IDEAS DE LA COMUNIDAD'), el('h2', '', 'Propuestas aprobadas.'));
  renderCommunityIdeas(data.ideas ?? [], approvedPanel.querySelector('.approved-ideas-list'));

  const moderation = el('section', 'community-moderation');
  moderation.hidden = true;
  moderation.append(el('p', 'eyebrow', 'HERRAMIENTAS DE MODERACIÓN'), el('h2', '', 'Ideas pendientes.'), el('div', 'moderation-queue'));
  const moderatorTools = el('button', 'text-button', 'Revisar propuestas pendientes');
  moderatorTools.id = 'load-moderation-ideas';
  moderatorTools.type = 'button';
  moderatorTools.hidden = true;
  moderation.insertBefore(moderatorTools, moderation.querySelector('.moderation-queue'));

  layout.append(account, top);
  section.append(layout, approvedPanel, moderation);
  main.append(section);

  let csrfToken = '';
  const resetTokenFromUrl = new URLSearchParams(window.location.search).get('resetToken');
  const setAuthTab = (register) => {
    authTabs.hidden = false;
    loginForm.hidden = register;
    registerForm.hidden = !register;
    passwordResetRequestForm.hidden = true;
    passwordResetForm.hidden = true;
    loginTab.classList.toggle('is-active', !register);
    registerTab.classList.toggle('is-active', register);
  };
  loginTab.addEventListener('click', () => setAuthTab(false));
  registerTab.addEventListener('click', () => setAuthTab(true));
  forgotPasswordButton.addEventListener('click', () => {
    authTabs.hidden = true;
    loginForm.hidden = true;
    registerForm.hidden = true;
    passwordResetRequestForm.hidden = false;
    passwordResetRequestForm.elements.email.value = loginForm.elements.email.value;
    passwordResetRequestMessage.textContent = '';
  });
  passwordResetRequestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    passwordResetRequestMessage.textContent = 'Enviando solicitud…';
    passwordResetRequestSubmit.disabled = true;
    try {
      const response = await fetch('/api/members/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: passwordResetRequestForm.elements.email.value }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'No se pudo solicitar el restablecimiento.');
      passwordResetRequestMessage.textContent = result.message;
    } catch (error) {
      passwordResetRequestMessage.textContent = error.message;
    } finally {
      passwordResetRequestSubmit.disabled = false;
    }
  });
  passwordResetForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(passwordResetForm).entries());
    if (values.password !== values.confirmPassword) {
      passwordResetMessage.textContent = 'Las contraseñas nuevas no coinciden.';
      return;
    }
    passwordResetMessage.textContent = 'Guardando nueva contraseña…';
    passwordResetSubmit.disabled = true;
    try {
      const response = await fetch('/api/members/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token: values.token, password: values.password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'No se pudo restablecer la contraseña.');
      passwordResetForm.reset();
      setAuthTab(false);
      document.querySelector('#member-auth-message').textContent = 'Contraseña restablecida. Ya puedes iniciar sesión.';
      window.history.replaceState(null, '', `${window.location.pathname}#cuenta`);
    } catch (error) {
      passwordResetMessage.textContent = error.message;
    } finally {
      passwordResetSubmit.disabled = false;
    }
  });
  passwordResetRequestForm.querySelector('.text-button').addEventListener('click', () => setAuthTab(false));
  passwordResetForm.querySelector('.text-button').addEventListener('click', () => setAuthTab(false));

  if (resetTokenFromUrl) {
    resetToken.value = resetTokenFromUrl;
    authTabs.hidden = true;
    loginForm.hidden = true;
    registerForm.hidden = true;
    passwordResetRequestForm.hidden = true;
    passwordResetForm.hidden = false;
    window.history.replaceState(null, '', `${window.location.pathname}#cuenta`);
    account.scrollIntoView({ block: 'start' });
  }

  const loadModeration = async () => {
    const response = await fetch('/api/members/ideas', { credentials: 'same-origin' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'No se pudo cargar la moderación.');
    renderModerationIdeas(result.ideas, csrfToken, moderation.querySelector('.moderation-queue'), loadModeration);
  };

  const showMember = (member) => {
    authView.hidden = true;
    profile.hidden = false;
    ideaForm.hidden = false;
    profileHeader.querySelector('.profile-name').replaceChildren(el('strong', '', member.displayName), el('span', '', member.role));
    document.querySelector('#member-points').textContent = String(member.points);
    document.querySelector('#member-spend').textContent = price(member.spendCents);
    profileForm.elements.displayName.value = member.displayName;
    profileForm.elements.email.value = member.email;
    const isModerator = ['moderator', 'administrator'].includes(member.role);
    moderation.hidden = !isModerator;
    moderatorTools.hidden = !isModerator;
  };

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.querySelector('#member-auth-message');
    message.textContent = 'Iniciando sesión…';
    const credentials = Object.fromEntries(new FormData(loginForm).entries());
    credentials.rememberMe = loginForm.elements.rememberMe.checked;
    try {
      const response = await fetch('/api/members/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(credentials),
      });
      const result = await response.json();
      if (result.status === 'banned') {
        renderMemberBanGate(result.member, result.csrfToken, result.appeal);
        return;
      }
      if (!response.ok) throw new Error(result.error ?? 'No se pudo iniciar sesión.');
      csrfToken = result.csrfToken;
      showMember(result.member);
      await syncMemberAccessLink(document.querySelector('.nav-account'));
    } catch (error) {
      message.textContent = error.message;
    }
  });

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.querySelector('#member-register-message');
    message.textContent = 'Creando cuenta…';
    const values = Object.fromEntries(new FormData(registerForm).entries());
    values.consent = registerForm.elements.consent.checked;
    try {
      const response = await fetch('/api/members/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'No se pudo crear la cuenta.');
      csrfToken = result.csrfToken;
      showMember(result.member);
      await syncMemberAccessLink(document.querySelector('.nav-account'));
    } catch (error) {
      message.textContent = error.message;
    }
  });

  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.querySelector('#profile-message');
    message.textContent = 'Guardando perfil…';
    try {
      const response = await fetch('/api/members/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        credentials: 'same-origin',
        body: JSON.stringify(Object.fromEntries(new FormData(profileForm).entries())),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'No se pudo actualizar el perfil.');
      showMember(result.member);
      message.textContent = 'Perfil actualizado.';
    } catch (error) {
      message.textContent = error.message;
    }
  });

  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(passwordForm).entries());
    const message = document.querySelector('#password-message');
    if (values.newPassword !== values.confirmPassword) {
      message.textContent = 'Las contraseñas nuevas no coinciden.';
      return;
    }
    message.textContent = 'Cambiando contraseña…';
    try {
      const response = await fetch('/api/members/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        credentials: 'same-origin',
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'No se pudo cambiar la contraseña.');
      csrfToken = result.csrfToken;
      passwordForm.reset();
      message.textContent = 'Contraseña actualizada. Se cerraron las demás sesiones.';
    } catch (error) {
      message.textContent = error.message;
    }
  });

  ideaForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.querySelector('#suggestion-message');
    message.textContent = 'Enviando para revisión…';
    try {
      const response = await fetch('/api/members/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify(Object.fromEntries(new FormData(ideaForm).entries())),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'No se pudo enviar la sugerencia.');
      ideaForm.reset();
      message.textContent = 'Idea enviada. Aparecerá aquí después de aprobarse.';
    } catch (error) {
      message.textContent = error.message;
    }
  });

  moderatorTools.addEventListener('click', async () => {
    try {
      await loadModeration();
    } catch (error) {
      moderation.querySelector('.moderation-queue').replaceChildren(el('p', 'form-message', error.message));
    }
  });

  document.querySelector('#member-logout').addEventListener('click', async () => {
    try {
      await fetch('/api/members/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
        credentials: 'same-origin',
      });
    } finally {
      csrfToken = '';
      profile.hidden = true;
      ideaForm.hidden = true;
      authView.hidden = false;
      await syncMemberAccessLink(document.querySelector('.nav-account'));
    }
  });

  if (!resetTokenFromUrl) {
    fetch('/api/members/session', { credentials: 'same-origin' }).then(async (response) => {
      if (!response.ok) return;
      const result = await response.json();
      csrfToken = result.csrfToken;
      showMember(result.member);
    }).catch(() => {});
  }
}

function inputField(labelText, name, type, options = {}) {
  const label = el('label', '', labelText);
  const input = el(type === 'select' ? 'select' : 'input');
  input.name = name;
  input.id = `booking-${name}`;
  if (type !== 'select') input.type = type;
  if (options.autocomplete) input.autocomplete = options.autocomplete;
  if (options.required !== false) input.required = true;
  if (options.minlength) input.minLength = options.minlength;
  if (options.maxlength) input.maxLength = options.maxlength;
  if (options.disabled) input.disabled = true;
  if (options.options) options.options.forEach(({ value, label }) => {
    const option = el('option', '', label);
    option.value = value;
    input.append(option);
  });
  if (options.placeholder) input.placeholder = options.placeholder;
  label.append(input);
  return { label, input };
}

function setupBookingForm(form, seats) {
  const seat = form.querySelector('[name="seatType"]');
  const date = form.querySelector('[name="date"]');
  const duration = form.querySelector('[name="durationHours"]');
  const time = form.querySelector('[name="startTime"]');
  const message = form.querySelector('#booking-message');
  const confirmation = form.querySelector('#booking-confirmation');
  const priceBox = form.querySelector('#booking-price');
  const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: businessConfig.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const today = Object.fromEntries(todayParts.map(({ type, value }) => [type, value]));
  date.min = `${today.year}-${today.month}-${today.day}`;
  date.value = date.min;
  seats.forEach((type) => {
    const option = el('option', '', type.name);
    option.value = type.slug;
    seat.append(option);
  });

  const loadAvailability = async () => {
    message.textContent = 'Comprobando disponibilidad…';
    time.disabled = true;
    priceBox.textContent = '—';
    const query = new URLSearchParams({ seatType: seat.value, date: date.value, durationHours: duration.value });
    try {
      const response = await fetch(`/api/availability?${query}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'No se pudo consultar la disponibilidad.');
      time.replaceChildren();
      if (!result.slots.length) {
        time.append(el('option', '', result.message ?? 'Sin horas disponibles'));
        message.textContent = result.message ?? 'Sin horas disponibles.';
        return;
      }
      result.slots.forEach((slot) => {
        const option = el('option', '', `${slot.startTime} · ${slot.available ? `${slot.remaining} libres · ${price(slot.totalCents)}` : 'Sin plazas'}`);
        option.value = slot.startTime;
        option.disabled = !slot.available;
        option.dataset.totalCents = String(slot.totalCents);
        time.append(option);
      });
      time.disabled = false;
      priceBox.textContent = price(Number(time.selectedOptions[0]?.dataset.totalCents ?? 0));
      message.textContent = 'La plaza se confirma al completar la reserva.';
    } catch (error) {
      time.replaceChildren(el('option', '', 'No disponible'));
      message.textContent = error.message;
    }
  };

  seat.addEventListener('change', loadAvailability);
  date.addEventListener('change', loadAvailability);
  duration.addEventListener('change', loadAvailability);
  time.addEventListener('change', () => {
    priceBox.textContent = price(Number(time.selectedOptions[0]?.dataset.totalCents ?? 0));
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = 'Guardando reserva…';
    const values = Object.fromEntries(new FormData(form).entries());
    values.durationHours = Number(values.durationHours);
    values.consent = form.elements.consent.checked;
    confirmation.hidden = true;
    try {
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'No se pudo crear la reserva.');
      confirmation.replaceChildren(
        el('p', 'confirmation-kicker', 'RESERVA REGISTRADA'),
        el('h2', '', result.code),
        el('p', '', `${result.seatType} · ${dateLabel(result.date)} · ${result.startTime} · ${result.durationHours} h`),
        el('strong', 'confirmation-price', price(result.totalCents)),
        el('p', 'confirmation-note', 'El email está simulado en este entorno. Guarda el código y el token del enlace de cancelación.'),
      );
      confirmation.hidden = false;
      const cancelForm = form.parentElement.querySelector('#cancel-form');
      cancelForm.elements.code.value = result.code;
      cancelForm.elements.token.value = result.cancellationToken;
      cancelForm.parentElement.open = true;
      message.textContent = 'Estado: pendiente de confirmación.';
      await loadAvailability();
    } catch (error) {
      message.textContent = error.message;
    }
  });

  const cancelForm = form.parentElement.querySelector('#cancel-form');
  cancelForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const cancelMessage = cancelForm.querySelector('[role="status"]');
    cancelMessage.textContent = 'Procesando cancelación…';
    try {
      const response = await fetch('/api/reservations/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(cancelForm).entries())),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'No se pudo cancelar la reserva.');
      cancelMessage.textContent = `Reserva ${result.code} cancelada.`;
      await loadAvailability();
    } catch (error) {
      cancelMessage.textContent = error.message;
    }
  });
  fetch('/api/members/session', { credentials: 'same-origin' }).then(async (response) => {
    if (!response.ok) return;
    const result = await response.json();
    if (!form.elements.customerName.value) form.elements.customerName.value = result.member.displayName;
    if (!form.elements.customerEmail.value) form.elements.customerEmail.value = result.member.email;
    message.textContent = `Sesión iniciada como ${result.member.displayName}. Las reservas completadas suman puntos.`;
  }).catch(() => {});
  loadAvailability();
}

function renderBooking(data) {
  const main = document.querySelector('#page-content');
  main.append(pageHeading({
    number: '05', eyebrow: 'RESERVA ONLINE', title: 'Tu próxima sesión ', accent: 'empieza aquí.',
    description: 'Elige tipo de puesto, día, hora y duración. La disponibilidad se comprueba al momento y el total se calcula con las tarifas vigentes.',
  }));
  const section = el('section', 'page-content-section booking-section');
  const layout = el('div', 'page-width booking-inner');
  const intro = el('div', 'booking-intro');
  intro.append(el('p', 'eyebrow', 'PLAZAS EN TIEMPO REAL'), el('h2', '', 'Aparta tu puesto.'), el('p', '', 'Las reservas quedan pendientes de confirmación. Recibirás el código en pantalla y en el panel de personal.'));
  const action = el('div', 'booking-action');
  const form = el('form', 'booking-form');
  form.id = 'booking-form';
  const fields = el('div', 'booking-fields booking-fields-triplet');
  const seat = inputField('Puesto', 'seatType', 'select');
  const date = inputField('Día', 'date', 'date');
  const duration = inputField('Duración', 'durationHours', 'select', { options: Array.from({ length: 6 }, (_, index) => ({ value: String(index + 1), label: `${index + 1} ${index === 0 ? 'hora' : 'horas'}` })) });
  duration.input.value = '2';
  fields.append(seat.label, date.label, duration.label);
  form.append(fields);
  const timeField = inputField('Hora de inicio', 'startTime', 'select', { disabled: true, options: [{ value: '', label: 'Elige puesto y día primero' }] });
  timeField.input.className = 'booking-start-time';
  form.append(timeField.label);
  const customerFields = el('div', 'booking-fields booking-fields-pair');
  customerFields.append(
    inputField('Nombre y apellidos', 'customerName', 'text', { autocomplete: 'name', minlength: 2, maxlength: 100 }).label,
    inputField('Teléfono', 'customerPhone', 'tel', { autocomplete: 'tel' }).label,
  );
  form.append(customerFields, inputField('Email', 'customerEmail', 'email', { autocomplete: 'email', maxlength: 254 }).label);
  const consentLabel = el('label', 'consent-row');
  const consent = el('input');
  consent.type = 'checkbox';
  consent.name = 'consent';
  consent.required = true;
  const consentText = el('span');
  consentText.append(document.createTextNode('He leído la '));
  const privacy = el('a', '', 'información de privacidad');
  privacy.href = '/local/#privacidad';
  consentText.append(privacy, document.createTextNode(' y acepto el uso de mis datos para gestionar esta reserva.'));
  consentLabel.append(consent, consentText);
  form.append(consentLabel);
  const honeypot = el('label', 'honeypot-field', 'Deja este campo vacío');
  const honeypotInput = el('input');
  honeypotInput.name = 'website';
  honeypotInput.type = 'text';
  honeypotInput.tabIndex = -1;
  honeypotInput.autocomplete = 'off';
  honeypot.append(honeypotInput);
  form.append(honeypot);
  const submitRow = el('div', 'booking-submit-row');
  const total = el('p', 'booking-price', 'Total estimado');
  total.append(el('strong', '', '—'));
  total.querySelector('strong').id = 'booking-price';
  const submit = el('button', 'button button-dark', 'Confirmar reserva');
  submit.type = 'submit';
  submit.append(el('span', '', '↗'));
  submitRow.append(total, submit);
  form.append(submitRow, el('p', 'booking-message', ''));
  form.querySelector('.booking-message').id = 'booking-message';
  const confirmation = el('div', 'booking-confirmation');
  confirmation.id = 'booking-confirmation';
  confirmation.hidden = true;
  form.append(confirmation);
  const cancellation = el('details', 'cancel-details');
  cancellation.id = 'cancel-reservation';
  cancellation.append(el('summary', '', '¿Necesitas cancelar una reserva?'));
  const cancelForm = el('form', 'cancel-form');
  cancelForm.id = 'cancel-form';
  const codeField = inputField('Código de reserva', 'code', 'text', { required: true });
  const tokenField = inputField('Token de cancelación', 'token', 'text', { required: true });
  cancelForm.append(codeField.label, tokenField.label);
  const cancelButton = el('button', 'text-button', 'Solicitar cancelación');
  cancelButton.type = 'submit';
  cancelForm.append(cancelButton, el('p', 'form-message', ''));
  cancelForm.querySelector('[role="status"]')?.remove();
  cancelForm.lastElementChild.setAttribute('role', 'status');
  cancelForm.lastElementChild.setAttribute('aria-live', 'polite');
  cancellation.append(cancelForm);
  action.append(form, cancellation);
  layout.append(intro, action);
  section.append(layout);
  main.append(section);
  setupBookingForm(form, data.seatTypes);
}

function renderVenue(data) {
  const main = document.querySelector('#page-content');
  main.append(pageHeading({
    number: '06', eyebrow: 'NOS VEMOS EN EL LOCAL', title: 'Ven por la partida. ', accent: 'Quédate por la gente.',
    description: 'Ubicación, horarios y contacto. Los datos de negocio son placeholders editables hasta que se confirmen.',
  }));
  const section = el('section', 'page-content-section venue-page-section');
  const layout = el('div', 'page-width venue-page-layout');
  const details = el('div', 'venue-contact-panel');
  details.append(el('p', 'eyebrow', 'DÓNDE ENCONTRARNOS'), el('h2', '', data.business.address));
  const map = new URL('https://maps.google.com/');
  map.searchParams.set('q', data.business.address);
  const mapLink = el('a', 'button button-acid', 'Abrir mapa');
  mapLink.href = map.href;
  mapLink.target = '_blank';
  mapLink.rel = 'noreferrer';
  mapLink.append(el('span', '', '↗'));
  details.append(mapLink);
  const contact = el('div', 'venue-contact-list');
  const phone = el('a', '', data.business.phone);
  phone.href = `tel:${data.business.phone.replace(/\D/g, '')}`;
  const email = el('a', '', data.business.email);
  email.href = `mailto:${data.business.email}`;
  const whatsapp = el('a', '', 'Abrir WhatsApp ↗');
  whatsapp.href = `https://wa.me/${data.business.phone.replace(/\D/g, '')}`;
  whatsapp.target = '_blank';
  whatsapp.rel = 'noreferrer';
  contact.append(el('h3', '', 'CONTACTO'), phone, email, whatsapp);
  const hours = el('div', 'venue-hours-panel');
  hours.append(el('p', 'eyebrow', 'HORARIO SEMANAL'), el('h2', '', 'Abierto para jugar.'));
  const list = el('ul', 'opening-hours');
  data.openingHours.forEach((item) => {
    const row = el('li');
    row.append(el('span', '', weekdayNames[item.weekday]), el('span', '', item.isClosed ? 'Cerrado' : `${item.opensAt}–${item.closesAt}`));
    list.append(row);
  });
  hours.append(list);
  layout.append(details, contact, hours);
  section.append(layout);
  main.append(section);
  const lower = el('section', 'page-content-section venue-faq-section');
  const faqLayout = el('div', 'page-width faq-layout');
  const faqIntro = el('div');
  faqIntro.append(el('p', 'eyebrow', 'ANTES DE LA PARTIDA'), el('h2', '', 'Todo claro.'));
  const faqList = el('div', 'faq-list');
  [
    ['¿Tengo que traer mi equipo?', 'No. Puedes reservar uno de nuestros puestos y jugar con el equipo disponible. Para periféricos personales, consúltanos antes de venir.'],
    ['¿Puedo venir si nunca he jugado en un gaming lounge?', 'Claro. El equipo puede ayudarte a elegir puesto y resolver dudas para empezar.'],
    ['¿Cómo funcionan los torneos?', 'Consulta el formato, la fecha y las plazas en la página de torneos. Las normas específicas se comparten para cada evento.'],
    ['Normas del local', 'Respeta a las personas y el equipo, sigue las indicaciones del personal y avisa si tienes alguna incidencia.'],
  ].forEach(([question, answer]) => {
    const details = el('details');
    const summary = el('summary', '', question);
    summary.append(el('span', '', '+'));
    details.append(summary, el('p', '', answer));
    faqList.append(details);
  });
  faqLayout.append(faqIntro, faqList);
  lower.append(faqLayout);
  main.append(lower);
  const legal = el('section', 'legal-section');
  legal.id = 'privacidad';
  const legalGrid = el('div', 'page-width legal-grid');
  const privacyDetails = el('details');
  privacyDetails.id = 'privacidad-detalle';
  privacyDetails.append(el('summary', '', 'Privacidad y protección de datos'), el('p', '', 'La información completa del responsable, finalidades, conservación y derechos RGPD debe confirmarse antes de publicar el sitio. Las reservas se usan para gestionar el servicio solicitado. Puedes solicitar acceso o borrado escribiendo a '));
  privacyDetails.querySelector('p').append(el('a', '', data.business.email));
  privacyDetails.querySelector('a').href = `mailto:${data.business.email}`;
  const legalDetails = el('details');
  legalDetails.append(el('summary', '', 'Aviso legal'), el('p', '', 'Titularidad, datos registrales y dirección definitiva pendientes de confirmar por el negocio.'));
  legalGrid.append(
    privacyDetails,
    legalDetails,
    el('p', '', 'Solo utilizamos cookies técnicas necesarias para mantener las sesiones y proteger los formularios (lg_member_session, lg_member_csrf, lg_session y lg_csrf). No se usan para publicidad ni seguimiento. Al elegir «Recordarme», la sesión de miembro se conserva en este dispositivo durante el plazo indicado; puedes cerrar sesión para eliminarla.'),
  );
  legal.append(legalGrid);
  main.append(legal);
}

function updateMetadata(business, page) {
  const label = navigationItems.find((item) => item.page === page)?.label ?? 'Local Gaming';
  document.title = `${label} | ${business.name}`;
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title);
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', `${label} del local gaming ${business.name}.`);
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: business.name,
    description: 'Local gaming con puestos de PC, consolas, simulador y zona retro.',
    address: { '@type': 'PostalAddress', streetAddress: business.address, addressCountry: 'ES' },
    telephone: business.phone,
    email: business.email,
  };
  let structuredData = document.querySelector('#business-schema');
  if (!structuredData) {
    structuredData = el('script');
    structuredData.id = 'business-schema';
    structuredData.type = 'application/ld+json';
    document.head.append(structuredData);
  }
  structuredData.textContent = JSON.stringify(schema);
}

async function start() {
  document.body.classList.add('auth-checking');
  const page = document.body.dataset.page;
  if (await enforceMemberBanGate()) return;
  const response = await fetch('/api/public', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('No se pudo cargar el contenido del local.');
  const data = await response.json();
  document.querySelector('#site-header').replaceWith(createHeader(data.business, page));
  document.querySelector('#site-footer').replaceWith(createFooter(data.business));
  updateMetadata(data.business, page);

  const renderers = {
    services: renderServices,
    rates: renderRates,
    tournaments: renderTournaments,
    news: renderNews,
    community: renderCommunity,
    booking: renderBooking,
    venue: renderVenue,
  };
  (renderers[page] ?? renderServices)(data);
}

start().catch((error) => {
  document.querySelector('#page-content').append(el('p', 'page-error', error.message));
});
