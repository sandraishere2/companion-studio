import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import Stripe from 'stripe';
import Anthropic from '@anthropic-ai/sdk';
import { pool } from './db.js';

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const JWT_SECRET = process.env.JWT_SECRET;

// Map companion names to their voice config
const COMPANIONS = {
  mia: { voiceId: process.env.ELEVENLABS_VOICE_MIA },
  lena: { voiceId: process.env.ELEVENLABS_VOICE_LENA },
  jade: { voiceId: process.env.ELEVENLABS_VOICE_JADE },
};

// ---------- Auth middleware ----------
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ---------- Auth routes ----------
router.post('/auth/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Account already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, created_at) VALUES ($1, $2, NOW()) RETURNING id, email',
      [email, passwordHash]
    );
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  try {
    const result = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to log in' });
  }
});

// ---------- Chat (Claude) ----------
router.post('/chat/:companion', requireAuth, async (req, res) => {
  const { companion } = req.params;
  const { message, history } = req.body;

  if (!COMPANIONS[companion]) {
    return res.status(404).json({ error: 'Unknown companion' });
  }
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const messages = [...(history || []), { role: 'user', content: message }];
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages,
    });

    const reply = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Failed to generate reply' });
  }
});

// ---------- Voice (ElevenLabs) ----------
router.post('/voice/:companion', requireAuth, async (req, res) => {
  const { companion } = req.params;
  const { text } = req.body;
  const config = COMPANIONS[companion];

  if (!config) {
    return res.status(404).json({ error: 'Unknown companion' });
  }
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs error: ${errText}`);
    }

    res.set('Content-Type', 'audio/mpeg');
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('Voice error:', err);
    res.status(500).json({ error: 'Failed to generate voice' });
  }
});

// ---------- Stripe checkout (single price) ----------
router.post('/subscribe/:companion', requireAuth, async (req, res) => {
  const { companion } = req.params;

  if (!COMPANIONS[companion]) {
    return res.status(400).json({ error: 'Invalid companion' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_PRICE_STANDARD, quantity: 1 }],
      success_url: `${process.env.APP_BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_BASE_URL}/cancel`,
      client_reference_id: String(req.user.userId),
      metadata: { companion },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ---------- Stripe webhook ----------
// NOTE: this route must receive the raw request body (not JSON-parsed)
// so it must be mounted in server.js BEFORE express.json(), e.g.:
//   app.post('/webhook/stripe', express.raw({ type: 'application/json' }), routes)
router.post('/webhook/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const { companion } = session.metadata;
        await pool.query(
          `INSERT INTO subscriptions (user_id, companion, tier, stripe_subscription_id, status, created_at)
           VALUES ($1, $2, 'standard', $3, 'active', NOW())`,
          [userId, companion, session.subscription]
        );
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await pool.query(
          `UPDATE subscriptions SET status = 'cancelled' WHERE stripe_subscription_id = $1`,
          [subscription.id]
        );
        break;
      }
      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handling error:', err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

export default router;
