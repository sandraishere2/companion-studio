import fs from 'fs/promises';
import path from 'path';

const VOICE_IDS = {
  mia:  process.env.ELEVENLABSVOICEMIA,
  lena: process.env.ELEVENLABSVOICELENA,
  jade: process.env.ELEVENLABSVOICEJADE,
};

const VOICE_SETTINGS = {
  mia:  { stability: 0.45, similarity_boost: 0.85, style: 0.3,  use_speaker_boost: true },
  lena: { stability: 0.75, similarity_boost: 0.90, style: 0.1,  use_speaker_boost: true },
  jade: { stability: 0.60, similarity_boost: 0.88, style: 0.5,  use_speaker_boost: true },
};

export async function generateVoiceNote(personaName, text, userId) {
  if (!process.env.ELEVENLABSAPIKEY) {
    console.info('[voiceGenerator] No ELEVENLABSAPIKEY configured, skipping voice generation');
    return null;
  }

  let ElevenLabs;
  try {
    ({ default: ElevenLabs } = await import('elevenlabs'));
  } catch (err) {
    console.warn('[voiceGenerator] elevenlabs package not available, skipping voice generation');
    return null;
  }

  const voiceId = VOICE_IDS[personaName];
  if (!voiceId) throw new Error(`No voice ID configured for persona: ${personaName}`);

  const cleanText = text
    .replace(/\*/g, '')
    .replace(/_/g, '')
    .replace(/\[.*?\]/g, '')
    .trim();

  const eleven = new ElevenLabs({ apiKey: process.env.ELEVENLABSAPIKEY });

  try {
    const audio = await eleven.generate({
      voice: voiceId,
      text: cleanText,
      model_id: 'eleven_multilingual_v2',
      voice_settings: VOICE_SETTINGS[personaName],
    });

    const filename = `${personaName}-${userId}-${Date.now()}.mp3`;
    const outputPath = path.join(process.cwd(), 'audio', filename);
    await fs.mkdir(path.join(process.cwd(), 'audio'), { recursive: true });

    const chunks = [];
    for await (const chunk of audio) chunks.push(chunk);
    await fs.writeFile(outputPath, Buffer.concat(chunks));

    return filename;
  } catch (err) {
    console.error(`[voiceGenerator] Failed for ${personaName}:`, err);
    throw err;
  }
}
