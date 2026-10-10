// Темы оформления: палитра интерфейса (C) и неоновая палитра (N) как данные.
//
// Ключевая идея: C и N остаются теми же объектами, что импортировали все модули,
// а applyTheme() меняет их свойства на месте. Поэтому ни одна команда не знает
// о темах — она просто читает C.primary, и он уже нужного цвета.

import { N } from './neon.ts';
import { C } from './theme.ts';

export type Palette = { [K in keyof typeof C]: string };
export type NeonPalette = { [K in keyof typeof N]: string };

export interface Theme {
  id: string;
  title: string;
  icon: string;
  desc: string;
  colors: Palette;
  neon: NeonPalette;
}

export const THEMES: Theme[] = [
  {
    id: 'tokyo',
    title: 'Tokyo Night',
    icon: '🌃',
    desc: 'Спокойная тёмная тема — по умолчанию',
    colors: {
      text: '#c0caf5',
      soft: '#a9b1d6',
      muted: '#565f89',
      faint: '#3b4261',
      primary: '#7aa2f7',
      accent: '#bb9af7',
      ok: '#9ece6a',
      warn: '#e0af68',
      err: '#f7768e',
      info: '#7dcfff',
      pink: '#ff75a0',
      cyan: '#73daca',
      bg: '#1a1b26',
      bgSoft: '#24283b',
    },
    neon: {
      pink: '#ff2d95',
      magenta: '#f20089',
      violet: '#a45cff',
      cyan: '#00e5ff',
      aqua: '#2de2e6',
      lime: '#b6ff3c',
      amber: '#ffb01f',
      red: '#ff3860',
      ember: '#ff7a45',
      ink: '#12121c',
    },
  },
  {
    id: 'neon',
    title: 'Neon',
    icon: '💜',
    desc: 'Кислотный киберпанк: розовый и циан на почти чёрном',
    colors: {
      text: '#e8f0ff',
      soft: '#b8c4e0',
      muted: '#5c6591',
      faint: '#333c66',
      primary: '#00e5ff',
      accent: '#ff2d95',
      ok: '#b6ff3c',
      warn: '#ffb01f',
      err: '#ff3860',
      info: '#7cf9ff',
      pink: '#ff2d95',
      cyan: '#2de2e6',
      bg: '#0b0b14',
      bgSoft: '#171a2e',
    },
    neon: {
      pink: '#ff2d95',
      magenta: '#f20089',
      violet: '#a45cff',
      cyan: '#00e5ff',
      aqua: '#2de2e6',
      lime: '#b6ff3c',
      amber: '#ffb01f',
      red: '#ff3860',
      ember: '#ff7a45',
      ink: '#0b0b14',
    },
  },
  {
    id: 'matrix',
    title: 'Matrix',
    icon: '🟩',
    desc: 'Зелёный терминал: только фосфор и ничего лишнего',
    colors: {
      text: '#c8ffd0',
      soft: '#8ce39a',
      muted: '#3f7a4d',
      faint: '#1f3d27',
      primary: '#00ff87',
      accent: '#00c46a',
      ok: '#4dff88',
      warn: '#d7ff5c',
      err: '#ff5f56',
      info: '#5cffd0',
      pink: '#7dffb0',
      cyan: '#00e0b0',
      bg: '#050a05',
      bgSoft: '#0d1a10',
    },
    neon: {
      pink: '#00ff87',
      magenta: '#00c46a',
      violet: '#00a86b',
      cyan: '#5cffd0',
      aqua: '#7dffb0',
      lime: '#b6ff3c',
      amber: '#d7ff5c',
      red: '#ff5f56',
      ember: '#ffa500',
      ink: '#050a05',
    },
  },
  {
    id: 'sunset',
    title: 'Sunset',
    icon: '🌅',
    desc: 'Тёплый закат: оранжевый, малиновый, янтарный',
    colors: {
      text: '#ffe8d6',
      soft: '#e0b9a0',
      muted: '#8a5f6e',
      faint: '#4a2f45',
      primary: '#ff8c42',
      accent: '#ff2e88',
      ok: '#7bd88f',
      warn: '#ffc857',
      err: '#ff4d6d',
      info: '#ffb26b',
      pink: '#ff6b9d',
      cyan: '#7fd1d1',
      bg: '#1a1024',
      bgSoft: '#2a1a33',
    },
    neon: {
      pink: '#ff2e88',
      magenta: '#d61f69',
      violet: '#8b5cf6',
      cyan: '#ffb26b',
      aqua: '#ffd9a0',
      lime: '#c3e88d',
      amber: '#ffc857',
      red: '#ff4d6d',
      ember: '#ff7a45',
      ink: '#1a1024',
    },
  },
  {
    id: 'nord',
    title: 'Nord',
    icon: '❄️',
    desc: 'Холодный северный минимализм, мягкий контраст',
    colors: {
      text: '#e5e9f0',
      soft: '#d8dee9',
      muted: '#7b88a1',
      faint: '#4c566a',
      primary: '#88c0d0',
      accent: '#b48ead',
      ok: '#a3be8c',
      warn: '#ebcb8b',
      err: '#bf616a',
      info: '#81a1c1',
      pink: '#d08770',
      cyan: '#8fbcbb',
      bg: '#2e3440',
      bgSoft: '#3b4252',
    },
    neon: {
      pink: '#b48ead',
      magenta: '#bf616a',
      violet: '#8fbcbb',
      cyan: '#88c0d0',
      aqua: '#8fbcbb',
      lime: '#a3be8c',
      amber: '#ebcb8b',
      red: '#bf616a',
      ember: '#d08770',
      ink: '#2e3440',
    },
  },
  {
    id: 'gruvbox',
    title: 'Gruvbox',
    icon: '🍂',
    desc: 'Ретро-тепло: охра, шалфей, ржавчина',
    colors: {
      text: '#ebdbb2',
      soft: '#d5c4a1',
      muted: '#928374',
      faint: '#504945',
      primary: '#83a598',
      accent: '#d3869b',
      ok: '#b8bb26',
      warn: '#fabd2f',
      err: '#fb4934',
      info: '#8ec07c',
      pink: '#d3869b',
      cyan: '#8ec07c',
      bg: '#282828',
      bgSoft: '#3c3836',
    },
    neon: {
      pink: '#d3869b',
      magenta: '#fb4934',
      violet: '#b16286',
      cyan: '#8ec07c',
      aqua: '#83a598',
      lime: '#b8bb26',
      amber: '#fabd2f',
      red: '#fb4934',
      ember: '#fe8019',
      ink: '#282828',
    },
  },
  {
    id: 'mono',
    title: 'Mono',
    icon: '🌑',
    desc: 'Почти без цвета: только оттенки серого',
    colors: {
      text: '#e6e6e6',
      soft: '#c0c0c0',
      muted: '#808080',
      faint: '#4d4d4d',
      primary: '#f0f0f0',
      accent: '#b0b0b0',
      ok: '#d0d0d0',
      warn: '#a8a8a8',
      err: '#ffffff',
      info: '#c8c8c8',
      pink: '#d8d8d8',
      cyan: '#bdbdbd',
      bg: '#111111',
      bgSoft: '#1e1e1e',
    },
    neon: {
      pink: '#e0e0e0',
      magenta: '#c8c8c8',
      violet: '#b0b0b0',
      cyan: '#d0d0d0',
      aqua: '#c0c0c0',
      lime: '#e8e8e8',
      amber: '#b8b8b8',
      red: '#ffffff',
      ember: '#a0a0a0',
      ink: '#111111',
    },
  },
];

export const DEFAULT_THEME = 'tokyo';

let currentId = DEFAULT_THEME;

export function themeIds(): string[] {
  return THEMES.map((t) => t.id);
}

export function findTheme(id: string): Theme | undefined {
  const key = id.trim().toLowerCase();
  return THEMES.find((t) => t.id === key) ?? THEMES.find((t) => t.title.toLowerCase() === key);
}

/** Текущая тема. */
export function currentTheme(): Theme {
  return findTheme(currentId) ?? THEMES[0];
}

export function currentThemeId(): string {
  return currentTheme().id;
}

/** Применить тему по id. Неизвестный id — не ошибка, просто false. */
export function applyTheme(id: string): boolean {
  const theme = findTheme(id);
  if (!theme) return false;
  // Именно мутация: C и N уже разошлись по всем модулям как ссылки.
  Object.assign(C, theme.colors);
  Object.assign(N, theme.neon);
  currentId = theme.id;
  return true;
}

/** Временно применить тему и вернуть прежнюю — для превью в списке. */
export function withTheme<T>(id: string, fn: () => T): T {
  const previous = currentId;
  const applied = applyTheme(id);
  try {
    return fn();
  } finally {
    if (applied) applyTheme(previous);
  }
}

/**
 * Тема для этого запуска: JD_THEME сильнее сохранённой.
 * kv читает уже открытую базу — саму базу тут не создаём.
 */
export function resolveStartupTheme(saved: string): string {
  const fromEnv = (process.env.JD_THEME ?? '').trim();
  if (fromEnv && findTheme(fromEnv)) return findTheme(fromEnv)!.id;
  if (saved && findTheme(saved)) return findTheme(saved)!.id;
  return DEFAULT_THEME;
}
