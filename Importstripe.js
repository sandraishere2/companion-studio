import express from "express";
import Stripe from "stripe";
import { enqueueMessage } from "../orchestrator/messageQueue.js";
import { getDB } from "./db.js";
import { authenticateToken } from "./auth.js";

export const router = express.Router();
const stripe = new Stripe(process.env.STRIPESECRETKEY);

const PRICEIDS = {
  miabasic:    process.env.STRIPEPRICEMIABASIC,
  miapremium:  process.env.STRIPEPRICEMIAPREMIUM,
  miavip:      process.env.STRIPEPRICEMIAVIP,
  lenabasic:   process.env.STRIPEPRICELENABASIC,
  lenapremium: process.env.STRIPEPRICELENAPREMIUM,
  lenavip:     process.env.STRIPEPRICELENAVIP,
  jadebasic:   process.env.STRIPEPRICEJADEBASIC,
  jadepremium: process.env.STRIPEPRICEJADEPREMIUM,
  jadevip:     process.env.STRIPEPRICEJADEVIP,
};

router.post("/auth/register", async (req, res) => {
  const { email, password } = req.body;
  const db = getDB();
  try {
    const user = await db.createUser({ email, password });
    const token = db.generateToken(user.id);
    res.json({ token, userId: user.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const db = getDB();
  try {
    const { user, token } = await db.loginUser({ email, password });
    res.json({ token, userId: user.id });
  } catch (err) {
    res.status(401).json({ error: "Invalid credentials" });
  }
});

router.post("/chat/:persona", authenticateToken, 
  async (req, res) => {
  const { persona } = req.params;
  const { message } = req.body;
  const userId = req.user.id;
  if (!["mia","lena","jade"].includes(persona)) {
    return res.status(400).json({ error: "Invalid persona" });
  }
  const db = getDB();
  const subscription = await db.getSubscription(userId, persona);
  if (!subscription || subscription.status !== "active") {
    return res.status(403).json({
      error: "Active subscription required",
      upgradeUrl: /subscribe/${persona},
    });
  }
  if (subscription.tier === "free") {
    const todayCount = await db.getMessageCount(userId, persona);
    if (todayCount >= 10) {
      return res.status(429).json({
        error: "Daily message limit reached",
        upgradeUrl: /subscribe/${persona},
      });
    }
  }
  enqueueMessage({
    personaName: persona, userId, message,
    callback: (err, reply) => {
      if (err) return res.status(500).json({ 
        error: "Reply failed" 
      });
      res.json({ reply, persona });
    },
  });
});

router.get("/chat/:persona/history", authenticateToken,
  async (req, res) => {
  const { persona } = req.params;
  const userId = req.user.id;
  const db = getDB();
  const history = await db.getConversationHistory(
    persona, userId, 100
  );
  res.json({ history });
});

router.post("/subscribe", authenticateToken, async (req, res) => {
  const { persona, tier } = req.body;
  const userId = req.user.id;
  const db = getDB();
  const priceId = PRICEIDS[${persona}${tier}];
  if (!priceId) return res.status(400).json({ 
    error: "Invalid plan" 
  });
  const user = await db.getUser(userId);
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email, metadata: { userId },
    });
    customerId = customer.id;
    await db.updateUser(userId, { 
      stripecustomerid: customerId 
    });
  }
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    paymentmethodtypes: ["card"],
    mode: "subscription",
    lineitems: [{ price: priceId, quantity: 1 }],
    successurl: ${process.env.FRONTENDURL}/success?persona=${persona},
    cancelurl: ${process.env.FRONTENDURL}/subscribe/${persona},
    metadata: { userId, persona, tier },
  });
  res.json({ checkoutUrl: session.url });
});

router.post("/webhook/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, sig, process.env.STRIPEWEBHOOKSECRET
    );
  } catch (err) {
    return res.status(400).send(Webhook Error: ${err.message});
  }
  const db = getDB();
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      await db.createSubscription({
        userId: session.metadata.userId,
        persona: session.metadata.persona,
        tier: session.metadata.tier,
        stripeSubscriptionId: session.subscription,
        status: "active",
      });
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      await db.updateSubscriptionByStripeId(
        sub.id, { status: "cancelled" }
      );
      break;
    }
    case "invoice.paymentfailed": {
      const invoice = event.data.object;
      await db.updateSubscriptionByStripeId(
        invoice.subscription, { status: "pastdue" }
      );
      break;
    }
  }
  res.json({ received: true });
});
