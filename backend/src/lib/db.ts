import { Pool, PoolClient } from 'pg';
import { env } from '../config/env';
import { logger } from './logger';

export const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.dbSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => logger.error({ err }, 'Unexpected PG pool error'));

export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const start = Date.now();
  const res = await pool.query(text, params);
  logger.debug({ text, ms: Date.now() - start, rows: res.rowCount }, 'sql');
  return res.rows as T[];
}

export async function one<T = any>(text: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
