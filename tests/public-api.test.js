import { describe, expect, it } from 'vitest';
import { createApp } from '../server/src/app.js';
import { createDatabase } from '../server/src/db/connection.js';
import { migrateDatabase } from '../server/src/db/migrate.js';
import { seedDatabase } from '../server/src/db/seed.js';

describe('API pública', () => {
  it('sirve tarifas, torneos próximos y clasificación desde SQLite', async () => {
    const database = createDatabase(':memory:');
    migrateDatabase(database);
    seedDatabase(database);
    const server = createApp(database).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));

    try {
      const { port } = server.address();
      const response = await fetch(`http://127.0.0.1:${port}/api/public`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.business.timeZone).toBe('Europe/Madrid');
      expect(data.seatTypes).toHaveLength(4);
      expect(data.seatTypes[0].hourlyPriceCents).toBeGreaterThan(0);
      expect(data.pricingRules.some((rule) => rule.kind === 'pack')).toBe(true);
      expect(data.tournaments).toHaveLength(2);
      expect(data.leaderboard[0]).toMatchObject({ gamertag: 'PixelNorte', points: 100, wins: 1 });
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      database.close();
    }
  });
});