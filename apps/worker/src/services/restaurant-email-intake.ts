import type { Env } from '../index.js';
import { dbFor } from './db-router.js';

const LOCAL_PART_PREFIX = 'r-';
const RANDOM_LENGTH = 32;
// 宛先を小文字化するメール基盤でも照合できるよう、発行値は小文字英数字に限定する。
const RANDOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const RANDOM_ACCEPT_LIMIT = Math.floor(256 / RANDOM_ALPHABET.length) * RANDOM_ALPHABET.length;
const REISSUE_GRACE_DAYS = 90;
const DEFAULT_RAW_MAIL_RETENTION_DAYS = 90;
const MAX_RAW_MAIL_RETENTION_DAYS = 3_650;
const RETENTION_BATCH_SIZE = 1_000;
const RETENTION_MAX_PER_RUN = 5_000;

type IntakeAddressRow = {
  store_id: string;
  status: 'active' | 'revoked';
  is_active: number;
};

type InboundEmailRow = {
  id: string;
  message_id: string;
  store_id: string | null;
  r2_key: string;
  status: 'storing' | 'stored' | 'received' | 'quarantined' | 'storage_failed' | 'raw_deleted';
  size_bytes: number;
  quarantine_reason: string | null;
};

export class RestaurantIntakeConfigurationError extends Error {
  constructor() {
    super('RESTAURANT_INTAKE_DOMAIN_NOT_CONFIGURED');
    this.name = 'RestaurantIntakeConfigurationError';
  }
}

function recipientParts(recipient: string): { localPart: string; domain: string } | null {
  const normalized = recipient.trim().toLowerCase();
  const separator = normalized.lastIndexOf('@');
  if (separator <= 0 || separator === normalized.length - 1) return null;
  return {
    localPart: normalized.slice(0, separator),
    domain: normalized.slice(separator + 1),
  };
}

function configuredDomain(env: Env['Bindings']): string | null {
  const domain = env.RESTAURANT_INTAKE_DOMAIN?.trim().toLowerCase() || '';
  if (!domain || domain.includes('@') || !/^[a-z0-9.-]+$/.test(domain)) return null;
  return domain;
}

function safeObjectKeySegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 宛先のローカル部だけで、飲食店向けcatch-allの対象かを判定する。 */
export function isRestaurantIntakeRecipient(recipient: string): boolean {
  return recipientParts(recipient)?.localPart.startsWith(LOCAL_PART_PREFIX) ?? false;
}

/**
 * 推測困難な取り込み専用ローカル部を作る。
 * modulo biasを避けるため、62の倍数に収まらない乱数値は捨てる。
 */
export function generateRestaurantIntakeLocalPart(): string {
  let token = '';
  while (token.length < RANDOM_LENGTH) {
    const bytes = new Uint8Array(RANDOM_LENGTH - token.length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= RANDOM_ACCEPT_LIMIT) continue;
      token += RANDOM_ALPHABET[byte % RANDOM_ALPHABET.length];
      if (token.length === RANDOM_LENGTH) break;
    }
  }
  return `${LOCAL_PART_PREFIX}${token}`;
}

export async function issueRestaurantIntakeAddress(
  env: Env['Bindings'],
  storeId: string,
): Promise<{ id: string; storeId: string; localPart: string; address: string; graceDays: number }> {
  const domain = configuredDomain(env);
  if (!domain) throw new RestaurantIntakeConfigurationError();

  const db = dbFor(env, storeId);
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = crypto.randomUUID();
    const localPart = generateRestaurantIntakeLocalPart();
    try {
      await db.batch([
        db.prepare(`INSERT INTO rt_intake_addresses (id, local_part, store_id)
          VALUES (?, ?, ?)`).bind(id, localPart, storeId),
        db.prepare(`UPDATE rt_intake_addresses
          SET revoked_at = datetime('now', '+${REISSUE_GRACE_DAYS} days')
          WHERE store_id = ? AND id <> ? AND status = 'active' AND revoked_at IS NULL`).bind(storeId, id),
      ]);
      return {
        id,
        storeId,
        localPart,
        address: `${localPart}@${domain}`,
        graceDays: REISSUE_GRACE_DAYS,
      };
    } catch (error) {
      if (!/unique constraint/i.test(String(error)) || attempt === 4) throw error;
    }
  }
  throw new Error('INTAKE_ADDRESS_GENERATION_FAILED');
}

async function storeRawEmail(
  message: ForwardableEmailMessage,
  env: Env['Bindings'],
  objectKey: string,
  customMetadata?: Record<string, string>,
): Promise<void> {
  // Cloudflare Email Routing rejects messages over 25 MiB before this handler runs.
  // Workers share a 128 MB isolate limit, so never turn the raw MIME stream into an
  // ArrayBuffer/string here. R2 receives the single-use stream directly.
  await env.RAW_MAIL.put(objectKey, message.raw, {
    httpMetadata: { contentType: 'message/rfc822' },
    customMetadata,
  });
}

function inboundMessageId(message: ForwardableEmailMessage): string {
  return message.headers.get('message-id')?.trim() || `email-${crypto.randomUUID()}`;
}

async function claimInboundEmail(
  env: Env['Bindings'],
  messageId: string,
  storeId: string | null,
  sizeBytes: number,
  quarantineReason: string | null,
): Promise<{ inserted: true; id: string } | { inserted: false; row: InboundEmailRow }> {
  const db = dbFor(env, storeId);
  const id = crypto.randomUUID();
  const inserted = await db.prepare(`INSERT INTO rt_inbound_emails
    (id, message_id, store_id, r2_key, status, size_bytes, quarantine_reason)
    VALUES (?, ?, ?, '', 'storing', ?, ?)
    ON CONFLICT(message_id) DO NOTHING`).bind(
      id,
      messageId,
      storeId,
      Math.max(0, sizeBytes),
      quarantineReason,
    ).run();
  if (inserted.meta.changes) return { inserted: true, id };

  const row = await db.prepare(`SELECT id, message_id, store_id, r2_key, status,
      size_bytes, quarantine_reason
    FROM rt_inbound_emails WHERE message_id = ? LIMIT 1`).bind(messageId).first<InboundEmailRow>();
  if (!row) throw new Error('INBOUND_EMAIL_IDEMPOTENCY_ROW_MISSING');
  return { inserted: false, row };
}

async function markRawStorageFailure(
  env: Env['Bindings'],
  storeId: string | null,
  inboundId: string,
  error: unknown,
): Promise<void> {
  try {
    await dbFor(env, storeId).prepare(`UPDATE rt_inbound_emails
      SET status = 'storage_failed', r2_key = '' WHERE id = ?`).bind(inboundId).run();
  } catch (recordError) {
    console.error(JSON.stringify({
      event: 'restaurant_email_storage_failure_record_failed',
      inboundId,
      error: String(recordError),
      originalError: String(error),
    }));
  }
}

async function discardDuplicateRawStream(message: ForwardableEmailMessage): Promise<void> {
  try {
    await message.raw.cancel('duplicate_message_id');
  } catch {
    // 重複メールは既存R2原文を正本とする。cancel失敗で受信結果は変えない。
  }
}

async function quarantineRestaurantEmail(
  message: ForwardableEmailMessage,
  env: Env['Bindings'],
  reason: string,
  parts: { localPart: string; domain: string } | null,
  storeId: string | null = null,
): Promise<{ quarantined: true; duplicate: boolean; objectKey: string }> {
  const receivedAt = new Date().toISOString();
  const messageId = inboundMessageId(message);
  const objectKey = `restaurant-intake-quarantine/${receivedAt.slice(0, 10)}/${crypto.randomUUID()}.eml`;
  const claim = await claimInboundEmail(env, messageId, storeId, message.rawSize, reason);
  if (!claim.inserted) {
    await discardDuplicateRawStream(message);
    return { quarantined: true, duplicate: true, objectKey: claim.row.r2_key };
  }

  try {
    await storeRawEmail(message, env, objectKey, {
      reason,
      localPart: parts?.localPart ?? '',
      domain: parts?.domain ?? '',
      rawSize: String(message.rawSize),
    });
  } catch (error) {
    await markRawStorageFailure(env, storeId, claim.id, error);
    throw error;
  }
  await dbFor(env, storeId).prepare(`UPDATE rt_inbound_emails
    SET r2_key = ?, status = 'quarantined' WHERE id = ?`).bind(objectKey, claim.id).run();
  console.warn(JSON.stringify({
    event: 'restaurant_email_quarantined',
    reason,
    objectKey,
    domain: parts?.domain ?? null,
    rawSize: message.rawSize,
  }));
  return { quarantined: true, duplicate: false, objectKey };
}

async function storeRestaurantReservationEmail(
  message: ForwardableEmailMessage,
  env: Env['Bindings'],
  storeId: string,
): Promise<{ storeId: string; quarantined: false; duplicate: boolean; objectKey: string }> {
  const externalEventId = inboundMessageId(message);
  const fingerprint = await sha256Hex(`${storeId}\n${externalEventId}`);
  const objectKey = `restaurant-intake/${safeObjectKeySegment(storeId)}/${fingerprint}.eml`;
  const claim = await claimInboundEmail(env, externalEventId, storeId, message.rawSize, null);
  if (!claim.inserted) {
    await discardDuplicateRawStream(message);
    return {
      storeId,
      quarantined: false,
      duplicate: true,
      objectKey: claim.row.r2_key || objectKey,
    };
  }

  try {
    await storeRawEmail(message, env, objectKey);
  } catch (error) {
    await markRawStorageFailure(env, storeId, claim.id, error);
    throw error;
  }

  await dbFor(env, storeId).prepare(`UPDATE rt_inbound_emails
    SET r2_key = ?, status = 'stored' WHERE id = ?`).bind(objectKey, claim.id).run();

  const inserted = await dbFor(env, storeId).prepare(`INSERT INTO rt_sync_events
    (id, store_id, provider, external_event_id, payload_json, status)
    VALUES (?, ?, 'email', ?, ?, 'received')
    ON CONFLICT(store_id, provider, external_event_id) DO NOTHING`).bind(
      crypto.randomUUID(),
      storeId,
      externalEventId,
      JSON.stringify({ objectKey, rawSize: message.rawSize, recipient: message.to }),
    ).run();

  await dbFor(env, storeId).prepare(`UPDATE rt_inbound_emails
    SET status = 'received' WHERE id = ?`).bind(claim.id).run();

  return {
    storeId,
    quarantined: false,
    duplicate: !inserted.meta.changes,
    objectKey,
  };
}

/** catch-allで届いた飲食店向けメールを店舗へ結び付け、原文をストリーム保存する。 */
export async function receiveRestaurantIntakeEmail(
  message: ForwardableEmailMessage,
  env: Env['Bindings'],
): Promise<
  | { storeId: string; quarantined: false; duplicate: boolean; objectKey: string }
  | { quarantined: true; duplicate: boolean; objectKey: string }
> {
  const parts = recipientParts(message.to);
  const domain = configuredDomain(env);
  if (!parts || !domain) {
    return quarantineRestaurantEmail(message, env, 'domain_not_configured', parts);
  }
  if (parts.domain !== domain) {
    return quarantineRestaurantEmail(message, env, 'domain_mismatch', parts);
  }

  const row = await dbFor(env).prepare(`SELECT store_id, status,
      CASE WHEN status = 'active' AND (revoked_at IS NULL OR revoked_at > datetime('now'))
        THEN 1 ELSE 0 END AS is_active
    FROM rt_intake_addresses WHERE local_part = ? LIMIT 1`).bind(parts.localPart).first<IntakeAddressRow>();

  if (!row || !row.is_active) {
    return quarantineRestaurantEmail(
      message,
      env,
      row?.status === 'revoked' ? 'address_revoked' : 'address_unknown_or_expired',
      parts,
      row?.store_id ?? null,
    );
  }
  return storeRestaurantReservationEmail(message, env, row.store_id);
}

function rawMailRetentionDays(env: Env['Bindings']): number {
  const raw = env.RAW_MAIL_RETENTION_DAYS?.trim();
  if (!raw) return DEFAULT_RAW_MAIL_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_RAW_MAIL_RETENTION_DAYS) {
    return DEFAULT_RAW_MAIL_RETENTION_DAYS;
  }
  return parsed;
}

/** 6時間cronから呼び、期限超過の原文だけをR2から破棄する。 */
export async function deleteExpiredRestaurantRawEmails(
  env: Env['Bindings'],
  options: { now?: Date; maxPerRun?: number } = {},
): Promise<{ checked: number; deleted: number; failed: number; retentionDays: number }> {
  const retentionDays = rawMailRetentionDays(env);
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const maxPerRun = Math.max(1, Math.min(options.maxPerRun ?? RETENTION_MAX_PER_RUN, RETENTION_MAX_PER_RUN));
  const db = dbFor(env);
  let checked = 0;
  let deleted = 0;
  let failed = 0;

  while (checked < maxPerRun) {
    const limit = Math.min(RETENTION_BATCH_SIZE, maxPerRun - checked);
    const { results } = await db.prepare(`SELECT id, r2_key
      FROM rt_inbound_emails
      WHERE r2_key <> '' AND datetime(received_at) < datetime(?)
      ORDER BY received_at, id
      LIMIT ?`).bind(cutoff, limit).all<{ id: string; r2_key: string }>();
    if (results.length === 0) break;
    checked += results.length;

    try {
      await env.RAW_MAIL.delete(results.map((row) => row.r2_key));
      for (let offset = 0; offset < results.length; offset += 100) {
        await db.batch(results.slice(offset, offset + 100).map((row) => db.prepare(`UPDATE rt_inbound_emails
          SET r2_key = '', status = 'raw_deleted'
          WHERE id = ? AND r2_key = ?`).bind(row.id, row.r2_key)));
      }
      deleted += results.length;
    } catch (error) {
      failed += results.length;
      console.error(JSON.stringify({
        event: 'restaurant_raw_mail_retention_failed',
        count: results.length,
        error: String(error),
      }));
      break;
    }
  }

  return { checked, deleted, failed, retentionDays };
}
