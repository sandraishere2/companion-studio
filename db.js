import pg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const { Pool } = pg;

// Initialize pool immediately at module load time
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

pool.on("error", (err) => {
  console.error("❌ Pool error:", err);
});

export function getDB() {
  return dbMethods;
}

export async function initDB() {
  // Pool is already created above
  // Just create tables
  await createTables();
  await enableRLS();
  console.log("Database initialized");
}

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      stripe_customer_id VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      persona VARCHAR(50) NOT NULL,
      tier VARCHAR(50) DEFAULT 'free',
      stripe_subscription_id VARCHAR(255),
      status VARCHAR(50) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, persona)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      persona VARCHAR(50) NOT NULL,
      role VARCHAR(20) NOT NULL,
      content TEXT NOT NULL,
      is_proactive BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS voice_notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      persona VARCHAR(50) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      text TEXT,
      delivered BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS push_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      payload JSONB NOT NULL,
      delivered BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_messages_user_persona
      ON messages(user_id, persona, created_at);
    CREATE INDEX IF NOT EXISTS idx_push_queue_user
      ON push_queue(user_id, delivered);
  `);
}

async function enableRLS() {
  // current_user_id() resolves the authenticated user for the current
  // session from the `app.current_user_id` session variable, which the
  // application layer sets after verifying a request's JWT. Requests made
  // without an authenticated session (i.e. no session variable set) resolve
  // to NULL and therefore never match any row-owner check below.
  try {
    await pool.query(`
      CREATE OR REPLACE FUNCTION current_user_id() RETURNS UUID AS $
        SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
      $ LANGUAGE sql STABLE;
    `);

    // ---- users table ----------------------------------------------------
    await pool.query("ALTER TABLE users ENABLE ROW LEVEL SECURITY;");

    // Drop existing policies if they exist (idempotent)
    await pool.query(`DROP POLICY IF EXISTS users_select_public ON users;`);
    await pool.query(`DROP POLICY IF EXISTS users_select_policy ON users;`);
    await pool.query(`DROP POLICY IF EXISTS users_insert_policy ON users;`);
    await pool.query(`DROP POLICY IF EXISTS users_update_policy ON users;`);

    // Anyone (authenticated or not) can read users
    await pool.query(`
      CREATE POLICY users_select_public ON users
        FOR SELECT
        USING (true);
    `);

    // Anyone can sign up
    await pool.query(`
      CREATE POLICY users_insert_policy ON users
        FOR INSERT
        WITH CHECK (true);
    `);

    // Only authenticated users can update their own row
    await pool.query(`
      CREATE POLICY users_update_policy ON users
        FOR UPDATE
        USING (id = current_user_id())
        WITH CHECK (id = current_user_id());
    `);

    // ---- subscriptions table ---------------------------------------------
    await pool.query("ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;");

    // Drop existing policies if they exist (idempotent)
    await pool.query(`DROP POLICY IF EXISTS subscriptions_select_public ON subscriptions;`);
    await pool.query(`DROP POLICY IF EXISTS subscriptions_select_policy ON subscriptions;`);
    await pool.query(`DROP POLICY IF EXISTS subscriptions_insert_policy ON subscriptions;`);
    await pool.query(`DROP POLICY IF EXISTS subscriptions_update_policy ON subscriptions;`);
    await pool.query(`DROP POLICY IF EXISTS subscriptions_delete_policy ON subscriptions;`);

    // Anyone can read subscriptions (e.g. to see pricing tiers)
    await pool.query(`
      CREATE POLICY subscriptions_select_public ON subscriptions
        FOR SELECT
        USING (true);
    `);

    // Only authenticated users can create subscriptions for themselves
    await pool.query(`
      CREATE POLICY subscriptions_insert_policy ON subscriptions
        FOR INSERT
        WITH CHECK (user_id = current_user_id());
    `);

    // Only authenticated users can update their own subscriptions
    await pool.query(`
      CREATE POLICY subscriptions_update_policy ON subscriptions
        FOR UPDATE
        USING (user_id = current_user_id())
        WITH CHECK (user_id = current_user_id());
    `);

    // Only authenticated users can delete their own subscriptions
    await pool.query(`
      CREATE POLICY subscriptions_delete_policy ON subscriptions
        FOR DELETE
        USING (user_id = current_user_id());
    `);

    console.log("✅ RLS enabled on users and subscriptions tables");
  } catch (err) {
    console.error("⚠️ RLS setup warning:", err.message);
    // Don't fail startup if RLS policies already exist
  }
}

const dbMethods = {
  async createUser({ email, password }) {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *",
      [email, hash]
    );
    return result.rows[0];
  },

  async loginUser({ email, password }) {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );
    if (!result.rows[0]) throw new Error("User not found");
    const valid = await bcrypt.compare(
      password,
      result.rows[0].password_hash
    );
    if (!valid) throw new Error("Invalid password");
    const token = this.generateToken(result.rows[0].id);
    return { user: result.rows[0], token };
  },

  generateToken(userId) {
    const JWT_SECRET = process.env.JWT_SECRET;
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
  },

  async saveMessage({ userId, persona, role, content, isProactive }) {
    const result = await pool.query(
      `INSERT INTO messages (user_id, persona, role, content, is_proactive)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, persona, role, content, isProactive]
    );
    return result.rows[0];
  },

  async getMessageHistory({ userId, persona, limit = 50 }) {
    const result = await pool.query(
      `SELECT * FROM messages WHERE user_id = $1 AND persona = $2
       ORDER BY created_at DESC LIMIT $3`,
      [userId, persona, limit]
    );
    return result.rows.reverse();
  },

  async saveVoiceNote({ userId, persona, filename, text }) {
    const result = await pool.query(
      `INSERT INTO voice_notes (user_id, persona, filename, text)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, persona, filename, text]
    );
    return result.rows[0];
  },

  async getVoiceNotes({ userId, persona, limit = 10 }) {
    const result = await pool.query(
      `SELECT * FROM voice_notes WHERE user_id = $1 AND persona = $2 AND delivered = FALSE
       ORDER BY created_at DESC LIMIT $3`,
      [userId, persona, limit]
    );
    return result.rows;
  },

  async markVoiceNoteDelivered(noteId) {
    await pool.query("UPDATE voice_notes SET delivered = TRUE WHERE id = $1", [
      noteId,
    ]);
  },

  async getSubscriptions(userId) {
    const result = await pool.query(
      "SELECT * FROM subscriptions WHERE user_id = $1",
      [userId]
    );
    return result.rows;
  },

  async createSubscription({ userId, persona, tier, stripeSubscriptionId }) {
    const result = await pool.query(
      `INSERT INTO subscriptions (user_id, persona, tier, stripe_subscription_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, persona, tier, stripeSubscriptionId]
    );
    return result.rows[0];
  },
};

export function getPool() {
  return pool;
}

