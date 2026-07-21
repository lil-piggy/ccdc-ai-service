const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('[1] Enabling pgvector extension...');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    const ext = await client.query("SELECT extname FROM pg_extension WHERE extname = 'vector'");
    console.log('pgvector extension:', ext.rows.length > 0 ? 'ENABLED' : 'NOT FOUND');

    console.log('[2] Dropping legacy KB tables (dimension migration)...');
    await client.query('DROP TABLE IF EXISTS kb_chunks CASCADE');
    await client.query('DROP TABLE IF EXISTS kb_files CASCADE');
    await client.query('DROP TABLE IF EXISTS kb_sheets CASCADE');
    await client.query('DROP TABLE IF EXISTS kb_docs CASCADE');
    console.log('Dropped kb_docs / kb_files / kb_chunks / kb_sheets');

    console.log('[3] Done. Please redeploy your Render service.');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
