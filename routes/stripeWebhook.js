// routes/stripeWebhook.js
//
// CRITICAL: this route needs the RAW request body to verify the Stripe
// signature. Mount BEFORE express.json() on this path using express.raw().
//
// Requires env vars:
//   STRIPE_WEBHOOK_SECRET   (from Stripe Dashboard, or `stripe listen` in dev)

import express from 'express';
import stripe from '../stripe/client.js';

const router = express.Router();

router.post(
  '/',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          console.log('Checkout completed:', session.id, session.mode);
          break;
        }
        case 'invoice.paid': {
          const invoice = event.data.object;
          console.log('Invoice paid:', invoice.id);
          break;
        }
        case 'invoice.payment_failed': {
          const invoice = event.data.object;
          console.log('Invoice payment failed:', invoice.id);
          break;
        }
        case 'customer.subscription.updated': {
          const subscription = event.data.object;
          console.log('Subscription updated:', subscription.id, subscription.status);
          break;
        }
        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          console.log('Subscription cancelled:', subscription.id);
          break;
        }
        default:
          break;
      }

      res.json({ received: true });
    } catch (err) {
      console.error('Error handling webhook event:', err);
      res.status(500).send('Webhook handler error');
    }
  }
);

export default router;
