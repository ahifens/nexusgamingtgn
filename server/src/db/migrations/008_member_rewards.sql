CREATE TABLE member_rewards (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  points_cost INTEGER NOT NULL CHECK (points_cost > 0),
  stock INTEGER CHECK (stock IS NULL OR stock >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE member_reward_redemptions (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  reward_id INTEGER NOT NULL REFERENCES member_rewards(id) ON DELETE RESTRICT,
  reward_name TEXT NOT NULL,
  points_cost INTEGER NOT NULL CHECK (points_cost > 0),
  redemption_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX member_reward_redemptions_member_created_idx
ON member_reward_redemptions (member_id, created_at DESC);

INSERT INTO member_rewards (name, description, points_cost)
VALUES
  ('Bebida sin alcohol', 'Premio de ejemplo. Presenta el código de canje al personal.', 250),
  ('1 hora de juego', 'Premio de ejemplo sujeto a disponibilidad. Presenta el código al personal.', 500),
  ('Bono de 5 €', 'Premio de ejemplo para consumir en el local. Presenta el código al personal.', 500);
