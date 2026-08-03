import fs from 'fs/promises';
import path from 'path';
import { getDB } from './db.js';

const VOICE_IDS = {
  mia:  process.env.ELEVENLABS_VOICE_MIA  || process.env.ELEVENLABSVOICEMIA,
  lena: process.env.ELEVENLABS_VOICE_LENA || process.env.ELEVENLABSVOICELENA,
  jade: process.env.ELEVENLABS_VOICE_JADE || process.env.ELEVENLABSVOICEJADE,
};

const VOICE_SETTINGS = {
  mia:  { stability: 0.45, similarity_boost: 0.85, style: 0.3, use_speaker_boost: true },
  lena: { stability: 0.75, similarity_boost: 0.90, style: 0.1, use_speaker_boost: true },
  jade: { stability: 0.60, similarity_boost: 0.88, style: 0.5, use_speaker_boost: true },
};

export async function generateVoiceNote(personaName, text, userId) {
  const apiKey = process.env.ELEVENLABSAPIKEY;
  if (!apiKey) {
    console.info(`[voiceGenerator] ELEVENLABSAPIKEY not set — skipping voice generation for ${personaName}`);
    return null;
  }

  const voiceId = VOICE_IDS[personaName];
  if (!voiceId) {
    console.warn(`[voiceGenerator] No voice ID configured for persona: ${personaName}`);
    return null;
  }

  const cleanText = text
    .replace(/\*/g, '')
    .replace(/_/g, '')
    .replace(/\[.*?\]/g, '')
    .trim();

  let ElevenLabs;
  try {
    ({ default: ElevenLabs } = await import('elevenlabs'));
  } catch {
    console.warn('[voiceGenerator] elevenlabs package not available — skipping voice generation');
    return null;
  }

  const eleven = new ElevenLabs({ apiKey });

  try {
    const audio = await eleven.generate({
      voice: voiceId,
      text: cleanText,
      model_id: 'eleven_multilingual_v2',
      voice_settings: VOICE_SETTINGS[personaName],
    });

    const filename = `${personaName}_${userId}_${Date.now()}.mp3`;
    const outputDir = path.join(process.cwd(), 'audio');
    const outputPath = path.join(outputDir, filename);

    await fs.mkdir(outputDir, { recursive: true });

    const chunks = [];
    for await (const chunk of audio) { chunks.push(chunk); }
    await fs.writeFile(outputPath, Buffer.concat(chunks));

    const db = getDB();
    await db.saveVoiceNote({ persona: personaName, userId, filename, text: cleanText });
    await db.pushVoiceNotification(userId, {
      persona: personaName,
      audioUrl: `/audio/${filename}`,
    });

    return filename;
  } catch (err) {
    console.error(`[voiceGenerator] Failed for ${personaName}:`, err);
    throw err;
  }
}
