/**
 * Pre-migration snapshots of the database file.
 *
 * A failed migration should cost a restore, never the learner's history. Backups are
 * best-effort: if the copy fails we log and continue, because refusing to launch the
 * app over a missing backup would be worse than the risk it guards against.
 */
import { Directory, File, Paths } from 'expo-file-system';

export const DATABASE_NAME = 'dutch.db';

/** How many snapshots to keep before pruning the oldest. */
const KEEP_BACKUPS = 3;

function sqliteDir(): Directory {
  return new Directory(Paths.document, 'SQLite');
}

function backupDir(): Directory {
  return new Directory(Paths.document, 'SQLite', 'backups');
}

/** Filesystem-safe timestamp: 2026-11-09T18-42-07-123Z */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Copy the live database aside before migrating off `fromVersion`.
 * Returns the backup's name, or null if there was nothing to copy.
 */
export async function backupDatabaseFile(fromVersion: number): Promise<string | null> {
  try {
    const source = new File(sqliteDir(), DATABASE_NAME);
    if (!source.exists) return null;

    const dir = backupDir();
    if (!dir.exists) dir.create({ intermediates: true });

    const name = `${DATABASE_NAME}.v${fromVersion}.${stamp()}.bak`;
    await source.copy(new File(dir, name));
    await pruneBackups();
    return name;
  } catch (error) {
    console.warn('[db] backup before migration failed; continuing', error);
    return null;
  }
}

export type BackupInfo = { name: string; size: number | null; modified: number | null };

/** Existing snapshots, newest first. */
export async function listBackups(): Promise<BackupInfo[]> {
  try {
    const dir = backupDir();
    if (!dir.exists) return [];
    return dir
      .list()
      .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.bak'))
      .map((file) => ({
        name: file.name,
        size: file.size,
        modified: file.lastModified,
      }))
      .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0) || b.name.localeCompare(a.name));
  } catch (error) {
    console.warn('[db] listing backups failed', error);
    return [];
  }
}

async function pruneBackups(): Promise<void> {
  const all = await listBackups();
  for (const extra of all.slice(KEEP_BACKUPS)) {
    try {
      new File(backupDir(), extra.name).delete();
    } catch (error) {
      console.warn(`[db] could not prune backup ${extra.name}`, error);
    }
  }
}

/**
 * Absolute path of a snapshot, for sharing it off the device.
 * Restoring is deliberately not automated: it needs the database closed first, so it
 * is a guided action in Settings rather than something that can happen by accident.
 */
export function backupPath(name: string): string {
  return new File(backupDir(), name).uri;
}
