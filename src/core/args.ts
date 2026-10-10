// Мини-парсер аргументов. Предсказуемый: значения — только через `--key=value`,
// либо `--key value`, если команда объявила этот флаг строковым/числовым.

export type FlagKind = 'boolean' | 'string' | 'number' | 'array';
export type FlagSpec = Record<string, FlagKind>;

export interface ParsedArgs {
  _: string[];
  flags: Record<string, string | number | boolean | string[]>;
}

export function parseArgs(
  argv: string[],
  spec: FlagSpec = {},
  aliases: Record<string, string> = {},
): ParsedArgs {
  const flags: Record<string, string | number | boolean | string[]> = {};
  const positional: string[] = [];
  const long = (name: string): string => aliases[name] ?? name;

  const assign = (key: string, rawValue: string | undefined, next: () => string | undefined): void => {
    const kind: FlagKind = spec[key] ?? 'boolean';

    if (rawValue !== undefined) {
      if (kind === 'number') flags[key] = Number(rawValue);
      else if (kind === 'array') (flags[key] as string[] | undefined)?.push(rawValue) ?? (flags[key] = [rawValue]);
      else flags[key] = rawValue;
      return;
    }

    if (kind === 'boolean') {
      flags[key] = true;
      return;
    }
    const value = next();
    if (value === undefined) {
      flags[key] = kind === 'array' ? [] : true;
      return;
    }
    if (kind === 'number') flags[key] = Number(value);
    else if (kind === 'array') {
      (flags[key] as string[] | undefined)?.push(value) ?? (flags[key] = [value]);
    } else flags[key] = value;
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const nextValue = (): string | undefined => {
      const candidate = argv[i + 1];
      if (candidate === undefined || (candidate.startsWith('-') && candidate.length > 1)) return undefined;
      i++;
      return candidate;
    };

    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (body.startsWith('no-') && eq === -1) {
        flags[long(body.slice(3))] = false;
        continue;
      }
      if (eq !== -1) {
        assign(long(body.slice(0, eq)), body.slice(eq + 1), nextValue);
      } else {
        assign(long(body), undefined, nextValue);
      }
    } else if (token.startsWith('-') && token.length > 1 && token !== '-') {
      const body = token.slice(1);
      const eq = body.indexOf('=');
      if (eq !== -1) assign(long(body.slice(0, eq)), body.slice(eq + 1), nextValue);
      else assign(long(body), undefined, nextValue);
    } else {
      positional.push(token);
    }
  }

  return { _: positional, flags };
}

export function flagStr(args: ParsedArgs, name: string, def = ''): string {
  const v = args.flags[name];
  if (v === undefined) return def;
  if (Array.isArray(v)) return v[v.length - 1] ?? def;
  return String(v);
}

export function flagNum(args: ParsedArgs, name: string, def: number): number {
  const v = args.flags[name];
  if (v === undefined || v === true || v === false) return def;
  const n = Number(Array.isArray(v) ? v[v.length - 1] : v);
  return Number.isFinite(n) ? n : def;
}

export function flagBool(args: ParsedArgs, name: string, def = false): boolean {
  const v = args.flags[name];
  if (v === undefined) return def;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.length > 0;
  return v !== '' && v !== '0';
}

export function flagList(args: ParsedArgs, name: string): string[] {
  const v = args.flags[name];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [String(v)];
}
