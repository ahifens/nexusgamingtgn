import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/src/app.js';
import { createDatabase } from '../server/src/db/connection.js';
import { migrateDatabase } from '../server/src/db/migrate.js';
import { seedDatabase } from '../server/src/db/seed.js';

let database;
let server;
let baseUrl;

async function request(path, { method = 'GET', body, cookie, csrfToken } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { response, data: await response.json() };
}

function sessionCookies(response) {
  return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
}

beforeEach(async () => {
  database = createDatabase(':memory:');
  migrateDatabase(database);
  seedDatabase(database);
  server = createApp(database).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  database.close();
});

describe('cuentas, puntos y sugerencias', () => {
  it('registra usuarios, atribuye puntos por euros completados y modera ideas por rol', async () => {
    const registration = await request('/api/members/register', {
      method: 'POST',
      body: {
        displayName: 'Jugadora Demo',
        email: 'jugadora@example.test',
        password: 'Clave-segura-1234',
        consent: true,
      },
    });
    expect(registration.response.status).toBe(201);
    expect(registration.data.member).toMatchObject({ role: 'user', points: 0, spendCents: 0 });
    const cookie = sessionCookies(registration.response);
    const csrfToken = registration.data.csrfToken;

    const deniedSuggestion = await request('/api/members/ideas', {
      method: 'POST',
      cookie,
      body: { title: 'Más tardes retro', description: 'Propongo reservar una tarde al mes para jugar a títulos clásicos en grupo.' },
    });
    expect(deniedSuggestion.response.status).toBe(403);

    const availability = await request(`/api/availability?seatType=pc-gaming&date=${futureDate()}&durationHours=2`);
    expect(availability.response.status).toBe(200);
    const reservation = await request('/api/reservations', {
      method: 'POST',
      cookie,
      body: {
        seatType: 'pc-gaming',
        date: futureDate(),
        startTime: '12:00',
        durationHours: 2,
        customerName: 'Jugadora Demo',
        customerEmail: 'jugadora@example.test',
        customerPhone: '+34600123456',
        consent: true,
        website: '',
      },
    });
    expect(reservation.response.status).toBe(201);

    database.prepare("UPDATE reservations SET status = 'completed' WHERE code = ?").run(reservation.data.code);
    const publicData = await request('/api/public');
    expect(publicData.data.topSpenders[0]).toMatchObject({ displayName: 'Jugadora Demo', points: 100, completedVisits: 1 });
    expect(publicData.data.topSpenders[0]).not.toHaveProperty('spendCents');

    const suggestion = await request('/api/members/ideas', {
      method: 'POST',
      cookie,
      csrfToken,
      body: { title: 'Más tardes retro', description: 'Propongo reservar una tarde al mes para jugar a títulos clásicos en grupo.' },
    });
    expect(suggestion.response.status).toBe(201);

    const memberId = registration.data.member.id;
    database.prepare("UPDATE members SET role = 'moderator' WHERE id = ?").run(memberId);
    const moderationQueue = await request('/api/members/ideas', { cookie });
    expect(moderationQueue.response.status).toBe(200);
    expect(moderationQueue.data.ideas).toHaveLength(1);

    const approved = await request(`/api/members/ideas/${suggestion.data.id}`, {
      method: 'PATCH',
      cookie,
      csrfToken,
      body: { status: 'approved', moderationNote: 'Buena propuesta.' },
    });
    expect(approved.response.status).toBe(200);

    const visibleIdeas = await request('/api/public');
    expect(visibleIdeas.data.ideas[0]).toMatchObject({ title: 'Más tardes retro', author: 'Jugadora Demo' });
  });

  it('bloquea a una cuenta baneada salvo consultar estado, apelar y cerrar sesión', async () => {
    const registration = await request('/api/members/register', {
      method: 'POST',
      body: { displayName: 'Cuenta Baneada', email: 'baneada@example.test', password: 'Clave-segura-1234', consent: true },
    });
    const cookie = sessionCookies(registration.response);
    const csrfToken = registration.data.csrfToken;
    database.prepare('UPDATE members SET active = 0 WHERE id = ?').run(registration.data.member.id);

    const session = await request('/api/members/session', { cookie });
    expect(session.response.status).toBe(200);
    expect(session.data).toMatchObject({ status: 'banned', member: { displayName: 'Cuenta Baneada' } });

    const blockedPublic = await request('/api/public', { cookie });
    expect(blockedPublic.response.status).toBe(403);
    const blockedBooking = await request('/api/reservations', { method: 'POST', cookie, body: {} });
    expect(blockedBooking.response.status).toBe(403);

    const appeal = await request('/api/members/appeals', {
      method: 'POST',
      cookie,
      csrfToken,
      body: { reason: 'Creo que esta suspensión se aplicó por error. Pido que revisen el contexto de mi cuenta.' },
    });
    expect(appeal.response.status).toBe(201);
    expect(appeal.data.status).toBe('pending');

    const duplicateAppeal = await request('/api/members/appeals', {
      method: 'POST',
      cookie,
      csrfToken,
      body: { reason: 'Vuelvo a solicitar una revisión de mi cuenta por este motivo.' },
    });
    expect(duplicateAppeal.response.status).toBe(409);

    const logout = await request('/api/members/logout', { method: 'POST', cookie, csrfToken });
    expect(logout.data.status).toBe('ok');
    expect((await request('/api/members/session', { cookie })).response.status).toBe(401);
  });

  it('recuerda la sesión por 30 días y exige la contraseña antigua al cambiarla', async () => {
    const registration = await request('/api/members/register', {
      method: 'POST',
      body: { displayName: 'Cuenta Recordada', email: 'remember@example.test', password: 'Clave-segura-1234', consent: true },
    });
    const registrationCookie = sessionCookies(registration.response);
    await request('/api/members/logout', {
      method: 'POST',
      cookie: registrationCookie,
      csrfToken: registration.data.csrfToken,
    });

    const login = await request('/api/members/login', {
      method: 'POST',
      body: { email: 'remember@example.test', password: 'Clave-segura-1234', rememberMe: true },
    });
    expect(login.response.status).toBe(200);
    expect(login.response.headers.getSetCookie().join(';')).toContain('Max-Age=2592000');
    const cookie = sessionCookies(login.response);

    const wrongPassword = await request('/api/members/password', {
      method: 'POST', cookie, csrfToken: login.data.csrfToken,
      body: { currentPassword: 'no-es-la-anterior', newPassword: 'Nueva-clave-segura-5678' },
    });
    expect(wrongPassword.response.status).toBe(401);

    const changed = await request('/api/members/password', {
      method: 'POST', cookie, csrfToken: login.data.csrfToken,
      body: { currentPassword: 'Clave-segura-1234', newPassword: 'Nueva-clave-segura-5678' },
    });
    expect(changed.response.status).toBe(200);
    expect(changed.data.status).toBe('password-updated');

    const oldPasswordLogin = await request('/api/members/login', {
      method: 'POST',
      body: { email: 'remember@example.test', password: 'Clave-segura-1234' },
    });
    expect(oldPasswordLogin.response.status).toBe(401);
    const newPasswordLogin = await request('/api/members/login', {
      method: 'POST',
      body: { email: 'remember@example.test', password: 'Nueva-clave-segura-5678' },
    });
    expect(newPasswordLogin.response.status).toBe(200);
  });
});

function futureDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 2);
  return date.toISOString().slice(0, 10);
}
