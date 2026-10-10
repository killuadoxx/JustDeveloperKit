// Первый тест: vitest уже настроен пресетом.
// Это шаблон для пресета "node-lib" — при установке файл копируется в проект.

import { describe, expect, it } from 'vitest';
import { retry } from './index.ts';

describe('retry', () => {
  it('возвращает результат с первой попытки', async () => {
    const value = await retry(async () => 42);
    expect(value).toBe(42);
  });

  it('повторяет после ошибки', async () => {
    let calls = 0;
    const value = await retry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('ещё рано');
        return 'готово';
      },
      { delayMs: 1 },
    );
    expect(value).toBe('готово');
    expect(calls).toBe(3);
  });

  it('бросает последнюю ошибку, когда попытки кончились', async () => {
    await expect(retry(async () => { throw new Error('всё сломалось'); }, { attempts: 2, delayMs: 1 })).rejects.toThrow(
      'всё сломалось',
    );
  });
});
