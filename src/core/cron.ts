// Разбор cron-выражений: что записано человеческими словами и когда это сработает.
//
// Поддерживаем классические пять полей, списки, диапазоны, шаги, имена месяцев
// и дней, а также короткие формы @daily и подобные. Семантика дня месяца и дня
// недели — как в Vixie cron: если заданы оба, достаточно совпадения одного.

export interface CronField {
  /** Значения, которые подходят. */
  values: Set<number>;
  /** Поле было «*» — значит, ограничения нет. */
  wildcard: boolean;
  raw: string;
}

export interface CronExpression {
  source: string;
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAY_RU = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const WEEKDAY_RU_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const NICKNAMES: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

export class CronError extends Error {}

function boundsFor(index: number): [number, number] {
  switch (index) {
    case 0:
      return [0, 59];
    case 1:
      return [0, 23];
    case 2:
      return [1, 31];
    case 3:
      return [1, 12];
    default:
      return [0, 7];
  }
}

function namesFor(index: number): string[] | null {
  if (index === 3) return MONTHS;
  if (index === 4) return WEEKDAYS;
  return null;
}

function normalizeName(token: string, names: string[] | null): string {
  if (!names) return token;
  const upper = token.toUpperCase();
  const found = names.findIndex((name) => name === upper || name.startsWith(upper));
  return found === -1 ? token : String(names === MONTHS ? found + 1 : found);
}

/** Разобрать одно поле: 5, диапазон 1-10, шаг со звёздочкой, список 1,2,3, MON-FRI. */
export function parseField(raw: string, index: number): CronField {
  const [min, max] = boundsFor(index);
  const names = namesFor(index);
  const values = new Set<number>();
  const wildcard = raw.trim() === '*' || raw.trim() === '?';

  for (const chunk of raw.split(',')) {
    const part = chunk.trim();
    if (!part) throw new CronError(`пустое значение в поле «${raw}»`);

    const [rangePart, stepPart] = part.split('/');
    let step = 1;
    if (stepPart !== undefined) {
      step = Number(stepPart);
      if (!Number.isInteger(step) || step <= 0) throw new CronError(`шаг «${stepPart}» должен быть целым числом больше нуля`);
    }

    let from: number;
    let to: number;
    if (rangePart === '*' || rangePart === '?') {
      from = min;
      to = max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      from = Number(normalizeName(a.trim(), names));
      to = Number(normalizeName(b.trim(), names));
    } else {
      from = Number(normalizeName(rangePart.trim(), names));
      to = stepPart !== undefined ? max : from;
    }

    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new CronError(`не понял «${part}»`);
    if (from < min || from > max || to < min || to > max) {
      throw new CronError(`значение «${part}» вне диапазона ${min}–${max}`);
    }
    if (from > to) throw new CronError(`диапазон «${part}» записан наоборот`);

    for (let value = from; value <= to; value += step) values.add(value % (index === 4 ? 7 : Number.MAX_SAFE_INTEGER));
  }

  // Воскресенье пишут и как 0, и как 7 — приводим к 0.
  if (index === 4 && values.has(7)) {
    values.delete(7);
    values.add(0);
  }

  return { values, wildcard, raw: raw.trim() };
}

export function parseCron(source: string): CronExpression {
  const text = source.trim();
  if (!text) throw new CronError('пустое выражение');
  const expanded = NICKNAMES[text.toLowerCase()] ?? text;
  const parts = expanded.split(/\s+/);
  if (parts.length !== 5) {
    throw new CronError(`нужно пять полей (минута час день месяц день-недели), а их ${parts.length}`);
  }
  return {
    source: text,
    minute: parseField(parts[0], 0),
    hour: parseField(parts[1], 1),
    dayOfMonth: parseField(parts[2], 2),
    month: parseField(parts[3], 3),
    dayOfWeek: parseField(parts[4], 4),
  };
}

function list(values: Set<number>, format: (n: number) => string, max = 6): string {
  const sorted = [...values].sort((a, b) => a - b);
  const shown = sorted.slice(0, max).map(format);
  return shown.join(', ') + (sorted.length > max ? ` и ещё ${sorted.length - max}` : '');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Человеческое описание: что и когда срабатывает. */
export function describeCron(expr: CronExpression): string[] {
  const out: string[] = [];
  const minutes = [...expr.minute.values].sort((a, b) => a - b);
  const hours = [...expr.hour.values].sort((a, b) => a - b);

  // Время суток.
  if (expr.minute.wildcard && expr.hour.wildcard) {
    out.push('каждую минуту');
  } else if (expr.hour.wildcard && minutes.length === 1) {
    out.push(`каждый час в :${pad(minutes[0])}`);
  } else if (expr.minute.raw.startsWith('*/') && expr.hour.wildcard) {
    out.push(`каждые ${expr.minute.raw.slice(2)} мин`);
  } else if (minutes.length === 1 && hours.length === 1) {
    out.push(`в ${pad(hours[0])}:${pad(minutes[0])}`);
  } else if (minutes.length === 1 && hours.length > 1) {
    out.push(`в ${list(expr.hour.values, (h) => `${pad(h)}:${pad(minutes[0])}`)}`);
  } else {
    out.push(`минуты: ${list(expr.minute.values, pad)}`);
    out.push(`часы: ${list(expr.hour.values, pad)}`);
  }

  // День.
  if (!expr.dayOfMonth.wildcard || !expr.dayOfWeek.wildcard) {
    const pieces: string[] = [];
    if (!expr.dayOfMonth.wildcard) {
      const days = [...expr.dayOfMonth.values].sort((a, b) => a - b);
      pieces.push(`числа ${list(expr.dayOfMonth.values, String)}${days.length === 1 && days[0] === 1 ? ' (первое)' : ''}`);
    }
    if (!expr.dayOfWeek.wildcard) {
      const days = [...expr.dayOfWeek.values].sort((a, b) => a - b);
      const only = days.length === 1 ? days[0] : -1;
      if (only >= 0) pieces.push(`по ${WEEKDAY_RU[only]}`);
      else if (days.join(',') === '1,2,3,4,5') pieces.push('по будням');
      else if (days.join(',') === '0,6') pieces.push('по выходным');
      else pieces.push(`по дням: ${list(expr.dayOfWeek.values, (d) => WEEKDAY_RU_SHORT[d])}`);
    }
    out.push(pieces.join(' и '));
  } else {
    out.push('каждый день');
  }

  // Месяц.
  if (!expr.month.wildcard) {
    out.push(`месяцы: ${list(expr.month.values, (m) => MONTH_RU[m - 1])}`);
  }

  return out;
}

/** Совпадает ли момент с расписанием. */
export function matchesCron(expr: CronExpression, date: Date): boolean {
  if (!expr.minute.values.has(date.getMinutes())) return false;
  if (!expr.hour.values.has(date.getHours())) return false;
  if (!expr.month.values.has(date.getMonth() + 1)) return false;

  const domOk = expr.dayOfMonth.values.has(date.getDate());
  const dowOk = expr.dayOfWeek.values.has(date.getDay());

  // Классическое правило: если заданы оба поля, подходит совпадение любого из них.
  if (expr.dayOfMonth.wildcard && expr.dayOfWeek.wildcard) return true;
  if (expr.dayOfMonth.wildcard) return dowOk;
  if (expr.dayOfWeek.wildcard) return domOk;
  return domOk || dowOk;
}

export interface NextRun {
  date: Date;
  msFromNow: number;
}

/**
 * Следующие срабатывания. Идём по минутам: для личного инструмента это
 * достаточно быстро (день — 1440 проверок), а логика остаётся очевидной.
 */
export function nextRuns(expr: CronExpression, count = 5, from = new Date()): NextRun[] {
  const out: NextRun[] = [];
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  // Год вперёд: если за это время ничего не нашлось, расписание подозрительное.
  const limit = 366 * 24 * 60;
  for (let i = 0; i < limit && out.length < count; i++) {
    if (matchesCron(expr, cursor)) {
      out.push({ date: new Date(cursor.getTime()), msFromNow: cursor.getTime() - from.getTime() });
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return out;
}
