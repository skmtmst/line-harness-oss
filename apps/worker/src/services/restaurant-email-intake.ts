import type { Env } from '../index.js';
import { dbFor } from './db-router.js';

const LOCAL_PART_PREFIX = 'r-';
const RANDOM_LENGTH = 32;
// 宛先を小文字化するメール基盤でも照合できるよう、発行値は小文字英数字に限定する。
const RANDOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const RANDOM_ACCEPT_LIMIT = Math.floor(256 / RANDOM_ALPHABET.length) * RANDOM_ALPHABET.length;
const REISSUE_GRACE_DAYS = 90;

type IntakeAddressRow = {
  store_id: string;
  status: 'active' | 'revoked';
  is_active: number;
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
  await env.IMAGES.put(objectKey, message.raw, {
    httpMetadata: { contentType: 'message/rfc822' },
    customMetadata,
  });
}

async function quarantineRestaurantEmail(
  message: ForwardableEmailMessage,
  env: Env['Bindings'],
  reason: string,
  parts: { localPart: string; domain: string } | null,
): Promise<{ quarantined: true; objectKey: string }> {
  const receivedAt = new Date().toISOString();
  const objectKey = `restaurant-intake-quarantine/${receivedAt.slice(0, 10)}/${crypto.randomUUID()}.eml`;
  await storeRawEmail(message, env, objectKey, {
    reason,
    localPart: parts?.localPart ?? '',
    domain: parts?.domain ?? '',
    rawSize: String(message.rawSize),
  });
  console.warn(JSON.stringify({
    event: 'restaurant_email_quarantined',
    reason,
    objectKey,
    domain: parts?.domain ?? null,
    rawSize: message.rawSize,
  }));
  return { quarantined: true, objectKey };
}

async function storeRestaurantReservationEmail(
  message: ForwardableEmailMessage,
  env: Env['Bindings'],
  storeId: string,
): Promise<{ storeId: string; quarantined: false; duplicate: boolean; objectKey: string }> {
  const externalEventId = message.headers.get('message-id')?.trim() || `email-${crypto.randomUUID()}`;
  const fingerprint = await sha256Hex(`${storeId}\n${externalEventId}`);
  const objectKey = `restaurant-intake/${safeObjectKeySegment(storeId)}/${fingerprint}.eml`;
  await storeRawEmail(message, env, objectKey);

  const inserted = await dbFor(env, storeId).prepare(`INSERT INTO rt_sync_events
    (id, store_id, provider, external_event_id, payload_json, status)
    VALUES (?, ?, 'email', ?, ?, 'received')
    ON CONFLICT(store_id, provider, external_event_id) DO NOTHING`).bind(
      crypto.randomUUID(),
      storeId,
      externalEventId,
      JSON.stringify({ objectKey, rawSize: message.rawSize, recipient: message.to }),
    ).run();

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
  | { quarantined: true; objectKey: string }
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
    );
  }
  return storeRestaurantReservationEmail(message, env, row.store_id);
}
