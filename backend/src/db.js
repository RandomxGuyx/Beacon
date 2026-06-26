import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const { Pool } = pg;
const here = path.dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

const toPg = (sql) => {
  let i = 0;
  // Add RETURNING id to INSERT statements that don't have it
  let s = sql.replace(/\?/g, () => `$${++i}`);
  if (/^\s*INSERT/i.test(s) && !/RETURNING/i.test(s)) s += ' RETURNING id';
  // SQLite compat fixes
  s = s.replace(/INSERT OR IGNORE INTO/gi, 'INSERT INTO');
  s = s.replace(/INSERT OR REPLACE INTO/gi, 'INSERT INTO');
  s = s.replace(/datetime\('now',\s*'([^']+)'\)/gi, (_, interval) => {
    const pg = interval.replace('-', '').trim();
    return interval.startsWith('-') ? `NOW() - INTERVAL '${pg}'` : `NOW() + INTERVAL '${pg}'`;
  });
  return s;
};

export const db = {
  exec: async (sql) => { await pool.query(sql); },

  prepare: (sql) => ({
    async run(...params) {
      const r = await pool.query(toPg(sql), params.flat());
      return { changes: r.rowCount, lastInsertRowid: r.rows[0]?.id ?? null };
    },
    async get(...params) {
      const s = toPg(sql);
      // Don't double-add LIMIT 1 if already present
      const q = /LIMIT\s+\d+/i.test(s) ? s : s + ' LIMIT 1';
      const r = await pool.query(q, params.flat());
      return r.rows[0] ?? null;
    },
    async all(...params) {
      const r = await pool.query(toPg(sql), params.flat());
      return r.rows;
    }
  }),

  transaction: (fn) => async (...args) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(...args);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
};

export async function migrate() {
  const directory = path.resolve(here, '../migrations');
  const files = fs.readdirSync(directory).filter(x => x.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(directory, file), 'utf8');
    await pool.query(sql);
    console.log(`Migrated: ${file}`);
  }
}