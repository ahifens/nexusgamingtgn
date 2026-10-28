import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const tournamentSchema = z.object({
  title: z.string().trim().min(3).max(120),
  game: z.string().trim().min(2).max(100),
  startsOn: z.string().regex(datePattern),
  startsAt: z.string().regex(timePattern),
  format: z.string().trim().min(2).max(100),
  capacity: z.coerce.number().int().min(2).max(256),
  entryFeeCents: z.coerce.number().int().min(0).max(1000000),
  prize: z.string().trim().max(300).default(''),
  rules: z.string().trim().max(5000).default(''),
  status: z.enum(['open', 'closed', 'completed']).default('open'),
});
const registrationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  gamertag: z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N}_ -]+$/u),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone: z.string().trim().regex(/^\+?[0-9\s().-]{7,24}$/),
  acceptedRules: z.literal(true),
});
const resultSchema = z.object({
  results: z.array(z.object({
    gamertag: z.string().trim().min(2).max(40),
    placement: z.coerce.number().int().min(1).max(256),
    points: z.coerce.number().int().min(0).max(100000),
  })).min(1).max(256),
});

export class TournamentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function slugify(title) {
  return title.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90) || `torneo-${randomBytes(3).toString('hex')}`;
}

function parseTournament(input) {
  const parsed = tournamentSchema.safeParse(input);
  if (!parsed.success) throw new TournamentError(400, 'Revisa título, juego, fecha, formato y plazas.');
  return parsed.data;
}

function tournamentList(database) {
  return database.prepare(`
    SELECT tournaments.id, tournaments.slug, tournaments.title, tournaments.game,
      tournaments.starts_on AS startsOn, tournaments.starts_at AS startsAt,
      tournaments.format, tournaments.capacity,
      tournaments.entry_fee_cents AS entryFeeCents, tournaments.prize,
      tournaments.rules, tournaments.status,
      COUNT(CASE WHEN tournament_entries.status = 'registered' THEN 1 END) AS registeredCount,
      COUNT(CASE WHEN tournament_entries.status = 'waitlisted' THEN 1 END) AS waitlistCount
    FROM tournaments
    LEFT JOIN tournament_entries ON tournament_entries.tournament_id = tournaments.id
    GROUP BY tournaments.id
    ORDER BY tournaments.starts_on DESC, tournaments.starts_at DESC
  `).all();
}

export function listTournamentsForStaff(database) {
  return tournamentList(database);
}

export function listTournamentEntries(database, id) {
  if (!database.prepare('SELECT id FROM tournaments WHERE id = ?').get(id)) {
    throw new TournamentError(404, 'No encontramos ese torneo.');
  }
  return database.prepare(`
    SELECT tournament_entries.id, tournament_entries.status,
      tournament_entries.registered_name AS name, tournament_entries.contact,
      players.gamertag, players.email, players.phone,
      tournament_results.placement, tournament_results.points
    FROM tournament_entries
    JOIN players ON players.id = tournament_entries.player_id
    LEFT JOIN tournament_results ON tournament_results.entry_id = tournament_entries.id
    WHERE tournament_entries.tournament_id = ?
    ORDER BY CASE tournament_entries.status WHEN 'registered' THEN 0 ELSE 1 END,
      tournament_results.placement, players.gamertag COLLATE NOCASE
  `).all(id);
}

export function createTournament(database, rawInput) {
  const input = parseTournament(rawInput);
  const slugBase = slugify(input.title);
  const slug = database.prepare('SELECT 1 FROM tournaments WHERE slug = ?').get(slugBase)
    ? `${slugBase}-${randomBytes(3).toString('hex')}`
    : slugBase;
  const result = database.prepare(`
    INSERT INTO tournaments
      (slug, title, game, starts_on, starts_at, format, capacity, entry_fee_cents, prize, status, rules)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(slug, input.title, input.game, input.startsOn, input.startsAt, input.format,
    input.capacity, input.entryFeeCents, input.prize, input.status, input.rules);
  return tournamentList(database).find((tournament) => tournament.id === result.lastInsertRowid);
}

export function updateTournament(database, id, rawInput) {
  const input = parseTournament(rawInput);
  const existing = database.prepare('SELECT id FROM tournaments WHERE id = ?').get(id);
  if (!existing) throw new TournamentError(404, 'No encontramos ese torneo.');

  const registeredCount = database.prepare(`
    SELECT COUNT(*) AS count FROM tournament_entries
    WHERE tournament_id = ? AND status = 'registered'
  `).get(id).count;
  if (input.capacity < registeredCount) {
    throw new TournamentError(409, 'El aforo no puede ser inferior al número de participantes ya inscritos.');
  }

  database.prepare(`
    UPDATE tournaments SET title = ?, game = ?, starts_on = ?, starts_at = ?, format = ?,
      capacity = ?, entry_fee_cents = ?, prize = ?, status = ?, rules = ?
    WHERE id = ?
  `).run(input.title, input.game, input.startsOn, input.startsAt, input.format,
    input.capacity, input.entryFeeCents, input.prize, input.status, input.rules, id);
  return tournamentList(database).find((tournament) => tournament.id === id);
}

export function deleteTournament(database, id) {
  const tournament = database.prepare('SELECT id FROM tournaments WHERE id = ?').get(id);
  if (!tournament) throw new TournamentError(404, 'No encontramos ese torneo.');
  database.prepare('DELETE FROM tournaments WHERE id = ?').run(id);
  return { id };
}

export function registerForTournament(database, slug, rawInput) {
  const parsed = registrationSchema.safeParse(rawInput);
  if (!parsed.success) throw new TournamentError(400, 'Completa los datos y acepta las normas del torneo.');
  const input = parsed.data;

  const register = database.transaction(() => {
    const tournament = database.prepare(`
      SELECT id, capacity, status FROM tournaments WHERE slug = ?
    `).get(slug);
    if (!tournament) throw new TournamentError(404, 'No encontramos ese torneo.');
    if (tournament.status !== 'open') throw new TournamentError(409, 'Las inscripciones de este torneo están cerradas.');

    const normalizedGamertag = input.gamertag.trim();
    let player = database.prepare('SELECT id, email FROM players WHERE gamertag = ? COLLATE NOCASE').get(normalizedGamertag);
    if (!player) {
      const created = database.prepare(`
        INSERT INTO players (gamertag, display_name, email, phone)
        VALUES (?, ?, ?, ?)
      `).run(normalizedGamertag, input.name, input.email, input.phone);
      player = { id: created.lastInsertRowid };
    } else if (player.email.toLowerCase() !== input.email) {
      throw new TournamentError(409, 'Ese gamertag ya está asociado a otro contacto.');
    }

    const existing = database.prepare(`
      SELECT id FROM tournament_entries WHERE tournament_id = ? AND player_id = ?
    `).get(tournament.id, player.id);
    if (existing) throw new TournamentError(409, 'Ese gamertag ya está inscrito en este torneo.');

    const registered = database.prepare(`
      SELECT COUNT(*) AS count FROM tournament_entries
      WHERE tournament_id = ? AND status = 'registered'
    `).get(tournament.id).count;
    const status = registered < tournament.capacity ? 'registered' : 'waitlisted';
    const entry = database.prepare(`
      INSERT INTO tournament_entries
        (tournament_id, player_id, registered_name, contact, accepted_rules_at, status)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    `).run(tournament.id, player.id, input.name, input.email, status);
    return { id: entry.lastInsertRowid, gamertag: normalizedGamertag, status };
  });

  return register.immediate();
}

export function recordTournamentResults(database, id, rawInput) {
  const parsed = resultSchema.safeParse(rawInput);
  if (!parsed.success) throw new TournamentError(400, 'Introduce posiciones y puntos válidos.');
  const results = parsed.data.results;
  const tags = results.map((result) => result.gamertag.toLocaleLowerCase());
  const positions = results.map((result) => result.placement);
  if (new Set(tags).size !== tags.length || new Set(positions).size !== positions.length) {
    throw new TournamentError(400, 'No repitas participantes ni posiciones.');
  }

  const save = database.transaction(() => {
    const tournament = database.prepare('SELECT id FROM tournaments WHERE id = ?').get(id);
    if (!tournament) throw new TournamentError(404, 'No encontramos ese torneo.');
    const entries = database.prepare(`
      SELECT tournament_entries.id, players.gamertag
      FROM tournament_entries
      JOIN players ON players.id = tournament_entries.player_id
      WHERE tournament_entries.tournament_id = ? AND tournament_entries.status = 'registered'
    `).all(id);
    const byTag = new Map(entries.map((entry) => [entry.gamertag.toLocaleLowerCase(), entry]));
    const upsert = database.prepare(`
      INSERT INTO tournament_results (entry_id, placement, points)
      VALUES (?, ?, ?)
      ON CONFLICT(entry_id) DO UPDATE SET placement = excluded.placement, points = excluded.points
    `);

    results.forEach((result) => {
      const entry = byTag.get(result.gamertag.toLocaleLowerCase());
      if (!entry) throw new TournamentError(400, `${result.gamertag} no está inscrito en este torneo.`);
      upsert.run(entry.id, result.placement, result.points);
    });
    database.prepare("UPDATE tournaments SET status = 'completed' WHERE id = ?").run(id);
    return { tournamentId: id, results: results.length, status: 'completed' };
  });

  return save.immediate();
}
