import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "./database-url";

// Accept Netlify DB / Neon-provided connection strings under their various
// env names and normalize pooled endpoints for Prisma.
resolveDatabaseUrl();

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
