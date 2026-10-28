import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../server/src/db/connection.js';
import { migrateDatabase } from '../server/src/db/migrate.js';
import { seedDatabase } from '../server/src/db/seed.js';
import {
  createTournament,
  listTournamentEntries,
  recordTournamentResults,
  registerForTournament,
  TournamentError,
  updateTournament,
} from '../server/src/tournaments.js';
import { getPublicData } from '../server/src/public-data.js';

let database;

function tournamentInput(overrides = {}) {
  return {
    title: 'Copa de prueba',
    game: 'Juego demo',
    startsOn: futureDate(),
    startsAt: '18:00',
    format: 'Eliminatoria',
    capacity: 2,
    entryFeeCents: 0,
    prize: 'Premio demo',
    rules: 'Normas de ejemplo',
    status: 'open',
    ...overrides,
  };
}

function entryInput(name, gamertag) {
  return {
    name,
    gamertag,
    email: `${gamertag.toLowerCase()}@example.test`,
    phone: '+34600123456',
    acceptedRules: true,
  };
}

function futureDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 8);
  return date.toISOString().slice(0, 10);
}

beforeEach(() => {
  database = createDatabase(':memory:');
  migrateDatabase(database);
  seedDatabase(database);
});

afterEach(() => database.close());

describe('gestión de torneos', () => {
  it('crea y edita torneos, respeta aforo y actualiza la clasificación con resultados', () => {
    const tournament = createTournament(database, tournamentInput({ capacity: 3 }));
    expect(tournament.slug).toBe('copa-de-prueba');

    const first = registerForTournament(database, tournament.slug, entryInput('Jugador Uno', 'UnoRacer'));
    const second = registerForTournament(database, tournament.slug, entryInput('Jugador Dos', 'DosRacer'));
    const third = registerForTournament(database, tournament.slug, entryInput('Jugador Tres', 'TresRacer'));
    const waiting = registerForTournament(database, tournament.slug, entryInput('Jugador Cuatro', 'CuatroRacer'));
    expect([first.status, second.status, third.status, waiting.status]).toEqual(['registered', 'registered', 'registered', 'waitlisted']);

    expect(() => updateTournament(database, tournament.id, tournamentInput({ capacity: 2 })))
      .toThrowError(new TournamentError(409, 'El aforo no puede ser inferior al número de participantes ya inscritos.'));

    updateTournament(database, tournament.id, tournamentInput({ title: 'Copa editada', capacity: 4 }));
    const entries = listTournamentEntries(database, tournament.id);
    expect(entries).toHaveLength(4);

    const result = recordTournamentResults(database, tournament.id, {
      results: [
        { gamertag: 'UnoRacer', placement: 1, points: 100 },
        { gamertag: 'DosRacer', placement: 2, points: 60 },
      ],
    });
    expect(result.status).toBe('completed');

    const publicData = getPublicData(database);
    expect(publicData.leaderboard.find((player) => player.gamertag === 'UnoRacer')).toMatchObject({ points: 100, wins: 1 });
    expect(publicData.tournaments.some((item) => item.id === tournament.id)).toBe(false);
  });
});
