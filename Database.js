import pg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const { Pool } = pg;
let pool;

export function getDB() { return dbMethods; }

export async function initDB() {
  pool = new Pool({
    connectionString: process.env.DATABASEURL,
    ssl: process.env.NODEENV === "production"
      ? { rejectUnauthorized: false } : false,
  });
  await createTables();
  console.log("Database initialized");
}

async function createTables() {
  await pool.query(
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT genrandomuuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      passwordhash VARCHAR(255) NOT NULL,
      stripecustomerid VARCHAR(255),
      createdat TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY DEFAULT genrandomuuid(),
      userid UUID REFERENCES users(id),
      persona VARCHAR(50) NOT NULL,
      tier VARCHAR(50) DEFAULT 'free',
      stripesubscriptionid VARCHAR(255),
      status VARCHAR(50) DEFAULT 'active',
      createdat TIMESTAMP DEFAULT NOW(),
      UNIQUE(userid, persona)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT genrandomuuid(),
      userid UUID REFERENCES users(id),
      persona VARCHAR(50) NOT NULL,
      role VARCHAR(20) NOT NULL,
      content TEXT NOT NULL,
      isproactive BOOLEAN DEFAULT FALSE,
      createdat TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS voicenotes (
      id UUID PRIMARY KEY DEFAULT genrandomuuid(),
      userid UUID REFERENCES users(id),
      persona VARCHAR(50) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      text TEXT,
      delivered BOOLEAN DEFAULT FALSE,
      createdat TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS pushqueue (
      id UUID PRIMARY KEY DEFAULT genrandomuuid(),
      userid UUID REFERENCES users(id),
      payload JSONB NOT NULL,
      delivered BOOLEAN DEFAULT FALSE,
      createdat TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idxmessagesuserpersona
      ON messages(userid, persona, createdat);
    CREATE INDEX IF NOT EXISTS idxpushqueueuser
      ON pushqueue(userid, delivered);
  );
}

const dbMethods = {
  async createUser({ email, password }) {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users (email, passwordhash) VALUES ($1, $2) RETURNING ",
      [email, hash]
    );
    return result.rows[0];
  },
  async loginUser({ email, password }) {
    const result = await pool.query(
      "SELECT  FROM users WHERE email = $1", [email]
    );
    if (!result.rows[0]) throw new Error("User not found");
    const valid = await bcrypt.compare(
      password, result.rows[0].passwordhash
    );
    if (!valid) throw new Error("Invalid password");
    const token = this.generateToken(result.rows[0].id);
    return { user: result.rows[0], token };
  },
  generateToken(userId) {
    return jwt.sign(
      { userId }, process.env.JWTSECRET, { expiresIn: "30d" }
    );
  },
  async getUser(userId) {
    const result = await pool.query(
      "SELECT * FROM users WHERE id = $1", [userId]
    );
    return result.rows[0];
  },
  async updateUser(userId, fields) {
    const sets = Object.keys(fields)
      .map((k, i) => ${k} = $${i + 2}).join(", ");
    await pool.query(
      UPDATE users SET ${sets} WHERE id = $1,
      [userId, ...Object.values(fields)]
    );
  },
  async getSubscription(userId, persona) {
    const result = await pool.query(
      "SELECT * FROM subscriptions WHERE userid = $1 AND persona = $2",
      [userId, persona]
    );
    return result.rows[0];
  },
  async createSubscription(data) {
    await pool.query(
      INSERT INTO subscriptions
        (userid, persona, tier, stripesubscriptionid, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (userid, persona)
       DO UPDATE SET tier = $3, status = $5,
         stripesubscriptionid = $4,
      [data.userId, data.persona, data.tier,
       data.stripeSubscriptionId, data.status]
    );
  },
  async updateSubscriptionByStripeId(stripeSubId, fields) {
    const sets = Object.keys(fields)
      .map((k, i) => ${k} = $${i + 2}).join(", ");
    await pool.query(
      UPDATE subscriptions SET ${sets}
       WHERE stripesubscriptionid = $1,
      [stripeSubId, ...Object.values(fields)]
    );
  },
  async getActiveSubscribers(persona) {
    const result = await pool.query(
      SELECT u.id as "userId", s.tier
       FROM subscriptions s
       JOIN users u ON u.id = s.userid
       WHERE s.persona = $1 AND s.status = 'active',
      [persona]
    );
    return result.rows;
  },
  async saveMessage({ 
    persona, userId, role, content, isProactive = false 
  }) {
    await pool.query(
      INSERT INTO messages
        (userid, persona, role, content, isproactive)
       VALUES ($1, $2, $3, $4, $5),
      [userId, persona, role, content, isProactive]
    );
  },
  async getConversationHistory(persona, userId, limit = 50) {
    const result = await pool.query(
      SELECT role, content FROM messages
       WHERE userid = $1 AND persona = $2
       ORDER BY createdat DESC LIMIT $3,
      [userId, persona, limit]
    );
    return result.rows.reverse();
  },
  async getMessageCount(userId, persona) {
    const result = await pool.query(
      SELECT COUNT(*) FROM messages
       WHERE userid = $1 AND persona = $2
         AND role = 'user'
         AND createdat > NOW() - INTERVAL '24 hours',
      [userId, persona]
    );
    return parseInt(result.rows[0].count);
  },
  async getUsersSilentFor(persona, hours) {
    const result = await pool.query(
      SELECT DISTINCT s.userid as "userId", s.tier
       FROM subscriptions s
       WHERE s.persona = $1 AND s.status = 'active'
         AND s.userid NOT IN (
           SELECT DISTINCT userid FROM messages
           WHERE persona = $1
             AND createdat > NOW() - INTERVAL '${hours} hours'
         ),
      [persona]
    );
    return result.rows;
  },
  async pushNotification(userId, payload) {
    await pool.query(
      "INSERT INTO pushqueue (userid, payload) VALUES ($1, $2)",
      [userId, JSON.stringify(payload)]
    );
  },
  async pushVoiceNotification(userId, payload) {
    await this.pushNotification(
      userId, { type: "voicenote", ...payload }
    );
  },
  async saveVoiceNote({ persona, userId, filename, text }) {
    await pool.query(
      INSERT INTO voicenotes 
        (userid, persona, filename, text)
       VALUES ($1, $2, $3, $4),
      [userId, persona, filename, text]
    );
  },
};
