import './style.css';
import './visual-refresh.css';
import { businessConfig, serviceVisuals, weekdayNames } from './config/business.js';
import { enforceMemberBanGate, syncMemberAccessLink } from './member-gate.js';

const euro = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
});

function node(tagName, className = '', text = '') {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function formatPrice(cents) {
  return euro.format(cents / 100);
}

function formatDate(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`);
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: businessConfig.timeZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(date).replace('.', '').toUpperCase();
}

function renderServices(seatTypes) {
  const list = document.querySelector('#services-list');
  list.replaceChildren();

  seatTypes.forEach((seat, index) => {
    const visual = serviceVisuals[seat.slug] ?? {
      number: String(index + 1).padStart(2, '0'),
      label: 'PUESTO DISPONIBLE',
      image: '',
      alt: seat.name,
    };
    const card = node('article', 'service-card');
    const figure = node('figure', 'service-image');
    const image = node('img');
    image.src = visual.image;
    image.alt = visual.alt;
    image.loading = 'lazy';
    figure.append(image);
    figure.append(node('span', 'service-number', visual.number));
    const content = node('div', 'service-copy');
    content.append(node('p', 'service-kicker', visual.label));
    content.append(node('h3', '', seat.name));
    content.append(node('p', 'service-description', seat.description));
    const specs = Object.entries(seat.specs ?? {}).map(([label, value]) => `${label}: ${value}`);
    if (specs.length) content.append(node('p', 'service-specs', specs.join(' · ')));
    const capacity = seat.capacity === 1 ? '1 puesto' : `${seat.capacity} puestos`;
    content.append(node('span', 'service-capacity', capacity));
    card.append(figure, content);
    list.append(card);
  });
}

function renderRates(seatTypes, pricingRules) {
  const hourlyRates = document.querySelector('#hourly-rates');
  const extraRates = document.querySelector('#extra-rates');
  hourlyRates.replaceChildren();
  extraRates.replaceChildren();

  seatTypes.forEach((seat) => {
    const row = node('div', 'rate-row');
    const label = node('div', 'rate-name');
    label.append(node('strong', '', seat.name));
    label.append(node('span', '', `${seat.capacity} puestos`));
    row.append(label);
    row.append(node('span', 'rate-price', seat.hourlyPriceCents === null ? 'Consultar' : formatPrice(seat.hourlyPriceCents)));
    row.append(node('span', 'rate-unit', '/ hora'));
    hourlyRates.append(row);
  });

  pricingRules.forEach((rule) => {
    const row = node('div', 'extra-rate-row');
    row.append(node('strong', '', rule.label));
    const detail = rule.kind === 'pack'
      ? `${rule.durationHours} horas · ${formatPrice(rule.priceCents)}`
      : `${rule.priceCents}% · ${rule.startsAt}–${rule.endsAt}`;
    row.append(node('span', '', detail));
    extraRates.append(row);
  });
}

function renderTournaments(tournaments, email) {
  const list = document.querySelector('#tournament-list');
  list.replaceChildren();

  if (!tournaments.length) {
    list.append(node('p', 'empty-state', 'Todavía no hay torneos anunciados. Vuelve pronto para ver las próximas fechas.'));
    return;
  }

  tournaments.forEach((tournament, index) => {
    const item = node('article', 'tournament-item');
    const date = node('div', 'tournament-date');
    date.append(node('span', '', formatDate(tournament.startsOn)));
    date.append(node('strong', '', tournament.startsAt));
    const details = node('div', 'tournament-details');
    details.append(node('p', 'tournament-game', tournament.game));
    details.append(node('h3', '', tournament.title));
    details.append(node('p', 'tournament-meta', `${tournament.format} · ${tournament.registeredCount}/${tournament.capacity} plazas`));
    const prize = node('div', 'tournament-prize');
    prize.append(node('span', '', index === 0 ? 'PREMIO' : 'INSCRIPCIÓN'));
    prize.append(node('strong', '', index === 0 ? tournament.prize : formatPrice(tournament.entryFeeCents)));
    const action = node('a', 'tournament-link', 'Consultar plaza');
    action.href = `mailto:${email}?subject=${encodeURIComponent(`Inscripción: ${tournament.title}`)}`;
    action.setAttribute('aria-label', `Consultar plaza para ${tournament.title}`);
    item.append(date, details, prize, action);
    list.append(item);
  });
}

function renderLeaderboard(players) {
  const list = document.querySelector('#leaderboard');
  list.replaceChildren();

  if (!players.length) {
    list.append(node('li', 'empty-state', 'Aún no hay resultados publicados.'));
    return;
  }

  players.forEach((player, index) => {
    const item = node('li', 'leaderboard-row');
    item.append(node('span', 'leaderboard-rank', String(index + 1).padStart(2, '0')));
    const identity = node('span', 'leaderboard-player');
    identity.append(node('strong', '', player.gamertag));
    identity.append(node('small', '', `${player.wins} ${player.wins === 1 ? 'victoria' : 'victorias'}`));
    item.append(identity);
    item.append(node('strong', 'leaderboard-points', String(player.points)));
    list.append(item);
  });
}

function renderNews(posts) {
  const list = document.querySelector('#news-list');
  list.replaceChildren();

  if (!posts.length) {
    list.append(node('p', 'empty-state', 'Todavía no hay noticias publicadas. Vuelve pronto para ver las novedades del local.'));
    return;
  }

  posts.forEach((post, index) => {
    const article = node('article', 'news-card');
    if (post.imageUrl) {
      const image = node('img');
      image.src = post.imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      article.append(image);
    }
    const content = node('div', 'news-card-copy');
    const publishedAt = post.publishedAt ? new Date(`${post.publishedAt.replace(' ', 'T')}Z`) : new Date();
    content.append(node('p', 'news-date', new Intl.DateTimeFormat('es-ES', {
      timeZone: businessConfig.timeZone,
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(publishedAt)));
    content.append(node('h3', '', post.title));
    content.append(node('p', 'news-excerpt', post.excerpt));
    const fullStory = node('details', 'news-readmore');
    fullStory.append(node('summary', '', 'Leer noticia'));
    fullStory.append(node('p', '', post.body));
    content.append(fullStory);
    article.append(content, node('span', 'news-index', String(index + 1).padStart(2, '0')));
    list.append(article);
  });
}

function madridToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: businessConfig.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function renderHours(openingHours) {
  const list = document.querySelector('#opening-hours');
  list.replaceChildren();

  openingHours.forEach((hours) => {
    const item = node('li');
    item.append(node('span', '', weekdayNames[hours.weekday]));
    item.append(node('span', '', hours.isClosed ? 'Cerrado' : `${hours.opensAt}–${hours.closesAt}`));
    list.append(item);
  });
}

function renderBusiness(business, openingHours) {
  const name = business.name || businessConfig.displayName;
  const phone = business.phone || businessConfig.phonePlaceholder;
  const email = business.email || businessConfig.emailPlaceholder;
  const address = business.address || businessConfig.addressPlaceholder;
  const digits = phone.replace(/\D/g, '');

  document.querySelector('#brand-name').textContent = name.toUpperCase();
  document.querySelector('#footer-brand-name').textContent = name.toUpperCase();
  document.querySelector('#footer-business-name').textContent = name;
  document.querySelector('#business-address').textContent = address;
  document.querySelector('#phone-link').textContent = phone;
  document.querySelector('#phone-link').href = `tel:${digits}`;
  document.querySelector('#email-link').textContent = email;
  document.querySelector('#email-link').href = `mailto:${email}`;

  const map = new URL('https://maps.google.com/');
  map.searchParams.set('q', address);
  document.querySelector('#map-link').href = map.href;
  document.querySelector('#current-year').textContent = String(new Date().getFullYear());
  document.title = `${name} | Juego en local, compite en serio`;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name,
    description: 'Local gaming con puestos de PC, consolas, simulador y zona retro.',
    address: {
      '@type': 'PostalAddress',
      streetAddress: address,
      addressCountry: 'ES',
    },
    telephone: phone,
    email,
    openingHoursSpecification: openingHours.filter((hours) => !hours.isClosed).map((hours) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: weekdayNames[hours.weekday],
      opens: hours.opensAt,
      closes: hours.closesAt,
    })),
  };
  document.querySelector('#business-schema').textContent = JSON.stringify(schema);
}

function setupBookingForm(seatTypes) {
  const form = document.querySelector('#booking-form');
  const seatSelect = document.querySelector('#booking-seat');
  const dateInput = document.querySelector('#booking-date');
  const durationSelect = document.querySelector('#booking-duration');
  const timeSelect = document.querySelector('#booking-time');
  const message = document.querySelector('#booking-message');
  const confirmation = document.querySelector('#booking-confirmation');
  const price = document.querySelector('#booking-price');

  seatTypes.forEach((seat) => {
    const option = node('option', '', seat.name);
    option.value = seat.slug;
    seatSelect.append(option);
  });
  dateInput.min = madridToday();
  dateInput.value = dateInput.min;

  async function loadAvailability() {
    message.textContent = 'Comprobando plazas…';
    price.textContent = '—';
    timeSelect.replaceChildren(node('option', '', 'Consultando disponibilidad…'));
    timeSelect.disabled = true;

    const query = new URLSearchParams({
      seatType: seatSelect.value,
      date: dateInput.value,
      durationHours: durationSelect.value,
    });

    try {
      const response = await fetch(`/api/availability?${query}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'No se pudo consultar la disponibilidad.');

      timeSelect.replaceChildren();
      if (!data.slots.length) {
        timeSelect.append(node('option', '', data.message ?? 'No hay horas disponibles'));
        message.textContent = data.message ?? 'No hay horas disponibles para esa duración.';
        return;
      }

      data.slots.forEach((slot) => {
        const status = slot.available ? `${slot.remaining} libres · ${formatPrice(slot.totalCents)}` : 'Sin plazas';
        const option = node('option', '', `${slot.startTime} · ${status}`);
        option.value = slot.startTime;
        option.disabled = !slot.available;
        option.dataset.totalCents = String(slot.totalCents);
        timeSelect.append(option);
      });
      timeSelect.disabled = false;
      updatePrice();
      message.textContent = 'Disponibilidad consultada. La plaza se confirma al completar la reserva.';
    } catch (error) {
      timeSelect.replaceChildren(node('option', '', 'No disponible'));
      message.textContent = error.message;
    }
  }

  function updatePrice() {
    const selected = timeSelect.selectedOptions[0];
    price.textContent = selected?.dataset.totalCents
      ? formatPrice(Number(selected.dataset.totalCents))
      : '—';
  }

  seatSelect.addEventListener('change', loadAvailability);
  dateInput.addEventListener('change', loadAvailability);
  durationSelect.addEventListener('change', loadAvailability);
  timeSelect.addEventListener('change', updatePrice);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const input = Object.fromEntries(values.entries());
    input.durationHours = Number(input.durationHours);
    input.consent = form.elements.consent.checked;
    message.textContent = 'Guardando tu reserva…';
    confirmation.replaceChildren();
    confirmation.hidden = true;

    try {
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'No se pudo completar la reserva.');

      message.textContent = 'Reserva guardada. Estado: pendiente de confirmación.';
      confirmation.append(node('p', 'confirmation-kicker', 'RESERVA REGISTRADA'));
      confirmation.append(node('h3', '', result.code));
      confirmation.append(node('p', '', `${result.seatType} · ${formatDate(result.date)} · ${result.startTime} · ${result.durationHours} h`));
      confirmation.append(node('strong', 'confirmation-price', formatPrice(result.totalCents)));
      const cancelDetails = document.querySelector('#cancel-reservation');
      const cancelForm = document.querySelector('#cancel-form');
      cancelForm.elements.code.value = result.code;
      cancelForm.elements.token.value = result.cancellationToken;
      cancelDetails.open = true;
      confirmation.append(node('p', 'confirmation-note', 'Guarda el código y el token del apartado de cancelación. El email de confirmación está simulado en este entorno.'));
      confirmation.hidden = false;
      await loadAvailability();
    } catch (error) {
      message.textContent = error.message;
    }
  });

  document.querySelector('#cancel-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const cancelMessage = document.querySelector('#cancel-message');
    const values = new FormData(event.currentTarget);
    cancelMessage.textContent = 'Procesando cancelación…';

    try {
      const response = await fetch('/api/reservations/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(Object.fromEntries(values.entries())),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'No se pudo cancelar la reserva.');
      cancelMessage.textContent = `La reserva ${result.code} se ha cancelado.`;
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

function setupNavigation() {
  const toggle = document.querySelector('#menu-toggle');
  const navigation = document.querySelector('#main-nav');

  function closeMenu() {
    toggle.setAttribute('aria-expanded', 'false');
    navigation.classList.remove('is-open');
  }

  toggle.addEventListener('click', () => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!isOpen));
    navigation.classList.toggle('is-open', !isOpen);
  });
  navigation.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
}

document.body.classList.add('auth-checking');
if (!await enforceMemberBanGate()) {
  await syncMemberAccessLink(document.querySelector('#member-access-link'));
  setupNavigation();

  try {
    const response = await fetch('/api/public', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('No se pudo cargar el contenido público.');

    const data = await response.json();
    renderBusiness(data.business, data.openingHours);
    renderServices(data.seatTypes);
    renderRates(data.seatTypes, data.pricingRules);
    renderTournaments(data.tournaments, data.business.email);
    renderLeaderboard(data.leaderboard);
    renderNews(data.news ?? []);
    renderHours(data.openingHours);
    setupBookingForm(data.seatTypes);
    document.querySelector('#data-status').textContent = 'Tarifas actualizadas desde la base de datos.';
  } catch {
    document.querySelector('#data-status').textContent = 'No se pudieron cargar las tarifas, torneos y ranking. Inténtalo más tarde.';
    document.querySelector('#services-list').append(node('p', 'empty-state', 'El contenido no está disponible en este momento.'));
  }
}