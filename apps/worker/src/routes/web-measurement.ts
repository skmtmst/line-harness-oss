import { Hono, type Context } from 'hono';
import {
  createMeasurementSite,
  getMeasurementSite,
  getUrlReachConversionPoints,
  listMeasurementSites,
  normalizeSiteHost,
  recordAnonymousConversionDay,
  recordDomainRejection,
  recordSiteConsentDecision,
  siteAllowsHost,
  trackConversion,
  updateMeasurementSiteDomains,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { accountFeatureIsEnabled } from '../services/feature-enforcement.js';
import { auditLog } from '../lib/audit-log.js';

/**
 * Web計測の公開口と計測サイトの管理 (#819)。
 *
 * 計測タグはサイトIDだけを載せる。秘密の鍵はタグに含めない代わりに、
 * 受け付けるドメインをサイトごとに決めておき、許可にない所から来た分は
 * 数えずに「件数と最後の来た先」だけを残す。
 */
const webMeasurement = new Hono<Env>();

const SITE_ID_PATTERN = /^site_[a-f0-9]{32}$/;
const VISITOR_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

webMeasurement.options('/api/public/web-conversions', (c) => c.body(null, 204, corsHeaders()));

/**
 * POST /api/public/web-conversions — 計測タグからの成果の受け口。
 *
 * 公開口なので常に 204 を返す（鍵や設定の有無を外から推測させない）。
 * 許可外ドメイン・同意が無い・友だちと結び付かない場合も 204 で、
 * 内部の台帳には「受け付けなかった」だけが残る。
 */
webMeasurement.post('/api/public/web-conversions', async (c) => {
  try {
    const body = await c.req.json<{
      siteId?: unknown;
      visitorId?: unknown;
      host?: unknown;
      path?: unknown;
      value?: unknown;
      sourceEventId?: unknown;
      consent?: unknown;
      consentDecision?: unknown;
    }>();

    const siteId = String(body.siteId ?? '');
    if (!SITE_ID_PATTERN.test(siteId)) return c.body(null, 204, corsHeaders());
    const site = await getMeasurementSite(c.env.DB, siteId);
    if (!site) return c.body(null, 204, corsHeaders());

    // 計測対象の機能が止まっているアカウントでは何も受け付けない。
    if (!(await accountFeatureIsEnabled(c.env.DB, site.line_account_id, 'affiliates'))) {
      return c.body(null, 204, corsHeaders());
    }

    // ドメインの許可。Origin ヘッダがあればそちらを、無ければ本文の host を見る。
    const headerHost = (() => {
      const origin = c.req.header('origin') ?? c.req.header('referer') ?? '';
      if (!origin) return null;
      try {
        return new URL(origin).hostname;
      } catch {
        return null;
      }
    })();
    const host = normalizeSiteHost(headerHost ?? body.host);
    if (!host || !(await siteAllowsHost(c.env.DB, siteId, host))) {
      // 許可にないドメインは数えない。件数と最後の来た先だけを残す。
      if (host) await recordDomainRejection(c.env.DB, siteId, host);
      return c.body(null, 204, corsHeaders());
    }

    // 同意の記録。granted の受信だけが成果になる。
    if (body.consentDecision === 'granted' || body.consentDecision === 'declined') {
      await recordSiteConsentDecision(c.env.DB, site.line_account_id, body.consentDecision);
    }
    if (body.consent !== 'granted') {
      return c.body(null, 204, corsHeaders());
    }

    const path = typeof body.path === 'string' && body.path.startsWith('/') ? body.path.split('?')[0] : '/';
    const fullUrl = `https://${host}${path}`;

    // url_reach 地点のうち、対象URLの前方一致に合うものを数える。
    const points = await getUrlReachConversionPoints(c.env.DB, fullUrl, site.line_account_id);
    if (points.length === 0) return c.body(null, 204, corsHeaders());

    // 訪問者から友だちを引く。結び付いていなければ匿名扱い。
    const visitorId = String(body.visitorId ?? '');
    let friendId: string | null = null;
    if (VISITOR_ID_PATTERN.test(visitorId)) {
      const visitor = await c.env.DB
        .prepare(`SELECT friend_id FROM site_visitors WHERE id = ? AND line_account_id = ?`)
        .bind(`${site.line_account_id}:${visitorId}`, site.line_account_id)
        .first<{ friend_id: string | null }>();
      friendId = visitor?.friend_id ?? null;
    }

    const sourceEventId = typeof body.sourceEventId === 'string' && body.sourceEventId.trim()
      ? body.sourceEventId.trim().slice(0, 120)
      : null;
    const value = typeof body.value === 'number' && Number.isFinite(body.value) && body.value >= 0
      ? body.value
      : null;

    for (const point of points) {
      if (!friendId) {
        // 友だちと結び付かない成果は、地点が「匿名を数える」設定のときだけ
        // 1日ごとの合計へ足す。個人を推測して友だちに付けない。
        if (point.count_anonymous === 1) {
          await recordAnonymousConversionDay(c.env.DB, point.id);
        }
        continue;
      }
      try {
        await trackConversion(c.env.DB, {
          conversionPointId: point.id,
          friendId,
          metadata: JSON.stringify({
            source: 'web_tag',
            siteId,
            host,
            path,
            ...(sourceEventId ? { sourceEventId } : {}),
          }),
          idempotencyKey: sourceEventId ? `wcv:${point.id}:${sourceEventId}` : undefined,
          value,
        });
      } catch (err) {
        // アカウント境界・停止中などは1地点の失敗で他を止めない。
        console.error('web-conversions track failed:', err instanceof Error ? err.message : 'unknown');
      }
    }
    return c.body(null, 204, corsHeaders());
  } catch (err) {
    console.error('POST /api/public/web-conversions error:', err);
    return c.body(null, 204, corsHeaders());
  }
});

async function scopedAccountId(c: Context<Env>): Promise<string | null> {
  const requested = (c.req.query('account_id') ?? c.req.query('accountId'))?.trim();
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!requested) {
    return scope.allowedAccountIds.length === 1 ? scope.allowedAccountIds[0] : null;
  }
  return scope.allowedAccountIds.includes(requested) ? requested : null;
}

// GET /api/measurement-sites — 計測サイトと許可ドメイン・拒否の内訳
webMeasurement.get(
  '/api/measurement-sites',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      const accountId = await scopedAccountId(c);
      if (!accountId) {
        return c.json({ success: false, error: 'account_id is required' }, 400);
      }
      const sites = await listMeasurementSites(c.env.DB, accountId);
      return c.json({
        success: true,
        data: sites.map((s) => ({
          id: s.id,
          label: s.label,
          domains: s.domains,
          createdAt: s.created_at,
          rejectedCount: s.rejectedTotal,
          lastRejectedHost: s.lastRejectedHost,
          lastRejectedAt: s.lastRejectedAt,
        })),
      });
    } catch (err) {
      console.error('GET /api/measurement-sites error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

// POST /api/measurement-sites — サイトを足す
webMeasurement.post('/api/measurement-sites', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      accountId?: unknown;
      account_id?: unknown;
      label?: unknown;
      domains?: unknown;
    }>();
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const accountId = String(body.accountId ?? body.account_id ?? '').trim()
      || (scope.allowedAccountIds.length === 1 ? scope.allowedAccountIds[0] : '');
    if (!accountId || !scope.allowedAccountIds.includes(accountId)) {
      return c.json({ success: false, error: 'account_id is required' }, 400);
    }
    const label = String(body.label ?? '').trim();
    if (!label || label.length > 100) {
      return c.json({ success: false, error: 'サイトの名前を入れてください' }, 400);
    }
    const rawDomains = Array.isArray(body.domains) ? body.domains : [];
    const domains = [...new Set(
      rawDomains.map((d) => normalizeSiteHost(d)).filter((d): d is string => d !== null),
    )];
    if (domains.length === 0) {
      return c.json({ success: false, error: '計測を許可するドメインを1つ以上入れてください' }, 400);
    }
    const site = await createMeasurementSite(c.env.DB, { lineAccountId: accountId, label, domains });
    auditLog(c, 'measurement_site.create', { kind: 'measurement_site', id: site.id }, { lineAccountId: accountId });
    return c.json({ success: true, data: { id: site.id, label: site.label, domains: site.domains } });
  } catch (err) {
    console.error('POST /api/measurement-sites error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/measurement-sites/:id — 名前・許可ドメインの更新
webMeasurement.patch('/api/measurement-sites/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const site = await getMeasurementSite(c.env.DB, c.req.param('id'));
    if (!site) return c.json({ success: false, error: 'Site not found' }, 404);
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (!scope.allowedAccountIds.includes(site.line_account_id)) {
      return c.json({ success: false, error: 'Site not found' }, 404);
    }
    const body = await c.req.json<{ label?: unknown; domains?: unknown }>();
    const label = body.label === undefined ? undefined : String(body.label).trim();
    if (label !== undefined && (!label || label.length > 100)) {
      return c.json({ success: false, error: 'サイトの名前を入れてください' }, 400);
    }
    let domains: string[] | undefined;
    if (body.domains !== undefined) {
      if (!Array.isArray(body.domains)) {
        return c.json({ success: false, error: 'domains は配列で指定してください' }, 400);
      }
      domains = [...new Set(
        body.domains.map((d) => normalizeSiteHost(d)).filter((d): d is string => d !== null),
      )];
      if (domains.length === 0) {
        return c.json({ success: false, error: '計測を許可するドメインを1つ以上入れてください' }, 400);
      }
    }
    await updateMeasurementSiteDomains(c.env.DB, site.id, domains ?? [], label);
    auditLog(c, 'measurement_site.update', { kind: 'measurement_site', id: site.id }, { lineAccountId: site.line_account_id });
    return c.json({ success: true, data: { id: site.id } });
  } catch (err) {
    console.error('PATCH /api/measurement-sites/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { webMeasurement };
