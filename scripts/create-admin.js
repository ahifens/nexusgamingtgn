import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { createDatabase } from '../server/src/db/connection.js';
import { migrateDatabase } from '../server/src/db/migrate.js';
import { hashStaffPassword } from '../server/src/admin-auth.js';

const database = createDatabase();
const username = `staff-${randomBytes(6).toString('hex')}`;
const password = `${randomBytes(18).toString('base64url')}A1!`;

try {
  migrateDatabase(database);
  database.prepare(`
    INSERT INTO staff_users (username, password_hash, role, active, must_change_password)
    VALUES (?, ?, 'administrator', 1, 0)
  `).run(username, hashStaffPassword(password));

  console.log('Cuenta administradora creada. Guarda estas credenciales:');
  console.log(`Usuario: ${username}`);
  console.log(`Contraseña: ${password}`);
  console.log('El sistema solo almacena el hash bcrypt; la contraseña no puede recuperarse después.');
} finally {
  database.close();
}
