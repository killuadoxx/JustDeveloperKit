// Контекст проекта: разбор .me.json, подстановка параметров, ссылки на команды.

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  applyInputs,
  commandCwd,
  commandEnv,
  DEFAULT_ME,
  findMeFile,
  inputPlaceholders,
  matchCommandRef,
  parseMe,
  shellQuote,
  type MeCommand,
  type ProjectContext,
} from '../src/core/project.ts';
import { makeProject, removeDir, writeFiles } from './helpers.ts';

const file = path.join('C:', 'проект', '.me.json');

test('parseMe: полный конфиг разбирается без замечаний', () => {
  const result = parseMe(
    JSON.stringify({
      projectName: 'Мой бот',
      ports: [3000, 5173],
      env: { NODE_ENV: 'development', DEBUG: true },
      commands: [
        { name: '🚀 Dev', cmd: 'npm run dev', desc: 'сервер', cwd: 'app', confirm: true },
        { name: 'Test', cmd: 'npm test', dependsOn: ['🚀 Dev'], inputs: [{ name: 'file', prompt: 'файл' }] },
      ],
    }),
    file,
  );
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.equal(result.project.config.projectName, 'Мой бот');
  assert.deepEqual(result.project.config.ports, [3000, 5173]);
  assert.equal(result.project.config.env?.DEBUG, 'true', 'булево превращается в строку');
  assert.equal(result.project.config.commands.length, 2);
  assert.equal(result.project.warnings.length, 0);
  assert.equal(result.project.dir, path.dirname(file));
});

test('parseMe: битый JSON не бросает, а сообщает', () => {
  const result = parseMe('{ это не json', file);
  assert.equal(result.status, 'broken');
  if (result.status === 'broken') {
    assert.equal(result.file, file);
    assert.ok(result.error.length > 0);
  }
});

test('parseMe: BOM в начале файла не мешает', () => {
  const result = parseMe('\uFEFF{"projectName":"С BOM","commands":[]}', file);
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') assert.equal(result.project.config.projectName, 'С BOM');
});

test('parseMe: массив вместо объекта — это ошибка', () => {
  assert.equal(parseMe('[]', file).status, 'broken');
  assert.equal(parseMe('"строка"', file).status, 'broken');
  assert.equal(parseMe('null', file).status, 'broken');
});

test('parseMe: мусор в командах пропускается с замечанием, а не ломает всё', () => {
  const result = parseMe(
    JSON.stringify({
      projectName: 'Тест',
      commands: [
        { name: 'ok', cmd: 'echo 1' },
        { name: 'без команды' },
        'строка вместо объекта',
        { cmd: 'echo 2' },
        { name: 'дубль', cmd: 'echo 3' },
        { name: 'дубль', cmd: 'echo 4' },
      ],
      ports: ['3000', 99999, 70000],
    }),
    file,
  );
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.project.config.commands.map((c) => c.name), ['ok', 'дубль']);
  assert.deepEqual(result.project.config.ports, [3000]);
  assert.ok(result.project.warnings.length >= 3, `замечаний: ${result.project.warnings.join('; ')}`);
  assert.ok(result.project.warnings.some((w) => w.includes('порт')));
});

test('parseMe: без projectName берётся имя папки', () => {
  const dir = path.join('C:', 'files', 'my-service');
  const result = parseMe('{"commands":[]}', path.join(dir, '.me.json'));
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') assert.equal(result.project.config.projectName, 'my-service');
});

test('DEFAULT_ME разбирается собственным парсером — шаблон jd init рабочий', () => {
  const result = parseMe(JSON.stringify(DEFAULT_ME), file);
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') assert.equal(result.project.warnings.length, 0);
});

test('findMeFile ищет файл вверх по дереву', () => {
  const dir = makeProject({ '.me.json': '{"projectName":"вверх","commands":[]}' });
  try {
    writeFiles(dir, { 'src/deep/nested/.keep': '' });
    const found = findMeFile(path.join(dir, 'src', 'deep', 'nested'));
    assert.equal(found, path.join(dir, '.me.json'));
  } finally {
    removeDir(dir);
  }
});

test('findMeFile возвращает null, когда файла нет', () => {
  const dir = makeProject({ 'readme.md': 'нет конфига' });
  try {
    assert.equal(findMeFile(dir), null);
  } finally {
    removeDir(dir);
  }
});

test('matchCommandRef: имя, команда, слаг без эмодзи и подстрока', () => {
  const list: MeCommand[] = [
    { name: '🚀 Dev Server', cmd: 'npm run dev' },
    { name: '⚗️ Prisma Push', cmd: 'npx prisma db push' },
  ];
  assert.equal(matchCommandRef(list, '🚀 Dev Server')?.cmd, 'npm run dev');
  assert.equal(matchCommandRef(list, 'npm run dev')?.name, '🚀 Dev Server');
  assert.equal(matchCommandRef(list, 'dev-server')?.cmd, 'npm run dev', 'эмодзи и пробелы не мешают');
  assert.equal(matchCommandRef(list, 'prisma')?.cmd, 'npx prisma db push', 'подстрока тоже работает');
  assert.equal(matchCommandRef(list, 'чего-то нет'), null);
  assert.equal(matchCommandRef(list, '   '), null);
});

test('applyInputs подставляет значения и экранирует их', () => {
  assert.equal(applyInputs('echo {{name}}', { name: 'world' }), 'echo world');
  assert.equal(applyInputs('echo {{ name }}', { name: 'world' }), 'echo world');
  assert.equal(applyInputs('echo {{name}}', {}), 'echo {{name}}', 'без значения placeholder остаётся');
  const quoted = applyInputs('run {{path}}', { path: 'две слова' });
  assert.ok(quoted.includes('две слова'));
  assert.notEqual(quoted, 'run две слова', 'значение с пробелом должно быть заэкранировано');
  assert.equal(applyInputs('echo {{a}}-{{b}}', { a: '1', b: '2' }), 'echo 1-2');
});

test('shellQuote не ломает простые значения', () => {
  assert.equal(shellQuote('3000'), '3000');
  assert.equal(shellQuote('a/b:c-d_e.f'), 'a/b:c-d_e.f');
  assert.ok(shellQuote('две слова').startsWith('"') || shellQuote('две слова').startsWith("'"));
});

test('inputPlaceholders собирает имена без повторов', () => {
  assert.deepEqual(inputPlaceholders('{{a}} {{b}} {{a}}'), ['a', 'b']);
  assert.deepEqual(inputPlaceholders('без параметров'), []);
});

test('commandCwd и commandEnv учитывают контекст проекта', () => {
  const project: ProjectContext = {
    file,
    dir: path.join('C:', 'проект'),
    config: { projectName: 'тест', commands: [], env: { ОБЩЕЕ: '1', ОБЩЕЕ_ПЕРЕОПРЕДЕЛЕНО: 'проект' } },
    warnings: [],
  };
  assert.equal(commandCwd({ name: 'a', cmd: 'x' }, project), project.dir);
  assert.equal(commandCwd({ name: 'a', cmd: 'x', cwd: 'app' }, project), path.join(project.dir, 'app'));
  const env = commandEnv({ name: 'a', cmd: 'x', env: { ОБЩЕЕ_ПЕРЕОПРЕДЕЛЕНО: 'команда', СВОЁ: 'да' } }, project);
  assert.equal(env.ОБЩЕЕ, '1');
  assert.equal(env.ОБЩЕЕ_ПЕРЕОПРЕДЕЛЕНО, 'команда', 'env команды важнее env проекта');
  assert.equal(env.СВОЁ, 'да');
  // На Windows переменная называется Path, на остальных системах — PATH.
  assert.ok(env.PATH ?? env.Path, 'окружение процесса сохраняется');
});
