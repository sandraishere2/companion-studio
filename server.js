import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import routes from "./apiRoutes.js";

import { initDB } from "./db.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// If behind a proxy (load balancer) enable trust proxy in production:
// app.set('trust proxy', 1);
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
);

// debug: log every incoming request as early as possible in the
// middleware chain, so we can see whether requests are even reaching
// the app before anything else (body parsing, rate limiting, routing)
// has a chance to fail silently.
app.use((req, _res, next) => {
  console.log(`➡️  ${req.method} ${req.originalUrl}`);
  next();
});

// limit JSON payload size
app.use(express.json({ limit: "10mb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests, please try again later.",
});
app.use(limiter);

// health check endpoints for diagnostics
app.get("/", (_req, res) => {
  res.status(200).json({ status: "ok", service: "companion-studio" });
});
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "healthy" });
});
// healthcheck endpoint for Railway
app.get("/healthz", (_req, res) => res.sendStatus(200));

// mount API routes under /api — apiRoutes.js defines paths like
// /auth/login, /chat/:companion, etc., so this exposes them as
// /api/auth/login, /api/chat/:companion, etc.
app.use("/api", routes);

app.use(express.static(path.join(__dirname, "public")));
app.use("/audio", express.static(path.join(__dirname, "audio")));

// catch-all 404 handler — placed BEFORE the error handler so we can see
// in the logs whether a request actually made it through the middleware
// chain and simply didn't match any route, vs. never reaching the app
// at all.
app.use((req, res) => {
  console.log(`📍 404: ${req.method} ${req.path}`);
  res.status(404).json({ error: "Not found" });
});

// basic error handler
app.use((err, _req, res, _next) => {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

async function start() {
  try {
    console.log("🚀 Starting server initialization...");
    console.log("📦 DATABASE_URL present:", !!process.env.DATABASE_URL);

    try {
      await initDB();
      console.log("✅ Database initialized");
    } catch (dbErr) {
      console.error("⚠️  Database init failed (non-blocking):", dbErr.message);
      console.log("ℹ️  Continuing without DB — routes may fail");
    }

    console.log("✅ Attempting to listen...");
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`✅ Server listening on 0.0.0.0:${PORT}`);
      console.log(`✅ Server running on port ${PORT}`);
    });

    server.on("error", (err) => {
      console.error("❌ Server error:", err);
      process.exit(1);
    });

    server.on("connection", (socket) => {
      console.log(`🔌 New TCP connection from ${socket.remoteAddress}`);
    });

    server.on("close", () => {
      console.log("⚠️  Server closed.");
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

// graceful shutdown hooks
process.on("SIGINT", () => {
  console.log("SIGINT received, exiting.");
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("SIGTERM received, exiting.");
  process.exit(0);
});

// catch anything that would otherwise crash the process silently
// (e.g. an unhandled promise rejection deep in a route or middleware)
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught exception:", err);
  if (err && err.stack) console.error(err.stack);
});
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled promise rejection:", reason);
});

start();
