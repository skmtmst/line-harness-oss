// F-21 成果と広告イベントの対応表・F-22 広告への送信のやり直し。
import { sendAdConversions } from './ad-conversion.js';

export class AdEventMappingError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface AdEventMapping {
  id: string;
  lineAccountId: string;
  conversionPointId: string;
  conversionPointName: string;
  adPlatformId: string;
  adPlatformName: string;
  eventName: string;
}

export interface AdEventMappingInput {
  conversionPointId: string;
  adPlatformId: string;
  eventName: string;
}

function requiredId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AdEventMappingError('invalid_mapping', `${label}を選んでください`);
  }
  return value.trim();
}

function requiredEventName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AdEventMappingError('invalid_mapping', '広告側の名前を入力してください');
  }
  const name = value.trim();
  if (name.length > 64) {
    throw new AdEventMappingError('invalid_mapping', '広告側の名前は64文字までです');
  }
  return name;
}

export interface AdEventMappingOptions {
  mappings: AdEventMapping[];
  points: Array<{ id: string; name: string }>;
  platforms: Array<{ id: string; name: string }>;
}

/** 対応表を読む。左＝うちの成果地点、右＝広告側の名前。足すための選択肢も同梱する。 */
export async function listAdEventMappings(
  db: D1Database,
  lineAccountId: string,
): Promise<AdEventMappingOptions> {
  const rows = await db
    .prepare(
      `SELECT m.id, m.line_account_id, m.conversion_point_id, p.name AS conversion_point_name,
              m.ad_platform_id, COALESCE(pl.display_name, pl.name) AS ad_platform_name, m.event_name
         FROM ad_conversion_event_mappings m
         JOIN conversion_points p ON p.id = m.conversion_point_id
         JOIN ad_platforms pl ON pl.id = m.ad_platform_id
        WHERE m.line_account_id = ?
        ORDER BY p.name, ad_platform_name`,
    )
    .bind(lineAccountId)
    .all<{
      id: string; line_account_id: string; conversion_point_id: string;
      conversion_point_name: string; ad_platform_id: string;
      ad_platform_name: string; event_name: string;
    }>();
  const mappings = rows.results.map((row) => ({
    id: row.id,
    lineAccountId: row.line_account_id,
    conversionPointId: row.conversion_point_id,
    conversionPointName: row.conversion_point_name,
    adPlatformId: row.ad_platform_id,
    adPlatformName: row.ad_platform_name,
    eventName: row.event_name,
  }));
  const [points, platforms] = await Promise.all([
    db.prepare(`SELECT id, name FROM conversion_points WHERE line_account_id = ? ORDER BY name`)
      .bind(lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT id, COALESCE(display_name, name) AS name FROM ad_platforms WHERE line_account_id = ? ORDER BY name`,
    ).bind(lineAccountId).all<{ id: string; name: string }>(),
  ]);
  return { mappings, points: points.results, platforms: platforms.results };
}

/**
 * 対応表をまるごと保存する。無い組み合わせは送らないので、
 * 消した行の対応は止まる。地点・媒体はこの店のものだけ受け付ける。
 */
export async function saveAdEventMappings(
  db: D1Database,
  lineAccountId: string,
  inputs: unknown,
  now = new Date().toISOString(),
): Promise<AdEventMappingOptions> {
  if (!Array.isArray(inputs)) {
    throw new AdEventMappingError('invalid_mapping', '対応表の形が正しくありません');
  }
  const seen = new Set<string>();
  const rows: AdEventMappingInput[] = inputs.map((item) => {
    const record = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const mapping: AdEventMappingInput = {
      conversionPointId: requiredId(record.conversionPointId, '成果地点'),
      adPlatformId: requiredId(record.adPlatformId, '広告'),
      eventName: requiredEventName(record.eventName),
    };
    const key = `${mapping.conversionPointId} ${mapping.adPlatformId}`;
    if (seen.has(key)) {
      throw new AdEventMappingError('invalid_mapping', '同じ組み合わせが2回あります');
    }
    seen.add(key);
    return mapping;
  });

  // この店の地点・媒体だけ。別の店のIDが混ざっていたら止める。
  for (const row of rows) {
    const point = await db
      .prepare(`SELECT id FROM conversion_points WHERE id = ? AND line_account_id = ?`)
      .bind(row.conversionPointId, lineAccountId)
      .first<{ id: string }>();
    if (!point) {
      throw new AdEventMappingError('mapping_not_found', '成果地点が見つからないか、別のLINE公式アカウントにあります', 404);
    }
    const platform = await db
      .prepare(`SELECT id FROM ad_platforms WHERE id = ? AND line_account_id = ?`)
      .bind(row.adPlatformId, lineAccountId)
      .first<{ id: string }>();
    if (!platform) {
      throw new AdEventMappingError('mapping_not_found', '広告が見つからないか、別のLINE公式アカウントにあります', 404);
    }
  }

  const statements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM ad_conversion_event_mappings WHERE line_account_id = ?`).bind(lineAccountId),
  ];
  for (const row of rows) {
    statements.push(
      db.prepare(
        `INSERT INTO ad_conversion_event_mappings
           (id, line_account_id, conversion_point_id, ad_platform_id, event_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), lineAccountId, row.conversionPointId, row.adPlatformId, row.eventName, now, now),
    );
  }
  await db.batch(statements);
  return listAdEventMappings(db, lineAccountId);
}

interface AdConversionLogRow {
  id: string;
  ad_platform_id: string;
  friend_id: string;
  event_name: string;
  request_body: string | null;
  created_at: string;
  idempotency_key: string | null;
  status: string;
}

/** 送った中身から金額だけ拾う。無ければ付けない（送り直しは金額なしでも送れる）。 */
function pickEventValue(requestBody: string | null): number | undefined {
  if (!requestBody) return undefined;
  try {
    const parsed = JSON.parse(requestBody) as Record<string, unknown>;
    for (const key of ['v', 'value', 'event_value', 'amount', 'eventValue']) {
      const candidate = parsed[key];
      if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** 今の記録は cur、旧形式は currency。主単位で保存された金額を再換算しない。 */
function pickEventCurrency(requestBody: string | null): string | undefined {
  if (!requestBody) return undefined;
  try {
    const parsed = JSON.parse(requestBody) as Record<string, unknown>;
    const currency = parsed.cur ?? parsed.currency;
    return typeof currency === 'string' && /^[a-z]{3}$/i.test(currency) ? currency.toUpperCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * F-22 広告への送信のやり直し。元の送信と同じ目印で送り直すので、
 * 押した回数だけ重複しない。90日を過ぎた記録は受け付けない。
 */
export async function resendAdConversion(
  db: D1Database,
  logId: string,
  lineAccountId: string,
  opts?: { now?: Date; credentialKey?: string },
): Promise<{ logId: string; resent: boolean }> {
  const log = await db
    .prepare(
      `SELECT l.id, l.ad_platform_id, l.friend_id, l.event_name, l.request_body, l.created_at,
              l.idempotency_key, l.status
         FROM ad_conversion_logs l
         JOIN ad_platforms pl ON pl.id = l.ad_platform_id
        WHERE l.id = ? AND pl.line_account_id = ?
          AND (l.line_account_id IS NULL OR l.line_account_id = ?)`,
    )
    .bind(logId, lineAccountId, lineAccountId)
    .first<AdConversionLogRow>();
  if (!log) {
    throw new AdEventMappingError('log_not_found', '送信履歴が見つからないか、別のLINE公式アカウントにあります', 404);
  }
  const now = opts?.now ?? new Date();
  const ageDays = (now.getTime() - new Date(log.created_at).getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays > 90) {
    throw new AdEventMappingError('resend_expired', '90日を過ぎた送信はやり直せません', 409);
  }
  if (log.status === 'sent') return { logId: log.id, resent: false };
  if (log.status !== 'failed') {
    throw new AdEventMappingError('resend_unavailable', '失敗した送信だけやり直せます', 409);
  }
  await sendAdConversions(db, log.friend_id, log.event_name, pickEventValue(log.request_body), {
    idempotencyKey: log.idempotency_key || log.id,
    lineAccountId,
    platformId: log.ad_platform_id,
    credentialKey: opts?.credentialKey,
    currency: pickEventCurrency(log.request_body),
    now: opts?.now,
  });
  return { logId: log.id, resent: true };
}
