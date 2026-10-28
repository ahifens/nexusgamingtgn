import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../server/src/db/connection.js';
import { migrateDatabase } from '../server/src/db/migrate.js';
import { seedDatabase } from '../server/src/db/seed.js';

const temporaryDirectories = [];
const databases = [];

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
  temporaryDirectories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
});

describe('base de datos inicial', () => {
  it('aplica migraciones y carga el seed de forma idempotente', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-gaming-'));
    temporaryDirectories.push(directory);
    const database = createDatabase(path.join(directory, 'test.sqlite'));
    databases.push(database);

    migrateDatabase(database);
    seedDatabase(database);
    seedDatabase(database);

    expect(database.prepare('SELECT COUNT(*) AS count FROM seat_types').get().count).toBe(4);
    expect(database.prepare('SELECT COUNT(*) AS count FROM tournaments').get().count).toBe(3);
    expect(database.prepare('SELECT COUNT(*) AS count FROM tournament_results').get().count).toBe(3);
    expect(database.prepare('SELECT COUNT(*) AS count FROM reservations').get().count).toBe(1);
  });
});