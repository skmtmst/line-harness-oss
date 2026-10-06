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

// 見本の言葉・日付は ★V8 の絵 (gVjiC・EscPA・y1bs9A など) に合わせる。
const QA_EVENT = {
  id: 'qa-event-1',
  name: '秋のわんこ撮影会',
  venue_name: '然 渋谷店 2F',
  venue_url: null,
  image_url: null,
  description: 'プロのカメラマンが撮影します。おやつ付き。',
  description_centered: 0,
  max_bookings_per_friend: 3,
  requires_approval: 0,
  cancel_deadline_hours_before: 16,
  waitlist_enabled: 1,
};

const QA_SLOTS = [
  {
    id: 'qa-slot-1',
    event_id: 'qa-event-1',
    starts_at: '2026-10-11T10:00:00+09:00',
    ends_at: '2026-10-11T11:00:00+09:00',
    capacity: 5,
    is_active: 1,
    active_count: 3,
    remaining: 2,
  },
  {
    id: 'qa-slot-2',
    event_id: 'qa-event-1',
    starts_at: '2026-10-11T11:00:00+09:00',
    ends_at: '2026-10-11T12:00:00+09:00',
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
  event_name: '秋のわんこ撮影会',
  event_image_url: null,
  venue_name: '然 渋谷店 2F',
  venue_url: 'https://example.com/qa-hall',
  cancel_deadline_hours_before: 16,
  slot_starts_at: '2026-10-11T10:00:00+09:00',
  slot_ends_at: '2026-10-11T11:00:00+09:00',
};

/** キャンセル待ちの2番目 (y1bs9A の2行目)。 */
const QA_EVENT_WAITLIST = {
  ...QA_EVENT_BOOKING,
  id: 'qa-event-booking-2',
  status: 'waitlisted',
  waitlist_position: 2,
  slot_starts_at: '2026-10-11T11:00:00+09:00',
  slot_ends_at: '2026-10-11T12:00:00+09:00',
};

const QA_LINK = {
  refCode: 'QA1234',
  label: 'ブログ用',
  url: 'https://example.com/r/QA1234',
  clickCount: 12,
  friendAdds: 4,
  conversions: 2,
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
    title: 'はじめての子犬のしつけ講座',
    durationSeconds: 3600,
    sessionStartAt: now - 120,
    offsetSeconds: 120,
    playlistUrl: 'https://example.com/qa/master.m3u8',
    cta: { label: '申し込む', url: 'https://example.com/qa', showAtSeconds: 300 },
    comments: [
      { atSeconds: 5, authorName: 'QA はなこ', body: '楽しみにしていました！' },
      { atSeconds: 8, authorName: 'まる', body: 'トイレの話が知りたいです' },
    ],
  };
}

/** 来店アンケート (★V8 の B8rCt・g9osGN・aNZKe)。2ページ目に予約の欄。 */
function qaForm() {
  return {
    id: 'qa-form-1',
    name: '来店アンケート',
    description: 'ご来店ありがとうございました。1分で終わります。',
    layout: {
      version: 2,
      header: [],
      sections: [
        {
          id: 'qa-section-1',
          name: '今日のご来店',
          blocks: [
            {
              id: 'qa-b1',
              kind: 'input',
              type: 'radio',
              name: '目的',
              label: '今日のご来店の目的は？',
              required: true,
              choices: [
                { label: 'トリミング', value: 'trimming', defaultSelected: true },
                { label: 'シャンプーのみ', value: 'shampoo' },
                { label: 'ご相談', value: 'consult' },
              ],
            },
            {
              id: 'qa-b2',
              kind: 'input',
              type: 'checkbox',
              name: '気になったところ',
              label: '気になったところ（いくつでも）',
              choices: [
                { label: '待ち時間', value: 'wait', defaultSelected: true },
                { label: '駐車場', value: 'parking', defaultSelected: true },
                { label: '料金', value: 'price' },
              ],
            },
          ],
        },
        {
          id: 'qa-section-2',
          name: '次回について',
          blocks: [
            {
              id: 'qa-b3',
              kind: 'input',
              type: 'booking',
              name: '次回の予約',
              label: '次回のご希望の日時を選んでください',
              required: true,
              booking: { menuId: 'qa-menu-1', staffId: 'qa-staff-any', daysAhead: 14 },
            },
            {
              id: 'qa-b4',
              kind: 'input',
              type: 'textarea',
              name: 'ご要望',
              label: 'ご要望があればお書きください',
              placeholder: '自由にお書きください',
            },
          ],
        },
      ],
      options: {
        thanksUrl: null,
        thanksText: 'ご回答ありがとうございました',
        restorePrevious: false,
        pageTitle: '来店アンケート',
        submitLabel: '答えを送る',
        prevLabel: '前のページへ',
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

  // ---- 上の帯 (店名) ----
  if (method === 'GET' && pathname === '/api/liff/config') {
    json(res, 200, {
      success: true,
      data: { botBasicId: '@qa', accountName: '然 - NEN -', accountId: 'qa-account' },
    });
    return;
  }

  // ---- 予約 ----
  if (method === 'GET' && pathname === '/api/liff/booking/menus') {
    json(res, 200, {
      menus: [
        {
          id: 'qa-menu-1',
          name: 'トリミング（小型犬）',
          category_label: 'トリミング',
          description: 'シャンプー・カット・爪切り',
          duration_minutes: 105,
          buffer_after_minutes: 15,
          base_price: 8400,
          cancel_deadline_hours_before: 24,
          sort_order: 1,
        },
        {
          id: 'qa-menu-2',
          name: 'トリミング（中型犬）',
          category_label: 'トリミング',
          description: 'シャンプー・カット・爪切り',
          duration_minutes: 150,
          buffer_after_minutes: 15,
          base_price: 12600,
          sort_order: 2,
        },
        {
          id: 'qa-menu-3',
          name: 'シャンプーのみ',
          category_label: 'お手入れ',
          description: null,
          duration_minutes: 60,
          buffer_after_minutes: 10,
          base_price: 4200,
          sort_order: 3,
        },
        {
          id: 'qa-menu-4',
          name: '初回相談',
          category_label: '相談',
          description: 'はじめての方向け',
          duration_minutes: 30,
          buffer_after_minutes: 0,
          base_price: 0,
          sort_order: 4,
        },
      ],
    });
    return;
  }
  {
    const m = pathname.match(/^\/api\/liff\/booking\/menus\/([^/]+)\/staff$/);
    if (method === 'GET' && m) {
      const menuId = m[1];
      const basePrice =
        menuId === 'qa-menu-2' ? 12600 : menuId === 'qa-menu-3' ? 4200 : menuId === 'qa-menu-4' ? 0 : 8400;
      const duration =
        menuId === 'qa-menu-2' ? 150 : menuId === 'qa-menu-3' ? 60 : menuId === 'qa-menu-4' ? 30 : 105;
      json(res, 200, {
        staff: [
          {
            id: 'qa-staff-any',
            display_name: '指名なし',
            role: null,
            profile_image_url: null,
            bio: null,
            is_designation_optional: 1,
            price: basePrice,
            duration_minutes: duration,
          },
          {
            id: 'qa-staff-1',
            display_name: '佐々木',
            role: 'トリマー',
            profile_image_url: null,
            bio: null,
            is_designation_optional: 0,
            price: basePrice,
            duration_minutes: duration,
          },
          {
            id: 'qa-staff-2',
            display_name: '高田',
            role: 'トリマー',
            profile_image_url: null,
            bio: null,
            is_designation_optional: 0,
            price: basePrice,
            duration_minutes: duration,
          },
        ],
      });
      return;
    }
  }
  if (method === 'GET' && pathname === '/api/liff/booking/settings') {
    json(res, 200, { liff_date_view: 'list', booking_window_days: 60 });
    return;
  }
  if (method === 'GET' && pathname === '/api/liff/booking/availability') {
    const staffId = url.searchParams.get('staff_id') ?? 'qa-staff-1';
    // ★V8 の絵 (M2p63S・k3aJKU) に合わせた日付で決める。月曜はお休み、
    // 4・10・15・20・25・30 日は満席 (枠はあって残り0)。時刻は 9:00〜16:00 の6つで、
    // 10:00 と 16:00 は埋まっている。
    const from = url.searchParams.get('from') ?? '2026-10-01';
    const to = url.searchParams.get('to') ?? '2026-10-01';
    const FULL_DAYS = [4, 10, 15, 20, 25, 30];
    const TIMES = [
      ['09:00', 3],
      ['10:00', 0],
      ['13:00', 3],
      ['14:00', 3],
      ['15:00', 3],
      ['16:00', 0],
    ];
    const slots = [];
    const closed = [];
    const end = new Date(`${to}T00:00:00Z`);
    for (let d = new Date(`${from}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      if (d.getUTCDay() === 1) {
        closed.push(date);
        continue;
      }
      const full = FULL_DAYS.includes(d.getUTCDate());
      for (const [start, left] of TIMES) {
        const [h, m] = start.split(':').map(Number);
        const remaining = full ? 0 : left;
        slots.push({
          date,
          start,
          end: `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
          remaining,
          state: remaining > 0 ? 'available' : 'full',
        });
      }
    }
    json(res, 200, {
      by_staff: [{ staff_id: staffId, display_name: 'QA スタッフ', slots }],
      closed_dates: closed,
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
          starts_at: '2026-10-02T13:00:00+09:00',
          status: 'requested',
          customer_note: null,
          menu_name: 'トリミング（小型犬）',
          staff_name: 'QA スタッフ',
          profile_image_url: null,
        },
        {
          id: 'qa-history-2',
          starts_at: '2026-10-20T10:00:00+09:00',
          status: 'confirmed',
          customer_note: null,
          menu_name: 'シャンプーのみ',
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
    json(res, 200, { items: [QA_EVENT_BOOKING, QA_EVENT_WAITLIST] });
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
        available: 1250,
        pending: 500,
        lifetimeEarned: 2000,
        spent: 750,
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
