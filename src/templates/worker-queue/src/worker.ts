// Воркер очереди: берёт задачи, логирует и корректно останавливается.
// Это шаблон для пресета "worker-queue" — при установке файл копируется в проект.

import { config } from 'dotenv';
import { Worker, type Job } from 'bullmq';
import { QUEUE_NAME, type JobData } from './queue.ts';

config();

const CONCURRENCY = Number(process.env.CONCURRENCY ?? 5);

const worker = new Worker<JobData>(
  QUEUE_NAME,
  async (job: Job<JobData>) => {
    const { kind, payload } = job.data;
    console.log(`[${job.id}] ${kind} — попытка ${job.attemptsMade + 1}`);

    switch (kind) {
      case 'greet':
        return `Привет, ${String(payload.name ?? 'мир')}!`;
      case 'sum':
        return Number(payload.a ?? 0) + Number(payload.b ?? 0);
      default:
        throw new Error(`неизвестный тип задачи: ${kind}`);
    }
  },
  { connection: { url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379' }, concurrency: CONCURRENCY },
);

worker.on('completed', (job, result) => console.log(`[${job.id}] готово: ${JSON.stringify(result)}`));
worker.on('failed', (job, err) => console.error(`[${job?.id}] упало: ${err.message}`));
worker.on('error', (err) => console.error('ошибка воркера:', err.message));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(`\n${signal}: дожидаюсь текущих задач…`);
    void worker.close().then(() => process.exit(0));
  });
}

console.log(`Воркер слушает очередь «${QUEUE_NAME}» (параллельно: ${CONCURRENCY})`);
