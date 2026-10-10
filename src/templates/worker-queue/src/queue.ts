// Описание очереди и пример постановки задач.
// Это шаблон для пресета "worker-queue" — при установке файл копируется в проект.
//
// Запуск: npm run enqueue  (положить задачи)  →  npm run worker  (обработать)

import { config } from 'dotenv';
import { Queue } from 'bullmq';

config();

const connection = { url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379' };
export const QUEUE_NAME = process.env.QUEUE_NAME ?? 'jobs';

export const queue = new Queue(QUEUE_NAME, { connection });

export interface JobData {
  kind: string;
  payload: Record<string, unknown>;
}

// Если файл запущен напрямую — кладём пару демо-задач.
if (process.argv[1]?.endsWith('queue.ts')) {
  const jobs: JobData[] = [
    { kind: 'greet', payload: { name: 'мир' } },
    { kind: 'sum', payload: { a: 2, b: 40 } },
  ];

  for (const data of jobs) {
    const job = await queue.add(data.kind, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    console.log(`поставил задачу ${job.id} (${data.kind})`);
  }

  console.log('\nТеперь запусти воркер: npm run worker');
  await queue.close();
}
