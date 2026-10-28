import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';

const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const rememberedSessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const registrationSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(200),
  consent: z.literal(true),
});
const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(200),
  rememberMe: z.boolean().default(false),
});
const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  currentPassword: z.string().min(1).max(200),
});
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
});
const ideaSchema = z.object({
  title: z.string().trim().min(5).max(100),
  description: z.string().trim().min(20).max(2000),
});
const moderationSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  moderationNote: z.string().trim().max(500).default(''),
});
const appealSchema = z.object({
  reason: z.string().trim().min(30).max(2000),
});

export class MemberError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(first, second) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

function cookie(request, name) {
  const prefix = `${name}=`;
  const entry = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!entry) return '';

  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return '';
  }
}

function memberSummary(database, memberId) {
  const member = database.prepare(`
    SELECT id, display_name AS displayName, email, role
    FROM members WHERE id = ? AND active = 1
  `).get(memberId);
  if (!member) return null;

  const stats = database.prepare(`
    SELECT COALESCE(SUM(total_cents), 0) AS spendCents,
      CAST(COALESCE(SUM(total_cents), 0) / 10 AS INTEGER) AS points,
      COUNT(*) AS completedVisits
    FROM reservations
    WHERE member_id = ? AND status = 'completed'
  `).get(memberId);
  return { ...member, ...stats };
}

function setSessionCookies(response, sessionToken, csrfToken, lifetimeMs = sessionLifetimeMs) {
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: lifetimeMs,
  };
  response.cookie('lg_member_session', sessionToken, options);
  response.cookie('lg_member_csrf', csrfToken, { ...options, httpOnly: false });
}

function createSession(database, memberId, lifetimeMs = sessionLifetimeMs) {
  const sessionToken = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + lifetimeMs).toISOString();
  database.prepare('DELETE FROM member_sessions WHERE expires_at <= ?').run(new Date().toISOString());
  database.prepare(`
    INSERT INTO member_sessions (member_id, token_hash, csrf_token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(memberId, digest(sessionToken), digest(csrfToken), expiresAt);
  return { sessionToken, csrfToken };
}

export function topSpenders(database) {
  return database.prepare(`
    SELECT members.id, members.display_name AS displayName,
      CAST(SUM(reservations.total_cents) / 10 AS INTEGER) AS points,
      COUNT(reservations.id) AS completedVisits
    FROM members
    JOIN reservations ON reservations.member_id = members.id
    WHERE members.active = 1 AND reservations.status = 'completed'
    GROUP BY members.id
    HAVING SUM(reservations.total_cents) > 0
    ORDER BY points DESC, SUM(reservations.total_cents) DESC, members.display_name COLLATE NOCASE
    LIMIT 10
  `).all();
}

export function approvedIdeas(database) {
  return database.prepare(`
    SELECT ideas.id, ideas.title, ideas.description,
      members.display_name AS author, ideas.created_at AS createdAt,
      ideas.moderation_note AS moderationNote
    FROM ideas
    JOIN members ON members.id = ideas.member_id
    WHERE ideas.status = 'approved'
    ORDER BY ideas.updated_at DESC, ideas.id DESC
    LIMIT 30
  `).all();
}

export function createMemberAuth(database) {
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera 15 minutos antes de volver a probar.' },
  });
  const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Se han realizado demasiados registros desde esta conexión. Prueba más tarde.' },
  });

  function attachMember(request, _response, next) {
    const token = cookie(request, 'lg_member_session');
    if (!token) return next();

    const session = database.prepare(`
      SELECT member_sessions.id AS sessionId,
        member_sessions.csrf_token_hash AS csrfTokenHash,
        member_sessions.expires_at AS expiresAt,
        members.id AS memberId, members.display_name AS displayName,
        members.email, members.role, members.active
      FROM member_sessions
      JOIN members ON members.id = member_sessions.member_id
      WHERE member_sessions.token_hash = ? AND member_sessions.expires_at > ?
    `).get(digest(token), new Date().toISOString());

    if (session) {
      const { active, ...member } = session;
      const identity = { ...member, csrfToken: cookie(request, 'lg_member_csrf') };
      if (active) request.member = identity;
      else request.bannedMember = identity;
    }
    return next();
  }

  function requireMember(request, response, next) {
    if (!request.member) return response.status(401).json({ error: 'Inicia sesión para continuar.' });
    return next();
  }

  function requireMemberSession(request, response, next) {
    if (!request.member && !request.bannedMember) return response.status(401).json({ error: 'Inicia sesión para continuar.' });
    return next();
  }

  function requireBannedMember(request, response, next) {
    if (!request.bannedMember) return response.status(403).json({ error: 'Solo las cuentas baneadas pueden enviar una apelación desde aquí.' });
    return next();
  }

  function requireCsrf(request, response, next) {
    const identity = request.member ?? request.bannedMember;
    const cookieToken = cookie(request, 'lg_member_csrf');
    const headerToken = request.get('x-csrf-token') ?? '';
    if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)
      || !safeEqual(digest(headerToken), identity.csrfTokenHash)) {
      return response.status(403).json({ error: 'La petición ha caducado. Recarga e inténtalo de nuevo.' });
    }
    return next();
  }

  function requireModerator(request, response, next) {
    if (!['moderator', 'administrator'].includes(request.member.role)) {
      return response.status(403).json({ error: 'Solo moderación puede revisar sugerencias.' });
    }
    return next();
  }

  function register(request, response, next) {
    const parsed = registrationSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Completa los datos y acepta la información de privacidad.' });

    try {
      const result = database.prepare(`
        INSERT INTO members (display_name, email, password_hash, privacy_consent_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `).run(parsed.data.displayName, parsed.data.email, bcrypt.hashSync(parsed.data.password, 12));
      const session = createSession(database, result.lastInsertRowid);
      setSessionCookies(response, session.sessionToken, session.csrfToken);
      return response.status(201).json({
        member: memberSummary(database, result.lastInsertRowid),
        csrfToken: session.csrfToken,
      });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return response.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
      }
      return next(error);
    }
  }

  function login(request, response) {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Introduce un email y contraseña válidos.' });

    const account = database.prepare(`
      SELECT id, display_name AS displayName, password_hash AS passwordHash, active
      FROM members WHERE email = ? COLLATE NOCASE
    `).get(parsed.data.email);
    if (!account || !bcrypt.compareSync(parsed.data.password, account.passwordHash)) {
      return response.status(401).json({ error: 'Email o contraseña incorrectos.' });
    }

    const lifetimeMs = parsed.data.rememberMe ? rememberedSessionLifetimeMs : sessionLifetimeMs;
    const session = createSession(database, account.id, lifetimeMs);
    setSessionCookies(response, session.sessionToken, session.csrfToken, lifetimeMs);
    if (!account.active) {
      const appeal = database.prepare(`
        SELECT id, reason, status, staff_response AS staffResponse,
          created_at AS createdAt, updated_at AS updatedAt
        FROM member_appeals WHERE member_id = ? ORDER BY created_at DESC LIMIT 1
      `).get(account.id) ?? null;
      return response.json({
        status: 'banned',
        member: { id: account.id, displayName: account.displayName },
        csrfToken: session.csrfToken,
        appeal,
      });
    }
    return response.json({ member: memberSummary(database, account.id), csrfToken: session.csrfToken });
  }

  function session(request, response) {
    if (request.bannedMember) {
      const appeal = database.prepare(`
        SELECT id, reason, status, staff_response AS staffResponse,
          created_at AS createdAt, updated_at AS updatedAt
        FROM member_appeals WHERE member_id = ? ORDER BY created_at DESC LIMIT 1
      `).get(request.bannedMember.memberId) ?? null;
      return response.json({
        status: 'banned',
        member: { id: request.bannedMember.memberId, displayName: request.bannedMember.displayName },
        csrfToken: request.bannedMember.csrfToken,
        appeal,
      });
    }
    if (!request.member) return response.status(401).json({ error: 'Inicia sesión para continuar.' });
    return response.json({
      member: memberSummary(database, request.member.memberId),
      csrfToken: request.member.csrfToken,
    });
  }

  function logout(request, response) {
    const identity = request.member ?? request.bannedMember;
    database.prepare('DELETE FROM member_sessions WHERE id = ?').run(identity.sessionId);
    response.clearCookie('lg_member_session', { path: '/', sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
    response.clearCookie('lg_member_csrf', { path: '/', sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
    return response.json({ status: 'ok' });
  }

  function submitAppeal(request, response) {
    const parsed = appealSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Explica el motivo de la apelación (30–2.000 caracteres).' });
    const pending = database.prepare(`
      SELECT id FROM member_appeals WHERE member_id = ? AND status = 'pending'
    `).get(request.bannedMember.memberId);
    if (pending) return response.status(409).json({ error: 'Ya tienes una apelación pendiente de revisión.' });
    const result = database.prepare(`
      INSERT INTO member_appeals (member_id, reason)
      VALUES (?, ?)
    `).run(request.bannedMember.memberId, parsed.data.reason);
    return response.status(201).json({ id: result.lastInsertRowid, status: 'pending' });
  }

  function updateProfile(request, response) {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Revisa el nombre, el email y la contraseña actual.' });
    const account = database.prepare('SELECT password_hash AS passwordHash FROM members WHERE id = ?').get(request.member.memberId);
    if (!account || !bcrypt.compareSync(parsed.data.currentPassword, account.passwordHash)) {
      return response.status(401).json({ error: 'La contraseña actual no es correcta.' });
    }

    try {
      database.prepare('UPDATE members SET display_name = ?, email = ? WHERE id = ?')
        .run(parsed.data.displayName, parsed.data.email, request.member.memberId);
      return response.json({ member: memberSummary(database, request.member.memberId) });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return response.status(409).json({ error: 'Ese email ya pertenece a otra cuenta.' });
      }
      throw error;
    }
  }

  function changePassword(request, response) {
    const parsed = passwordChangeSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'La contraseña nueva debe tener al menos 12 caracteres.' });
    const account = database.prepare('SELECT password_hash AS passwordHash FROM members WHERE id = ? AND active = 1')
      .get(request.member.memberId);
    if (!account || !bcrypt.compareSync(parsed.data.currentPassword, account.passwordHash)) {
      return response.status(401).json({ error: 'La contraseña actual no es correcta.' });
    }

    const lifetimeMs = Math.max(60 * 1000, Date.parse(request.member.expiresAt) - Date.now());
    const rotate = database.transaction(() => {
      database.prepare('UPDATE members SET password_hash = ? WHERE id = ?')
        .run(bcrypt.hashSync(parsed.data.newPassword, 12), request.member.memberId);
      database.prepare('DELETE FROM member_sessions WHERE member_id = ?').run(request.member.memberId);
      return createSession(database, request.member.memberId, lifetimeMs);
    });
    const session = rotate.immediate();
    setSessionCookies(response, session.sessionToken, session.csrfToken, lifetimeMs);
    return response.json({ status: 'password-updated', csrfToken: session.csrfToken });
  }

  function submitIdea(request, response) {
    const parsed = ideaSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Revisa el título y la descripción de la idea.' });

    const count = database.prepare(`
      SELECT COUNT(*) AS count FROM ideas
      WHERE member_id = ? AND status = 'pending'
    `).get(request.member.memberId).count;
    if (count >= 5) return response.status(429).json({ error: 'Tienes 5 ideas pendientes; espera a que se revisen.' });

    const result = database.prepare(`
      INSERT INTO ideas (member_id, title, description)
      VALUES (?, ?, ?)
    `).run(request.member.memberId, parsed.data.title, parsed.data.description);
    return response.status(201).json({ id: result.lastInsertRowid, status: 'pending' });
  }

  function listMemberIdeas(request, response) {
    const ideas = database.prepare(`
      SELECT ideas.id, ideas.title, ideas.description, ideas.status,
        ideas.moderation_note AS moderationNote,
        ideas.created_at AS createdAt, members.display_name AS author
      FROM ideas JOIN members ON members.id = ideas.member_id
      ORDER BY CASE ideas.status WHEN 'pending' THEN 0 ELSE 1 END,
        ideas.created_at DESC
    `).all();
    return response.json({ ideas });
  }

  function moderateIdea(request, response) {
    const parsed = moderationSchema.safeParse(request.body);
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
      return response.status(400).json({ error: 'La resolución de la sugerencia no es válida.' });
    }
    const result = database.prepare(`
      UPDATE ideas
      SET status = ?, moderation_note = ?, moderated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(parsed.data.status, parsed.data.moderationNote, request.member.memberId, id);
    if (!result.changes) return response.status(404).json({ error: 'No encontramos esa sugerencia.' });
    return response.json({ id, status: parsed.data.status });
  }

  return {
    loginLimiter,
    registrationLimiter,
    attachMember,
    requireMember,
    requireMemberSession,
    requireBannedMember,
    requireCsrf,
    requireModerator,
    register,
    login,
    session,
    logout,
    submitAppeal,
    updateProfile,
    changePassword,
    submitIdea,
    listMemberIdeas,
    moderateIdea,
  };
}
