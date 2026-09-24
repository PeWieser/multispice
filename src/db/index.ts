import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type Database = NodePgDatabase<typeof schema>;

const connectionString = process.env.DATABASE_URL ?? process.env.HYPERDRIVE_CONNECTION_STRING;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsPostgresqlDb?: Database;
};

/**
 * The pool is created lazily so that static exports, edge runtimes and
 * `next build` do not fail when no database is configured. Only the API
 * routes that actually query Postgres need a connection string.
 */
function getPool(): Pool {
  if (globalForDb.__arenaNextJsPostgresqlPool) return globalForDb.__arenaNextJsPostgresqlPool;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for database access");
  }
  const pool = new Pool({ connectionString });
  if (process.env.NODE_ENV !== "production") globalForDb.__arenaNextJsPostgresqlPool = pool;
  return pool;
}

function getDb(): Database {
  if (globalForDb.__arenaNextJsPostgresqlDb) return globalForDb.__arenaNextJsPostgresqlDb;
  const instance = drizzle(getPool(), { schema });
  if (process.env.NODE_ENV !== "production") globalForDb.__arenaNextJsPostgresqlDb = instance;
  return instance;
}

/**
 * Drizzle client proxy — keeps `db.select()…` ergonomics while deferring the
 * actual connection until the first query runs.
 */
export const db = new Proxy({} as Database, {
  apply: () => getDb(),
  get: (_target, property) => {
    const instance = getDb() as unknown as Record<string | symbol, unknown>;
    const value = instance[property];
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export const pool = new Proxy({} as Pool, {
  get: (_target, property) => {
    const instance = getPool() as unknown as Record<string | symbol, unknown>;
    const value = instance[property];
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
