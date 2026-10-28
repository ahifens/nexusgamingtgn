import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));

export function migrateDatabase(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const migrationNames = fs.readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const name of migrationNames) {
    const alreadyApplied = database.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(name);

    if (alreadyApplied) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDirectory, name), 'utf8');
    const applyMigration = database.transaction(() => {
      database.exec(sql);
      database.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name);
    });

    applyMigration();
  }
}