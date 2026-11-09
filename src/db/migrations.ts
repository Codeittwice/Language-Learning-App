/**
 * Schema migrations.
 *
 * Three rules, and breaking any of them corrupts the learner's history:
 *
 * 1. `MIGRATIONS` is append-only. Once a migration has run on a real device, its
 *    `up` is frozen forever -- editing it makes that device and a fresh install
 *    diverge permanently, with no way to detect the difference.
 * 2. `PRAGMA foreign_keys = ON` must be set per connection and OUTSIDE any
 *    transaction. Inside one it is silently a no-op, which turns every REFERENCES
 *    clause into decoration while orphan rows accumulate for months.
 * 3. Before upgrading an existing database we copy the file aside. A bad migration
 *    must cost a restore, not the phrase bank.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { backupDatabaseFile } from '@/db/backup';
import { SCHEMA_V1 } from '@/db/schema-v1';
import { nowIso } from '@/time/day';

export type Migration = {
  version: number;
  label: string;
  up(db: SQLiteDatabase): Promise<void>;
};

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    label: 'initial schema',
    async up(db) {
      await db.execAsync(SCHEMA_V1);
    },
  },
];

export const LATEST_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

/** Thrown when the database is newer than this build of the app understands. */
export class SchemaTooNewError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number
  ) {
    super(
      `This database was written by a newer version of the app (schema v${found}, ` +
        `this build supports v${supported}). Update the app rather than risk a downgrade.`
    );
    this.name = 'SchemaTooNewError';
  }
}

async function readUserVersion(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Bring the database up to `LATEST_VERSION`. Wired as `SQLiteProvider onInit`, so no
 * screen can ever query a half-migrated database.
 */
export async function migrate(db: SQLiteDatabase): Promise<void> {
  // Must be first, must be outside a transaction, must be every connection.
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  const from = await readUserVersion(db);

  if (from > LATEST_VERSION) throw new SchemaTooNewError(from, LATEST_VERSION);
  if (from === LATEST_VERSION) return;

  const pending = MIGRATIONS.filter((m) => m.version > from).sort(
    (a, b) => a.version - b.version
  );
  if (pending.length === 0) return;

  // Only worth backing up if there is data to lose -- a first install has none.
  if (from > 0) {
    await backupDatabaseFile(from);
  }

  for (const migration of pending) {
    await db.withTransactionAsync(async () => {
      await migration.up(db);
      await db.runAsync(
        'INSERT OR REPLACE INTO __migration_log (version, label, applied_at) VALUES (?, ?, ?)',
        [migration.version, migration.label, nowIso()]
      );
    });
    // PRAGMA values cannot be bound. This is a number from our own frozen array, so
    // templating it is safe; never template anything that reaches here from outside.
    await db.execAsync(`PRAGMA user_version = ${Math.trunc(migration.version)};`);
  }
}

/**
 * Assert the invariants we rely on everywhere else. Called once at startup in
 * development; a failure here means a migration ran without its PRAGMAs.
 */
export async function assertDatabaseHealthy(db: SQLiteDatabase): Promise<void> {
  const fk = await db.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys');
  if (!fk?.foreign_keys) {
    throw new Error('PRAGMA foreign_keys is OFF -- every REFERENCES clause is inert.');
  }
  const version = await readUserVersion(db);
  if (version !== LATEST_VERSION) {
    throw new Error(`Schema is v${version}, expected v${LATEST_VERSION}.`);
  }
}
