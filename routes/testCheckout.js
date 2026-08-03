// routes/testCheckout.js
//
// TEMPORARY — for manual testing only. Skips auth, uses a hardcoded test
// email. DELETE this file before going live.

import express from 'express';
import stripe from '../stripe/client.js';

const router = express.Router();

router.post('/create-test-checkout', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: 'test-user@example.com',
      line_items: [{ price: process.env.STRIPE_PRICE_STANDARD, quantity: 1 }],
      success_url: `${process.env.APP_BASE_URL}/test.html?status=success`,
      cancel_url: `${process.env.APP_BASE_URL}/test.html?status=cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Error creating test checkout session:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
