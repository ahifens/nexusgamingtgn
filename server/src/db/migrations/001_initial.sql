CREATE TABLE business_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  time_zone TEXT NOT NULL DEFAULT 'Europe/Madrid'
);

CREATE TABLE seat_types (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  specs_json TEXT NOT NULL DEFAULT '{}',
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE pricing_rules (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  seat_type_id INTEGER REFERENCES seat_types(id),
  kind TEXT NOT NULL CHECK (kind IN ('hourly', 'pack', 'time_discount')),
  label TEXT NOT NULL,
  duration_hours INTEGER CHECK (duration_hours BETWEEN 1 AND 100),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  starts_at TEXT,
  ends_at TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE opening_hours (
  weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  opens_at TEXT,
  closes_at TEXT,
  is_closed INTEGER NOT NULL DEFAULT 0 CHECK (is_closed IN (0, 1)),
  CHECK (is_closed = 1 OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND opens_at < closes_at))
);

CREATE TABLE closure_dates (
  id INTEGER PRIMARY KEY,
  closed_on TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE reservations (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  cancellation_token TEXT NOT NULL UNIQUE,
  seat_type_id INTEGER NOT NULL REFERENCES seat_types(id),
  reservation_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  duration_hours INTEGER NOT NULL CHECK (duration_hours BETWEEN 1 AND 6),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  consent_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX reservations_date_start_idx ON reservations (reservation_date, start_time);
CREATE INDEX reservations_contact_status_idx ON reservations (customer_email, customer_phone, status);

CREATE TABLE tournaments (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  game TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  format TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  entry_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (entry_fee_cents >= 0),
  prize TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'completed')),
  rules TEXT NOT NULL DEFAULT ''
);

CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  gamertag TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tournament_entries (
  id INTEGER PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  registered_name TEXT NOT NULL,
  contact TEXT NOT NULL,
  accepted_rules_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'waitlisted', 'disqualified')),
  UNIQUE (tournament_id, player_id)
);

CREATE TABLE tournament_results (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL UNIQUE REFERENCES tournament_entries(id) ON DELETE CASCADE,
  placement INTEGER NOT NULL CHECK (placement > 0),
  points INTEGER NOT NULL CHECK (points >= 0)
);

CREATE TABLE tournament_matches (
  id INTEGER PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL CHECK (round_number > 0),
  match_number INTEGER NOT NULL CHECK (match_number > 0),
  player_one_id INTEGER REFERENCES players(id),
  player_two_id INTEGER REFERENCES players(id),
  player_one_score INTEGER CHECK (player_one_score >= 0),
  player_two_score INTEGER CHECK (player_two_score >= 0),
  winner_id INTEGER REFERENCES players(id),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed')),
  UNIQUE (tournament_id, round_number, match_number)
);

CREATE TABLE staff_users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('administrator', 'employee')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE staff_sessions (
  id INTEGER PRIMARY KEY,
  staff_user_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO business_settings (id, name, address, phone, email, time_zone)
VALUES (1, 'Nombre del local', 'Dirección pendiente', '+34 000 000 000', 'contacto@example.test', 'Europe/Madrid');