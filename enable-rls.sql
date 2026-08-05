-- Enable RLS on users table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Create policy: users can only see their own row
CREATE POLICY users_select_policy ON users
  FOR SELECT
  USING (id = (SELECT id FROM users WHERE email = current_user));

-- Allow authenticated inserts (for signup)
CREATE POLICY users_insert_policy ON users
  FOR INSERT
  WITH CHECK (true);

-- Users can only update their own data
CREATE POLICY users_update_policy ON users
  FOR UPDATE
  USING (id = (SELECT id FROM users WHERE email = current_user))
  WITH CHECK (id = (SELECT id FROM users WHERE email = current_user));

-- Enable RLS on subscriptions table
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Create policy: users can only see their own subscriptions
CREATE POLICY subscriptions_select_policy ON subscriptions
  FOR SELECT
  USING (user_id = (SELECT id FROM users WHERE email = current_user));

-- Users can create their own subscriptions
CREATE POLICY subscriptions_insert_policy ON subscriptions
  FOR INSERT
  WITH CHECK (user_id = (SELECT id FROM users WHERE email = current_user));

-- Users can only update their own subscriptions
CREATE POLICY subscriptions_update_policy ON subscriptions
  FOR UPDATE
  USING (user_id = (SELECT id FROM users WHERE email = current_user))
  WITH CHECK (user_id = (SELECT id FROM users WHERE email = current_user));

-- Users can only delete their own subscriptions
CREATE POLICY subscriptions_delete_policy ON subscriptions
  FOR DELETE
  USING (user_id = (SELECT id FROM users WHERE email = current_user));

