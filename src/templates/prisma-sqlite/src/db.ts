// Единственный экземпляр PrismaClient на всё приложение.
// Это шаблон для пресета "prisma-sqlite" — при установке файл копируется в проект.

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

// При горячем перезапуске (node --watch) не плодим соединения.
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
