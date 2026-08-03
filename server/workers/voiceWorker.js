import { Worker } from 'bullmq';
import { generateVoiceNote } from '../../voiceGenerator.js';

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
};
if (process.env.REDIS_PASSWORD) connection.password = process.env.REDIS_PASSWORD;
if (process.env.REDIS_TLS === 'true') connection.tls = {};

const worker = new Worker('voice-jobs', async (job) => {
  const { persona, reply, userId } = job.data;
  console.info('[voiceWorker] processing job', job.id, persona, userId);
  // generateVoiceNote may throw; let BullMQ handle retries based on job opts
  await generateVoiceNote(persona, reply, userId);
}, { connection });

worker.on('completed', job => {
  console.info('[voiceWorker] job completed', job.id);
});

worker.on('failed', (job, err) => {
  console.error('[voiceWorker] job failed', job.id, err);
});

process.on('SIGINT', async () => {
  await worker.close();
  process.exit(0);
});
