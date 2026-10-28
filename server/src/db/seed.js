function madridDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + offsetDays));

  return date.toISOString().slice(0, 10);
}

export function seedDatabase(database) {
  const seed = database.transaction(() => {
    database.prepare(`
      UPDATE business_settings
      SET name = ?, address = ?, phone = ?, email = ?, time_zone = ?
      WHERE id = 1
    `).run(
      process.env.BUSINESS_NAME ?? 'Nombre del local',
      process.env.BUSINESS_ADDRESS ?? 'Dirección pendiente',
      process.env.BUSINESS_PHONE ?? '+34 000 000 000',
      process.env.BUSINESS_EMAIL ?? 'contacto@example.test',
      process.env.APP_TIME_ZONE ?? 'Europe/Madrid',
    );

    const insertSeat = database.prepare(`
      INSERT OR IGNORE INTO seat_types (slug, name, description, specs_json, capacity)
      VALUES (@slug, @name, @description, @specs, @capacity)
    `);
    const seatTypes = [
      { slug: 'pc-gaming', name: 'PC gaming', description: 'Puesto de ejemplo con periféricos gaming.', specs: '{"gpu":"Modelo por definir","monitor":"144 Hz"}', capacity: 12 },
      { slug: 'consolas', name: 'Consolas', description: 'Zona de consolas con pantalla compartida.', specs: '{"consolas":"Modelos por definir"}', capacity: 4 },
      { slug: 'simulador', name: 'Simulador', description: 'Puesto de simulación de conducción o vuelo.', specs: '{"cockpit":"Configuración por definir"}', capacity: 2 },
      { slug: 'retro', name: 'Zona retro', description: 'Selección de sistemas y juegos clásicos.', specs: '{"coleccion":"Por definir"}', capacity: 6 },
    ];

    seatTypes.forEach((seatType) => insertSeat.run(seatType));

    const seatId = (slug) => database.prepare('SELECT id FROM seat_types WHERE slug = ?').get(slug).id;
    const insertPrice = database.prepare(`
      INSERT OR IGNORE INTO pricing_rules (slug, seat_type_id, kind, label, duration_hours, price_cents, starts_at, ends_at)
      VALUES (@slug, @seatTypeId, @kind, @label, @durationHours, @priceCents, @startsAt, @endsAt)
    `);
    const prices = [
      { slug: 'demo-pc-hour', seatTypeId: seatId('pc-gaming'), kind: 'hourly', label: 'Tarifa demo PC / hora', durationHours: null, priceCents: 500, startsAt: null, endsAt: null },
      { slug: 'demo-console-hour', seatTypeId: seatId('consolas'), kind: 'hourly', label: 'Tarifa demo consola / hora', durationHours: null, priceCents: 700, startsAt: null, endsAt: null },
      { slug: 'demo-sim-hour', seatTypeId: seatId('simulador'), kind: 'hourly', label: 'Tarifa demo simulador / hora', durationHours: null, priceCents: 1000, startsAt: null, endsAt: null },
      { slug: 'demo-retro-hour', seatTypeId: seatId('retro'), kind: 'hourly', label: 'Tarifa demo retro / hora', durationHours: null, priceCents: 350, startsAt: null, endsAt: null },
      { slug: 'demo-5-hours', seatTypeId: null, kind: 'pack', label: 'Bono demo 5 horas', durationHours: 5, priceCents: 2000, startsAt: null, endsAt: null },
      { slug: 'demo-evening-discount', seatTypeId: null, kind: 'time_discount', label: 'Descuento demo de tarde', durationHours: null, priceCents: 10, startsAt: '14:00', endsAt: '17:00' },
    ];

    prices.forEach((price) => insertPrice.run(price));

    const insertHours = database.prepare(`
      INSERT OR IGNORE INTO opening_hours (weekday, opens_at, closes_at, is_closed)
      VALUES (?, ?, ?, 0)
    `);
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      insertHours.run(weekday, weekday === 0 || weekday === 6 ? '10:00' : '12:00', '23:00');
    }

    database.prepare(`
      INSERT OR IGNORE INTO reservations
        (code, cancellation_token, seat_type_id, reservation_date, start_time, duration_hours,
         customer_name, customer_email, customer_phone, total_cents, status, consent_at)
      VALUES ('DEMO-RESERVA-001', 'demo-cancel-token-001', ?, ?, '18:00', 2,
        'Reserva de prueba', 'demo@example.test', '+34000000000', 1000, 'confirmed', CURRENT_TIMESTAMP)
    `).run(seatId('pc-gaming'), madridDate(1));

    const insertTournament = database.prepare(`
      INSERT OR IGNORE INTO tournaments
        (slug, title, game, starts_on, starts_at, format, capacity, entry_fee_cents, prize, status, rules)
      VALUES (@slug, @title, @game, @startsOn, @startsAt, @format, @capacity, @entryFeeCents, @prize, @status, @rules)
    `);
    const tournaments = [
      { slug: 'demo-torneo-retro', title: 'Torneo demo retro', game: 'Juego por anunciar', startsOn: madridDate(-14), startsAt: '17:00', format: 'Eliminatoria', capacity: 8, entryFeeCents: 0, prize: 'Premio por definir', status: 'completed', rules: 'Evento de demostración.' },
      { slug: 'demo-torneo-fighting', title: 'Torneo demo de lucha', game: 'Juego por anunciar', startsOn: madridDate(4), startsAt: '18:00', format: 'Doble eliminación', capacity: 16, entryFeeCents: 0, prize: 'Premio por definir', status: 'open', rules: 'Normas de demostración.' },
      { slug: 'demo-torneo-racing', title: 'Reto demo de simulación', game: 'Simulador por anunciar', startsOn: madridDate(11), startsAt: '16:00', format: 'Clasificación y final', capacity: 8, entryFeeCents: 0, prize: 'Premio por definir', status: 'open', rules: 'Normas de demostración.' },
    ];
    tournaments.forEach((tournament) => insertTournament.run(tournament));

    const insertPlayer = database.prepare(`
      INSERT OR IGNORE INTO players (gamertag, display_name, email, phone)
      VALUES (?, ?, ?, ?)
    `);
    const players = [
      ['PixelNorte', 'Jugador de prueba 1'],
      ['LunaByte', 'Jugador de prueba 2'],
      ['MandoRetro', 'Jugador de prueba 3'],
    ];
    players.forEach(([gamertag, displayName]) => {
      insertPlayer.run(gamertag, displayName, 'demo@example.test', '+34000000000');
    });

    const tournamentId = database.prepare('SELECT id FROM tournaments WHERE slug = ?').get('demo-torneo-retro').id;
    const insertEntry = database.prepare(`
      INSERT OR IGNORE INTO tournament_entries
        (tournament_id, player_id, registered_name, contact, accepted_rules_at, status)
      SELECT ?, id, display_name, 'demo@example.test', CURRENT_TIMESTAMP, 'registered'
      FROM players WHERE gamertag = ?
    `);
    players.forEach(([gamertag]) => insertEntry.run(tournamentId, gamertag));

    const placements = [
      ['PixelNorte', 1, 100],
      ['LunaByte', 2, 60],
      ['MandoRetro', 3, 40],
    ];
    const insertResult = database.prepare(`
      INSERT OR IGNORE INTO tournament_results (entry_id, placement, points)
      SELECT tournament_entries.id, ?, ?
      FROM tournament_entries
      JOIN players ON players.id = tournament_entries.player_id
      WHERE tournament_entries.tournament_id = ? AND players.gamertag = ?
    `);
    placements.forEach(([gamertag, placement, points]) => insertResult.run(placement, points, tournamentId, gamertag));
  });

  seed();
}