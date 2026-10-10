// Темы оформления: полнота палитр, валидность цветов, переключение.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { N } from '../src/core/neon.ts';
import { C } from '../src/core/theme.ts';
import {
  applyTheme,
  currentThemeId,
  DEFAULT_THEME,
  findTheme,
  resolveStartupTheme,
  THEMES,
  themeIds,
  withTheme,
} from '../src/core/themes.ts';

// Ключи проверяем списком: если кто-то переименует поле в theme.ts и забудет
// поправить палитры, тема останется с цветом от предыдущей — это надо ловить.
const COLOR_KEYS = [
  'text', 'soft', 'muted', 'faint', 'primary', 'accent', 'ok', 'warn', 'err',
  'info', 'pink', 'cyan', 'bg', 'bgSoft',
] as const;

const NEON_KEYS = ['pink', 'magenta', 'violet', 'cyan', 'aqua', 'lime', 'amber', 'red', 'ember', 'ink'] as const;

test('все темы описаны полностью и без опечаток', () => {
  assert.ok(THEMES.length >= 5, 'тем должно быть несколько');
  assert.equal(new Set(themeIds()).size, THEMES.length, 'id тем уникальны');

  for (const theme of THEMES) {
    assert.deepEqual(Object.keys(theme.colors).sort(), [...COLOR_KEYS].sort(), `палитра темы ${theme.id}`);
    assert.deepEqual(Object.keys(theme.neon).sort(), [...NEON_KEYS].sort(), `неон темы ${theme.id}`);
    assert.ok(theme.title.length > 0, `у темы ${theme.id} нет названия`);
    assert.ok(theme.desc.length > 0, `у темы ${theme.id} нет описания`);
    for (const [key, value] of Object.entries({ ...theme.colors, ...theme.neon })) {
      assert.match(value, /^#[0-9a-f]{6}$/i, `${theme.id}.${key} = ${value} — не hex-цвет`);
    }
    // Текст должен отличаться от фона, иначе интерфейс нечитаем.
    assert.notEqual(theme.colors.text.toLowerCase(), theme.colors.bg.toLowerCase(), `тема ${theme.id}: текст на фоне не виден`);
    assert.notEqual(theme.colors.primary.toLowerCase(), theme.colors.bg.toLowerCase(), `тема ${theme.id}: акцент сливается с фоном`);
  }
});

test('applyTheme меняет живой объект палитры — команды видят новый цвет', () => {
  const before = C.primary;
  assert.equal(applyTheme('matrix'), true);
  assert.notEqual(C.primary, before, 'C мутируется на месте: все модули держат одну ссылку');
  assert.equal(C.primary, findTheme('matrix')?.colors.primary);
  assert.equal(currentThemeId(), 'matrix');

  assert.equal(applyTheme('nord'), true);
  assert.equal(N.pink, findTheme('nord')?.neon.pink, 'неоновая палитра тоже переключается');
  assert.equal(C.primary, findTheme('nord')?.colors.primary);
});

test('applyTheme на неизвестной теме ничего не ломает', () => {
  applyTheme('gruvbox');
  const before = C.primary;
  assert.equal(applyTheme('нет-такой-темы'), false);
  assert.equal(C.primary, before);
  assert.equal(currentThemeId(), 'gruvbox');
});

test('withTheme возвращает прежнюю тему после отрисовки', () => {
  applyTheme('tokyo');
  const inside = withTheme('sunset', () => C.primary);
  assert.equal(inside, findTheme('sunset')?.colors.primary);
  assert.equal(currentThemeId(), 'tokyo');
  assert.equal(C.primary, findTheme('tokyo')?.colors.primary);

  // Исключение внутри тоже не должно оставить чужую тему.
  assert.throws(() =>
    withTheme('neon', () => {
      throw new Error('упало при отрисовке');
    }),
  );
  assert.equal(currentThemeId(), 'tokyo');
});

test('findTheme понимает id и название без учёта регистра', () => {
  assert.equal(findTheme('TOKYO')?.id, 'tokyo');
  assert.equal(findTheme('Tokyo Night')?.id, 'tokyo');
  assert.equal(findTheme('  neon ')?.id, 'neon');
  assert.equal(findTheme('нет'), undefined);
});

test('resolveStartupTheme: JD_THEME важнее сохранённой темы', () => {
  const env = process.env.JD_THEME;
  try {
    process.env.JD_THEME = 'matrix';
    assert.equal(resolveStartupTheme('nord'), 'matrix');
    process.env.JD_THEME = 'такой-нет';
    assert.equal(resolveStartupTheme('nord'), 'nord', 'неизвестный JD_THEME игнорируется');
    delete process.env.JD_THEME;
    assert.equal(resolveStartupTheme('nord'), 'nord');
    assert.equal(resolveStartupTheme(''), DEFAULT_THEME);
    assert.equal(resolveStartupTheme('мусор'), DEFAULT_THEME);
  } finally {
    if (env === undefined) delete process.env.JD_THEME;
    else process.env.JD_THEME = env;
    applyTheme(DEFAULT_THEME);
  }
});

test('переключение всех тем подряд не оставляет следов', () => {
  for (const id of themeIds()) {
    assert.equal(applyTheme(id), true);
    assert.equal(C.text, findTheme(id)?.colors.text);
  }
  applyTheme(DEFAULT_THEME);
});
