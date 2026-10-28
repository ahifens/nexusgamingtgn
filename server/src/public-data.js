import { listPublishedNews } from './news.js';
import { approvedIdeas, topSpenders } from './member-accounts.js';

function dateInMadrid(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

  return `${values.year}-${values.month}-${values.day}`;
}

export function getPublicData(database) {
  const business = database.prepare(`
    SELECT name, address, phone, email, time_zone AS timeZone
    FROM business_settings
    WHERE id = 1
  `).get();
  const seatTypes = database.prepare(`
    SELECT seat_types.id, seat_types.slug, seat_types.name, seat_types.description,
      seat_types.specs_json AS specsJson, seat_types.capacity,
      pricing_rules.price_cents AS hourlyPriceCents
    FROM seat_types
    LEFT JOIN pricing_rules
      ON pricing_rules.seat_type_id = seat_types.id
      AND pricing_rules.kind = 'hourly'
      AND pricing_rules.active = 1
    WHERE seat_types.active = 1
    ORDER BY seat_types.id
  `).all().map(({ specsJson, ...seatType }) => ({
    ...seatType,
    specs: JSON.parse(specsJson),
  }));
  const pricingRules = database.prepare(`
    SELECT slug, seat_type_id AS seatTypeId, kind, label,
      duration_hours AS durationHours, price_cents AS priceCents,
      starts_at AS startsAt, ends_at AS endsAt
    FROM pricing_rules
    WHERE active = 1 AND kind != 'hourly'
    ORDER BY kind, duration_hours, id
  `).all();
  const openingHours = database.prepare(`
    SELECT weekday, opens_at AS opensAt, closes_at AS closesAt, is_closed AS isClosed
    FROM opening_hours
    ORDER BY weekday
  `).all().map((hours) => ({ ...hours, isClosed: Boolean(hours.isClosed) }));
  const tournaments = database.prepare(`
    SELECT tournaments.id, tournaments.slug, tournaments.title, tournaments.game,
      tournaments.starts_on AS startsOn, tournaments.starts_at AS startsAt,
      tournaments.format, tournaments.capacity,
      tournaments.entry_fee_cents AS entryFeeCents, tournaments.prize,
      COUNT(CASE WHEN tournament_entries.status = 'registered' THEN 1 END) AS registeredCount
    FROM tournaments
    LEFT JOIN tournament_entries ON tournament_entries.tournament_id = tournaments.id
    WHERE tournaments.status = 'open' AND tournaments.starts_on >= ?
    GROUP BY tournaments.id
    ORDER BY tournaments.starts_on, tournaments.starts_at
  `).all(dateInMadrid());
  const leaderboard = database.prepare(`
    SELECT players.gamertag, players.display_name AS displayName,
      SUM(tournament_results.points) AS points,
      COUNT(DISTINCT tournament_entries.tournament_id) AS tournamentsPlayed,
      SUM(CASE WHEN tournament_results.placement = 1 THEN 1 ELSE 0 END) AS wins
    FROM players
    JOIN tournament_entries ON tournament_entries.player_id = players.id
    JOIN tournament_results ON tournament_results.entry_id = tournament_entries.id
    GROUP BY players.id
    ORDER BY points DESC, wins DESC, players.gamertag COLLATE NOCASE
    LIMIT 10
  `).all();

  return {
    business,
    seatTypes,
    pricingRules,
    openingHours,
    tournaments,
    leaderboard,
    news: listPublishedNews(database),
    topSpenders: topSpenders(database),
    ideas: approvedIdeas(database),
  };
}