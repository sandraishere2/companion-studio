// routes/billing.js
//
// Mount this in your main Express app with:
//   const billingRoutes = require('./routes/billing');
//   app.use('/api/billing', billingRoutes);
//
// Requires env vars:
//   STRIPE_SECRET_KEY
//   STRIPE_PRICE_STANDARD      (the recurring Price ID for your one scaffolded tier)
//   STRIPE_PRICE_CREDIT_TOPUP  (a one-time Price ID you create for credit packs, once you have one)
//   APP_BASE_URL               (e.g. https://companion-studio.up.railway.app)

const express = require('express');
const router = express.Router();
const stripe = require('../stripe/client');

// Replace this with your real auth/user lookup middleware.
// It should attach `req.user = { id, email, stripeCustomerId }`.
const requireAuth = require('../middleware/requireAuth');

/**
 * Ensure the logged-in user has a Stripe Customer, creating one if needed.
 * Store the resulting customer ID on your user record in Supabase.
 */
async function getOrCreateStripeCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { app_user_id: user.id },
  });

  // TODO: persist customer.id to Supabase as user.stripeCustomerId
  // await supabase.from('users').update({ stripe_customer_id: customer.id }).eq('id', user.id);

  return customer.id;
}

/**
 * POST /api/billing/create-subscription-checkout
 * Starts a hosted Checkout Session for the subscription tier.
 * No trial — card is charged immediately on completion.
 */
router.post('/create-subscription-checkout', requireAuth, async (req, res) => {
  try {
    const customerId = await getOrCreateStripeCustomer(req.user);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price: process.env.STRIPE_PRICE_STANDARD,
          quantity: 1,
        },
      ],
      success_url: `${process.env.APP_BASE_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_BASE_URL}/billing/cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Error creating subscription checkout session:', err);
    res.status(500).json({ error: 'Could not start checkout' });
  }
});

/**
 * POST /api/billing/create-topup-checkout
 * One-time payment for extra credits, independent of the subscription.
 */
router.post('/create-topup-checkout', requireAuth, async (req, res) => {
  try {
    const customerId = await getOrCreateStripeCustomer(req.user);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [
        {
          price: process.env.STRIPE_PRICE_CREDIT_TOPUP,
          quantity: 1,
        },
      ],
      success_url: `${process.env.APP_BASE_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_BASE_URL}/billing/cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Error creating top-up checkout session:', err);
    res.status(500).json({ error: 'Could not start checkout' });
  }
});

/**
 * POST /api/billing/create-portal-session
 * Sends an existing customer to the Stripe-hosted Customer Portal
 * to manage/cancel their subscription or update their card.
 */
router.post('/create-portal-session', requireAuth, async (req, res) => {
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

module.exports = router;
