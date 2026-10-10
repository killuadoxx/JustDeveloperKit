@echo off
rem jd — Just Developer Kit. Запуск без сборки: Node 24 сам понимает .ts
node "%~dp0src\cli.ts" %*
