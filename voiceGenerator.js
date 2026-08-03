import fs from "fs/promises";
import path from "path";

import { getDB } from "./db.js";

function normalizeSegment(value, fallback = "unknown") {
  return String(value ?? fallback)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function normalizeText(text) {
  return String(text ?? "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function persistVoiceNote({ personaName, userId, filename, text }) {
  try {
    const db = getDB();
    await db.saveVoiceNote({
      persona: personaName,
      userId,
      filename,
      text,
    });
    await db.pushVoiceNotification(userId, {
      persona: personaName,
      audioUrl: `/audio/${filename}`,
    });
  } catch (err) {
    console.warn("[voice] skipping voice note persistence:", err.message);
  }
}

export async function generateVoiceNote(personaName, text, userId) {
  const cleanText = normalizeText(text);
  const filename = `${normalizeSegment(personaName, "persona")}-${normalizeSegment(userId, "user")}-${Date.now()}.mp3`;
  const audioDir = path.join(process.cwd(), "audio");

  await fs.mkdir(audioDir, { recursive: true });
  await fs.writeFile(path.join(audioDir, filename), Buffer.alloc(0));
  await persistVoiceNote({
    personaName,
    userId,
    filename,
    text: cleanText,
  });

  console.info("[voice] generated placeholder voice note", filename);
  return filename;
}
