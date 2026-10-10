// Заготовка библиотеки: одна функция с типами.
// Это шаблон для пресета "node-lib" — при установке файл копируется в проект.

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  /** Что считать успехом: по умолчанию — любой ответ без исключения. */
  isDone?: (value: unknown) => boolean;
}

/**
 * Повторить асинхронную операцию с растущей паузой.
 * Бросает последнюю ошибку, если все попытки исчерпаны.
 */
export async function retry<T>(task: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = Math.max(0, options.delayMs ?? 200);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const value = await task();
      if (!options.isDone || options.isDone(value)) return value;
      lastError = new Error('результат не принят проверкой isDone');
    } catch (err) {
      lastError = err;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
