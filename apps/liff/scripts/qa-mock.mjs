/**
 * LIFF 撮影モード専用の偽 API。node で :8790 に立つ。
 *
 * 使い方: `node apps/liff/scripts/qa-mock.mjs`
 * 形は Worker の実装 (apps/worker/src/routes/booking.ts・events.ts・
 * webinars.ts・forms.ts・affiliate-self.ts) と LIFF 側の読み方
 * (apps/liff/src/lib/api.ts・pages/Affiliate.tsx) に合わせる。
 * 実在の個人情報は入れない。
 *
 * 注意: GET /api/forms/:id は本物の Worker が {success,data} の包みで
 * 返すが、LIFF の api.getForm は包みなし (PublicForm そのまま) を読む。
 * 偽物は LIFF が読む形 (包みなし) を返す。#要確認: 本物との差は要申告。
 *
 * 撮影の操作口:
 *   POST /__qa/state { delayMs, fail }  delayMs=応答を遅らせるms(読み込み中を撮る)
 *                                       fail="all" かパスの接頭辞の配列(500を返す)
 *   POST /__qa/reset                   上を元に戻す
 *   GET  /__qa/state                   今の設定を見る
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.QA_MOCK_PORT ?? 8790);

const state = { delayMs: 0, fail: null };

const QA_EVENT = {
  id: 'qa-event-1',
  name: 'QA 撮影会',
  venue_name: 'QA ホール',
  venue_url: 'https://example.com/qa-hall',
  image_url: null,
  description: '撮影モードの見本イベントです。',
  description_centered: 0,
  max_bookings_per_friend: 2,
  requires_approval: 0,
  cancel_deadline_hours_before: 24,
};

const QA_SLOTS = [
  {
    id: 'qa-slot-1',
    event_id: 'qa-event-1',
    starts_at: '2026-10-01T10:00:00+09:00',
    ends_at: '2026-10-01T11:00:00+09:00',
    capacity: 5,
    is_active: 1,
    active_count: 2,
    remaining: 3,
  },
  {
    id: 'qa-slot-2',
    event_id: 'qa-event-1',
    starts_at: '2026-10-02T14:00:00+09:00',
    ends_at: '2026-10-02T15:00:00+09:00',
    capacity: 5,
    is_active: 1,
    active_count: 5,
    remaining: 0,
  },
];

const QA_EVENT_BOOKING = {
  id: 'qa-event-booking-1',
  event_id: 'qa-event-1',
  status: 'confirmed',
  customer_note: null,
  event_name: 'QA 撮影会',
  event_image_url: null,
  venue_name: 'QA ホール',
  venue_url: 'https://example.com/qa-hall',
  cancel_deadline_hours_before: 24,
  slot_starts_at: '2026-10-01T10:00:00+09:00',
  slot_ends_at: '2026-10-01T11:00:00+09:00',
};

const QA_LINK = {
  refCode: 'QA1234',
  label: 'ブログ用',
  url: 'https://example.com/r/QA1234',
  clickCount: 12,
  friendAdds: 3,
  conversions: 1,
  conversionsPending: 0,
  conversionsApproved: 1,
  offerId: null,
  offerName: null,
};

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

function shouldFail(pathname) {
  if (state.fail === 'all') return true;
  if (Array.isArray(state.fail)) return state.fail.some((p) => pathname.startsWith(p));
  return false;
}

function webinarLive() {
  const now = Math.floor(Date.now() / 1000);
  return {
    live: true,
    title: 'QA ウェビナー',
    durationSeconds: 3600,
    sessionStartAt: now - 120,
    offsetSeconds: 120,
    playlistUrl: 'https://example.com/qa/master.m3u8',
    cta: { label: '申し込む', url: 'https://example.com/qa', showAtSeconds: 300 },
    comments: [{ atSeconds: 5, authorName: 'QA はなこ', body: '楽しみにしています' }],
  };
}

function qaForm() {
  return {
    id: 'qa-form-1',
    name: 'QA アンケート',
    description: '撮影モードの見本フォームです。',
    layout: {
      version: 2,
      header: [],
      sections: [
        {
          id: 'qa-section-1',
          name: '基本情報',
          blocks: [
            { id: 'qa-b1', kind: 'input', type: 'text', name: 'お名前', label: 'お名前', required: true },
            {
              id: 'qa-b2',
              kind: 'input',
              type: 'radio',
              name: '来店回数',
              label: '来店回数',
              choices: [
                { label: 'はじめて', value: 'first' },
                { label: '2回目以降', value: 'repeat' },
              ],
            },
            { id: 'qa-b3', kind: 'text', text: 'ご協力ありがとうございます。' },
          ],
        },
      ],
      options: {
        thanksUrl: null,
        thanksText: 'ご回答ありがとうございました。',
        restorePrevious: false,
        pageTitle: 'QA アンケート',
        submitLabel: '送信',
        prevLabel: '前へ',
        nextLabel: '次へ',
        sectionHeader: 'pageNumber',
        confirmDialog: { enabled: false },
        deadline: { enabled: false },
        oncePerFriend: { enabled: false },
        totalLimit: { enabled: false },
        afterActions: [],
      },
    },
    isActive: true,
  };
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/__qa/state' && req.method === 'GET') {
    json(res, 200, state);
    return;
  }
  if (pathname === '/__qa/state' && req.method === 'POST') {
    const body = await readBody(req);
    if (typeof body.delayMs === 'number') state.delayMs = body.delayMs;
    if (body.fail === undefined || body.fail === null || body.fail === 'all' || Array.isArray(body.fail)) {
      state.fail = body.fail ?? null;
    }
    json(res, 200, state);
    return;
  }
  if (pathname === '/__qa/reset' && req.method === 'POST') {
    state.delayMs = 0;
    state.fail = null;
    json(res, 200, state);
    return;
  }

  if (state.delayMs > 0) {
    await new Promise((r) => setTimeout(r, state.delayMs));
  }
  if (shouldFail(pathname)) {
    json(res, 500, { error: 'qa_mock_failure' });
    return;
  }

  const method = req.method ?? 'GET';

  // ---- 予約 ----
  if (method === 'GET' && pathname === '/api/liff/booking/menus') {
    json(res, 200, {
      menus: [
        {
          id: 'qa-menu-1',
          name: 'QA カット',
          category_label: 'ヘア',
          description: '撮影用の見本メニューです。',
          duration_minutes: 60,
          buffer_after_minutes: 10,
          base_price: 3000,
          sort_order: 1,
        },
      ],
    });
    return;
  }
  {
    const m = pathname.match(/^\/api\/liff\/booking\/menus\/([^/]+)\/staff$/);
    if (method === 'GET' && m) {
      json(res, 200, {
        staff: [
          {
            id: 'qa-staff-1',
            display_name: 'QA スタッフ',
            role: 'スタイリスト',
            profile_image_url: null,
            bio: null,
            is_designation_optional: 0,
            price: 3000,
            duration_minutes: 60,
          },
        ],
      });
      return;
    }
  }
  if (method === 'GET' && pathname === '/api/liff/booking/availability') {
    const staffId = url.searchParams.get('staff_id') ?? 'qa-staff-1';
    json(res, 200, {
      by_staff: [
        {
          staff_id: staffId,
          display_name: 'QA スタッフ',
          slots: [
            { date: '2026-10-01', start: '10:00', end: '11:00' },
            { date: '2026-10-01', start: '11:00', end: '12:00' },
          ],
        },
      ],
    });
    return;
  }
  if (method === 'POST' && pathname === '/api/liff/booking/requests') {
    json(res, 200, { booking_id: 'qa-booking-1', status: 'requested' });
    return;
  }
  if (method === 'GET' && pathname === '/api/liff/booking/me') {
    json(res, 200, {
      upcoming: [
        {
          id: 'qa-history-1',
          starts_at: '2026-10-01T10:00:00+09:00',
          status: 'confirmed',
          customer_note: null,
          menu_name: 'QA カット',
          staff_name: 'QA スタッフ',
          profile_image_url: null,
        },
      ],
      past: [],
    });
    return;
  }

  // ---- イベント ----
  if (method === 'GET' && pathname === '/api/liff/events/me') {
    json(res, 200, { items: [QA_EVENT_BOOKING] });
    return;
  }
  if (method === 'GET' && pathname.startsWith('/api/liff/events/me/')) {
    json(res, 200, QA_EVENT_BOOKING);
    return;
  }
  {
    const m = pathname.match(/^\/api\/liff\/events\/me\/([^/]+)\/cancel$/);
    if (method === 'POST' && m) {
      json(res, 200, { ok: true });
      return;
    }
  }
  {
    const m = pathname.match(/^\/api\/liff\/events\/waitlist\/([^/]+)\/accept$/);
    if (method === 'POST' && m) {
      json(res, 200, {
        success: true,
        data: { bookingId: 'qa-booking-wl', status: 'confirmed', alreadyConfirmed: false },
      });
      return;
    }
  }
  {
    const m = pathname.match(/^\/api\/liff\/events\/([^/]+)\/slots$/);
    if (method === 'GET' && m) {
      json(res, 200, { items: QA_SLOTS });
      return;
    }
  }
  {
    const m = pathname.match(/^\/api\/liff\/events\/([^/]+)\/bookings$/);
    if (method === 'POST' && m) {
      json(res, 200, { id: 'qa-event-booking-new', status: 'confirmed' });
      return;
    }
  }
  {
    const m = pathname.match(/^\/api\/liff\/events\/([^/]+)$/);
    if (method === 'GET' && m) {
      json(res, 200, QA_EVENT);
      return;
    }
  }

  // ---- フォーム ----
  {
    const m = pathname.match(/^\/api\/forms\/([^/]+)\/my-latest$/);
    if (method === 'GET' && m) {
      json(res, 200, null);
      return;
    }
  }
  {
    const m = pathname.match(/^\/api\/forms\/([^/]+)\/files$/);
    if (method === 'POST' && m) {
      json(res, 200, {
        success: true,
        data: { key: 'qa-key', url: 'https://example.com/qa.png', mimeType: 'image/png', size: 123 },
      });
      return;
    }
  }
  {
    const m = pathname.match(/^\/api\/forms\/([^/]+)\/submit$/);
    if (method === 'POST' && m) {
      json(res, 200, { success: true, data: { complete: true } });
      return;
    }
  }
  {
    const m = pathname.match(/^\/api\/forms\/([^/]+)$/);
    if (method === 'GET' && m) {
      json(res, 200, qaForm());
      return;
    }
  }

  // ---- ウェビナー ----
  {
    const m = pathname.match(/^\/api\/liff\/webinars\/([^/]+)\/(heartbeat|comments|cta-click)$/);
    if (method === 'POST' && m) {
      json(res, 200, { ok: true });
      return;
    }
  }
  {
    const m = pathname.match(/^\/api\/liff\/webinars\/([^/]+)$/);
    if (method === 'GET' && m) {
      const slug = decodeURIComponent(m[1]);
      if (slug === 'qa-webinar-private') {
        json(res, 403, { error: 'forbidden' });
        return;
      }
      if (slug === 'qa-webinar-waiting') {
        json(res, 200, {
          live: false,
          title: 'QA ウェビナー',
          nextSessionAt: Math.floor(Date.now() / 1000) + 3600,
        });
        return;
      }
      json(res, 200, webinarLive());
      return;
    }
  }

  // ---- アフィリエイト・ mileage ----
  if (method === 'GET' && pathname === '/api/liff/affiliate/me') {
    json(res, 200, {
      affiliate: {
        id: 'qa-aff',
        name: 'QA たろう',
        code: 'QA1234',
        commissionRate: 10,
        isActive: true,
        friendId: 'Fqa0001',
      },
      links: [QA_LINK],
    });
    return;
  }
  if (method === 'POST' && pathname === '/api/liff/affiliate/register') {
    await readBody(req);
    json(res, 200, {
      affiliate: {
        id: 'qa-aff',
        name: 'QA たろう',
        code: 'QA1234',
        commissionRate: 10,
        isActive: true,
        friendId: 'Fqa0001',
      },
      links: [QA_LINK],
    });
    return;
  }
  if (method === 'POST' && pathname === '/api/liff/affiliate/links') {
    json(res, 200, { link: QA_LINK });
    return;
  }
  if (method === 'GET' && pathname === '/api/liff/affiliate/offers') {
    json(res, 200, {
      offers: [
        {
          id: 'qa-offer-1',
          name: 'QA 紹介特典',
          description: '撮影用の見本特典です。',
          rewardAmount: 1000,
          rewardMiles: 50,
          enrolled: false,
          refCode: null,
          url: null,
        },
      ],
    });
    return;
  }
  {
    const m = pathname.match(/^\/api\/liff\/affiliate\/offers\/([^/]+)\/enroll$/);
    if (method === 'POST' && m) {
      json(res, 200, { link: QA_LINK });
      return;
    }
  }
  if (method === 'GET' && pathname === '/api/liff/mileage/me') {
    json(res, 200, {
      mileage: {
        programId: 'qa-program',
        programName: 'QA マイル',
        available: 120,
        pending: 30,
        lifetimeEarned: 200,
        spent: 50,
      },
      history: [],
      insights: {
        accountCount: 1,
        rewardedActions: 2,
        referralMiles: 50,
        qualityReferralCount: 1,
        lastEarnedAt: null,
      },
      opportunities: [],
    });
    return;
  }

  json(res, 404, { error: 'qa_mock_not_found', path: pathname });
});

server.listen(PORT, () => {
  console.log(`[qa-mock] listening on :${PORT}`);
});
