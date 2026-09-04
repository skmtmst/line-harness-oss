import { jstNow } from './utils.js';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import {
  CredentialEncryptionKeyError,
  decryptCredential,
  encryptCredential,
} from './credential-crypto.js';
// =============================================================================
// LINE Accounts — Multi-Account Management
// =============================================================================

async function resolveCredentialEncryptionKey(explicit?: string): Promise<string | undefined> {
  if (explicit?.trim()) return explicit;
  try {
    // Workers expose bindings through this runtime module. Node-based DB tests
    // and offline tools do not, so reads retain the migration fallback there.
    const runtime = await import('cloudflare:workers');
    const bindings = runtime.env as unknown as { LINE_CREDENTIAL_ENCRYPTION_KEY?: string };
    return bindings.LINE_CREDENTIAL_ENCRYPTION_KEY?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export interface LineAccount {
  id: string;
  channel_id: string;
  name: string;
  channel_access_token: string;
  channel_secret: string;
  channel_access_token_encrypted?: string | null;
  channel_secret_encrypted?: string | null;
  login_channel_id: string | null;
  login_channel_secret: string | null;
  liff_id: string | null;
  is_active: number;
  country: string | null;
  role: string | null;
  display_order: number;
  token_expires_at: string | null;
  og_site_name: string | null;
  og_default_image_url: string | null;
  og_default_description: string | null;
  /** 友だち数の上限。NULL なら上限を管理しない */
  friend_capacity: number | null;
  /** 何人で警告を出すか。NULL なら警告しない */
  capacity_warn_at: number | null;
  /** 管理画面の一覧やヘッダーで使うアイコン。OGP用の og_default_image_url とは用途が違う */
  icon_url: string | null;
  /** LINE公式アカウント構成の上位アカウント。NULLなら未設定（ルート）。 */
  parent_line_account_id: string | null;
  /** 所属する統括。指示Cで認可境界として有効化するまでは表示範囲を変えない。 */
  tenant_id: string | null;
  /** V6の日時指定と日別分析で使うIANAタイムゾーン。 */
  timezone?: string;
  created_at: string;
  updated_at: string;
}

export type LineCredentialField = 'channel_access_token' | 'channel_secret';

export type LineCredentialFailureReason =
  | 'key_unavailable_or_invalid'
  | 'decrypt_failed';

export interface LineCredentialContext {
  lineAccountId: string;
  field: LineCredentialField;
}

export interface LineCredentialHealth {
  encrypted: boolean;
  decryptable: boolean;
  source: 'encrypted' | 'plaintext';
}

export interface LineAccountCredentialHealth {
  channel_access_token: LineCredentialHealth;
  channel_secret: LineCredentialHealth;
}

function classifyCredentialFailure(error: unknown): LineCredentialFailureReason {
  return error instanceof CredentialEncryptionKeyError
    ? 'key_unavailable_or_invalid'
    : 'decrypt_failed';
}

function warnPlaintextCredentialFallback(
  context: LineCredentialContext,
  error: unknown,
): void {
  // Credential values and thrown error messages are deliberately excluded.
  console.warn({
    event: 'line_credential_plaintext_fallback',
    line_account_id: context.lineAccountId,
    field: context.field,
    reason: classifyCredentialFailure(error),
  });
}

export interface CreateLineAccountInput {
  channelId: string;
  name: string;
  channelAccessToken: string;
  channelSecret: string;
  loginChannelId?: string | null;
  loginChannelSecret?: string | null;
  liffId?: string | null;
  ogSiteName?: string | null;
  ogDefaultImageUrl?: string | null;
  ogDefaultDescription?: string | null;
  parentLineAccountId?: string | null;
  tenantId?: string | null;
}

export async function createLineAccount(
  db: D1Database,
  input: CreateLineAccountInput,
  credentialEncryptionKey?: string,
): Promise<LineAccount> {
  const id = crypto.randomUUID();
  const now = jstNow();

  // Auto-fill display_order to (max existing + 1) so new accounts go to the end.
  // COALESCE handles the empty-table case: -1 + 1 = 0.
  const orderRow = await db
    .prepare(`SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM line_accounts`)
    .first<{ next: number }>();
  const displayOrder = orderRow?.next ?? 0;
  const encryptionKey = await resolveCredentialEncryptionKey(credentialEncryptionKey);
  const [encryptedAccessToken, encryptedChannelSecret] = await Promise.all([
    encryptCredential(input.channelAccessToken, encryptionKey),
    encryptCredential(input.channelSecret, encryptionKey),
  ]);

  await db
    .prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret,
          channel_access_token_encrypted, channel_secret_encrypted,
          login_channel_id, login_channel_secret, liff_id,
          is_active, display_order,
          og_site_name, og_default_image_url, og_default_description,
          parent_line_account_id, tenant_id,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.channelId,
      input.name,
      input.channelAccessToken,
      input.channelSecret,
      encryptedAccessToken,
      encryptedChannelSecret,
      input.loginChannelId ?? null,
      input.loginChannelSecret ?? null,
      input.liffId ?? null,
      displayOrder,
      input.ogSiteName ?? null,
      input.ogDefaultImageUrl ?? null,
      input.ogDefaultDescription ?? null,
      input.parentLineAccountId ?? null,
      input.tenantId ?? DEFAULT_TENANT_ID,
      now,
      now,
    )
    .run();

  return (await getLineAccountById(db, id, encryptionKey))!;
}

/**
 * Prefer encrypted credentials. During the staged migration only, a missing key
 * or failed decrypt falls back to the legacy plaintext columns when they exist.
 */
export async function decryptLineAccountCredentials(
  row: LineAccount,
  credentialEncryptionKey?: string,
): Promise<LineAccount> {
  const next = { ...row };
  for (const field of [
    ['channel_access_token', 'channel_access_token_encrypted'],
    ['channel_secret', 'channel_secret_encrypted'],
  ] as const) {
    const [plainField, encryptedField] = field;
    const encrypted = row[encryptedField];
    if (!encrypted) continue;
    try {
      next[plainField] = await decryptCredential(encrypted, credentialEncryptionKey);
    } catch (error) {
      if (!row[plainField]) {
        throw new Error(`Unable to decrypt ${plainField}; no legacy fallback is available`);
      }
      warnPlaintextCredentialFallback(
        { lineAccountId: row.id, field: plainField },
        error,
      );
      next[plainField] = row[plainField];
    }
  }
  return next;
}

/** Resolves one joined credential column while preserving the migration fallback. */
export async function resolveLineCredential(
  encrypted: string | null | undefined,
  legacyPlaintext: string | null | undefined,
  context: LineCredentialContext,
  credentialEncryptionKey?: string,
): Promise<string> {
  if (!encrypted) return legacyPlaintext ?? '';
  const encryptionKey = await resolveCredentialEncryptionKey(credentialEncryptionKey);
  try {
    return await decryptCredential(encrypted, encryptionKey);
  } catch (error) {
    if (legacyPlaintext) {
      warnPlaintextCredentialFallback(context, error);
      return legacyPlaintext;
    }
    throw new Error('Unable to decrypt LINE credential; no legacy fallback is available');
  }
}

async function inspectCredentialHealth(
  encrypted: string | null | undefined,
  legacyPlaintext: string | null | undefined,
  credentialEncryptionKey?: string,
): Promise<LineCredentialHealth> {
  if (!encrypted) {
    return { encrypted: false, decryptable: false, source: 'plaintext' };
  }
  try {
    await decryptCredential(encrypted, credentialEncryptionKey);
    return { encrypted: true, decryptable: true, source: 'encrypted' };
  } catch {
    return {
      encrypted: true,
      decryptable: false,
      source: legacyPlaintext ? 'plaintext' : 'encrypted',
    };
  }
}

/** Returns credential storage/decryption state without exposing either value. */
export async function getLineAccountCredentialHealth(
  db: D1Database,
  id: string,
  credentialEncryptionKey?: string,
): Promise<LineAccountCredentialHealth | null> {
  const row = await db
    .prepare(
      `SELECT channel_access_token, channel_secret,
              channel_access_token_encrypted, channel_secret_encrypted
         FROM line_accounts
        WHERE id = ?`,
    )
    .bind(id)
    .first<
      Pick<
        LineAccount,
        | 'channel_access_token'
        | 'channel_secret'
        | 'channel_access_token_encrypted'
        | 'channel_secret_encrypted'
      >
    >();
  if (!row) return null;

  const encryptionKey = await resolveCredentialEncryptionKey(credentialEncryptionKey);
  const [channelAccessToken, channelSecret] = await Promise.all([
    inspectCredentialHealth(
      row.channel_access_token_encrypted,
      row.channel_access_token,
      encryptionKey,
    ),
    inspectCredentialHealth(
      row.channel_secret_encrypted,
      row.channel_secret,
      encryptionKey,
    ),
  ]);
  return {
    channel_access_token: channelAccessToken,
    channel_secret: channelSecret,
  };
}

export async function getLineAccountById(
  db: D1Database,
  id: string,
  credentialEncryptionKey?: string,
): Promise<LineAccount | null> {
  const encryptionKey = await resolveCredentialEncryptionKey(credentialEncryptionKey);
  const row = await db
    .prepare(`SELECT * FROM line_accounts WHERE id = ?`)
    .bind(id)
    .first<LineAccount>();
  return row ? decryptLineAccountCredentials(row, encryptionKey) : null;
}

export async function getLineAccounts(
  db: D1Database,
  credentialEncryptionKey?: string,
): Promise<LineAccount[]> {
  const encryptionKey = await resolveCredentialEncryptionKey(credentialEncryptionKey);
  const result = await db
    .prepare(`SELECT * FROM line_accounts ORDER BY display_order ASC, created_at ASC`)
    .all<LineAccount>();
  return Promise.all(
    result.results.map((row) => decryptLineAccountCredentials(row, encryptionKey)),
  );
}

export interface LineAccountListStats {
  friendCount: number;
  activeScenarios: number;
  messagesThisMonth: number;
}

/**
 * Returns the three counters used by the account list in one D1 query.
 *
 * The JSON input keeps the bind count constant even when an operator has many
 * accounts. Each source is aggregated before UNION ALL so joins cannot
 * multiply another source's count.
 */
export async function getLineAccountListStats(
  db: D1Database,
  lineAccountIds: string[],
): Promise<Record<string, LineAccountListStats>> {
  if (lineAccountIds.length === 0) return {};

  const result = await db
    .prepare(
      `WITH requested_accounts(line_account_id) AS (
         SELECT CAST(value AS TEXT) FROM json_each(?)
       ), source_counts AS (
         SELECT f.line_account_id,
                COUNT(*) AS friend_count,
                0 AS active_scenarios,
                0 AS messages_this_month
           FROM friends f
           INNER JOIN requested_accounts requested
             ON requested.line_account_id = f.line_account_id
          WHERE f.is_following = 1
          GROUP BY f.line_account_id
         UNION ALL
         SELECT f.line_account_id,
                0 AS friend_count,
                COUNT(*) AS active_scenarios,
                0 AS messages_this_month
           FROM friend_scenarios fs
           INNER JOIN friends f ON f.id = fs.friend_id
           INNER JOIN requested_accounts requested
             ON requested.line_account_id = f.line_account_id
          WHERE fs.status = 'active'
          GROUP BY f.line_account_id
         UNION ALL
         SELECT f.line_account_id,
                0 AS friend_count,
                0 AS active_scenarios,
                COUNT(*) AS messages_this_month
           FROM messages_log ml
           INNER JOIN friends f ON f.id = ml.friend_id
           INNER JOIN requested_accounts requested
             ON requested.line_account_id = f.line_account_id
          WHERE ml.direction = 'outgoing'
            AND (ml.delivery_type IS NULL OR ml.delivery_type = 'push')
            AND ml.created_at >= date('now', 'start of month')
          GROUP BY f.line_account_id
       )
       SELECT requested.line_account_id,
              COALESCE(SUM(source.friend_count), 0) AS friend_count,
              COALESCE(SUM(source.active_scenarios), 0) AS active_scenarios,
              COALESCE(SUM(source.messages_this_month), 0) AS messages_this_month
         FROM requested_accounts requested
         LEFT JOIN source_counts source
           ON source.line_account_id = requested.line_account_id
        GROUP BY requested.line_account_id`,
    )
    .bind(JSON.stringify(lineAccountIds))
    .all<{
      line_account_id: string;
      friend_count: number;
      active_scenarios: number;
      messages_this_month: number;
    }>();

  return Object.fromEntries(
    result.results.map((row) => [
      row.line_account_id,
      {
        friendCount: Number(row.friend_count),
        activeScenarios: Number(row.active_scenarios),
        messagesThisMonth: Number(row.messages_this_month),
      },
    ]),
  );
}

export async function getLineAccountByChannelId(
  db: D1Database,
  channelId: string,
  credentialEncryptionKey?: string,
): Promise<LineAccount | null> {
  const encryptionKey = await resolveCredentialEncryptionKey(credentialEncryptionKey);
  const row = await db
    .prepare(`SELECT * FROM line_accounts WHERE channel_id = ?`)
    .bind(channelId)
    .first<LineAccount>();
  return row ? decryptLineAccountCredentials(row, encryptionKey) : null;
}

export type UpdateLineAccountInput = Partial<
  Pick<
    LineAccount,
    | 'name'
    | 'channel_access_token'
    | 'channel_secret'
    | 'login_channel_id'
    | 'login_channel_secret'
    | 'liff_id'
    | 'is_active'
    | 'token_expires_at'
    | 'og_site_name'
    | 'og_default_image_url'
    | 'og_default_description'
    | 'friend_capacity'
    | 'capacity_warn_at'
    | 'icon_url'
    | 'parent_line_account_id'
  >
>;

export async function updateLineAccount(
  db: D1Database,
  id: string,
  updates: UpdateLineAccountInput,
  credentialEncryptionKey?: string,
): Promise<LineAccount | null> {
  const encryptionKey = await resolveCredentialEncryptionKey(credentialEncryptionKey);
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.channel_access_token !== undefined) {
    fields.push('channel_access_token = ?');
    values.push(updates.channel_access_token);
    fields.push('channel_access_token_encrypted = ?');
    values.push(await encryptCredential(updates.channel_access_token, encryptionKey));
  }
  if (updates.channel_secret !== undefined) {
    fields.push('channel_secret = ?');
    values.push(updates.channel_secret);
    fields.push('channel_secret_encrypted = ?');
    values.push(await encryptCredential(updates.channel_secret, encryptionKey));
  }
  if (updates.login_channel_id !== undefined) {
    fields.push('login_channel_id = ?');
    values.push(updates.login_channel_id);
  }
  if (updates.login_channel_secret !== undefined) {
    fields.push('login_channel_secret = ?');
    values.push(updates.login_channel_secret);
  }
  if (updates.liff_id !== undefined) {
    fields.push('liff_id = ?');
    values.push(updates.liff_id);
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.is_active);
  }
  if (updates.token_expires_at !== undefined) {
    fields.push('token_expires_at = ?');
    values.push(updates.token_expires_at);
  }
  if (updates.og_site_name !== undefined) {
    fields.push('og_site_name = ?');
    values.push(updates.og_site_name);
  }
  if (updates.og_default_image_url !== undefined) {
    fields.push('og_default_image_url = ?');
    values.push(updates.og_default_image_url);
  }
  if (updates.friend_capacity !== undefined) {
    fields.push('friend_capacity = ?');
    values.push(updates.friend_capacity);
  }
  if (updates.capacity_warn_at !== undefined) {
    fields.push('capacity_warn_at = ?');
    values.push(updates.capacity_warn_at);
  }
  if (updates.icon_url !== undefined) {
    fields.push('icon_url = ?');
    values.push(updates.icon_url);
  }
  if (updates.parent_line_account_id !== undefined) {
    fields.push('parent_line_account_id = ?');
    values.push(updates.parent_line_account_id);
  }
  if (updates.og_default_description !== undefined) {
    fields.push('og_default_description = ?');
    values.push(updates.og_default_description);
  }

  if (fields.length === 0) return getLineAccountById(db, id, encryptionKey);

  fields.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);

  await db
    .prepare(`UPDATE line_accounts SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return getLineAccountById(db, id, encryptionKey);
}

export async function deleteLineAccount(
  db: D1Database,
  id: string,
): Promise<void> {
  await db.prepare(`DELETE FROM line_accounts WHERE id = ?`).bind(id).run();
}

export interface UpdateLineAccountFieldsInput {
  country?: string | null;
  role?: string | null;
  isActive?: boolean;
  loginChannelId?: string | null;
  loginChannelSecret?: string | null;
  liffId?: string | null;
  ogSiteName?: string | null;
  ogDefaultImageUrl?: string | null;
  ogDefaultDescription?: string | null;
  /** 友だち数の上限。null で「上限を管理しない」に戻す */
  friendCapacity?: number | null;
  /** 何人で警告を出すか。null で「警告しない」に戻す */
  capacityWarnAt?: number | null;
  /** 管理画面で使うアイコン。null で未設定に戻す */
  iconUrl?: string | null;
}

export async function updateLineAccountFields(
  db: D1Database,
  id: string,
  input: UpdateLineAccountFieldsInput,
): Promise<LineAccount | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];

  if (input.country !== undefined) {
    sets.push('country = ?');
    binds.push(input.country); // empty string normalization happens at the route layer
  }
  if (input.role !== undefined) {
    sets.push('role = ?');
    binds.push(input.role);
  }
  if (input.isActive !== undefined) {
    sets.push('is_active = ?');
    binds.push(input.isActive ? 1 : 0);
  }
  if (input.loginChannelId !== undefined) {
    sets.push('login_channel_id = ?');
    binds.push(input.loginChannelId);
  }
  if (input.loginChannelSecret !== undefined) {
    sets.push('login_channel_secret = ?');
    binds.push(input.loginChannelSecret);
  }
  if (input.liffId !== undefined) {
    sets.push('liff_id = ?');
    binds.push(input.liffId);
  }
  if (input.ogSiteName !== undefined) {
    sets.push('og_site_name = ?');
    binds.push(input.ogSiteName);
  }
  if (input.ogDefaultImageUrl !== undefined) {
    sets.push('og_default_image_url = ?');
    binds.push(input.ogDefaultImageUrl);
  }
  if (input.ogDefaultDescription !== undefined) {
    sets.push('og_default_description = ?');
    binds.push(input.ogDefaultDescription);
  }
  if (input.friendCapacity !== undefined) {
    sets.push('friend_capacity = ?');
    binds.push(input.friendCapacity);
  }
  if (input.capacityWarnAt !== undefined) {
    sets.push('capacity_warn_at = ?');
    binds.push(input.capacityWarnAt);
  }
  if (input.iconUrl !== undefined) {
    sets.push('icon_url = ?');
    binds.push(input.iconUrl);
  }

  if (sets.length === 0) {
    return getLineAccountById(db, id);
  }

  sets.push('updated_at = ?');
  binds.push(jstNow());
  binds.push(id);

  await db
    .prepare(`UPDATE line_accounts SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  return getLineAccountById(db, id);
}

export async function updateLineAccountOrder(
  db: D1Database,
  ordered: Array<{ id: string; displayOrder: number }>,
): Promise<void> {
  if (ordered.length === 0) return;

  const now = jstNow();
  const stmts = ordered.map(({ id, displayOrder }) =>
    db.prepare(`UPDATE line_accounts SET display_order = ?, updated_at = ? WHERE id = ?`)
      .bind(displayOrder, now, id),
  );

  // db.batch is atomic on D1; if any UPDATE fails, none commit.
  await db.batch(stmts);
}
