import { initializeDatabase } from '../lib/database.js';

async function runMigrations() {
  try {
    console.log('Starting database migration...');
    await initializeDatabase();
    console.log('Database migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();
