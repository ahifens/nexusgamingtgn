import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/src/app.js';
import { hashStaffPassword } from '../server/src/admin-auth.js';
import { createDatabase } from '../server/src/db/connection.js';
import { migrateDatabase } from '../server/src/db/migrate.js';
import { seedDatabase } from '../server/src/db/seed.js';

let database;
let server;
let baseUrl;

async function jsonRequest(path, { method = 'GET', body, cookie, csrfToken } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  return { response, data };
}

beforeEach(async () => {
  database = createDatabase(':memory:');
  migrateDatabase(database);
  seedDatabase(database);
  database.prepare(`
    INSERT INTO staff_users (username, password_hash, role)
    VALUES (?, ?, 'administrator')
  `).run('equipo', hashStaffPassword('Clave-larga-de-prueba-2026'));
  server = createApp(database).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  database.close();
});

describe('panel de noticias', () => {
  it('exige sesión y CSRF antes de publicar noticias', async () => {
    const unauthenticated = await jsonRequest('/api/admin/news');
    expect(unauthenticated.response.status).toBe(401);

    const login = await jsonRequest('/api/admin/login', {
      method: 'POST',
      body: { username: 'equipo', password: 'Clave-larga-de-prueba-2026' },
    });
    expect(login.response.status).toBe(200);
    const cookie = login.response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const csrfToken = login.data.csrfToken;

    const csrfBlocked = await jsonRequest('/api/admin/news', {
      method: 'POST',
      cookie,
      body: { title: 'Torneo de otoño', excerpt: 'Inscripciones abiertas para el torneo.', body: 'Las plazas ya están disponibles para todas las personas interesadas.', imageUrl: '', status: 'published' },
    });
    expect(csrfBlocked.response.status).toBe(403);

    const published = await jsonRequest('/api/admin/news', {
      method: 'POST',
      cookie,
      csrfToken,
      body: { title: 'Torneo de otoño', excerpt: 'Inscripciones abiertas para el torneo.', body: 'Las plazas ya están disponibles para todas las personas interesadas.', imageUrl: '', status: 'published' },
    });
    expect(published.response.status).toBe(201);
    expect(published.data.news.slug).toBe('torneo-de-otono');

    const publicData = await jsonRequest('/api/public');
    expect(publicData.data.news[0].title).toBe('Torneo de otoño');
  });

  it('gestiona torneos con permisos de administrador y publica resultados', async () => {
    const login = await jsonRequest('/api/admin/login', {
      method: 'POST',
      body: { username: 'equipo', password: 'Clave-larga-de-prueba-2026' },
    });
    const cookie = login.response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const csrfToken = login.data.csrfToken;
    const startsOn = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const tournamentInput = {
      title: 'Copa HTTP',
      game: 'Juego de prueba',
      startsOn,
      startsAt: '18:00',
      format: 'Eliminatoria',
      capacity: 8,
      entryFeeCents: 500,
      prize: 'Premio demo',
      rules: 'Normas de prueba',
      status: 'open',
    };

    const created = await jsonRequest('/api/admin/tournaments', {
      method: 'POST', cookie, csrfToken, body: tournamentInput,
    });
    expect(created.response.status).toBe(201);
    expect(created.data.tournament.slug).toBe('copa-http');

    const updated = await jsonRequest(`/api/admin/tournaments/${created.data.tournament.id}`, {
      method: 'PUT', cookie, csrfToken,
      body: { ...tournamentInput, title: 'Copa HTTP Editada' },
    });
    expect(updated.data.tournament.title).toBe('Copa HTTP Editada');

    const entry = await jsonRequest(`/api/tournaments/${created.data.tournament.slug}/register`, {
      method: 'POST',
      body: { name: 'Piloto Demo', gamertag: 'PilotoHTTP', email: 'piloto@example.test', phone: '+34600123456', acceptedRules: true },
    });
    expect(entry.response.status).toBe(201);
    expect(entry.data.status).toBe('registered');

    const results = await jsonRequest(`/api/admin/tournaments/${created.data.tournament.id}/results`, {
      method: 'POST', cookie, csrfToken,
      body: { results: [{ gamertag: 'PilotoHTTP', placement: 1, points: 100 }] },
    });
    expect(results.data.status).toBe('completed');
    const publicData = await jsonRequest('/api/public');
    expect(publicData.data.leaderboard.find((player) => player.gamertag === 'PilotoHTTP')).toMatchObject({ points: 100, wins: 1 });
  });

  it('completa reservas para sumar puntos y permite asignar roles de comunidad', async () => {
    const member = await jsonRequest('/api/members/register', {
      method: 'POST',
      body: { displayName: 'Cliente Panel', email: 'cliente-panel@example.test', password: 'Clave-segura-1234', consent: true },
    });
    const memberCookie = member.response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const date = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const reservation = await jsonRequest('/api/reservations', {
      method: 'POST',
      cookie: memberCookie,
      body: {
        seatType: 'pc-gaming', date, startTime: '12:00', durationHours: 2,
        customerName: 'Cliente Panel', customerEmail: 'cliente-panel@example.test',
        customerPhone: '+34600123456', consent: true, website: '',
      },
    });
    expect(reservation.response.status).toBe(201);

    const staffLogin = await jsonRequest('/api/admin/login', {
      method: 'POST',
      body: { username: 'equipo', password: 'Clave-larga-de-prueba-2026' },
    });
    const staffCookie = staffLogin.response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const staffCsrf = staffLogin.data.csrfToken;
    const listed = await jsonRequest('/api/admin/reservations', { cookie: staffCookie });
    const storedReservation = listed.data.reservations.find((item) => item.code === reservation.data.code);

    const completed = await jsonRequest(`/api/admin/reservations/${storedReservation.id}/status`, {
      method: 'PATCH', cookie: staffCookie, csrfToken: staffCsrf, body: { status: 'completed' },
    });
    expect(completed.data.status).toBe('completed');

    const roles = await jsonRequest('/api/admin/members', { cookie: staffCookie });
    const publicMember = roles.data.members.find((item) => item.email === 'cliente-panel@example.test');
    const assigned = await jsonRequest(`/api/admin/members/${publicMember.id}/role`, {
      method: 'PUT', cookie: staffCookie, csrfToken: staffCsrf, body: { role: 'moderator' },
    });
    expect(assigned.data.role).toBe('moderator');

    const community = await jsonRequest('/api/public');
    expect(community.data.topSpenders[0]).toMatchObject({ displayName: 'Cliente Panel', points: 100 });
  });
});
