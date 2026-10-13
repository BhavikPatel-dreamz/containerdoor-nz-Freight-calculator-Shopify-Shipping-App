import "dotenv/config";
import { defineConfig } from "prisma/config";

/** CLI migrate/introspect must not use Neon PgBouncer (-pooler) — advisory locks time out (P1002). */
function prismaCliDatabaseUrl(): string {
  const preferred =
    process.env.DIRECT_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL;
  if (!preferred) {
    throw new Error("DATABASE_URL is not set");
  }
  try {
    const u = new URL(preferred);
    u.hostname = u.hostname.replace(/-pooler(?=\.|$)/, "");
    u.searchParams.delete("pgbouncer");
    return u.toString();
  } catch {
    return preferred;
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: prismaCliDatabaseUrl(),
  },
});

