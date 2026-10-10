// Заготовка Telegram-бота на grammy.
// Это шаблон для пресета "telegram-bot" — при установке файл копируется в проект.

import { config } from 'dotenv';
import { Bot, GrammyError, HttpError } from 'grammy';
import { z } from 'zod';

config();

const env = z
  .object({
    BOT_TOKEN: z.string().min(1, 'BOT_TOKEN пустой — впиши токен от @BotFather'),
    LOG_LEVEL: z.string().default('info'),
  })
  .parse(process.env);

const bot = new Bot(env.BOT_TOKEN);

bot.command('start', async (ctx) => {
  const name = ctx.from?.first_name ?? 'друг';
  await ctx.reply(`Привет, ${name}! Я на связи.\nНапиши /help, чтобы увидеть команды.`);
});

bot.command('help', async (ctx) => {
  await ctx.reply(['/start — поздороваться', '/ping — проверить отклик', '/help — эта справка'].join('\n'));
});

bot.command('ping', async (ctx) => {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - ctx.msg.date);
  await ctx.reply(`pong · сообщение дошло за ${seconds} с`);
});

// Любой текст — эхо. Замени на свою логику.
bot.on('message:text', async (ctx) => {
  await ctx.reply(`Ты написал: ${ctx.msg.text}`);
});

bot.catch((err) => {
  const cause = err.error;
  if (cause instanceof GrammyError) {
    console.error('Telegram отклонил запрос:', cause.description);
  } else if (cause instanceof HttpError) {
    console.error('Telegram недоступен:', cause.message);
  } else {
    console.error('Неизвестная ошибка:', cause);
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(`\n${signal}: останавливаю бота…`);
    void bot.stop();
  });
}

console.log('Бот запущен. Открой Telegram и напиши /start');
await bot.start();
