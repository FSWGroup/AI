import { PrismaClient } from "@prisma/client";

// Netlify DB (Neon) exposes NETLIFY_DATABASE_URL; alias it so Prisma's
// datasource env("DATABASE_URL") works without duplicating the value.
process.env.DATABASE_URL ??= process.env.NETLIFY_DATABASE_URL;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
