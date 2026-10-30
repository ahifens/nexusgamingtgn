import { hashStaffPassword } from './admin-auth.js';

export function bootstrapAdministrator(database, environment = process.env) {
  const username = environment.ADMIN_USERNAME?.trim() ?? '';
  const password = environment.ADMIN_PASSWORD ?? '';

  if (!username && !password) return false;
  if (!username || !password) {
    throw new Error('Configura ADMIN_USERNAME y ADMIN_PASSWORD juntos para crear el administrador inicial.');
  }
  if (username.length < 2 || username.length > 80) {
    throw new Error('ADMIN_USERNAME debe tener entre 2 y 80 caracteres.');
  }
  const temporaryPassword = username.toLowerCase() === 'admin' && password === 'admin';
  if (password.length < 12 && (!temporaryPassword || environment.NODE_ENV === 'production')) {
    throw new Error('ADMIN_PASSWORD debe tener al menos 12 caracteres.');
  }

  const existing = database.prepare('SELECT id FROM staff_users WHERE username = ? COLLATE NOCASE').get(username);
  if (existing) return false;

  database.prepare(`
    INSERT INTO staff_users (username, password_hash, role, active, must_change_password)
    VALUES (?, ?, 'administrator', 1, ?)
  `).run(username, hashStaffPassword(password), temporaryPassword ? 1 : 0);
  console.log(`Cuenta administradora inicial creada: ${username}`);
  return true;
}
