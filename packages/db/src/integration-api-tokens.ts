import { jstNow } from './utils.js';

/**
 * 公開APIトークンの台帳（#939 N-380）。
 *
 * 外部システムが `/api/public/v1/*` を呼ぶための合言葉。
 * 管理画面の認証(staffのapi_keyやenv API_KEY)とは別の台帳で、
 * ここで発行したトークンは公開APIだけに効き、管理画面の入口には使えない。
 *
 * 約束:
 * - 平文は保存しない。保存するのは SHA-256 の hash と、一覧で見分ける
 *   ための先頭の数桁(token_prefix)だけ。
 * - 平文が返るのは発行・再発行の応答の1回だけ。
 * - 失効は行を消さず revoked_at に時刻を残す。再発行は旧行を失効させ、
 *   新しい行の rotated_from_id で系譜を残す。
 */

export const INTEGRATION_API_TOKEN_PREFIX = 'lhp_';

/** 公開APIで使える権限の範囲。初版はタグの参照と付け外しだけ。 */
export const INTEGRATION_API_SCOPES = ['tags:read', 'tags:write'] as const;
export type IntegrationApiScope = (typeof INTEGRATION_API_SCOPES)[number];

export interface IntegrationApiTokenRow {
  id: string;
  line_account_id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  /** JSON配列。中身は IntegrationApiScope の並び。 */
  scopes: string;
  created_by: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  rotated_from_id: string | null;
  created_at: string;
  updated_at: string;
}

export function generateIntegrationApiToken(): string {
  // 192bit の乱数。推測も総当たりも実質不可能な長さ。
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `${INTEGRATION_API_TOKEN_PREFIX}${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function hashIntegrationApiToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function parseScopes(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function tokenHasScope(row: IntegrationApiTokenRow, scope: IntegrationApiScope): boolean {
  return parseScopes(row.scopes).includes(scope);
}

/** 照合。失効済み・存在しないものは null。見つかったら last_used_at を進める。 */
export async function resolveIntegrationApiToken(
  db: D1Database,
  token: string,
): Promise<IntegrationApiTokenRow | null> {
  if (!token.startsWith(INTEGRATION_API_TOKEN_PREFIX)) return null;
  const hash = await hashIntegrationApiToken(token);
  const row = await db.prepare(
    `SELECT * FROM integration_api_tokens WHERE token_hash = ? AND revoked_at IS NULL`,
  ).bind(hash).first<IntegrationApiTokenRow>();
  if (!row) return null;
  await db.prepare(
    `UPDATE integration_api_tokens SET last_used_at = ? WHERE id = ?`,
  ).bind(jstNow(), row.id).run();
  return row;
}

export async function listIntegrationApiTokens(
  db: D1Database,
  lineAccountId: string,
): Promise<IntegrationApiTokenRow[]> {
  const result = await db.prepare(
    `SELECT * FROM integration_api_tokens
      WHERE line_account_id = ? AND revoked_at IS NULL
      ORDER BY created_at DESC`,
  ).bind(lineAccountId).all<IntegrationApiTokenRow>();
  return result.results ?? [];
}

export async function getIntegrationApiTokenById(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<IntegrationApiTokenRow | null> {
  return db.prepare(
    `SELECT * FROM integration_api_tokens WHERE id = ? AND line_account_id = ?`,
  ).bind(id, lineAccountId).first<IntegrationApiTokenRow>();
}

/**
 * 新しいトークンを作る。返り値の token はこの呼び出しの中でしか
 * 手に入らない平文。呼び出し側は応答へ1回だけ乗せて、どこにも残さない。
 */
export async function createIntegrationApiToken(
  db: D1Database,
  input: {
    lineAccountId: string;
    name: string;
    scopes: string[];
    createdBy?: string;
    rotatedFromId?: string;
  },
): Promise<{ row: IntegrationApiTokenRow; token: string }> {
  const id = crypto.randomUUID();
  const token = generateIntegrationApiToken();
  const hash = await hashIntegrationApiToken(token);
  const now = jstNow();
  await db.prepare(
    `INSERT INTO integration_api_tokens
       (id, line_account_id, name, token_hash, token_prefix, scopes, created_by, rotated_from_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    input.lineAccountId,
    input.name,
    hash,
    token.slice(0, 12),
    JSON.stringify(input.scopes),
    input.createdBy ?? null,
    input.rotatedFromId ?? null,
    now,
    now,
  ).run();
  return { row: (await getIntegrationApiTokenById(db, id, input.lineAccountId))!, token };
}

export async function revokeIntegrationApiToken(
  db: D1Database,
  id: string,
  lineAccountId: string,
  revokedBy?: string,
): Promise<boolean> {
  const now = jstNow();
  const result = await db.prepare(
    `UPDATE integration_api_tokens
        SET revoked_at = ?, revoked_by = ?, updated_at = ?
      WHERE id = ? AND line_account_id = ? AND revoked_at IS NULL`,
  ).bind(now, revokedBy ?? null, now, id, lineAccountId).run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * 再発行。旧トークンは即座に失効させ、同じ名前・範囲の新しいトークンを返す。
 * 旧行が無い・既に失効済みなら null。
 */
export async function rotateIntegrationApiToken(
  db: D1Database,
  id: string,
  lineAccountId: string,
  rotatedBy?: string,
): Promise<{ row: IntegrationApiTokenRow; token: string } | null> {
  const old = await getIntegrationApiTokenById(db, id, lineAccountId);
  if (!old || old.revoked_at !== null) return null;
  // 先に失効させる。逆順で新しい方だけ失敗すると、失効したはずの
  // 旧トークンが生き残る。先に止めれば失敗時は「どちらも使えない」に倒れる。
  await revokeIntegrationApiToken(db, id, lineAccountId, rotatedBy);
  return createIntegrationApiToken(db, {
    lineAccountId,
    name: old.name,
    scopes: parseScopes(old.scopes),
    createdBy: rotatedBy,
    rotatedFromId: old.id,
  });
}
