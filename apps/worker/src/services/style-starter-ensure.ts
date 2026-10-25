import type { SetupAnswer } from '@line-crm/shared';
import { hasPendingStyleSelection, profile, type StyleProfile } from './style-profile.js';
import { StyleError } from './style-setup-core.js';
import { insertStyleStarterItems } from './style-starter-insert.js';

/**
 * 今のスタイルの初期セットのうち、まだ入っていない物を決める。
 * statements に積むだけで実行しない。読む口（はじめにやること）と入れ直しの口が同じ判定を使い、
 * 「足りない数」と「入れ直しで入る数」がずれないようにする。
 */
async function planMissingStarterItems(
  db: D1Database,
  account: string,
  tenant: string | null,
  actor: string,
  p: StyleProfile,
  now: string,
) {
  const statements: D1PreparedStatement[] = [];
  const selected = p.selection_mode === 'configured' || hasPendingStyleSelection(p);
  const answers = JSON.parse(p.answers_json ?? '{}') as Record<string, SetupAnswer>;
  // 店が編集した物を上書きしないよう、ある物は必ず飛ばす（skipExisting は既定の true のまま）。
  const result = await insertStyleStarterItems(
    db, account, tenant, actor, {}, selected, p.style, answers, statements, now,
  );
  return { ...result, statements };
}

/** はじめにやることの「初期セットが入っているか」。読むだけで書かない。 */
export async function starterApplication(db: D1Database, account: string, tenant: string | null) {
  const p = await profile(db, account);
  if (!p) return null;
  const count = (await db
    .prepare('SELECT COUNT(*) AS n FROM style_starter_items WHERE line_account_id=?')
    .bind(account)
    .first<{ n: number }>())?.n ?? 0;
  let missing: number | null;
  try {
    missing = (await planMissingStarterItems(db, account, tenant, 'getting-started', p, new Date().toISOString())).inserted.length;
  } catch (error) {
    // 統括の組が入れ直しで使えない形の時も、手順の一覧そのものは返す。数えられない物を 0 と言わない。
    if (!(error instanceof StyleError)) throw error;
    missing = null;
  }
  return { applied: count > 0, count, missing };
}

/**
 * 入れ直し。足りない物だけを入れ、スタイルの版は上げない。
 * 版は条件にだけ使い、読んだ後に変わっていたら batch ごと取り消す（古いスタイルの見本を入れない）。
 * 入れる物は止めた状態のまま。送信も利用開始もしない。
 */
export async function ensureStyleStarterItems(
  db: D1Database,
  account: string,
  tenant: string | null,
  actor: string,
  input: Record<string, unknown>,
) {
  const p = await profile(db, account);
  if (!p) throw new StyleError('select_style_first', 409);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion !== p.version)
    throw new StyleError('version_conflict', 409);
  const now = new Date().toISOString();
  const { set, inserted, skipped, existing, statements } = await planMissingStarterItems(db, account, tenant, actor, p, now);
  const keys = new Set(set.definition.items.map((item) => item.key));
  const result = {
    inserted: (inserted as Array<{ key: string; kind: string }>).map(({ key, kind }) => ({ key, kind })),
    skipped,
    existing: existing.filter((row) => keys.has(row.item_key)).length,
    starterSet: { id: set.id, version: set.version },
  };
  if (!inserted.length) return result;
  try {
    await db.batch([
      db.prepare(
        `SELECT json(CASE WHEN COALESCE((SELECT version FROM account_styles WHERE line_account_id=? AND style=?),-1)=? THEN '{}' ELSE 'STYLE_VERSION_CONFLICT' END)`,
      ).bind(account, p.style, p.version),
      ...statements,
      db.prepare(
        `INSERT INTO style_change_logs(id,line_account_id,actor_id,action,after_json,created_at) VALUES(?,?,?,'starter.ensure',?,?)`,
      ).bind(
        crypto.randomUUID(),
        account,
        actor,
        JSON.stringify({ setId: set.id, setVersion: set.version, version: p.version, keys: result.inserted.map((i) => i.key) }),
        now,
      ),
    ]);
  } catch (error) {
    if (String(error).includes('malformed JSON') || String(error).includes('UNIQUE constraint failed: style_starter_items.'))
      throw new StyleError('version_conflict', 409);
    throw error;
  }
  return result;
}
