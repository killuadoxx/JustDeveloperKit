// jd push — быстрый старт репозитория: .gitignore, init, commit и push в main.
// Спрашивает только ссылку на репозиторий и делает всё остальное сам.

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { flagBool, flagStr, parseArgs } from '../core/args.ts';
import { fail } from '../core/help.ts';
import { confirm, isInteractive, promptText } from '../core/input.ts';
import { ch, N, neonRule, runSteps, type Step } from '../core/neon.ts';
import { run } from '../core/shell.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { box } from '../core/ui.ts';
import type { Command } from '../core/registry.ts';

const GITIGNORE_NODE = `# зависимости
node_modules/
.pnpm-store/
.yarn/cache/
.yarn/install-state.gz

# сборка и кэш
dist/
build/
out/
coverage/
*.tsbuildinfo
.eslintcache
.cache/

# окружение и секреты
.env
.env.*
!.env.example
*.pem
*.key

# логи
*.log
npm-debug.log*
yarn-error.log*
logs/

# данные самого jd
.jd/
scratch/

# редакторы и ОС
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
.idea/
.DS_Store
Thumbs.db
desktop.ini
`;

const GITIGNORE_BASE = `# окружение и секреты
.env
.env.*
!.env.example
*.pem
*.key

# логи
*.log
logs/

# кэш и временные файлы
.cache/
tmp/
temp/
.jd/
scratch/

# редакторы и ОС
.vscode/*
!.vscode/extensions.json
.idea/
.DS_Store
Thumbs.db
desktop.ini
`;

interface GitOut {
  ok: boolean;
  out: string;
  err: string;
  code: number | null;
}

async function git(args: string[], cwd: string, timeout = 60000): Promise<GitOut> {
  const res = await run('git', args, { cwd, timeout });
  return { ok: res.ok, out: res.stdout.trim(), err: res.stderr.trim(), code: res.code };
}

/**
 * Выбрать самую полезную строку из вывода git. Просто «последняя строка» врёт:
 * у git хвост stderr — это обрубок вроде «and the repository exists.».
 */
function bestGitError(output: string): string {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const fatal = lines.find((l) => /^(fatal|error):/i.test(l));
  return (fatal ?? lines[0] ?? '').replace(/^(fatal|error):\s*/i, '');
}

/** Выполнить git-команду и упасть с человеческим текстом, если не вышло. */
async function gitOrFail(args: string[], cwd: string, what: string, timeout = 60000): Promise<string> {
  const res = await git(args, cwd, timeout);
  if (res.ok) return res.out;
  const reason = bestGitError(res.err || res.out);
  throw new Error(`${what}: ${reason || `код ${res.code}`}`);
}

function looksLikeRemote(url: string): boolean {
  // file:// — чтобы можно было проверить на локальном bare-репозитории.
  if (/^(https?|git|ssh|file):\/\/\S+$/i.test(url)) return true;
  if (/^[\w.-]+@[\w.-]+:\S+$/i.test(url)) return true; // git@github.com:user/repo.git
  return false;
}

/** Подсказка по частым причинам отказа push. */
function pushHint(reason: string, url: string, branch: string): string | undefined {
  if (/rejected|fetch first|non-fast-forward|failed to push some refs/i.test(reason)) {
    return `В удалённом репозитории уже есть коммиты. Сначала: git pull --rebase origin ${branch}, потом повтори push.`;
  }
  if (/Authentication failed|could not read Username|Permission denied|403|401/i.test(reason)) {
    return 'Нет доступа к репозиторию. Проверь ссылку и авторизацию (git config --global credential.helper manager).';
  }
  if (/not found|does not exist|does not appear to be a git repository|Repository not found/i.test(reason)) {
    return `Репозиторий ${url} недоступен. Создай его на GitHub пустым (без README и .gitignore) и повтори.`;
  }
  if (/Could not read from remote repository|Permission denied \(publickey\)/i.test(reason)) {
    return 'Нет доступа к репозиторию. Проверь ссылку и авторизацию: git config --global credential.helper manager.';
  }
  if (/Could not resolve host|unable to access|Connection|timed out/i.test(reason)) {
    return 'Похоже, нет сети или мешает прокси/VPN.';
  }
  return undefined;
}

export default {
  name: 'push',
  aliases: ['gitpush', 'ginit', 'publish'],
  group: 'Разработка',
  title: 'Git: Fast Init & Push',
  desc: 'Создаёт .gitignore, делает init, commit и push в main',
  usage: 'jd push [--url=<ссылка>] [--message=init] [--branch=main] [--yes]',
  examples: [
    'jd push',
    'jd push --url=https://github.com/user/repo.git',
    'jd push --url=git@github.com:user/repo.git --branch=main --yes',
  ],

  async run({ argv, cwd }) {
    const args = parseArgs(
      argv,
      { url: 'string', u: 'string', message: 'string', m: 'string', branch: 'string', b: 'string', yes: 'boolean', y: 'boolean' },
      { u: 'url', m: 'message', b: 'branch', y: 'yes' },
    );

    const branch = flagStr(args, 'branch', 'main');
    const message = flagStr(args, 'message', 'init');
    const assumeYes = flagBool(args, 'yes');

    // 1. git на месте?
    const probe = await git(['--version'], cwd, 10000);
    if (!probe.ok) {
      fail('Не нашёл git в PATH.', 'Установи Git for Windows: https://git-scm.com/download/win');
      return;
    }

    // 2. Ссылка на репозиторий — аргументом или вопросом.
    let url = flagStr(args, 'url', '').trim();
    if (!url && isInteractive()) {
      url = (await promptText('Ссылка на GitHub-репозиторий (https://github.com/пользователь/репозиторий.git)')).trim();
    }
    if (!url) {
      fail(
        'Нужна ссылка на репозиторий.',
        'Пример: jd push --url=https://github.com/user/repo.git',
      );
      return;
    }
    if (!looksLikeRemote(url)) {
      fail(`"${url}" не похоже на git-ссылку.`, 'Ожидаю https://github.com/user/repo.git или git@github.com:user/repo.git');
      return;
    }
    if (!/\.git$/i.test(url) && /^https?:\/\//i.test(url)) url = `${url.replace(/\/+$/, '')}.git`;

    // 3. Работаем ли внутри существующего репозитория.
    const inside = await git(['rev-parse', '--show-toplevel'], cwd, 10000);
    const root = inside.ok && inside.out ? inside.out.split(/\r?\n/)[0] : cwd;
    const freshRepo = !inside.ok;
    const projectName = path.basename(root);

    const hasPackageJson = existsSync(path.join(root, 'package.json'));
    const gitignorePath = path.join(root, '.gitignore');
    const gitignoreExists = existsSync(gitignorePath);

    // 4. Показываем план и спрашиваем согласие.
    const plan: string[] = [];
    plan.push(paint('  папка    ', fg(C.muted)) + paint(root, fg(C.text)));
    plan.push(paint('  проект   ', fg(C.muted)) + paint(projectName, bold(), fg(C.text)));
    plan.push(paint('  репозиторий ', fg(C.muted)) + paint(url, fg(C.info)));
    plan.push(paint('  ветка    ', fg(C.muted)) + paint(branch, fg(C.accent)) + paint(`   коммит: "${message}"`, fg(C.muted)));
    plan.push(
      paint('  git      ', fg(C.muted)) +
        paint(freshRepo ? 'будет создан (git init)' : 'уже есть, переиспользую', fg(freshRepo ? C.warn : C.ok)),
    );
    plan.push(
      paint('  .gitignore ', fg(C.muted)) +
        (gitignoreExists
          ? paint('уже есть — оставлю как есть', fg(C.ok))
          : paint(`создам (${hasPackageJson ? 'Node/TS' : 'базовый'})`, fg(C.warn))),
    );

    process.stdout.write('\n' + box(plan, { title: paint('Fast Init & Push', bold(), fg(C.primary)) }) + '\n');

    if (!assumeYes) {
      if (!isInteractive()) {
        fail('Нужно подтверждение, а терминал неинтерактивный.', 'Добавь --yes, чтобы выполнить без вопросов.');
        return;
      }
      const go = await confirm(`Инициализировать и запушить в ${branch}?`, true);
      if (!go) {
        process.stdout.write(paint('  отменено\n', fg(C.muted)));
        return;
      }
    }

    // 5. Шаги. Каждый — под своим спиннером.
    const steps: Step[] = [];
    const notes: string[] = [];

    if (freshRepo) {
      steps.push({
        label: 'git init',
        run: async () => {
          await gitOrFail(['init', '-b', branch], root, 'git init');
        },
        doneLabel: `git init  ${paint('ветка ' + branch, fg(C.muted))}`,
      });
    } else {
      notes.push('репозиторий уже был — init пропущен');
    }

    steps.push({
      label: '.gitignore',
      doneLabel: gitignoreExists ? '.gitignore уже есть, не трогаю' : '.gitignore создан',
      run: async () => {
        if (gitignoreExists) return;
        await writeFile(gitignorePath, hasPackageJson ? GITIGNORE_NODE : GITIGNORE_BASE, 'utf8');
      },
    });

    steps.push({
      label: 'проверяю автора коммита',
      doneLabel: 'автор коммита настроен',
      run: async () => {
        const email = (await git(['config', 'user.email'], root, 10000)).out;
        if (email) return;
        if (!isInteractive()) {
          throw new Error('не задан user.email — выполни: git config --global user.email "you@example.com"');
        }
        const name = await promptText('Представься для коммитов: имя');
        const mail = await promptText('и e-mail');
        if (!name || !mail) throw new Error('имя и e-mail обязательны для коммита');
        await gitOrFail(['config', 'user.name', name], root, 'git config user.name');
        await gitOrFail(['config', 'user.email', mail], root, 'git config user.email');
      },
    });

    steps.push({
      label: 'git add -A',
      run: async () => {
        await gitOrFail(['add', '-A'], root, 'git add');
      },
    });

    let committed = false;
    steps.push({
      label: `git commit -m "${message}"`,
      run: async () => {
        const staged = await git(['diff', '--cached', '--quiet'], root, 30000);
        if (staged.ok) {
          notes.push('изменений не было — коммит пропущен');
          return;
        }
        await gitOrFail(['commit', '-m', message], root, 'git commit');
        committed = true;
      },
      doneLabel: () => (committed ? `git commit -m "${message}"` : 'коммит не нужен — изменений нет'),
    });

    steps.push({
      label: `ветка ${branch}`,
      doneLabel: `текущая ветка — ${branch}`,
      run: async () => {
        await gitOrFail(['branch', '-M', branch], root, 'git branch -M');
      },
    });

    steps.push({
      label: 'remote origin',
      run: async () => {
        const current = await git(['remote', 'get-url', 'origin'], root, 10000);
        if (current.ok && current.out) {
          if (current.out.trim() === url) return;
          await gitOrFail(['remote', 'set-url', 'origin', url], root, 'git remote set-url');
          return;
        }
        await gitOrFail(['remote', 'add', 'origin', url], root, 'git remote add');
      },
      doneLabel: 'origin указывает на репозиторий',
    });

    steps.push({
      label: `git push -u origin ${branch}`,
      run: async () => {
        const res = await git(['push', '-u', 'origin', branch], root, 180000);
        if (!res.ok) {
          const reason = bestGitError(res.err || res.out);
          throw new Error(reason || 'push не прошёл');
        }
      },
      doneLabel: `запушено в origin/${branch}`,
    });

    process.stdout.write('\n');
    const { failed } = await runSteps(steps);
    process.stdout.write('\n');

    if (failed) {
      fail(`Шаг "${failed.label}" не прошёл.`, failed.error);
      const hint = pushHint(failed.error ?? '', url, branch);
      if (hint) process.stdout.write('    ' + paint(hint, fg(C.warn)) + '\n');
      process.stdout.write(
        '\n' +
          paint('  что уже сделано: ', fg(C.muted)) +
          paint(`${path.join(root, '.gitignore')} и локальные коммиты на месте`, fg(C.soft)) +
          '\n' +
          paint('  повторный запуск ', fg(C.muted)) +
          paint('jd push', fg(C.info)) +
          paint(' доведёт дело до конца — лишнего не сделает', fg(C.muted)) +
          '\n\n',
      );
      return;
    }

    process.stdout.write('  ' + neonRule(46, N.lime, N.cyan) + '\n');
    process.stdout.write(
      '  ' +
        ch.hex(N.lime).bold('Готово! ') +
        paint(projectName, bold(), fg(C.text)) +
        paint(' запушен в ', fg(C.muted)) +
        paint(`origin/${branch}`, fg(C.accent)) +
        '\n',
    );
    if (committed) {
      const count = (await git(['rev-list', '--count', 'HEAD'], root, 15000)).out;
      process.stdout.write('  ' + paint(`коммитов в ветке: ${count || '1'}`, fg(C.muted)) + '\n');
    }
    for (const note of notes) {
      process.stdout.write('  ' + paint('· ' + note, fg(C.faint)) + '\n');
    }
    process.stdout.write(
      '\n  ' + paint('открыть: ', fg(C.faint)) + paint(url.replace(/\.git$/, ''), fg(C.info)) + '\n\n',
    );
  },
} satisfies Command;
