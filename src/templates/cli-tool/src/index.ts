// Заготовка CLI-утилиты на commander.
// Это шаблон для пресета "cli-tool" — при установке файл копируется в проект.

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';

const program = new Command();

program
  .name('mytool')
  .description('Моя личная утилита')
  .version('0.1.0');

program
  .command('hello')
  .description('Поздороваться')
  .argument('[name]', 'кого приветствовать', 'мир')
  .option('-l, --loud', 'капсом')
  .action((name: string, opts: { loud?: boolean }) => {
    const text = `Привет, ${name}!`;
    console.log(chalk.cyan(opts.loud ? text.toUpperCase() : text));
  });

program
  .command('wait')
  .description('Показать спиннер заданное время')
  .option('-s, --seconds <n>', 'сколько ждать', '2')
  .action(async (opts: { seconds: string }) => {
    const seconds = Number(opts.seconds) || 2;
    const spin = ora('работаю…').start();
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    spin.succeed(chalk.green(`готово за ${seconds} с`));
  });

program.parse();
