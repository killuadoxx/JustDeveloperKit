// Гасим единственное предупреждение, которое реально мешает: node:sqlite
// помечен экспериментальным, но работает стабильно. Всё остальное пропускаем.
const orig = process.emitWarning.bind(process);

// @ts-ignore — подменяем сигнатуру сознательно, чтобы фильтровать по тексту
process.emitWarning = (warning: unknown, ...rest: unknown[]) => {
  const msg = typeof warning === 'string' ? warning : String((warning as Error)?.message ?? '');
  if (msg.includes('SQLite is an experimental feature')) return;
  // @ts-ignore
  return orig(warning, ...rest);
};

export {};
