// routes/testCheckout.js
//
// TEMPORARY — for manual testing only. This route skips auth entirely and
// uses a hardcoded test email, so you can click a button and get a real
// Stripe Checkout Session without needing login/auth built yet.
//
// DELETE THIS FILE (and its app.use(...) line in server.js) before going live.

const express = require('express');
const router = express.Router();
const stripe = require('../stripe/client');

router.post('/create-test-checkout', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: 'test-user@example.com',
      line_items: [
        {
          price: process.env.STRIPE_PRICE_STANDARD,
          quantity: 1,
        },
      ],
      success_url: `${process.env.APP_BASE_URL}/test.html?status=success`,
      cancel_url: `${process.env.APP_BASE_URL}/test.html?status=cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Error creating test checkout session:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
