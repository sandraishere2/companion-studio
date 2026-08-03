import fs from "fs/promises";
import path from "path";

const VOICE_IDS = {
  mia:  process.env.ELEVENLABS_VOICE_MIA,
  lena: process.env.ELEVENLABS_VOICE_LENA,
  jade: process.env.ELEVENLABS_VOICE_JADE,
};

const VOICE_SETTINGS = {
  mia:  { stability: 0.45, similarity_boost: 0.85, style: 0.3, use_speaker_boost: true },
  lena: { stability: 0.75, similarity_boost: 0.90, style: 0.1, use_speaker_boost: true },
  jade: { stability: 0.60, similarity_boost: 0.88, style: 0.5, use_speaker_boost: true },
};

export async function generateVoiceNote(personaName, text, userId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = VOICE_IDS[personaName];

  if (!apiKey || !voiceId) {
    console.warn(
      `[voiceGenerator] Skipping — ELEVENLABS_API_KEY or voice ID for "${personaName}" not configured.`
    );
    return null;
  }

  const cleanText = text
    .replace(/\*/g, "")
    .replace(/_/g, "")
    .replace(/\[.*?\]/g, "")
    .trim();

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: "eleven_multilingual_v2",
        voice_settings: VOICE_SETTINGS[personaName] ?? VOICE_SETTINGS.mia,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
  }

  const filename = `${personaName}_${userId}_${Date.now()}.mp3`;
  const audioDir = path.join(process.cwd(), "audio");
  await fs.mkdir(audioDir, { recursive: true });
  await fs.writeFile(path.join(audioDir, filename), Buffer.from(await response.arrayBuffer()));

  return filename;
}
