// Заготовка скрейпера: Playwright + cheerio + ограничение параллелизма.
// Это шаблон для пресета "scraper" — при установке файл копируется в проект.
//
// Перед первым запуском: npm run browsers

import { config } from 'dotenv';
import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';

config();

const START_URL = process.env.START_URL ?? 'https://news.ycombinator.com';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const HEADLESS = (process.env.HEADLESS ?? 'true') !== 'false';

const browser = await chromium.launch({ headless: HEADLESS });
const page = await browser.newPage();

console.log(`Открываю ${START_URL}`);
await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

// Собираем ссылки на страницы, которые хотим обойти.
const links = await page.$$eval('a.titlelink, a.storylink, a[href^="http"]', (nodes) =>
  [...new Set(nodes.map((node) => (node as HTMLAnchorElement).href))].slice(0, 20),
);
console.log(`Нашёл ссылок: ${links.length}`);

const limit = pLimit(CONCURRENCY);
const results = await Promise.all(
  links.map((url) =>
    limit(async () => {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const html = await page.content();
        const $ = cheerio.load(html);
        return { url, title: $('title').first().text().trim() || '(без заголовка)' };
      } catch (err) {
        return { url, title: `ошибка: ${(err as Error).message}` };
      }
    }),
  ),
);

for (const row of results) {
  console.log(`· ${row.title}\n  ${row.url}`);
}

await browser.close();
console.log(`\nГотово: ${results.length} страниц.`);
