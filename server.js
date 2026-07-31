// server.js
// This is the actual entry point of the app — Railway runs this file
// (via "npm start", which runs "node server.js" per package.json).

const express = require('express');
const app = express();

// --- Webhook route MUST be mounted before express.json() ---
// Stripe needs the raw, unparsed request body to verify signatures.
const stripeWebhookRoute = require('./routes/stripeWebhook');
app.use('/api/stripe/webhook', stripeWebhookRoute);

// --- Now it's safe to parse JSON for everything else ---
app.use(express.json());

// --- Serve static test page(s) from /public ---
app.use(express.static('public'));

// --- Regular billing routes (checkout, customer portal) ---
const billingRoutes = require('./routes/billing');
app.use('/api/billing', billingRoutes);

// --- Temporary no-auth test route (delete before going live) ---
const testCheckoutRoute = require('./routes/testCheckout');
app.use('/api/test', testCheckoutRoute);

// --- Simple health check so you can confirm the server is alive ---
app.get('/', (req, res) => {
  res.send('Companion Studio backend is running.');
});

// Railway provides the PORT environment variable automatically.
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
