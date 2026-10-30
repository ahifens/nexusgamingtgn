<<<<<<< HEAD
ALTER TABLE member_reward_redemptions
ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
CHECK (status IN ('pending', 'delivered', 'returned'));
=======
ALTER TABLE member_reward_redemptions
ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
CHECK (status IN ('pending', 'delivered', 'returned'));
>>>>>>> 5af4803bddf206bce0207b8407ed54ec08bf7358
