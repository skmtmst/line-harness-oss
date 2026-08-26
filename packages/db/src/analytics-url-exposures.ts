const MAX_LINKS_PER_MESSAGE = 50;

export interface AnalyticsUrlExposureQueueResult {
  claimed: number;
  processed: number;
  failed: number;
  exposures: number;
}

interface QueuedMessage {
  id: string;
  line_account_id: string;
  friend_id: string | null;
  content: string;
  broadcast_id: string | null;
  scenario_step_id: string | null;
  source: string | null;
  created_at: string;
}

export function extractTrackedLinkKeys(content: string): string[] {
  const keys = new Set<string>();
  const pattern = /\/t\/([A-Za-z0-9_-]{1,128})/g;
  for (const match of content.matchAll(pattern)) {
    keys.add(match[1]);
    if (keys.size >= MAX_LINKS_PER_MESSAGE) break;
  }
  return [...keys];
}

export async function ensureAnalyticsUrlExposureCoverage(
  db: D1Database,
  input: { lineAccountId: string; availableFrom: string; updatedAt?: string },
): Promise<void> {
  const lineAccountId = input.lineAccountId.trim();
  if (!lineAccountId) throw new Error('analytics_url_exposure_account_required');
  const availableFrom = new Date(input.availableFrom);
  if (Number.isNaN(availableFrom.getTime())) {
    throw new Error('analytics_url_exposure_time_invalid');
  }
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  await db.prepare(
    `INSERT INTO analytics_event_coverage (
       line_account_id, event_type, available_from, state, updated_at
     ) VALUES (?, 'url_exposed', ?, 'available', ?)
     ON CONFLICT(line_account_id, event_type) DO UPDATE SET
       updated_at = excluded.updated_at`,
  ).bind(lineAccountId, availableFrom.toISOString(), updatedAt).run();
}

async function findTrackedLinkIds(
  db: D1Database,
  lineAccountId: string,
  keys: string[],
): Promise<string[]> {
  if (keys.length === 0) return [];
  const ids = new Set<string>();
  for (let offset = 0; offset < keys.length; offset += 90) {
    const chunk = keys.slice(offset, offset + 90);
    const placeholders = chunk.map(() => '?').join(',');
    const byShortCode = await db.prepare(
      `SELECT id FROM tracked_links
        WHERE line_account_id = ? AND short_code IN (${placeholders})`,
    ).bind(lineAccountId, ...chunk).all<{ id: string }>();
    const byId = await db.prepare(
      `SELECT id FROM tracked_links
        WHERE line_account_id = ? AND short_code IS NULL AND id IN (${placeholders})`,
    ).bind(lineAccountId, ...chunk).all<{ id: string }>();
    for (const row of [...byShortCode.results, ...byId.results]) ids.add(row.id);
  }
  return [...ids];
}

function sourceOf(message: QueuedMessage): { kind: string; id: string | null } {
  if (message.broadcast_id) return { kind: 'broadcast', id: message.broadcast_id };
  if (message.scenario_step_id) return { kind: 'scenario', id: message.scenario_step_id };
  const source = message.source?.trim().slice(0, 64);
  return { kind: source || 'message', id: null };
}

/**
 * LINE broadcast APIのように受信者一覧が返らない送信を記録する。
 * 到達人数は推測せず、分析APIが「取得不可」と表示するための印だけを残す。
 */
export async function recordUnknownAnalyticsUrlExposures(
  db: D1Database,
  input: {
    lineAccountId: string;
    messageId: string;
    content: string;
    sourceKind: string;
    sourceId?: string | null;
    sentAt: string;
  },
): Promise<number> {
  const linkIds = await findTrackedLinkIds(
    db,
    input.lineAccountId,
    extractTrackedLinkKeys(input.content),
  );
  if (linkIds.length === 0) return 0;
  const results = await db.batch(linkIds.map((trackedLinkId) => db.prepare(
    `INSERT OR IGNORE INTO analytics_url_exposures (
       line_account_id, message_id, friend_id, tracked_link_id,
       source_kind, source_id, audience_state, sent_at, created_at
     ) VALUES (?, ?, NULL, ?, ?, ?, 'unknown', ?, ?)`,
  ).bind(
    input.lineAccountId,
    input.messageId,
    trackedLinkId,
    input.sourceKind,
    input.sourceId ?? null,
    input.sentAt,
    input.sentAt,
  )));
  return results.reduce((sum, row) => sum + Number(row.meta?.changes ?? 0), 0);
}

/**
 * messages_logへの追記を非同期でURL露出へ投影する。
 * 送信処理は軽いqueue INSERTだけで終わり、重い本文解析は5分Cronで行う。
 */
export async function processPendingAnalyticsUrlExposures(
  db: D1Database,
  options: { limit?: number; now?: string } = {},
): Promise<AnalyticsUrlExposureQueueResult> {
  const limit = Math.min(250, Math.max(1, options.limit ?? 100));
  const now = options.now ?? new Date().toISOString();
  await db.prepare(
    `UPDATE analytics_url_exposure_queue
        SET status = 'pending', processing_started_at = NULL, updated_at = ?
      WHERE status = 'processing'
        AND julianday(processing_started_at) < julianday(?, '-10 minutes')`,
  ).bind(now, now).run();

  const due = await db.prepare(
    `SELECT message_id, line_account_id
       FROM analytics_url_exposure_queue
      WHERE status IN ('pending','failed')
        AND attempts < 5
        AND julianday(available_at) <= julianday(?)
      ORDER BY created_at, message_id
      LIMIT ?`,
  ).bind(now, limit).all<{ message_id: string; line_account_id: string }>();

  const result: AnalyticsUrlExposureQueueResult = {
    claimed: 0, processed: 0, failed: 0, exposures: 0,
  };
  for (const item of due.results) {
    const claim = await db.prepare(
      `UPDATE analytics_url_exposure_queue
          SET status = 'processing', attempts = attempts + 1,
              processing_started_at = ?, updated_at = ?, last_error = NULL
        WHERE message_id = ? AND line_account_id = ?
          AND status IN ('pending','failed')`,
    ).bind(now, now, item.message_id, item.line_account_id).run();
    if ((claim.meta?.changes ?? 0) === 0) continue;
    result.claimed += 1;

    try {
      const message = await db.prepare(
        `SELECT m.id,
                COALESCE(m.line_account_id, f.line_account_id) AS line_account_id,
                m.friend_id, m.content, m.broadcast_id, m.scenario_step_id,
                m.source, m.created_at
           FROM messages_log m LEFT JOIN friends f ON f.id = m.friend_id
          WHERE m.id = ?
            AND COALESCE(m.line_account_id, f.line_account_id) = ?`,
      ).bind(item.message_id, item.line_account_id).first<QueuedMessage>();
      const linkIds = message
        ? await findTrackedLinkIds(
            db,
            item.line_account_id,
            extractTrackedLinkKeys(message.content),
          )
        : [];
      const source = message ? sourceOf(message) : { kind: 'message', id: null };
      const statements = linkIds.map((trackedLinkId) => db.prepare(
        `INSERT OR IGNORE INTO analytics_url_exposures (
         line_account_id, message_id, friend_id, tracked_link_id,
           source_kind, source_id, audience_state, sent_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        item.line_account_id,
        item.message_id,
        message?.friend_id ?? null,
        trackedLinkId,
        source.kind,
        source.id,
        'known',
        message?.created_at ?? now,
        now,
      ));
      statements.push(db.prepare(
        `UPDATE analytics_url_exposure_queue
            SET status = 'processed', processed_at = ?, processing_started_at = NULL,
                updated_at = ?, last_error = NULL
          WHERE message_id = ? AND line_account_id = ?`,
      ).bind(now, now, item.message_id, item.line_account_id));
      const batch = await db.batch(statements);
      result.exposures += batch.slice(0, linkIds.length)
        .reduce((sum, row) => sum + Number(row.meta?.changes ?? 0), 0);
      result.processed += 1;
    } catch (error) {
      result.failed += 1;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await db.prepare(
        `UPDATE analytics_url_exposure_queue
            SET status = 'failed', processing_started_at = NULL,
                available_at = datetime(?, '+' || MIN(attempts * 5, 60) || ' minutes'),
                updated_at = ?, last_error = ?
          WHERE message_id = ? AND line_account_id = ?`,
      ).bind(now, now, message, item.message_id, item.line_account_id).run();
    }
  }
  return result;
}
