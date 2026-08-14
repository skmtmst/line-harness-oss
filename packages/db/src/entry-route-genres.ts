import { jstNow } from './utils.js';

export interface EntryRouteGenre {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export async function getEntryRouteGenres(db: D1Database): Promise<EntryRouteGenre[]> {
  const result = await db
    .prepare('SELECT * FROM entry_route_genres ORDER BY created_at ASC, name ASC')
    .all<EntryRouteGenre>();
  return result.results;
}

export async function createEntryRouteGenre(
  db: D1Database,
  name: string,
): Promise<EntryRouteGenre> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO entry_route_genres (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(id, name.trim(), now, now)
    .run();
  return (await db
    .prepare('SELECT * FROM entry_route_genres WHERE id = ?')
    .bind(id)
    .first<EntryRouteGenre>())!;
}

export async function ensureEntryRouteGenre(
  db: D1Database,
  name: string,
): Promise<void> {
  const normalized = name.trim();
  if (!normalized) return;
  const now = jstNow();
  await db
    .prepare(
      `INSERT OR IGNORE INTO entry_route_genres (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), normalized, now, now)
    .run();
}
