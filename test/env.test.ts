// Переменные окружения: разбор .env, сравнение с примером, маскировка секретов.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  envDiff,
  envKeys,
  fillEnvFromExample,
  fillExampleFromEnv,
  isSecretKey,
  maskValue,
  readEnv,
} from '../src/core/env.ts';
import { makeProject, removeDir } from './helpers.ts';

test('readEnv разбирает файл, игнорируя комментарии и пробелы', () => {
  const dir = makeProject({
    '.env': '# комментарий\n\nPORT = 3000 \nJWT_SECRET=abc:def==\nПУСТАЯ=\nЛОЖНАЯ_СТРОКА\n',
  });
  try {
    const pairs = readEnv(path.join(dir, '.env'));
    assert.deepEqual(pairs, [
      { key: 'PORT', value: '3000' },
      { key: 'JWT_SECRET', value: 'abc:def==' },
      { key: 'ПУСТАЯ', value: '' },
    ]);
    assert.deepEqual(envKeys(path.join(dir, '.env')), ['PORT', 'JWT_SECRET', 'ПУСТАЯ']);
  } finally {
    removeDir(dir);
  }
});

test('readEnv терпит BOM и отсутствие файла', () => {
  const dir = makeProject({ '.env': '\uFEFFA=1\n' });
  try {
    assert.deepEqual(readEnv(path.join(dir, '.env')), [{ key: 'A', value: '1' }]);
    assert.deepEqual(readEnv(path.join(dir, 'нет-такого')), []);
  } finally {
    removeDir(dir);
  }
});

test('isSecretKey узнаёт секреты по имени', () => {
  for (const key of ['BOT_TOKEN', 'JWT_SECRET', 'DB_PASSWORD', 'API_KEY', 'PRIVATE_KEY', 'AUTH_SALT']) {
    assert.equal(isSecretKey(key), true, `${key} должен считаться секретом`);
  }
  for (const key of ['PORT', 'LOG_LEVEL', 'NODE_ENV', 'DATABASE_URL']) {
    assert.equal(isSecretKey(key), false, `${key} не секрет по имени`);
  }
});

test('maskValue прячет секреты и не трогает обычные значения', () => {
  assert.equal(maskValue('PORT', '3000'), '3000');
  assert.equal(maskValue('LOG_LEVEL', 'debug'), 'debug');
  assert.equal(maskValue('BOT_TOKEN', ''), '(пусто)');
  assert.equal(maskValue('DATABASE_URL', 'file:./dev.db'), 'file:./dev.db', 'путь к файлу показывать полезно');

  const masked = maskValue('BOT_TOKEN', '123456:AAHsecret-token-value');
  assert.ok(!masked.includes('secret'), 'секрет не должен попадать в вывод');
  assert.ok(masked.startsWith('123'), 'начало оставляем, чтобы узнать значение');
  assert.ok(masked.includes('••••••'));

  // Пароль внутри строки подключения прячем, даже если имя переменной безобидное.
  const dsn = maskValue('DATABASE_URL', 'postgres://admin:supersecret@localhost:5432/app');
  assert.ok(!dsn.includes('supersecret'), 'пароль из строки подключения не показываем');

  // Короткий секрет не должен раскрываться целиком.
  assert.equal(maskValue('API_KEY', 'abc'), '••••••');
});

test('envDiff показывает, чего не хватает и что лишнее', () => {
  const dir = makeProject({
    '.env.example': 'PORT=3000\nDATABASE_URL=file:./dev.db\nJWT_SECRET=\nLOG_LEVEL=info\n',
    '.env': 'PORT=8080\nLOG_LEVEL=debug\nMY_FLAG=1\nEMPTY_ONE=\n',
  });
  try {
    const diff = envDiff(dir);
    assert.equal(diff.hasEnv, true);
    assert.equal(diff.hasExample, true);
    assert.deepEqual(diff.missing, ['DATABASE_URL', 'JWT_SECRET']);
    assert.deepEqual(diff.extra, ['MY_FLAG', 'EMPTY_ONE']);
    assert.deepEqual(diff.empty, ['EMPTY_ONE']);
    assert.equal(diff.env.length, 4);
    assert.equal(diff.example.length, 4);
  } finally {
    removeDir(dir);
  }
});

test('envDiff корректно работает с одним файлом из двух', () => {
  const onlyExample = makeProject({ '.env.example': 'A=1\n' });
  const onlyEnv = makeProject({ '.env': 'A=1\n' });
  const none = makeProject({ 'package.json': '{}' });
  try {
    const first = envDiff(onlyExample);
    assert.equal(first.hasEnv, false);
    assert.equal(first.hasExample, true);
    assert.deepEqual(first.missing, ['A'], 'без .env всё из примера считается отсутствующим');

    const second = envDiff(onlyEnv);
    assert.equal(second.hasExample, false);
    assert.deepEqual(second.extra, ['A']);

    const third = envDiff(none);
    assert.equal(third.hasEnv, false);
    assert.equal(third.hasExample, false);
    assert.deepEqual(third.missing, []);
  } finally {
    for (const dir of [onlyExample, onlyEnv, none]) removeDir(dir);
  }
});

test('fillEnvFromExample создаёт .env и дописывает только недостающее', () => {
  const dir = makeProject({ '.env.example': 'PORT=3000\nJWT_SECRET=\nLOG_LEVEL=info\n' });
  try {
    const created = fillEnvFromExample(dir);
    assert.equal(created.created, true);
    assert.deepEqual(created.added, ['PORT', 'JWT_SECRET', 'LOG_LEVEL']);
    const text = readFileSync(path.join(dir, '.env'), 'utf8');
    assert.ok(text.includes('PORT=3000'), 'значение из примера переносится');
    assert.ok(text.includes('JWT_SECRET='), 'пустое значение тоже переносится');
    assert.match(text, /^# создано jd env/, 'в новом файле есть пояснение');

    // Повторный вызов ничего не добавляет.
    assert.deepEqual(fillEnvFromExample(dir, envDiff(dir)).added, []);

    // Значение, выставленное человеком, не перезаписывается.
    const mine = readFileSync(path.join(dir, '.env'), 'utf8').replace('PORT=3000', 'PORT=9999');
    writeFileSync(path.join(dir, '.env'), mine, 'utf8');
    assert.deepEqual(fillEnvFromExample(dir, envDiff(dir)).added, []);
    assert.ok(readFileSync(path.join(dir, '.env'), 'utf8').includes('PORT=9999'), 'значение пользователя не меняется');
  } finally {
    removeDir(dir);
  }
});

test('fillEnvFromExample без примера ничего не делает', () => {
  const dir = makeProject({});
  try {
    const result = fillEnvFromExample(dir);
    assert.deepEqual(result.added, []);
    assert.equal(result.created, false);
    assert.throws(() => readFileSync(path.join(dir, '.env'), 'utf8'), 'файл не создаётся из воздуха');
  } finally {
    removeDir(dir);
  }
});

test('fillExampleFromEnv добавляет в пример только имена, без значений', () => {
  const dir = makeProject({ '.env': 'PORT=8080\nMY_SECRET=очень-секретно\n', '.env.example': 'PORT=3000\n' });
  try {
    const result = fillExampleFromEnv(dir);
    assert.deepEqual(result.added, ['MY_SECRET']);
    const example = readFileSync(path.join(dir, '.env.example'), 'utf8');
    assert.ok(example.includes('MY_SECRET='), 'ключ попал в пример');
    assert.ok(!example.includes('очень-секретно'), 'значение секрета в пример не попадает');
    assert.ok(example.startsWith('PORT=3000'), 'старое содержимое на месте');
  } finally {
    removeDir(dir);
  }
});

test('fillExampleFromEnv ничего не делает, когда лишнего нет', () => {
  const dir = makeProject({ '.env': 'A=1\n', '.env.example': 'A=\n' });
  try {
    assert.deepEqual(fillExampleFromEnv(dir).added, []);
  } finally {
    removeDir(dir);
  }
});
