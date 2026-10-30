import { afterEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { bootstrapAdministrator } from '../server/src/admin-bootstrap.js';
import { createDatabase } from '../server/src/db/connection.js';
import { migrateDatabase } from '../server/src/db/migrate.js';

let database;

afterEach(() => {
  database?.close();
  database = undefined;
  vi.restoreAllMocks();
});

function createTestDatabase() {
  database = createDatabase(':memory:');
  migrateDatabase(database);
  return database;
}

describe('bootstrap del administrador', () => {
  it('crea el administrador desde variables de entorno y no sustituye su contraseña en arranques posteriores', () => {
    const db = createTestDatabase();
    const environment = {
      ADMIN_USERNAME: 'equipo-clase',
      ADMIN_PASSWORD: 'Contraseña-larga-2026',
      NODE_ENV: 'production',
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(bootstrapAdministrator(db, environment)).toBe(true);
    const originalHash = db.prepare(`
      SELECT password_hash AS passwordHash FROM staff_users WHERE username = ?
    `).get('equipo-clase').passwordHash;
    expect(bcrypt.compareSync(environment.ADMIN_PASSWORD, originalHash)).toBe(true);

    db.prepare('UPDATE staff_users SET password_hash = ? WHERE username = ?')
      .run('rotated-password-hash', 'equipo-clase');
    expect(bootstrapAdministrator(db, environment)).toBe(false);
    expect(db.prepare('SELECT password_hash AS passwordHash FROM staff_users WHERE username = ?')
      .get('equipo-clase').passwordHash).toBe('rotated-password-hash');
    expect(log).toHaveBeenCalledOnce();
  });

  it('no hace nada si no se configuran las variables y rechaza una configuración incompleta', () => {
    const db = createTestDatabase();
    expect(bootstrapAdministrator(db, {})).toBe(false);
    expect(() => bootstrapAdministrator(db, { ADMIN_USERNAME: 'equipo' }))
      .toThrow('Configura ADMIN_USERNAME y ADMIN_PASSWORD juntos');
  });

  it('rechaza contraseñas débiles en producción', () => {
    const db = createTestDatabase();
    expect(() => bootstrapAdministrator(db, {
      ADMIN_USERNAME: 'equipo',
      ADMIN_PASSWORD: 'corta',
      NODE_ENV: 'production',
    })).toThrow('ADMIN_PASSWORD debe tener al menos 12 caracteres.');
  });
});
