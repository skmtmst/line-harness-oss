import { jstNow } from './utils.js';

/**
 * ファネル分析。
 *
 * 「広告を見た → 友だちになった → フォームに答えた → 買った」のように、
 * 段ごとに何人が残ったかを見る。
 */

export const FUNNEL_STEP_KINDS = [
  'tag',
  'field',
  'form',
  'site_event',
  'purchase',
  'link_click',
  'conversion',
] as const;
export type FunnelStepKind = (typeof FUNNEL_STEP_KINDS)[number];

export interface Funnel {
  id: string;
  name: string;
  segment_json: string | null;
  window_days: number;
  created_at: string;
}

export interface FunnelStep {
  id: string;
  funnel_id: string;
  step_order: number;
  label: string;
  kind: string;
  match_json: string;
}

export async function getFunnels(db: D1Database): Promise<Funnel[]> {
  const result = await db
    .prepare(`SELECT * FROM funnels ORDER BY created_at DESC`)
    .all<Funnel>();
  return result.results;
}

export async function getFunnelById(db: D1Database, id: string): Promise<Funnel | null> {
  return db.prepare(`SELECT * FROM funnels WHERE id = ?`).bind(id).first<Funnel>();
}

export async function getFunnelSteps(db: D1Database, funnelId: string): Promise<FunnelStep[]> {
  const result = await db
    .prepare(`SELECT * FROM funnel_steps WHERE funnel_id = ? ORDER BY step_order ASC`)
    .bind(funnelId)
    .all<FunnelStep>();
  return result.results;
}

export async function createFunnel(
  db: D1Database,
  input: {
    name: string;
    windowDays?: number;
    segment?: unknown;
    steps: Array<{ label: string; kind: FunnelStepKind; match: unknown }>;
  },
): Promise<Funnel> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO funnels (id, name, segment_json, window_days, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.segment === undefined ? null : JSON.stringify(input.segment),
      input.windowDays ?? 30,
      jstNow(),
    )
    .run();
  // 段の順番は配列の並びで決める。呼び出し側に番号を振らせると、
  // 抜けや重複を毎回検証することになる。
  let order = 1;
  for (const step of input.steps) {
    await db
      .prepare(
        `INSERT INTO funnel_steps (id, funnel_id, step_order, label, kind, match_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), id, order, step.label, step.kind, JSON.stringify(step.match))
      .run();
    order++;
  }
  return (await getFunnelById(db, id))!;
}

export async function deleteFunnel(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM funnels WHERE id = ?`).bind(id).run();
}

/**
 * 段ごとの到達人数。
 *
 * 段の条件が満たされた人を数える。前の段を通っていない人は数えない
 * （ファネルなので、途中から湧いてこない）。
 */
export async function countFunnelStep(
  db: D1Database,
  step: FunnelStep,
  opts: { from: string; to: string; friendIds?: string[] },
): Promise<string[]> {
  const match = JSON.parse(step.match_json) as Record<string, unknown>;
  const scope = opts.friendIds;
  // 前の段の通過者だけを見る。1段目は全員が対象。
  const scopeClause =
    scope && scope.length > 0 ? `AND friend_id IN (${scope.map(() => '?').join(',')})` : '';
  const scopeValues = scope ?? [];

  switch (step.kind) {
    case 'tag': {
      const result = await db
        .prepare(
          `SELECT DISTINCT friend_id FROM friend_tags
            WHERE tag_id = ? AND assigned_at >= ? AND assigned_at <= ? ${scopeClause}`,
        )
        .bind(String(match.tagId), opts.from, opts.to, ...scopeValues)
        .all<{ friend_id: string }>();
      return result.results.map((r) => r.friend_id);
    }
    case 'field': {
      const result = await db
        .prepare(
          `SELECT DISTINCT friend_id FROM friend_field_values
            WHERE field_id = ? AND value IS NOT NULL AND value != ''
              AND updated_at >= ? AND updated_at <= ? ${scopeClause}`,
        )
        .bind(String(match.fieldId), opts.from, opts.to, ...scopeValues)
        .all<{ friend_id: string }>();
      return result.results.map((r) => r.friend_id);
    }
    case 'site_event': {
      const result = await db
        .prepare(
          `SELECT DISTINCT friend_id FROM site_events
            WHERE event_type = ? AND friend_id IS NOT NULL
              AND (? IS NULL OR path = ?)
              AND occurred_at >= ? AND occurred_at <= ? ${scopeClause}`,
        )
        .bind(
          String(match.eventType ?? 'page_view'),
          match.path ?? null,
          match.path ?? null,
          opts.from,
          opts.to,
          ...scopeValues,
        )
        .all<{ friend_id: string }>();
      return result.results.map((r) => r.friend_id);
    }
    case 'conversion': {
      const result = await db
        .prepare(
          `SELECT DISTINCT friend_id FROM conversion_events
            WHERE conversion_point_id = ? AND created_at >= ? AND created_at <= ? ${scopeClause}`,
        )
        .bind(String(match.conversionPointId), opts.from, opts.to, ...scopeValues)
        .all<{ friend_id: string }>();
      return result.results.map((r) => r.friend_id);
    }
    case 'link_click': {
      const result = await db
        .prepare(
          `SELECT DISTINCT friend_id FROM link_clicks
            WHERE tracked_link_id = ? AND friend_id IS NOT NULL
              AND clicked_at >= ? AND clicked_at <= ? ${scopeClause}`,
        )
        .bind(String(match.trackedLinkId), opts.from, opts.to, ...scopeValues)
        .all<{ friend_id: string }>();
      return result.results.map((r) => r.friend_id);
    }
    case 'form': {
      const result = await db
        .prepare(
          `SELECT DISTINCT friend_id FROM form_submissions
            WHERE form_id = ? AND friend_id IS NOT NULL
              AND created_at >= ? AND created_at <= ? ${scopeClause}`,
        )
        .bind(String(match.formId), opts.from, opts.to, ...scopeValues)
        .all<{ friend_id: string }>();
      return result.results.map((r) => r.friend_id);
    }
    default:
      // 知らない種類は「誰も通らなかった」として扱う。例外にすると
      // ファネル全体が見られなくなる。
      return [];
  }
}
