import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';

const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const passwordSchema = z.object({
  username: z.string().trim().min(2).max(80),
  password: z.string().min(1).max(200),
});
const passwordChangeSchema = z.object({
  newPassword: z.string().min(12).max(200),
});

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(first, second) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

function readCookie(request, name) {
  const prefix = `${name}=`;
  const entry = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!entry) return '';

  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return '';
  }
}

export function hashStaffPassword(password) {
  return bcrypt.hashSync(password, 12);
}

export function createAdminAuth(database) {
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera 15 minutos antes de volver a probar.' },
  });

  function requireStaff(request, response, next) {
    const token = readCookie(request, 'lg_session');
    if (!token) return response.status(401).json({ error: 'Inicia sesión para continuar.' });

    const session = database.prepare(`
      SELECT staff_sessions.id AS sessionId, staff_sessions.csrf_token_hash AS csrfTokenHash,
        staff_users.id AS staffUserId, staff_users.username, staff_users.role,
        staff_users.must_change_password AS mustChangePassword
      FROM staff_sessions
      JOIN staff_users ON staff_users.id = staff_sessions.staff_user_id
      WHERE staff_sessions.token_hash = ? AND staff_sessions.expires_at > ?
        AND staff_users.active = 1
    `).get(digest(token), new Date().toISOString());

    if (!session) return response.status(401).json({ error: 'La sesión ha caducado. Inicia sesión de nuevo.' });
    request.staff = { ...session, csrfToken: readCookie(request, 'lg_csrf') };
    return next();
  }

  function requireCsrf(request, response, next) {
    const cookieToken = readCookie(request, 'lg_csrf');
    const headerToken = request.get('x-csrf-token') ?? '';
    const tokenHash = digest(headerToken);

    if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken) || !safeEqual(tokenHash, request.staff.csrfTokenHash)) {
      return response.status(403).json({ error: 'La petición ha caducado. Recarga el panel e inténtalo de nuevo.' });
    }
    return next();
  }

  function requireAdministrator(request, response, next) {
    if (request.staff.role !== 'administrator') {
      return response.status(403).json({ error: 'Esta acción requiere permisos de administrador.' });
    }
    return next();
  }

  function login(request, response) {
    const parsed = passwordSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Introduce usuario y contraseña válidos.' });

    const account = database.prepare(`
      SELECT id, username, password_hash AS passwordHash, role,
        must_change_password AS mustChangePassword
      FROM staff_users
      WHERE username = ? COLLATE NOCASE AND active = 1
    `).get(parsed.data.username);

    if (!account || !bcrypt.compareSync(parsed.data.password, account.passwordHash)) {
      return response.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + sessionLifetimeMs).toISOString();
    database.prepare('DELETE FROM staff_sessions WHERE expires_at <= ?').run(new Date().toISOString());
    database.prepare(`
      INSERT INTO staff_sessions (staff_user_id, token_hash, csrf_token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(account.id, digest(token), digest(csrfToken), expiresAt);

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: sessionLifetimeMs,
    };
    response.cookie('lg_session', token, cookieOptions);
    response.cookie('lg_csrf', csrfToken, { ...cookieOptions, httpOnly: false });
    return response.json({
      user: { username: account.username, role: account.role },
      csrfToken,
      mustChangePassword: Boolean(account.mustChangePassword),
    });
  }

  function changePassword(request, response) {
    const parsed = passwordChangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ error: 'La nueva contraseña debe tener al menos 12 caracteres.' });
    }

    const account = database.prepare(`
      SELECT password_hash AS passwordHash,
        must_change_password AS mustChangePassword
      FROM staff_users WHERE id = ? AND active = 1
    `).get(request.staff.staffUserId);
    if (!account || (!account.mustChangePassword && !bcrypt.compareSync(request.body.currentPassword ?? '', account.passwordHash))) {
      return response.status(401).json({ error: 'La contraseña actual no es correcta.' });
    }

    const sessionToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + sessionLifetimeMs).toISOString();
    const rotateSession = database.transaction(() => {
      database.prepare(`
        UPDATE staff_users SET password_hash = ?, must_change_password = 0 WHERE id = ?
      `).run(hashStaffPassword(parsed.data.newPassword), request.staff.staffUserId);
      database.prepare('DELETE FROM staff_sessions WHERE staff_user_id = ?').run(request.staff.staffUserId);
      database.prepare(`
        INSERT INTO staff_sessions (staff_user_id, token_hash, csrf_token_hash, expires_at)
        VALUES (?, ?, ?, ?)
      `).run(request.staff.staffUserId, digest(sessionToken), digest(csrfToken), expiresAt);
    });
    rotateSession.immediate();

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: sessionLifetimeMs,
    };
    response.cookie('lg_session', sessionToken, cookieOptions);
    response.cookie('lg_csrf', csrfToken, { ...cookieOptions, httpOnly: false });
    return response.json({ csrfToken, status: 'password-updated' });
  }

  function logout(request, response) {
    database.prepare('DELETE FROM staff_sessions WHERE id = ?').run(request.staff.sessionId);
    response.clearCookie('lg_session', { path: '/', sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
    response.clearCookie('lg_csrf', { path: '/', sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
    return response.json({ status: 'ok' });
  }

  return { loginLimiter, login, changePassword, requireStaff, requireCsrf, requireAdministrator, logout };
}
