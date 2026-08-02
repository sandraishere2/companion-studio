import cron from 'node-cron';
import pLimit from 'p-limit';

import { getPersonaReply } from '../../index.js';
import { generateVoiceNote } from '../../voiceGenerator.js';
import { getDB } from '../../backend/db.js';

let VoiceQueue = null;
try {
  const { Queue } = await import('bullmq');
  const redisConnection = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
  };
  if (process.env.REDIS_PASSWORD) redisConnection.password = process.env.REDIS_PASSWORD;
  // support TLS flag if needed
  if (process.env.REDIS_TLS === 'true') redisConnection.tls = {};
  VoiceQueue = new Queue('voice-jobs', { connection: redisConnection });
  console.info('[proactive] BullMQ enabled — voice jobs will be enqueued to Redis');
} catch (err) {
  VoiceQueue = null;
  console.info('[proactive] BullMQ not available — falling back to local limited worker');
}

const CONCURRENCY = parseInt(process.env.PROACTIVE_CONCURRENCY || '10', 10);
const limit = pLimit(CONCURRENCY);

async function getActiveSubscribers(personaName) {
  const db = getDB();
  return db.getActiveSubscribers(personaName);
}

async function sendProactiveMessage(personaName, userId, trigger) {
  const db = getDB();
  const conversationHistory = await db.getConversationHistory(personaName, userId, 20);
  const { reply } = await getPersonaReply({
    personaName,
    userId,
    userMessage: `Proactive trigger — ${trigger}. Generate appropriate outreach.`,
    conversationHistory,
  });

  await db.saveMessage({
    persona: personaName,
    userId,
    role: 'assistant',
    content: reply,
    isProactive: true,
  });

  // Fire-and-forget notification
  try {
    db.pushNotification(userId, { persona: personaName, message: reply });
  } catch (err) {
    console.error('[proactive] pushNotification failed:', err);
  }

  return reply;
}

async function enqueueVoiceJob(persona, reply, userId, opts = {}) {
  if (VoiceQueue) {
    try {
      await VoiceQueue.add('generate-voice', { persona, reply, userId }, {
        delay: opts.delay || 0,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });
    } catch (err) {
      console.error('[proactive] failed to enqueue voice job:', err);
      // fallback to local execution
      await limit(() => generateVoiceNote(persona, reply, userId));
    }
  } else {
    // local limited concurrency fallback (not persistent)
    await limit(() => generateVoiceNote(persona, reply, userId));
  }
}

async function processSubscribers(persona, subscribers, options = {}) {
  const localLimit = pLimit(options.concurrent || CONCURRENCY);
  await Promise.all(subscribers.map(sub => localLimit(async () => {
    try {
      const reply = await sendProactiveMessage(persona, sub.userId, options.trigger || 'proactive');
      if (options.enqueueVoice && ['premium', 'vip'].includes(sub.tier)) {
        const delay = options.delayMs || 0;
        await enqueueVoiceJob(persona, reply, sub.userId, { delay });
      }
    } catch (err) {
      console.error(`[CRON] ${persona} subscriber ${sub.userId} failed:`, err);
    }
  })));
}

// Jade 6am Cape Town -> 04:00 UTC ; run at minute 0 hour 4 UTC
cron.schedule('0 4 * * *', async () => {
  try {
    const subscribers = await getActiveSubscribers('jade');
    await processSubscribers('jade', subscribers, { trigger: '6am morning check-in', enqueueVoice: true });
    console.info('[proactive] Jade cron completed');
  } catch (err) {
    console.error('[proactive] Jade cron failed:', err);
  }
}, { timezone: 'UTC' });

// Lena 11pm Vienna (22:00 UTC)
cron.schedule('0 22 * * *', async () => {
  try {
    const subscribers = await getActiveSubscribers('lena');
    await processSubscribers('lena', subscribers, { trigger: '11pm evening check-in', enqueueVoice: true });
    console.info('[proactive] Lena cron completed');
  } catch (err) {
    console.error('[proactive] Lena cron failed:', err);
  }
}, { timezone: 'UTC' });

// Mia random late night 30%: enqueue delayed jobs instead of in-process timeouts
cron.schedule('0 23 * * *', async () => {
  try {
    const subscribers = await getActiveSubscribers('mia');
    const selected = subscribers.filter(() => Math.random() < 0.3);
    await Promise.all(selected.map(s => (async () => {
      try {
        const delayMinutes = Math.floor(Math.random() * 120); // up to 120 minutes
        const delayMs = delayMinutes * 60 * 1000;
        // schedule a single-message process with optional delayed voice job
        await processSubscribers('mia', [s], { trigger: 'late night spontaneous message', enqueueVoice: true, delayMs });
      } catch (err) {
        console.error('[CRON] Mia single subscriber failed:', err);
      }
    })()));
    console.info('[proactive] Mia cron completed — selected', selected.length);
  } catch (err) {
    console.error('[proactive] Mia cron failed:', err);
  }
}, { timezone: 'UTC' });

// Re-engagement every 6 hours: cron expression '0 */6 * * *'
cron.schedule('0 */6 * * *', async () => {
  try {
    const db = getDB();
    for (const persona of ['mia','lena','jade']) {
      const silentUsers = await db.getUsersSilentFor(persona, 48);
      await processSubscribers(persona, silentUsers, { trigger: '48-hour silence re-engagement', enqueueVoice: false });
    }
    console.info('[proactive] Re-engagement cron completed');
  } catch (err) {
    console.error('[proactive] Re-engagement cron failed:', err);
  }
}, { timezone: 'UTC' });
