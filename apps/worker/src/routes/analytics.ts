import { Hono } from 'hono';
import {
  getDailyMessageCounts,
  getLinkClickSummary,
  getBroadcastSummary,
  getTagFieldCross,
  buildFunnelResult,
  getFunnels,
  getFunnelById,
  getFunnelSteps,
  createFunnel,
  deleteFunnel,
  countFunnelStep,
  FUNNEL_STEP_KINDS,
  type Funnel,
  type FunnelStepKind,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';

/**
 * 集計。
 *
 * 新しいテーブルは作らず、既にあるデータをその場で数える。
 * 外部APIも叩かないので、ここが外の障害で落ちることはない。
 */
const analytics = new Hono<Env>();

/**
 * 期間を読む。
 *
 * 既定は直近30日。上限を置いているのは、期間を長くするほど
 * 走査する行が増えるため。1年を超える集計が要るなら、
 * 貯める仕組みを作ってからにする。
 */
const MAX_RANGE_DAYS = 366;

function readRange(
  c: { req: { query: (k: string) => string | undefined } },
): { ok: true; value: { from: string; to: string } } | { ok: false; error: string } {
  const jstNow = new Date(Date.now() + 9 * 3600_000);
  const toRaw = c.req.query('to') ?? jstNow.toISOString().slice(0, 10);
  const fromRaw =
    c.req.query('from') ??
    new Date(jstNow.getTime() - 30 * 24 * 3600_000).toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
    return { ok: false, error: '期間は 2026-08-01 の形で指定してください' };
  }
  if (fromRaw > toRaw) {
    return { ok: false, error: '開始日が終了日より後になっています' };
  }
  const days = (Date.parse(`${toRaw}T00:00:00Z`) - Date.parse(`${fromRaw}T00:00:00Z`)) / 86_400_000;
  if (days > MAX_RANGE_DAYS) {
    return { ok: false, error: `期間は ${MAX_RANGE_DAYS} 日までにしてください` };
  }
  // 終了日はその日いっぱいを含める。'2026-08-16' で切ると、その日のぶんが
  // まるごと落ちる。
  return { ok: true, value: { from: fromRaw, to: `${toRaw}T23:59:59.999` } };
}

function serializeFunnel(f: Funnel) {
  return {
    id: f.id,
    name: f.name,
    windowDays: f.window_days,
    createdAt: f.created_at,
  };
}

// GET /api/analytics/messages — 日ごとの送受信数
analytics.get('/api/analytics/messages', async (c) => {
  try {
    const range = readRange(c);
    if (!range.ok) return c.json({ success: false, error: range.error }, 400);
    const items = await getDailyMessageCounts(c.env.DB, range.value);
    return c.json({ success: true, data: items });
  } catch (err) {
    console.error('GET /api/analytics/messages error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/analytics/link-clicks — リンクごとのクリック
analytics.get('/api/analytics/link-clicks', async (c) => {
  try {
    const range = readRange(c);
    if (!range.ok) return c.json({ success: false, error: range.error }, 400);
    const items = await getLinkClickSummary(c.env.DB, range.value);
    return c.json({ success: true, data: items });
  } catch (err) {
    console.error('GET /api/analytics/link-clicks error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/analytics/broadcasts — 配信ごとの成績
analytics.get('/api/analytics/broadcasts', async (c) => {
  try {
    const range = readRange(c);
    if (!range.ok) return c.json({ success: false, error: range.error }, 400);
    const items = await getBroadcastSummary(c.env.DB, range.value);
    return c.json({ success: true, data: items });
  } catch (err) {
    console.error('GET /api/analytics/broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/analytics/cross?fieldId=... — タグ × 情報欄の値
analytics.get('/api/analytics/cross', async (c) => {
  try {
    const fieldId = c.req.query('fieldId');
    if (!fieldId) return c.json({ success: false, error: 'fieldId が必要です' }, 400);
    const cells = await getTagFieldCross(c.env.DB, fieldId);
    return c.json({ success: true, data: cells });
  } catch (err) {
    console.error('GET /api/analytics/cross error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── ファネル ────────────────────────────────────────────────

analytics.get('/api/funnels', async (c) => {
  try {
    const items = await getFunnels(c.env.DB);
    return c.json({ success: true, data: items.map(serializeFunnel) });
  } catch (err) {
    console.error('GET /api/funnels error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

analytics.post('/api/funnels', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      name?: unknown;
      windowDays?: unknown;
      steps?: unknown;
    }>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ success: false, error: '名前を入力してください' }, 400);

    if (!Array.isArray(body.steps) || body.steps.length < 2) {
      // 1段のファネルは「ただの件数」で、離脱を見るという目的を果たさない。
      return c.json({ success: false, error: '段は2つ以上にしてください' }, 422);
    }
    if (body.steps.length > 10) {
      return c.json({ success: false, error: '段は10個までです' }, 422);
    }

    const steps: Array<{ label: string; kind: FunnelStepKind; match: unknown }> = [];
    for (const raw of body.steps as unknown[]) {
      const step = raw as { label?: unknown; kind?: unknown; match?: unknown };
      const label = typeof step.label === 'string' ? step.label.trim() : '';
      if (!label) return c.json({ success: false, error: '段の名前を入力してください' }, 422);
      if (!(FUNNEL_STEP_KINDS as readonly string[]).includes(String(step.kind))) {
        return c.json({ success: false, error: `知らない段の種類です: ${String(step.kind)}` }, 422);
      }
      steps.push({ label, kind: step.kind as FunnelStepKind, match: step.match ?? {} });
    }

    const windowDays = body.windowDays === undefined ? 30 : Number(body.windowDays);
    if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 365) {
      return c.json({ success: false, error: '期間は1〜365日で指定してください' }, 422);
    }

    const funnel = await createFunnel(c.env.DB, { name, windowDays, steps });
    return c.json({ success: true, data: serializeFunnel(funnel) }, 201);
  } catch (err) {
    console.error('POST /api/funnels error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

analytics.delete('/api/funnels/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    await deleteFunnel(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/funnels/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/funnels/:id/result — 段ごとの到達人数
analytics.get('/api/funnels/:id/result', async (c) => {
  try {
    const funnel = await getFunnelById(c.env.DB, c.req.param('id'));
    if (!funnel) return c.json({ success: false, error: 'Not found' }, 404);

    const range = readRange(c);
    if (!range.ok) return c.json({ success: false, error: range.error }, 400);

    const steps = await getFunnelSteps(c.env.DB, funnel.id);
    const reachedPerStep: string[][] = [];
    // 各段で「前の段を通った人」だけを対象にする。段ごとに独立して数えると、
    // 途中を飛ばした人まで含まれて、下の段が上の段より多い表になる。
    let scope: string[] | undefined;
    for (const step of steps) {
      const reached = await countFunnelStep(c.env.DB, step, {
        from: range.value.from,
        to: range.value.to,
        friendIds: scope,
      });
      reachedPerStep.push(reached);
      scope = reached;
      // 誰も通らなかったら、その先を数えても必ず0。問い合わせを打ち切る。
      if (reached.length === 0) {
        for (let i = reachedPerStep.length; i < steps.length; i++) reachedPerStep.push([]);
        break;
      }
    }

    return c.json({
      success: true,
      data: {
        funnel: serializeFunnel(funnel),
        steps: buildFunnelResult(steps, reachedPerStep),
      },
    });
  } catch (err) {
    console.error('GET /api/funnels/:id/result error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { analytics };
