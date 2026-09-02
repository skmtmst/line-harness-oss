import { Hono } from 'hono';
import {
  recordSiteEvent,
  linkVisitorToFriend,
  getPageViewSummary,
  getFriendSiteEvents,
  SITE_EVENT_TYPES,
  type SiteEventType,
  getSiteTrackingSummary,
} from '@line-crm/db';
import type { Env } from '../index.js';

/**
 * 自社サイトの行動記録。
 *
 * 埋め込んだJSから送られてくる訪問と操作を受け取る。
 *
 * 受け口（/api/site/collect）は認証しない。外のサイトのブラウザから
 * 直接叩かれるので、鍵を置いてもページのソースに出てしまう。
 * その代わりレート制限を掛け、受け取る中身を厳しく絞る。
 */
const siteTracking = new Hono<Env>();

/** cookie に入れる訪問者ID。形だけ確かめる（中身は当てにしない）。 */
const VISITOR_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * CORS。
 *
 * 外のサイトから叩かれるので許可が要る。オリジンを絞らないのは、
 * 導入先のドメインをこちら側で先に知ることができないため。
 * 代わりに、受け取るものを「記録するだけで何も返さない」に留めている。
 * 読み出しの経路（一覧・集計）はこの許可の対象にしない。
 */
function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

siteTracking.options('/api/site/collect', (c) => c.body(null, 204, corsHeaders()));

// POST /api/site/collect — 訪問と操作の記録
//
// 認証しない。成功も失敗も 204 で返し、中身は何も返さない。
// エラーの形を返すと、外から叩いて内部の様子を探れてしまう。
siteTracking.post('/api/site/collect', async (c) => {
  try {
    const body = await c.req.json<{
      visitorId?: unknown;
      eventType?: unknown;
      path?: unknown;
      label?: unknown;
      valueNum?: unknown;
      referrer?: unknown;
    }>();

    const visitorId = String(body.visitorId ?? '');
    if (!VISITOR_ID_PATTERN.test(visitorId)) return c.body(null, 204, corsHeaders());

    const eventType = String(body.eventType ?? 'page_view');
    if (!(SITE_EVENT_TYPES as readonly string[]).includes(eventType)) {
      return c.body(null, 204, corsHeaders());
    }

    await recordSiteEvent(c.env.DB, {
      visitorId,
      eventType: eventType as SiteEventType,
      // クエリ文字列の除去は recordSiteEvent の中で行う。
      // 受け口ごとに書くと、必ずどこかで忘れる。
      path: body.path,
      label: body.label == null ? null : String(body.label),
      valueNum:
        body.valueNum == null || Number.isNaN(Number(body.valueNum))
          ? null
          : Math.trunc(Number(body.valueNum)),
      referrer: body.referrer,
    });
    return c.body(null, 204, corsHeaders());
  } catch (err) {
    // 記録に失敗しても 204。外のサイトの画面が、こちらの都合で
    // エラーを出すべきではない。
    console.error('POST /api/site/collect error:', err);
    return c.body(null, 204, corsHeaders());
  }
});

// GET /api/site/script.js — 埋め込むJS
//
// 認証しない。ページの <script src> から読まれる。
siteTracking.get('/api/site/script.js', (c) => {
  const origin = c.env.WORKER_URL || new URL(c.req.url).origin;
  // 埋め込むJSはここで組み立てる。ファイルに置くと、Worker のURLを
  // 差し込めない（環境ごとに違うため）。
  const script = `(function () {
  var ENDPOINT = ${JSON.stringify(`${origin}/api/site/collect`)};
  var COOKIE = 'lh_visitor';
  var YEAR = 365 * 24 * 60 * 60;

  function readCookie() {
    var m = document.cookie.match(/(?:^|; )lh_visitor=([^;]*)/);
    return m ? m[1] : null;
  }
  function makeId() {
    // crypto があれば使う。無い環境でも動くよう時刻と乱数で作る。
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID().replace(/-/g, '');
    return String(Date.now()) + Math.random().toString(36).slice(2, 12);
  }
  function visitorId() {
    var id = readCookie();
    if (id) return id;
    id = makeId();
    // SameSite=Lax。別サイトからの遷移でも読める必要がある。
    document.cookie = COOKIE + '=' + id + ';path=/;max-age=' + YEAR + ';SameSite=Lax';
    return id;
  }
  function send(payload) {
    payload.visitorId = visitorId();
    var body = JSON.stringify(payload);
    // ページを離れる瞬間でも送れるよう sendBeacon を優先する。
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
  }

  // 訪問。パスだけを送る。クエリ文字列はサーバー側でも落とすが、
  // 送らないに越したことはない。
  send({ eventType: 'page_view', path: location.pathname, referrer: document.referrer || null });

  // data-lh-event を付けた要素のクリック。
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-lh-event]') : null;
    if (!el) return;
    send({ eventType: 'click', path: location.pathname, label: el.getAttribute('data-lh-event') });
  }, true);

  // 外から呼べるようにしておく。購入完了などをページ側から送れる。
  window.lhTrack = function (label, valueNum) {
    send({ eventType: 'custom', path: location.pathname, label: label, valueNum: valueNum });
  };
})();`;

  return c.body(script, 200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    // 変わることはほとんど無いが、Worker のURLが変わる可能性はある。
    // 1時間で見直す程度にしておく。
    'Cache-Control': 'public, max-age=3600',
  });
});

// POST /api/site/link — 訪問者と友だちを結びつける
//
// LIFF やフォームの中から呼ぶ。ここは認証済みの経路から呼ばれる前提だが、
// 友だちIDを当てられても「その人の行動が紐づく」だけで、情報は返さない。
siteTracking.post('/api/site/link', async (c) => {
  try {
    const body = await c.req.json<{ visitorId?: unknown; friendId?: unknown; via?: unknown }>();
    const visitorId = String(body.visitorId ?? '');
    const friendId = String(body.friendId ?? '');
    if (!VISITOR_ID_PATTERN.test(visitorId) || !friendId) {
      return c.json({ success: false, error: 'visitorId と friendId が必要です' }, 400);
    }
    const via = ['entry_route', 'liff', 'form', 'manual'].includes(String(body.via))
      ? (String(body.via) as 'entry_route' | 'liff' | 'form' | 'manual')
      : 'manual';
    const linked = await linkVisitorToFriend(c.env.DB, visitorId, friendId, via);
    // 既に別の人と結びついていたら false。上書きしないので、
    // 「結びつかなかった」ことだけ伝える。
    return c.json({ success: true, data: { linked } });
  } catch (err) {
    console.error('POST /api/site/link error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/site/summary — 計測が動いているかと、その内訳
siteTracking.get('/api/site/summary', async (c) => {
  try {
    const summary = await getSiteTrackingSummary(c.env.DB);
    return c.json({ success: true, data: summary });
  } catch (err) {
    console.error('GET /api/site/summary error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/site/pages — ページ別の閲覧数（管理画面用）
siteTracking.get('/api/site/pages', async (c) => {
  try {
    const jstNow = new Date(Date.now() + 9 * 3600_000);
    const to = c.req.query('to') ?? jstNow.toISOString().slice(0, 10);
    const from =
      c.req.query('from') ??
      new Date(jstNow.getTime() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return c.json({ success: false, error: '期間は 2026-08-01 の形で指定してください' }, 400);
    }
    const items = await getPageViewSummary(c.env.DB, { from, to: `${to}T23:59:59.999` });
    return c.json({ success: true, data: items });
  } catch (err) {
    console.error('GET /api/site/pages error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/friends/:id/site-events — 1人の行動履歴（友だち詳細用）
siteTracking.get('/api/friends/:id/site-events', async (c) => {
  try {
    const items = await getFriendSiteEvents(c.env.DB, c.req.param('id'), 100);
    return c.json({
      success: true,
      data: items.map((e) => ({
        id: e.id,
        eventType: e.event_type,
        path: e.path,
        label: e.label,
        occurredAt: e.occurred_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/friends/:id/site-events error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { siteTracking };
