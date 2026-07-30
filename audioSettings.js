import ElevenLabs from "elevenlabs";
import fs from "fs/promises";
import path from "path";
import { getDB } from "../backend/db.js";

const eleven = new ElevenLabs({
  apiKey: process.env.ELEVENLABSAPIKEY,
});

const VOICEIDS = {
  mia:  process.env.ELEVENLABSVOICEMIA,
  lena: process.env.ELEVENLABSVOICELENA,
  jade: process.env.ELEVENLABSVOICEJADE,
};

const VOICESETTINGS = {
  mia:  { stability: 0.45, similarityboost: 0.85, 
          style: 0.3, usespeakerboost: true },
  lena: { stability: 0.75, similarityboost: 0.90, 
          style: 0.1, usespeakerboost: true },
  jade: { stability: 0.60, similarityboost: 0.88, 
          style: 0.5, usespeakerboost: true },
};

export async function generateVoiceNote(
  personaName, text, userId
) {
  const voiceId = VOICEIDS[personaName];
  if (!voiceId) throw new Error(
    No voice ID for ${personaName}
  );
  const cleanText = text
    .replace(/\/g, "").replace(/\/g, "")
    .replace(/\[.?\]/g, "").trim();
  try {
    const audio = await eleven.generate({
      voice: voiceId,
      text: cleanText,
      modelid: "elevenmultilingualv2",
      voicesettings: VOICESETTINGS[personaName],
    });
    const filename = 
      ${personaName}${userId}${Date.now()}.mp3;
    const outputPath = path.join(
      process.cwd(), "audio", filename
    );
    await fs.mkdir(
      path.join(process.cwd(), "audio"), 
      { recursive: true }
    );
    const chunks = [];
    for await (const chunk of audio) { chunks.push(chunk); }
    await fs.writeFile(outputPath, Buffer.concat(chunks));
    const db = getDB();
    await db.saveVoiceNote({
      persona: personaName, userId, filename, text: cleanText,
    });
    await db.pushVoiceNotification(userId, {
      persona: personaName,
      audioUrl: /audio/${filename},
    });
    return filename;
  } catch (err) {
    console.error([VOICE] Failed for ${personaName}:, err);
    throw err;
  }
}
