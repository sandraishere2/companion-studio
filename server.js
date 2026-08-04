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

// limit JSON payload size
app.use(express.json({ limit: "10mb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests, please try again later.",
});
app.use("/api/", limiter);

app.use("/api", routes);
app.use(express.static(path.join(__dirname, "public")));
app.use("/audio", express.static(path.join(__dirname, "audio")));

// healthcheck
app.get("/healthz", (_req, res) => res.sendStatus(200));

// basic error handler
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

async function start() {
  try {
    await initDB();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
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

start();
