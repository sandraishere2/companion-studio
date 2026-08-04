import { ElevenLabsClient } from 'elevenlabs';

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

/**
 * Generate a voice note for a persona using ElevenLabs
 * @param {string} persona - The persona name ('mia', 'lena', 'jade')
 * @param {string} text - The text to convert to speech
 * @param {string} userId - The user ID to associate with this voice note
 * @returns {Promise<Object>} Voice note metadata
 */
export async function generateVoiceNote(persona, text, userId) {
  if (!text || text.trim().length === 0) {
    throw new Error('Cannot generate voice note: text is empty');
  }

  // Map personas to their ElevenLabs voice IDs
  const voiceMap = {
    mia: process.env.ELEVENLABS_VOICE_JADE || 'mZxDd7xv8t0q',
    lena: process.env.ELEVENLABS_VOICE_LENA || 'EXAVITQu4vr4',
    jade: 'MF3mGyEYCl7XYWbV9V6O',
  };

  const voiceId = voiceMap[persona.toLowerCase()];
  if (!voiceId) {
    throw new Error(`Unknown persona: ${persona}`);
  }

  try {
    console.info(`[voiceGenerator] generating voice note for ${persona}/${userId}`, {
      textLength: text.length,
      voiceId,
    });

    const voiceNote = await client.generate({
      voice_id: voiceId,
      text: text,
      model_id: 'eleven_monolingual_v1',
    });

    console.info(`[voiceGenerator] voice note generated for ${persona}/${userId}`, {
      audioLength: voiceNote?.length || 'unknown',
    });

    return {
      persona,
      userId,
      timestamp: new Date().toISOString(),
      success: true,
      audioData: voiceNote,
    };
  } catch (error) {
    console.error(`[voiceGenerator] failed to generate voice note for ${persona}/${userId}`, error);
    throw new Error(`Voice generation failed for ${persona}: ${error.message}`);
  }
}
