import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdminAuth } from './admin-auth.js';
import { NewsError, createNews, deleteNews, listNewsForStaff, updateNews } from './news.js';
import { getPublicData } from './public-data.js';
import { cancelReservation, createReservation, getAvailability, ReservationError } from './reservations.js';
import { createMemberAuth, MemberError } from './member-accounts.js';
import {
  createTournament,
  deleteTournament,
  listTournamentEntries,
  listTournamentsForStaff,
  recordTournamentResults,
  registerForTournament,
  TournamentError,
  updateTournament,
} from './tournaments.js';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

export function createApp(database, { sendResetEmail } = {}) {
  const app = express();
  const auth = createAdminAuth(database);
  const memberAuth = createMemberAuth(database, { sendResetEmail });
  const availabilityLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas consultas. Espera un minuto e inténtalo de nuevo.' },
  });
  const bookingLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Has alcanzado el límite de intentos. Prueba más tarde.' },
  });
  const tournamentRegistrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 6,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas inscripciones. Prueba más tarde.' },
  });

  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:', 'https://images.unsplash.com'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      },
    },
    strictTransportSecurity: process.env.NODE_ENV === 'production' ? undefined : false,
  }));
  app.use(express.json({ limit: '32kb' }));
  app.use(memberAuth.attachMember);
  app.use('/api', (request, response, next) => {
    if (!request.bannedMember) return next();
    const allowed = request.path === '/members/session'
      || request.path === '/members/logout'
      || request.path === '/members/appeals';
    if (allowed) return next();
    return response.status(403).json({ status: 'banned', error: 'Esta cuenta está baneada.' });
  });

  app.get('/api/health', (_request, response) => {
    database.prepare('SELECT 1').get();
    response.json({ status: 'ok' });
  });

  app.get('/api/public', (_request, response) => {
    response.json(getPublicData(database));
  });

  app.get('/api/availability', availabilityLimiter, (request, response, next) => {
    try {
      response.json(getAvailability(database, request.query));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/reservations', bookingLimiter, (request, response, next) => {
    try {
      const reservation = createReservation(database, {
        ...request.body,
        memberId: request.member?.memberId,
      });
      response.status(201).json(reservation);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/reservations/cancel', bookingLimiter, (request, response, next) => {
    try {
      response.json(cancelReservation(database, request.body?.code, request.body?.token));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/members/register', memberAuth.registrationLimiter, memberAuth.register);
  app.post('/api/members/login', memberAuth.loginLimiter, memberAuth.login);
  app.post('/api/members/password-reset', memberAuth.passwordResetRequestLimiter, memberAuth.requestPasswordReset);
  app.post('/api/members/password-reset/confirm', memberAuth.passwordResetLimiter, memberAuth.resetPassword);
  app.get('/api/members/session', memberAuth.session);
  app.get('/api/members/rewards', memberAuth.requireMember, memberAuth.memberRewards);
  app.post('/api/members/rewards/:id/redeem', memberAuth.requireMember, memberAuth.requireCsrf, memberAuth.redeemMemberReward);
  app.post('/api/members/logout', memberAuth.requireMemberSession, memberAuth.requireCsrf, memberAuth.logout);
  app.post('/api/members/appeals', memberAuth.requireMemberSession, memberAuth.requireBannedMember, memberAuth.requireCsrf, memberAuth.submitAppeal);
  app.put('/api/members/profile', memberAuth.requireMember, memberAuth.requireCsrf, memberAuth.updateProfile);
  app.post('/api/members/password', memberAuth.requireMember, memberAuth.requireCsrf, memberAuth.changePassword);
  app.post('/api/members/ideas', memberAuth.requireMember, memberAuth.requireCsrf, memberAuth.submitIdea);
  app.get('/api/members/ideas', memberAuth.requireMember, memberAuth.requireModerator, memberAuth.listMemberIdeas);
  app.patch('/api/members/ideas/:id', memberAuth.requireMember, memberAuth.requireCsrf, memberAuth.requireModerator, memberAuth.moderateIdea);

  app.post('/api/tournaments/:slug/register', tournamentRegistrationLimiter, (request, response, next) => {
    try {
      const entry = registerForTournament(database, request.params.slug, request.body);
      return response.status(201).json(entry);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/admin/login', auth.loginLimiter, auth.login);
  app.get('/api/admin/session', auth.requireStaff, (request, response) => {
    response.json({
      user: { username: request.staff.username, role: request.staff.role },
      csrfToken: request.staff.csrfToken,
      mustChangePassword: Boolean(request.staff.mustChangePassword),
    });
  });
  app.post('/api/admin/password', auth.requireStaff, auth.requireCsrf, auth.changePassword);
  app.post('/api/admin/logout', auth.requireStaff, auth.requireCsrf, auth.logout);
  app.get('/api/admin/news', auth.requireStaff, (_request, response) => {
    response.json({ news: listNewsForStaff(database) });
  });
  app.post('/api/admin/news', auth.requireStaff, auth.requireCsrf, auth.requireAdministrator, (request, response, next) => {
    try {
      response.status(201).json({ news: createNews(database, request.staff.staffUserId, request.body) });
    } catch (error) {
      next(error);
    }
  });
  app.put('/api/admin/news/:id', auth.requireStaff, auth.requireCsrf, auth.requireAdministrator, (request, response, next) => {
    try {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Identificador de noticia no válido.' });
      return response.json({ news: updateNews(database, id, request.body) });
    } catch (error) {
      return next(error);
    }
  });
  app.delete('/api/admin/news/:id', auth.requireStaff, auth.requireCsrf, auth.requireAdministrator, (request, response, next) => {
    try {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Identificador de noticia no válido.' });
      return response.json(deleteNews(database, id));
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/admin/tournaments', auth.requireStaff, (_request, response) => {
    response.json({ tournaments: listTournamentsForStaff(database) });
  });
  app.post('/api/admin/tournaments', auth.requireStaff, auth.requireCsrf, auth.requireAdministrator, (request, response, next) => {
    try {
      return response.status(201).json({ tournament: createTournament(database, request.body) });
    } catch (error) {
      return next(error);
    }
  });
  app.put('/api/admin/tournaments/:id', auth.requireStaff, auth.requireCsrf, auth.requireAdministrator, (request, response, next) => {
    try {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Identificador de torneo no válido.' });
      return response.json({ tournament: updateTournament(database, id, request.body) });
    } catch (error) {
      return next(error);
    }
  });
  app.delete('/api/admin/tournaments/:id', auth.requireStaff, auth.requireCsrf, auth.requireAdministrator, (request, response, next) => {
    try {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Identificador de torneo no válido.' });
      return response.json(deleteTournament(database, id));
    } catch (error) {
      return next(error);
    }
  });
  app.get('/api/admin/tournaments/:id/entries', auth.requireStaff, (request, response, next) => {
    try {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Identificador de torneo no válido.' });
      return response.json({ entries: listTournamentEntries(database, id) });
    } catch (error) {
      return next(error);
    }
  });
  app.post('/api/admin/tournaments/:id/results', auth.requireStaff, auth.requireCsrf, auth.requireAdministrator, (request, response, next) => {
    try {
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Identificador de torneo no válido.' });
      return response.json(recordTournamentResults(database, id, request.body));
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/admin/reservations', auth.requireStaff, (_request, response) => {
    const reservations = database.prepare(`
      SELECT reservations.id, reservations.code, reservations.reservation_date AS date,
        reservations.start_time AS startTime, reservations.duration_hours AS durationHours,
        reservations.customer_name AS customerName, reservations.customer_email AS customerEmail,
        reservations.total_cents AS totalCents, reservations.status,
        members.display_name AS memberName, members.email AS memberEmail
      FROM reservations
      LEFT JOIN members ON members.id = reservations.member_id
      ORDER BY reservations.reservation_date DESC, reservations.start_time DESC
      LIMIT 100
    `).all();
    response.json({ reservations });
  });
  app.patch('/api/admin/reservations/:id/status', auth.requireStaff, auth.requireCsrf, (request, response) => {
    const id = Number(request.params.id);
    const allowed = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
    if (!Number.isSafeInteger(id) || id < 1 || !allowed.includes(request.body?.status)) {
      return response.status(400).json({ error: 'Identificador o estado de reserva no válido.' });
    }
    const result = database.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(request.body.status, id);
    if (!result.changes) return response.status(404).json({ error: 'No encontramos esa reserva.' });
    return response.json({ id, status: request.body.status });
  });
  app.get('/api/admin/members', auth.requireStaff, auth.requireAdministrator, (_request, response) => {
    const members = database.prepare(`
      SELECT members.id, members.display_name AS displayName, members.email, members.role,
        members.active, members.created_at AS createdAt,
        MAX(0, CAST(COALESCE(SUM(CASE WHEN reservations.status = 'completed' THEN reservations.total_cents ELSE 0 END), 0) / 10 AS INTEGER)
          - COALESCE((SELECT SUM(points_cost) FROM member_reward_redemptions WHERE member_id = members.id), 0)) AS points
      FROM members
      LEFT JOIN reservations ON reservations.member_id = members.id
      GROUP BY members.id
      ORDER BY members.created_at DESC
    `).all();
    response.json({ members });
  });
  app.get('/api/admin/rewards', auth.requireStaff, auth.requireAdministrator, memberAuth.listRewardsForAdmin);
  app.post('/api/admin/rewards', auth.requireStaff, auth.requireCsrf, auth.requireAdministrator, memberAuth.createReward);
  app.put('/api/admin/rewards/:id', auth.requireStaff, auth.requireCsrf, auth.requireAdministrator, memberAuth.updateReward);
  app.put('/api/admin/members/:id/role', auth.requireStaff, auth.requireCsrf, auth.requireAdministrator, (request, response) => {
    const id = Number(request.params.id);
    const roles = ['user', 'moderator', 'administrator'];
    if (!Number.isSafeInteger(id) || id < 1 || !roles.includes(request.body?.role)) {
      return response.status(400).json({ error: 'Miembro o rol no válido.' });
    }
    const result = database.prepare('UPDATE members SET role = ? WHERE id = ? AND active = 1').run(request.body.role, id);
    if (!result.changes) return response.status(404).json({ error: 'No encontramos esa cuenta.' });
    return response.json({ id, role: request.body.role });
  });
  app.patch('/api/admin/members/:id/ban', auth.requireStaff, auth.requireCsrf, auth.requireAdministrator, (request, response) => {
    const id = Number(request.params.id);
    const active = request.body?.active;
    if (!Number.isSafeInteger(id) || id < 1 || typeof active !== 'boolean') {
      return response.status(400).json({ error: 'Miembro o acción de baneo no válida.' });
    }
    const update = database.transaction(() => {
      const result = database.prepare('UPDATE members SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
      if (!result.changes) return false;
      return true;
    });
    if (!update.immediate()) return response.status(404).json({ error: 'No encontramos esa cuenta.' });
    return response.json({ id, active });
  });
  app.delete('/api/admin/members/:id', auth.requireStaff, auth.requireCsrf, auth.requireAdministrator, (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Miembro no válido.' });
    const result = database.prepare('DELETE FROM members WHERE id = ?').run(id);
    if (!result.changes) return response.status(404).json({ error: 'No encontramos esa cuenta.' });
    return response.json({ id, deleted: true });
  });
  app.get('/api/admin/ideas', auth.requireStaff, (_request, response) => {
    const ideas = database.prepare(`
      SELECT ideas.id, ideas.title, ideas.description, ideas.status,
        ideas.moderation_note AS moderationNote, ideas.created_at AS createdAt,
        members.display_name AS author, members.email AS authorEmail
      FROM ideas JOIN members ON members.id = ideas.member_id
      ORDER BY CASE ideas.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
        ideas.created_at DESC
    `).all();
    response.json({ ideas });
  });
  app.patch('/api/admin/ideas/:id', auth.requireStaff, auth.requireCsrf, (request, response) => {
    const id = Number(request.params.id);
    const status = request.body?.status;
    const note = typeof request.body?.moderationNote === 'string' ? request.body.moderationNote.slice(0, 500) : '';
    if (!Number.isSafeInteger(id) || id < 1 || !['approved', 'rejected'].includes(status)) {
      return response.status(400).json({ error: 'Idea o decisión de moderación no válida.' });
    }
    const result = database.prepare(`
      UPDATE ideas SET status = ?, moderation_note = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, note, id);
    if (!result.changes) return response.status(404).json({ error: 'No encontramos esa idea.' });
    return response.json({ id, status });
  });
  app.get('/api/admin/appeals', auth.requireStaff, (_request, response) => {
    const appeals = database.prepare(`
      SELECT member_appeals.id, member_appeals.reason, member_appeals.status,
        member_appeals.staff_response AS staffResponse,
        member_appeals.created_at AS createdAt,
        members.display_name AS memberName, members.email AS memberEmail
      FROM member_appeals
      JOIN members ON members.id = member_appeals.member_id
      ORDER BY CASE member_appeals.status WHEN 'pending' THEN 0 ELSE 1 END,
        member_appeals.created_at DESC
    `).all();
    response.json({ appeals });
  });
  app.patch('/api/admin/appeals/:id', auth.requireStaff, auth.requireCsrf, (request, response) => {
    const id = Number(request.params.id);
    const status = request.body?.status;
    const staffResponse = typeof request.body?.staffResponse === 'string' ? request.body.staffResponse.slice(0, 1000) : '';
    if (!Number.isSafeInteger(id) || id < 1 || !['accepted', 'rejected'].includes(status)) {
      return response.status(400).json({ error: 'Apelación o decisión no válida.' });
    }
    const update = database.transaction(() => {
      const appeal = database.prepare('SELECT member_id AS memberId FROM member_appeals WHERE id = ?').get(id);
      if (!appeal) return false;
      database.prepare(`
        UPDATE member_appeals SET status = ?, staff_response = ?, reviewed_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(status, staffResponse, request.staff.staffUserId, id);
      if (status === 'accepted') database.prepare('UPDATE members SET active = 1 WHERE id = ?').run(appeal.memberId);
      return true;
    });
    if (!update.immediate()) return response.status(404).json({ error: 'No encontramos esa apelación.' });
    return response.json({ id, status });
  });

  app.use('/api', (_request, response) => response.status(404).json({ error: 'Endpoint no encontrado.' }));

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(projectRoot, 'client', 'dist')));
    app.use((request, response, next) => {
      if (request.method !== 'GET' || request.path.startsWith('/api/')) {
        return next();
      }

      return response.sendFile(path.join(projectRoot, 'client', 'dist', 'index.html'));
    });
  }

  app.use((error, _request, response, _next) => {
    const status = error instanceof ReservationError || error instanceof NewsError
      || error instanceof MemberError || error instanceof TournamentError ? error.status : 500;
    if (status === 500) console.error('Error de API:', error);
    response.status(status).json({ error: status === 500 ? 'Ha ocurrido un error interno.' : error.message });
  });

  return app;
}