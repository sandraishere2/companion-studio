import pg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const { Pool } = pg;
let pool;

export function getPool() {
  if (!pool) {
    throw new Error("Database not initialized. Call initDB() first.");
  }
  return pool;
}

export function getDB() {
  return dbMethods;
}

export async function initDB() {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
  });
  await createTables();
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

