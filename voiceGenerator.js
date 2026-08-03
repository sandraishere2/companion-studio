import fs from "fs/promises";
import path from "path";
import { getDB } from "./db.js";

const VOICE_IDS = {
  mia:  process.env.ELEVENLABS_VOICE_MIA,
  lena: process.env.ELEVENLABS_VOICE_LENA,
  jade: process.env.ELEVENLABS_VOICE_JADE,
};

const VOICE_SETTINGS = {
  mia:  { stability: 0.45, similarity_boost: 0.85, style: 0.3,  use_speaker_boost: true },
  lena: { stability: 0.75, similarity_boost: 0.90, style: 0.1,  use_speaker_boost: true },
  jade: { stability: 0.60, similarity_boost: 0.88, style: 0.5,  use_speaker_boost: true },
};

export async function generateVoiceNote(personaName, text, userId) {
  const voiceId = VOICE_IDS[personaName];
  if (!voiceId) {
    console.warn(`[voiceGenerator] No voice ID configured for ${personaName}, skipping`);
    return null;
  }
  if (!process.env.ELEVENLABS_API_KEY) {
    console.warn("[voiceGenerator] ELEVENLABS_API_KEY not set, skipping voice generation");
    return null;
  }

  const cleanText = text
    .replace(/</g, "")
    .replace(/>/g, "")
    .replace(/\[.*?\]/g, "")
    .trim();

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: "eleven_multilingual_v2",
        voice_settings: VOICE_SETTINGS[personaName] || { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs error: ${errText}`);
  }

  const filename = `${personaName}_${userId}_${Date.now()}.mp3`;
  const outputPath = path.join(process.cwd(), "audio", filename);
  await fs.mkdir(path.join(process.cwd(), "audio"), { recursive: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);

  const db = getDB();
  await db.saveVoiceNote({ persona: personaName, userId, filename, text: cleanText });
  await db.pushVoiceNotification(userId, {
    persona: personaName,
    audioUrl: `/audio/${filename}`,
  });
  return filename;
}
