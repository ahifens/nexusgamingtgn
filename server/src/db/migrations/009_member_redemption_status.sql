ALTER TABLE member_reward_redemptions
ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
CHECK (status IN ('pending', 'delivered', 'returned'));
