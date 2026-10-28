import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import nodemailer from 'nodemailer';
import { z } from 'zod';

const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const memberRememberDays = Number(process.env.MEMBER_REMEMBER_DAYS ?? 30);
if (!Number.isInteger(memberRememberDays) || memberRememberDays < 1 || memberRememberDays > 365) {
  throw new Error('MEMBER_REMEMBER_DAYS debe ser un número entero entre 1 y 365.');
}
const rememberedSessionLifetimeMs = memberRememberDays * 24 * 60 * 60 * 1000;
const passwordResetLifetimeMs = 60 * 60 * 1000;
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
const passwordResetRequestSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
});
const passwordResetSchema = z.object({
  token: z.string().min(32).max(128),
  password: z.string().min(12).max(200),
});
const ideaSchema = z.object({
  title: z.string().trim().min(5).max(100),
  description: z.string().trim().min(20).max(2000),
});
const moderationSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  moderationNote: z.string().trim().max(500).default(''),
});
const rewardSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).default(''),
  pointsCost: z.number().int().min(1).max(1000000),
  stock: z.number().int().min(0).nullable(),
  active: z.boolean(),
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
    SELECT COALESCE(SUM(reservations.total_cents), 0) AS spendCents,
      MAX(0, CAST(COALESCE(SUM(reservations.total_cents), 0) / 10 AS INTEGER)
        - COALESCE((SELECT SUM(points_cost) FROM member_reward_redemptions WHERE member_id = ?), 0)) AS points,
      COUNT(*) AS completedVisits
    FROM reservations
    WHERE reservations.member_id = ? AND reservations.status = 'completed'
  `).get(memberId, memberId);
  return { ...member, ...stats };
}

export function availableMemberRewards(database) {
  return database.prepare(`
    SELECT id, name, description, points_cost AS pointsCost, stock
    FROM member_rewards
    WHERE active = 1 AND (stock IS NULL OR stock > 0)
    ORDER BY points_cost, id
  `).all();
}

function setSessionCookies(response, sessionToken, csrfToken, lifetimeMs, remembered = false) {
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  };
  if (remembered) options.maxAge = lifetimeMs;
  response.cookie('lg_member_session', sessionToken, options);
  response.cookie('lg_member_csrf', csrfToken, { ...options, httpOnly: false });
}

function createSession(database, memberId, lifetimeMs = sessionLifetimeMs, remembered = false) {
  const sessionToken = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + lifetimeMs).toISOString();
  database.prepare('DELETE FROM member_sessions WHERE expires_at <= ?').run(new Date().toISOString());
  database.prepare(`
    INSERT INTO member_sessions (member_id, token_hash, csrf_token_hash, expires_at, remembered)
    VALUES (?, ?, ?, ?, ?)
  `).run(memberId, digest(sessionToken), digest(csrfToken), expiresAt, remembered ? 1 : 0);
  return { sessionToken, csrfToken };
}

export function topSpenders(database) {
  return database.prepare(`
    SELECT members.id, members.display_name AS displayName,
      MAX(0, CAST(SUM(reservations.total_cents) / 10 AS INTEGER)
        - COALESCE((SELECT SUM(points_cost) FROM member_reward_redemptions WHERE member_id = members.id), 0)) AS points,
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

function passwordResetConfiguration() {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  const port = Number(SMTP_PORT);
  if (!SMTP_HOST || !Number.isInteger(port) || port < 1 || port > 65535
    || !['true', 'false'].includes(SMTP_SECURE) || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM
    || !process.env.PUBLIC_BASE_URL) {
    throw new MemberError(503, 'El servicio de recuperación no está configurado. Contacta con el local.');
  }

  let baseUrl;
  try {
    baseUrl = new URL(process.env.PUBLIC_BASE_URL);
  } catch {
    throw new MemberError(503, 'El servicio de recuperación no está configurado. Contacta con el local.');
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol)
    || (process.env.NODE_ENV === 'production' && baseUrl.protocol !== 'https:')) {
    throw new MemberError(503, 'El servicio de recuperación no está configurado. Contacta con el local.');
  }
  return { host: SMTP_HOST, port, secure: SMTP_SECURE === 'true', user: SMTP_USER, password: SMTP_PASSWORD, from: SMTP_FROM, baseUrl };
}

async function sendPasswordResetEmail({ email, displayName, resetUrl }) {
  const config = passwordResetConfiguration();
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });
  await transporter.sendMail({
    from: config.from,
    to: email,
    subject: 'Restablece tu contraseña',
    text: `Hola ${displayName},\n\nPara restablecer tu contraseña, abre este enlace en la próxima hora:\n${resetUrl}\n\nSi no has solicitado este cambio, ignora este mensaje.`,
  });
}

export function createMemberAuth(database, { sendResetEmail = sendPasswordResetEmail } = {}) {
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
  const passwordResetRequestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Espera 15 minutos antes de volver a probar.' },
  });
  const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera 15 minutos antes de volver a probar.' },
  });

  function attachMember(request, _response, next) {
    const token = cookie(request, 'lg_member_session');
    if (!token) return next();

    const session = database.prepare(`
      SELECT member_sessions.id AS sessionId,
        member_sessions.csrf_token_hash AS csrfTokenHash,
        member_sessions.expires_at AS expiresAt,
        member_sessions.remembered,
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
      setSessionCookies(response, session.sessionToken, session.csrfToken, sessionLifetimeMs);
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

    const remembered = parsed.data.rememberMe;
    const lifetimeMs = remembered ? rememberedSessionLifetimeMs : sessionLifetimeMs;
    const session = createSession(database, account.id, lifetimeMs, remembered);
    setSessionCookies(response, session.sessionToken, session.csrfToken, lifetimeMs, remembered);
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

  function memberRewards(request, response) {
    const rewards = availableMemberRewards(database);
    const redemptions = database.prepare(`
      SELECT id, reward_name AS rewardName, points_cost AS pointsCost,
        redemption_code AS redemptionCode, created_at AS createdAt
      FROM member_reward_redemptions
      WHERE member_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 20
    `).all(request.member.memberId);
    return response.json({ points: memberSummary(database, request.member.memberId).points, rewards, redemptions });
  }

  function redeemMemberReward(request, response, next) {
    const rewardId = Number(request.params.id);
    if (!Number.isSafeInteger(rewardId) || rewardId < 1) {
      return response.status(400).json({ error: 'Recompensa no válida.' });
    }

    try {
      const redeem = database.transaction(() => {
        const reward = database.prepare(`
          SELECT id, name, points_cost AS pointsCost, stock
          FROM member_rewards
          WHERE id = ? AND active = 1
        `).get(rewardId);
        if (!reward) return { error: 'Esta recompensa ya no está disponible.', status: 404 };
        if (memberSummary(database, request.member.memberId).points < reward.pointsCost) {
          return { error: 'No tienes suficientes puntos para este canje.', status: 409 };
        }

        if (reward.stock !== null) {
          const stockUpdate = database.prepare(`
            UPDATE member_rewards SET stock = stock - 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND active = 1 AND stock > 0
          `).run(reward.id);
          if (!stockUpdate.changes) return { error: 'Esta recompensa se ha agotado.', status: 409 };
        }

        const redemptionCode = randomBytes(6).toString('hex').toUpperCase();
        const result = database.prepare(`
          INSERT INTO member_reward_redemptions
            (member_id, reward_id, reward_name, points_cost, redemption_code)
          VALUES (?, ?, ?, ?, ?)
        `).run(request.member.memberId, reward.id, reward.name, reward.pointsCost, redemptionCode);
        return {
          redemption: {
            id: result.lastInsertRowid,
            rewardName: reward.name,
            pointsCost: reward.pointsCost,
            redemptionCode,
          },
          points: memberSummary(database, request.member.memberId).points,
        };
      });

      const result = redeem.immediate();
      if (result.error) return response.status(result.status).json({ error: result.error });
      return response.status(201).json(result);
    } catch (error) {
      return next(error);
    }
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
      const update = database.transaction(() => {
        database.prepare('UPDATE members SET display_name = ?, email = ? WHERE id = ?')
          .run(parsed.data.displayName, parsed.data.email, request.member.memberId);
        database.prepare('DELETE FROM member_password_resets WHERE member_id = ?').run(request.member.memberId);
      });
      update.immediate();
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
      database.prepare('DELETE FROM member_password_resets WHERE member_id = ?').run(request.member.memberId);
      return createSession(database, request.member.memberId, lifetimeMs, Boolean(request.member.remembered));
    });
    const session = rotate.immediate();
    setSessionCookies(response, session.sessionToken, session.csrfToken, lifetimeMs, Boolean(request.member.remembered));
    return response.json({ status: 'password-updated', csrfToken: session.csrfToken });
  }

  async function requestPasswordReset(request, response, next) {
    const parsed = passwordResetRequestSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Introduce un email válido.' });

    try {
      const config = passwordResetConfiguration();
      const resetUrl = new URL('/comunidad/', config.baseUrl);
      const now = new Date().toISOString();
      database.prepare('DELETE FROM member_password_resets WHERE expires_at <= ?').run(now);

      const account = database.prepare(`
        SELECT id, display_name AS displayName, email
        FROM members WHERE email = ? COLLATE NOCASE AND active = 1
      `).get(parsed.data.email);
      if (account) {
        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + passwordResetLifetimeMs).toISOString();
        database.prepare(`
          INSERT INTO member_password_resets (member_id, token_hash, expires_at)
          VALUES (?, ?, ?)
          ON CONFLICT(member_id) DO UPDATE SET
            token_hash = excluded.token_hash,
            expires_at = excluded.expires_at,
            created_at = CURRENT_TIMESTAMP
        `).run(account.id, digest(token), expiresAt);
        const accountResetUrl = new URL(resetUrl);
        accountResetUrl.searchParams.set('resetToken', token);
        accountResetUrl.hash = 'cuenta';

        try {
          await sendResetEmail({
            email: account.email,
            displayName: account.displayName,
            resetUrl: accountResetUrl.toString(),
          });
        } catch (error) {
          database.prepare('DELETE FROM member_password_resets WHERE member_id = ? AND token_hash = ?')
            .run(account.id, digest(token));
          if (error instanceof MemberError) throw error;
          console.error('Error enviando email de restablecimiento:', error);
          throw new MemberError(503, 'No se pudo enviar el email de recuperación. Inténtalo más tarde.');
        }
      }
      return response.json({
        message: 'Si existe una cuenta activa con ese email, recibirá un enlace para restablecer la contraseña.',
      });
    } catch (error) {
      return next(error);
    }
  }

  function resetPassword(request, response, next) {
    const parsed = passwordResetSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'El enlace no es válido o la contraseña no cumple los requisitos.' });

    try {
      const passwordHash = bcrypt.hashSync(parsed.data.password, 12);
      const reset = database.transaction(() => {
        const entry = database.prepare(`
          SELECT member_id AS memberId
          FROM member_password_resets
          WHERE token_hash = ? AND expires_at > ?
        `).get(digest(parsed.data.token), new Date().toISOString());
        if (!entry) return false;

        const updated = database.prepare('UPDATE members SET password_hash = ? WHERE id = ? AND active = 1')
          .run(passwordHash, entry.memberId);
        if (!updated.changes) return false;
        database.prepare('DELETE FROM member_sessions WHERE member_id = ?').run(entry.memberId);
        database.prepare('DELETE FROM member_password_resets WHERE member_id = ?').run(entry.memberId);
        return true;
      });
      if (!reset.immediate()) return response.status(400).json({ error: 'El enlace ha caducado o ya se ha utilizado. Solicita uno nuevo.' });
      return response.json({ status: 'password-reset' });
    } catch (error) {
      return next(error);
    }
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

  function listRewardsForAdmin(_request, response) {
    const rewards = database.prepare(`
      SELECT id, name, description, points_cost AS pointsCost, stock, active,
        updated_at AS updatedAt
      FROM member_rewards
      ORDER BY active DESC, points_cost, id
    `).all().map((reward) => ({ ...reward, active: Boolean(reward.active) }));
    return response.json({ rewards });
  }

  function createReward(request, response) {
    const parsed = rewardSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Revisa el nombre, el coste y el stock de la recompensa.' });
    const result = database.prepare(`
      INSERT INTO member_rewards (name, description, points_cost, stock, active)
      VALUES (?, ?, ?, ?, ?)
    `).run(parsed.data.name, parsed.data.description, parsed.data.pointsCost, parsed.data.stock, parsed.data.active ? 1 : 0);
    return response.status(201).json({ id: result.lastInsertRowid });
  }

  function updateReward(request, response) {
    const id = Number(request.params.id);
    const parsed = rewardSchema.safeParse(request.body);
    if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
      return response.status(400).json({ error: 'Revisa la recompensa y sus datos.' });
    }
    const result = database.prepare(`
      UPDATE member_rewards
      SET name = ?, description = ?, points_cost = ?, stock = ?, active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      parsed.data.name,
      parsed.data.description,
      parsed.data.pointsCost,
      parsed.data.stock,
      parsed.data.active ? 1 : 0,
      id,
    );
    if (!result.changes) return response.status(404).json({ error: 'No encontramos esa recompensa.' });
    return response.json({ id });
  }

  return {
    loginLimiter,
    registrationLimiter,
    passwordResetRequestLimiter,
    passwordResetLimiter,
    attachMember,
    requireMember,
    requireMemberSession,
    requireBannedMember,
    requireCsrf,
    requireModerator,
    register,
    login,
    session,
    memberRewards,
    redeemMemberReward,
    logout,
    submitAppeal,
    updateProfile,
    changePassword,
    requestPasswordReset,
    resetPassword,
    submitIdea,
    listMemberIdeas,
    moderateIdea,
    listRewardsForAdmin,
    createReward,
    updateReward,
  };
}
