import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { router } from "./routes.js";
import { initDB } from "./db.js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
}));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests, please try again later.",
});
app.use("/api/", limiter);
app.use("/api", router);
app.use("/audio", express.static("audio"));

async function start() {
  await initDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start();
