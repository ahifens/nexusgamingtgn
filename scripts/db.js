import 'dotenv/config';
import { createDatabase } from '../server/src/db/connection.js';
import { migrateDatabase } from '../server/src/db/migrate.js';
import { seedDatabase } from '../server/src/db/seed.js';
import { hashStaffPassword } from '../server/src/admin-auth.js';

const action = process.argv[2] ?? 'setup';
const database = createDatabase();

try {
  migrateDatabase(database);

  if (action === 'seed' || action === 'setup') {
    seedDatabase(database);
    const username = process.env.ADMIN_USERNAME?.trim();
    const password = process.env.ADMIN_PASSWORD;

    if (username && password) {
      const temporaryPassword = username.toLowerCase() === 'admin' && password === 'admin';
      if (password.length < 12 && (!temporaryPassword || process.env.NODE_ENV === 'production')) {
        throw new Error('ADMIN_PASSWORD debe tener al menos 12 caracteres.');
      }
      database.prepare(`
        INSERT INTO staff_users (username, password_hash, role, active, must_change_password)
        VALUES (?, ?, 'administrator', 1, ?)
        ON CONFLICT(username) DO UPDATE SET
          password_hash = excluded.password_hash,
          role = 'administrator',
          active = 1,
          must_change_password = excluded.must_change_password
      `).run(username, hashStaffPassword(password), temporaryPassword ? 1 : 0);
      console.log(`Cuenta administradora configurada: ${username}`);
    }
  } else if (action !== 'migrate') {
    throw new Error(`Acción desconocida: ${action}. Usa migrate, seed o setup.`);
  }

  console.log(action === 'migrate' ? 'Migraciones aplicadas.' : 'Base de datos preparada con datos demo.');
} finally {
  database.close();
}