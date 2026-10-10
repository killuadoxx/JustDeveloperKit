// Заготовка REST API на Fastify.
// Это шаблон для пресета "api-rest" — при установке файл копируется в проект.

import { config } from 'dotenv';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';

config();

const env = z
  .object({
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.string().default('info'),
  })
  .parse(process.env);

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    // Красивый вывод только локально: в проде нужен машинный JSON.
    ...(process.env.NODE_ENV === 'production' ? {} : { transport: { target: 'pino-pretty' } }),
  },
});

await app.register(cors, { origin: true });

app.get('/health', async () => ({
  ok: true,
  uptime: Math.round(process.uptime()),
  now: new Date().toISOString(),
}));

const echoSchema = z.object({ message: z.string().min(1) });

app.post('/echo', async (request, reply) => {
  const parsed = echoSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Нужно поле message (непустая строка)', issues: parsed.error.issues });
  }
  return { echo: parsed.data.message, at: new Date().toISOString() };
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal}: останавливаю сервер…`);
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`проверка: http://localhost:${env.PORT}/health`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
