# Companion Studio — Proactive Jobs & Worker

This branch introduces a queue-based approach for proactive messages and voice generation using BullMQ and Redis.

## New files / important changes
- `server/jobs/proactive.js` — cron jobs now enqueue voice tasks to BullMQ with concurrency control.
- `server/workers/voiceWorker.js` — BullMQ worker that processes `generate-voice` jobs and calls `generateVoiceNote`.
- `public/index.html` — frontend performance improvements (batched DOM updates, fetch timeouts, message cap).
- `styles.css` — restored to CSS-only.
- `package.json` — added dependencies: `p-limit`, `node-cron`, `bullmq`, `ioredis` and npm script `worker`.

## Migration / Quickstart
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start Redis (local dev):
   ```bash
   docker run --name companion-redis -p 6379:6379 -d redis:7
   ```
3. Set env vars (example):
   ```bash
   export REDIS_HOST=127.0.0.1
   export REDIS_PORT=6379
   # optionally: REDIS_PASSWORD, REDIS_TLS=true
   export PROACTIVE_CONCURRENCY=10
   ```
4. Start app and worker in separate terminals:
   ```bash
   npm start
   npm run worker
   ```

## Testing checklist (smoke tests)
- [ ] Start Redis locally and set `REDIS_HOST`.
- [ ] Run `npm start` and `npm run worker` in separate terminals.
- [ ] Verify web UI still loads and sending messages works.
- [ ] Trigger cron handlers manually or wait for schedule to confirm jobs are enqueued.
- [ ] Verify the worker processes `generate-voice` jobs and logs show processing/completion.

## Production recommendations
- Use a managed Redis (e.g., AWS ElastiCache, Azure Redis Cache, Redis Cloud) in the same cloud region/VPC as your app/worker for low latency and high availability.
- Run the BullMQ worker as a separate process (or separate service) from the web server for resource isolation.
- Monitor job queue length, job failures, and worker memory/CPU.

