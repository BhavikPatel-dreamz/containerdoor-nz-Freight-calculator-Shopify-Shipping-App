import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

/**
 * Dev: after `prisma generate` (e.g. new CommunicationLog.variantId), the old
 * PrismaClient cached on globalThis still rejects new fields until process restart.
 * Always construct a fresh client when this module loads in development.
 */
function makeClient() {
  return new PrismaClient();
}

let prisma: PrismaClient;

if (process.env.NODE_ENV !== "production") {
  const prev = global.prismaGlobal;
  prisma = makeClient();
  global.prismaGlobal = prisma;
  if (prev && prev !== prisma) {
    void prev.$disconnect().catch(() => undefined);
  }
} else {
  prisma = global.prismaGlobal ?? makeClient();
  global.prismaGlobal = prisma;
}

export default prisma;
