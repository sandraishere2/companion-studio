// routes/billing.js
//
// Mount in your main Express app with:
//   import billingRoutes from './routes/billing.js';
//   app.use('/api/billing', billingRoutes);
//
// Requires env vars:
//   STRIPE_SECRET_KEY
//   STRIPE_PRICE_STANDARD      (recurring Price ID for the standard tier)
//   STRIPE_PRICE_CREDIT_TOPUP  (one-time Price ID for credit packs)
//   APP_BASE_URL               (e.g. https://companion-studio.up.railway.app)

import express from 'express';
import rateLimit from 'express-rate-limit';
import stripe from '../stripe/client.js';
import requireAuth from '../middleware/requireAuth.js';

const router = express.Router();

const billingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many billing requests, please try again later.',
});

async function getOrCreateStripeCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { app_user_id: user.id },
  });

  // TODO: persist customer.id to your DB as user.stripeCustomerId

  return customer.id;
}

router.post('/create-subscription-checkout', billingLimiter, requireAuth, async (req, res) => {
  try {
    const customerId = await getOrCreateStripeCustomer(req.user);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: process.env.STRIPE_PRICE_STANDARD, quantity: 1 }],
      success_url: `${process.env.APP_BASE_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_BASE_URL}/billing/cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Error creating subscription checkout session:', err);
    res.status(500).json({ error: 'Could not start checkout' });
  }
});

router.post('/create-topup-checkout', billingLimiter, requireAuth, async (req, res) => {
  try {
    const customerId = await getOrCreateStripeCustomer(req.user);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [{ price: process.env.STRIPE_PRICE_CREDIT_TOPUP, quantity: 1 }],
      success_url: `${process.env.APP_BASE_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_BASE_URL}/billing/cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Error creating top-up checkout session:', err);
    res.status(500).json({ error: 'Could not start checkout' });
  }
});

router.post('/create-portal-session', billingLimiter, requireAuth, async (req, res) => {
  try {
    const customerId = await getOrCreateStripeCustomer(req.user);

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.APP_BASE_URL}/account`,
    });

    res.json({ url: portalSession.url });
  } catch (err) {
    console.error('Error creating portal session:', err);
    res.status(500).json({ error: 'Could not open billing portal' });
  }
});

export default router;
