import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from '../config/database';

async function runMigrate() {
  console.log('Running migrations...');
  try {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    console.log('Migrations completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrate();
