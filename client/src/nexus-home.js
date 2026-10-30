import './nexus.css';
import './page-transitions.css';
import { serviceVisuals, weekdayNames } from './config/business.js';
import { enforceMemberBanGate, renderMemberBanGate, syncMemberAccessLink } from './member-gate.js';

const euro = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
let publicData;
let csrfToken = '';
let bookingSlots = [];
let noticeTimer;

function el(tag, className = '', text = '') {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}

function price(cents) {
  return euro.format(cents / 100);
}

function madridToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateLabel(value) {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00Z`));
}

function notify(message) {
  const notice = document.querySelector('#notice');
  notice.textContent = message;
  notice.classList.add('show');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.remove('show'), 3500);
}

async function jsonRequest(path, { method = 'GET', body, csrf = false } = {}) {
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
  return { response, data };
}

function renderServices(seatTypes) {
  const list = document.querySelector('#services-list');
  list.replaceChildren();
  seatTypes.forEach((seat, index) => {
    const visual = serviceVisuals[seat.slug] ?? {};
    const card = el('article', 'service');
    const image = el('div', 'service-image');
    if (visual.image) image.style.backgroundImage = `url("${visual.image}")`;
    const content = el('div', 'service-content');
    content.append(el('span', 'service-index', `${String(index + 1).padStart(2, '0')} / ${visual.label ?? 'PUESTO'}`));
    content.append(el('h3', '', seat.name));
    content.append(el('p', '', seat.description));
    const specs = Object.entries(seat.specs ?? {}).map(([key, value]) => `${key}: ${value}`).join(' · ');
    if (specs) content.append(el('p', '', specs));
    const rate = seat.hourlyPriceCents === null ? 'Tarifa por confirmar' : `${price(seat.hourlyPriceCents)} / h`;
    content.append(el('p', 'service-rate', `${rate} · ${seat.capacity} puestos`));
    card.append(image, content);
    list.append(card);
  });
}

function renderNews(posts) {
  const list = document.querySelector('#newsList');
  list.replaceChildren();
  if (!posts.length) {
    list.append(el('p', 'news-empty', 'Todavía no hay noticias publicadas.'));
    return;
  }
  posts.forEach((post) => {
    const card = el('article', 'news-card');
    if (post.imageUrl) {
      const image = el('img', 'news-media');
      image.src = post.imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      card.append(image);
    }
    const content = el('div', 'news-content');
    content.append(el('span', 'news-date', dateLabel(post.publishedAt?.slice(0, 10) ?? madridToday())));
    content.append(el('h3', '', post.title));
    content.append(el('p', '', post.excerpt));
    const details = el('details', 'news-read-more');
    details.append(el('summary', '', 'Leer noticia'), el('p', '', post.body));
    content.append(details);
    card.append(content);
    list.append(card);
  });
}

function renderRates(seatTypes, pricingRules) {
  const table = document.querySelector('#rateTable');
  table.replaceChildren();
  seatTypes.forEach((seat) => {
    const row = el('div', 'rate-row');
    const description = Object.values(seat.specs ?? {}).join(' · ') || `${seat.capacity} puestos`;
    row.append(el('div', '', seat.name), el('div', '', description));
    const total = el('div', 'rate-price');
    total.append(document.createTextNode(seat.hourlyPriceCents === null ? 'Consultar ' : `${price(seat.hourlyPriceCents)} `));
    total.append(el('small', '', '/ hora'));
    row.append(total);
    table.append(row);
  });
  pricingRules.forEach((rule) => {
    const row = el('div', 'rate-row rate-extra-row');
    row.append(el('div', '', rule.label));
    row.append(el('div', '', rule.kind === 'pack' ? `${rule.durationHours} horas` : `${rule.startsAt}–${rule.endsAt}`));
    const value = rule.kind === 'pack' ? price(rule.priceCents) : `${rule.priceCents}% dto.`;
    row.append(el('div', 'rate-price', value));
    table.append(row);
  });
}

function renderTournamentSignup(tournament) {
  const button = el('button', 'button button-small signup-button', 'Inscribirme ↗');
  button.type = 'button';
  button.addEventListener('click', () => {
    document.querySelector('#signupTournament').value = tournament.slug;
    document.querySelector('#signupTitle').textContent = tournament.title;
    document.querySelector('#signupMessage').textContent = '';
    document.querySelector('#signupBackdrop').classList.add('open');
    document.querySelector('#signupName').focus();
  });
  return button;
}

function renderTournaments(tournaments) {
  const list = document.querySelector('#tournamentList');
  list.replaceChildren();
  if (!tournaments.length) {
    list.append(el('div', 'staff-empty', 'No hay torneos abiertos en este momento.'));
    return;
  }
  tournaments.forEach((tournament) => {
    const row = el('article', 'tournament');
    const title = el('div');
    title.append(el('span', 'tag', 'Inscripción abierta'));
    title.append(el('h3', '', tournament.title));
    title.append(el('p', '', `${tournament.game} · ${tournament.format}`));
    const meta = el('div', 'tournament-meta');
    meta.append(document.createTextNode(`${dateLabel(tournament.startsOn)} · ${tournament.startsAt}`));
    meta.append(el('p', '', `${tournament.registeredCount}/${tournament.capacity} inscritos · ${tournament.waitlistCount} en espera`));
    const prize = el('div', 'tournament-meta', tournament.prize || `Inscripción: ${price(tournament.entryFeeCents)}`);
    row.append(title, meta, prize, renderTournamentSignup(tournament));
    list.append(row);
  });
}

function renderCompetitiveRanking(players) {
  const body = document.querySelector('#rankingBody');
  body.replaceChildren();
  if (!players.length) {
    const row = el('tr');
    const cell = el('td', 'rank-empty', 'Aún no hay jugadores en el ranking.');
    cell.colSpan = 3;
    row.append(cell);
    body.append(row);
    return;
  }
  players.slice(0, 10).forEach((player, index) => {
    const row = el('tr');
    row.append(el('td', '', String(index + 1).padStart(2, '0')));
    row.append(el('td', 'rank-name', player.gamertag));
    row.append(el('td', '', `${player.points} pts`));
    body.append(row);
  });
}

function renderSpenders(players) {
  const body = document.querySelector('#spendersBody');
  body.replaceChildren();
  if (!players.length) {
    const row = el('tr');
    const cell = el('td', 'rank-empty', 'Completa una sesión para aparecer en el Top.');
    cell.colSpan = 3;
    row.append(cell);
    body.append(row);
    return;
  }
  players.forEach((player, index) => {
    const row = el('tr');
    row.append(el('td', '', String(index + 1).padStart(2, '0')));
    row.append(el('td', 'rank-name', player.displayName));
    row.append(el('td', '', `${player.points} pts`));
    body.append(row);
  });
}

function renderApprovedIdeas(ideas) {
  const list = document.querySelector('#approvedIdeas');
  list.replaceChildren();
  if (!ideas.length) {
    list.append(el('p', 'rank-empty', 'Las ideas aprobadas aparecerán aquí.'));
    return;
  }
  ideas.forEach((idea) => {
    const card = el('article', 'approved-idea');
    card.append(el('small', '', `IDEA DE ${idea.author.toUpperCase()}`));
    card.append(el('h3', '', idea.title), el('p', '', idea.description));
    if (idea.moderationNote) card.append(el('p', 'approved-response', `Respuesta: ${idea.moderationNote}`));
    list.append(card);
  });
}

function fillAccount(member) {
  document.querySelector('#clientAuthForms').hidden = true;
  document.querySelector('#clientSignedIn').hidden = false;
  document.querySelector('#suggestionForm').hidden = false;
  document.querySelector('#clientIdentity').textContent = `${member.displayName} · ${member.role}`;
  document.querySelector('#rewardBalance').textContent = `${member.points} puntos · ${member.completedVisits} sesiones completadas`;
}

async function initCommunity() {
  document.querySelector('#clientLogout').addEventListener('click', async () => {
    try {
      await jsonRequest('/api/members/logout', { method: 'POST', csrf: true });
    } finally {
      csrfToken = '';
      document.querySelector('#clientSignedIn').hidden = true;
      document.querySelector('#suggestionForm').hidden = true;
      document.querySelector('#clientAuthForms').hidden = false;
      await syncMemberAccessLink(document.querySelector('#member-access-link'));
    }
  });

  document.querySelector('#suggestionForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.querySelector('#suggestionMessage');
    message.textContent = 'Enviando para revisión…';
    try {
      const { response, data } = await jsonRequest('/api/members/ideas', {
        method: 'POST',
        body: Object.fromEntries(new FormData(form).entries()),
        csrf: true,
      });
      if (!response.ok) throw new Error(data.error ?? 'No se pudo enviar la propuesta.');
      form.reset();
      message.textContent = 'Propuesta enviada para moderación.';
    } catch (error) {
      message.textContent = error.message;
    }
  });

  const session = await jsonRequest('/api/members/session');
  if (session.data.status === 'banned') {
    renderMemberBanGate(session.data.member, session.data.csrfToken, session.data.appeal);
    return true;
  }
  if (session.response.ok) {
    csrfToken = session.data.csrfToken;
    fillAccount(session.data.member);
  }
  return false;
}

function initBooking(seatTypes) {
  const form = document.querySelector('#bookingForm');
  const type = document.querySelector('#bookingType');
  const date = document.querySelector('#bookingDate');
  const time = document.querySelector('#bookingTime');
  const duration = document.querySelector('#bookingDuration');
  const availability = document.querySelector('#availability');
  const submit = document.querySelector('#bookingSubmit');
  const confirmation = document.querySelector('#bookingConfirmation');
  const today = madridToday();
  date.min = today;
  date.value = today;
  seatTypes.forEach((seat) => {
    const option = el('option', '', seat.name);
    option.value = seat.slug;
    type.append(option);
  });

  const updateAvailability = async () => {
    availability.className = 'availability';
    availability.textContent = 'Comprobando disponibilidad…';
    submit.disabled = true;
    submit.textContent = 'Comprobando…';
    time.disabled = true;
    const query = new URLSearchParams({ seatType: type.value, date: date.value, durationHours: duration.value });
    try {
      const { response, data } = await jsonRequest(`/api/availability?${query}`);
      if (!response.ok) throw new Error(data.error ?? 'No se pudo comprobar el aforo.');
      time.replaceChildren();
      bookingSlots = data.slots;
      const availableSlots = data.slots.filter((slot) => slot.available);
      data.slots.forEach((slot) => {
        const option = el('option', '', `${slot.startTime} · ${slot.available ? `${slot.remaining} libres · ${price(slot.totalCents)}` : 'Sin plazas'}`);
        option.value = slot.startTime;
        option.disabled = !slot.available;
        time.append(option);
      });
      if (!data.slots.length) {
        time.append(el('option', '', data.message ?? 'Sin horas disponibles'));
        availability.classList.add('bad');
        availability.textContent = data.message ?? 'No hay horas disponibles para esa fecha.';
        return;
      }
      time.disabled = false;
      if (availableSlots.length) {
        availability.classList.add('good');
        availability.textContent = `${availableSlots.length} franjas con plazas disponibles.`;
        submit.disabled = false;
        submit.textContent = 'Confirmar reserva';
      } else {
        availability.classList.add('bad');
        availability.textContent = 'No quedan puestos para esa duración.';
      }
    } catch (error) {
      availability.classList.add('bad');
      availability.textContent = error.message;
    }
  };

  [type, date, duration].forEach((control) => control.addEventListener('change', updateAvailability));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    values.durationHours = Number(values.durationHours);
    values.consent = form.elements.consent.checked;
    const memberResponse = await jsonRequest('/api/members/session');
    if (memberResponse.response.ok) values.memberId = memberResponse.data.member.id;
    const slot = bookingSlots.find((item) => item.startTime === values.startTime);
    const { response, data } = await jsonRequest('/api/reservations', { method: 'POST', body: values });
    if (!response.ok) {
      availability.classList.add('bad');
      availability.textContent = data.error ?? 'No se pudo guardar la reserva.';
      return;
    }
    confirmation.hidden = false;
    confirmation.replaceChildren(
      el('strong', '', 'Reserva registrada'),
      el('code', '', data.code),
      el('p', '', `${data.seatType} · ${dateLabel(data.date)} · ${data.startTime} · ${data.durationHours} h · ${price(data.totalCents)}`),
      el('p', '', 'El email está simulado en este entorno. Copia el código y el token para cancelar si lo necesitas.'),
    );
    document.querySelector('#cancelBookingCode').value = data.code;
    document.querySelector('#cancelBookingToken').value = data.cancellationToken;
    availability.classList.add('good');
    availability.textContent = 'Reserva creada y guardada.';
    submit.disabled = true;
    submit.textContent = 'Reserva registrada';
    await updateAvailability();
  });
  jsonRequest('/api/members/session').then(({ response, data }) => {
    if (!response.ok || data.status === 'banned') return;
    if (!form.elements.customerName.value) form.elements.customerName.value = data.member.displayName;
    if (!form.elements.customerEmail.value) form.elements.customerEmail.value = data.member.email;
  }).catch(() => {});
  updateAvailability();
}

function initCancellation() {
  const form = document.querySelector('#cancelBookingForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.querySelector('#cancelBookingStatus');
    const { response, data } = await jsonRequest('/api/reservations/cancel', {
      method: 'POST',
      body: Object.fromEntries(new FormData(form).entries()),
    });
    status.className = `availability ${response.ok ? 'good' : 'bad'}`;
    status.textContent = response.ok ? `Reserva ${data.code} cancelada.` : data.error;
  });
}

function initTournamentSignup() {
  const backdrop = document.querySelector('#signupBackdrop');
  document.querySelector('#signupClose').addEventListener('click', () => backdrop.classList.remove('open'));
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) backdrop.classList.remove('open');
  });
  document.querySelector('#signupForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    values.acceptedRules = form.elements.acceptedRules.checked;
    const { response, data } = await jsonRequest(`/api/tournaments/${encodeURIComponent(values.tournamentSlug)}/register`, { method: 'POST', body: values });
    const message = document.querySelector('#signupMessage');
    if (!response.ok) {
      message.textContent = data.error ?? 'No se pudo completar la inscripción.';
      return;
    }
    message.textContent = data.status === 'waitlisted' ? 'Aforo completo: te hemos añadido a la lista de espera.' : 'Inscripción confirmada.';
    notify(message.textContent);
    setTimeout(() => { backdrop.classList.remove('open'); renderTournaments(publicData.tournaments); }, 1400);
  });
}

function renderLocation(business) {
  document.querySelector('#business-display').textContent = business.name;
  document.querySelector('#business-address').textContent = business.address;
  document.querySelector('#business-email').textContent = business.email;
  document.querySelector('#business-email').href = `mailto:${business.email}`;
  const map = new URL('https://www.openstreetmap.org/search');
  map.searchParams.set('query', business.address);
  document.querySelector('#business-map').href = map.href;
  document.querySelector('#footer-brand').textContent = business.name.toUpperCase();
  document.querySelector('#footer-business').textContent = business.name;
  document.querySelector('#year').textContent = String(new Date().getFullYear());
  document.title = `${business.name} — Gaming social`;
  document.querySelector('#business-schema').textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: business.name,
    description: 'Local gaming con puestos de PC, consolas, simulador y zona retro.',
    address: { '@type': 'PostalAddress', streetAddress: business.address, addressCountry: 'ES' },
    telephone: business.phone,
    email: business.email,
  });
}

async function start() {
  document.body.classList.add('auth-checking');
  if (await enforceMemberBanGate()) return;
  const response = await fetch('/api/public', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('No se pudo cargar el contenido del local.');
  publicData = await response.json();
  document.body.classList.remove('auth-checking');
  renderLocation(publicData.business);
  renderServices(publicData.seatTypes);
  renderNews(publicData.news ?? []);
  renderRates(publicData.seatTypes, publicData.pricingRules);
  renderTournaments(publicData.tournaments);
  renderCompetitiveRanking(publicData.leaderboard);
  renderSpenders(publicData.topSpenders ?? []);
  renderApprovedIdeas(publicData.ideas ?? []);
  initBooking(publicData.seatTypes);
  initCancellation();
  initTournamentSignup();
  await initCommunity();
  await syncMemberAccessLink(document.querySelector('#member-access-link'));
  document.querySelector('#menuToggle').addEventListener('click', (event) => {
    const button = event.currentTarget;
    const menu = document.querySelector('#navLinks');
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!open));
    menu.classList.toggle('open', !open);
  });
  document.querySelectorAll('#navLinks a').forEach((link) => link.addEventListener('click', () => {
    document.querySelector('#navLinks').classList.remove('open');
    document.querySelector('#menuToggle').setAttribute('aria-expanded', 'false');
  }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.querySelector('#navLinks').classList.remove('open');
      document.querySelector('#menuToggle').setAttribute('aria-expanded', 'false');
      document.querySelector('#signupBackdrop').classList.remove('open');
    }
  });
}

start().catch((error) => {
  document.body.classList.remove('auth-checking');
  const notice = document.querySelector('#notice');
  if (notice) notify(error.message);
});
