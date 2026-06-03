// Applies backend/sql/schema.sql to the configured database.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  await client.query(sql);
  await client.end();
  console.log('✓ schema applied');
})().catch((e) => { console.error(e); process.exit(1); });
