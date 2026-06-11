import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { openDatabaseSync } from 'expo-sqlite';
import migrationsList from '../drizzle/migrations';
import * as schema from './schema';

const expoDb = openDatabaseSync('grocery_runner.db', { enableChangeListener: true });
export const db = drizzle(expoDb, { schema });

// Run migrations using Drizzle's migrate function
(async () => {
  try {
    // 1. Run standard migrations
    await migrate(db, migrationsList);

    // 2. Resilient check for the new 'note' column in transactions table
    // This handles cases where the user hasn't generated a formal migration yet.
    try {
      await db.run(sql`ALTER TABLE transactions ADD COLUMN note TEXT`);
    } catch (e) {
      // Column probably already exists, ignore error
    }

    // resilient check for 'createdAt' in various tables
    const tablesToUpdate = ['persons', 'items', 'placeAliases', 'sourceAliases'];
    for (const table of tablesToUpdate) {
      try {
        await db.run(sql.raw(`ALTER TABLE ${table} ADD COLUMN createdAt TEXT`));
      } catch (e) {
        // Already exists or table doesn't exist yet
      }
    }

    // resilient check for new fields in orders table
    try {
      await db.run(sql`ALTER TABLE orders ADD COLUMN createdAt TEXT`);
    } catch (e) {
      // Column probably already exists
    }
    try {
      await db.run(sql`ALTER TABLE orders ADD COLUMN modifiedAt TEXT`);
    } catch (e) {
      // Column probably already exists
    }

    // resilient check for new lastOrderedAt field in items table
    try {
      await db.run(sql`ALTER TABLE items ADD COLUMN lastOrderedAt TEXT`);
    } catch (e) {
      // Column probably already exists
    }

    // resilient check for tasks table entirely
    try {
      await db.run(sql`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          type TEXT NOT NULL,
          personId TEXT,
          itemId TEXT,
          quantity INTEGER DEFAULT 1 NOT NULL,
          targetDate TEXT,
          targetTime TEXT,
          locationPlace TEXT,
          notificationId TEXT,
          isCompleted INTEGER DEFAULT 0 NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);
    } catch (e) {}

    const taskColumnsToAdd = [
      'itemId TEXT',
      'quantity INTEGER DEFAULT 1 NOT NULL',
      'targetDate TEXT',
      'targetTime TEXT',
      'locationPlace TEXT',
      'notificationId TEXT',
      'isCompleted INTEGER DEFAULT 0 NOT NULL',
      'personId TEXT'
    ];
    for (const colDef of taskColumnsToAdd) {
      try {
        await db.run(sql.raw(`ALTER TABLE tasks ADD COLUMN ${colDef}`));
      } catch (e) {
        // Column probably already exists
      }
    }
  } catch (err) {
    console.error('Migration error:', err);
  }
})();
