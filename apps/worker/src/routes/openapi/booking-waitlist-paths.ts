// Definitions only. Runtime handlers remain in their feature routes.
export const bookingWaitlistPaths = {
  // ── Booking plus (booking-plus 1・2・6：繰り返し予約・待ち・今日の一覧) ──
  '/api/booking/admin/last-booking': {
    get: {
      tags: ['Booking'],
      summary: '前回と同じ内容で予約するための直近の予約を取得',
      description: 'friend_id か booking_customer_id のどちらか一方を指定する。取り消し済みを除いた最新の予約のメニュー・担当を返す。無いときは available=false。',
      parameters: [
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'friend_id', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'booking_customer_id', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '直近の予約、または available=false' },
        '400': { description: 'account_id 未指定、または客の指定が無い・両方ある' },
      },
    },
  },
  '/api/booking/admin/today': {
    get: {
      tags: ['Booking'],
      summary: '今日の予約を時刻順に取得（人・席・両方）',
      description: 'date は店の暦日（省いたら今日）。mode=staff|seat|both。from/to で期間も取れる（35日まで）。席の予約は飲食店向けの卓の予約で、つなげる卓は両方の卓名を返す。席の結び付きがあるかは has_seat_stores で返す。',
      parameters: [
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'date', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'mode', in: 'query', required: false, schema: { type: 'string', enum: ['staff', 'seat', 'both'] } },
        { name: 'from', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'to', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'status', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'staff_id', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'bookings（人）・seats（席）・timeline（混ぜた時刻順）' },
        '400': { description: 'account_id 未指定、または日付の形が正しくない' },
      },
    },
  },
  '/api/booking/admin/waitlist': {
    get: {
      tags: ['Booking'],
      summary: 'キャンセル待ちの一覧を取得',
      description: 'staff_id・starts_at・status で絞れる。開始時刻順・登録順で最大100件。',
      parameters: [
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'staff_id', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'starts_at', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['waiting', 'invited', 'converted', 'cancelled'] } },
      ],
      responses: {
        '200': { description: 'waitlist の配列' },
        '400': { description: 'account_id 未指定、または開始日時の形が正しくない' },
      },
    },
    post: {
      tags: ['Booking'],
      summary: 'キャンセル待ちを登録',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['staff_id', 'menu_id', 'starts_at'], properties: {
        staff_id: { type: 'string' },
        menu_id: { type: 'string' },
        starts_at: { type: 'string' },
        friend_id: { type: ['string', 'null'] },
        booking_customer_id: { type: ['string', 'null'] },
      } } } } },
      responses: {
        '201': { description: '登録した待ち' },
        '400': { description: 'account_id 未指定、または JSON・値が正しくない' },
        '404': { description: '担当・メニューが無い' },
        '409': { description: '同じ枠に既に待ちがある・枠が空いている・開始1時間前を過ぎた' },
      },
    },
  },
  '/api/booking/admin/waitlist/{id}': {
    delete: {
      tags: ['Booking'],
      summary: 'キャンセル待ちを取り消す',
      description: '招待ずみ（仮押さえ中）の取り消しでは、次の人へすぐ繰り上げる。',
      parameters: [
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'status=cancelled' },
        '404': { description: '待ちが無い' },
        '409': { description: '既に締め切っている' },
      },
    },
  },
  '/api/booking/admin/waitlist/{id}/convert': {
    post: {
      tags: ['Booking'],
      summary: 'キャンセル待ちを予約になったへ進める',
      description: '同じ枠・同じ人の予約だけ受け付ける。違う予約では booking_mismatch で止まる。',
      parameters: [
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['booking_id'], properties: { booking_id: { type: 'string' } } } } } },
      responses: {
        '200': { description: 'status=converted' },
        '400': { description: 'account_id 未指定、または予約の指定が無い' },
        '404': { description: '待ちが無い' },
        '409': { description: '既に締め切っている、または予約が枠・人と合わない' },
      },
    },
  },
  '/api/booking/admin/bookings/{id}/visit': {
    post: {
      tags: ['Booking'],
      summary: '来店の印を付ける（来店した・遅れる・来なかった）',
      description: '来店したは完了へ、来なかったは無断へ進める。遅れるは印だけ。kind は visited|late|no_show。late_minutes は遅れると1〜1440分だけ要る。',
      parameters: [
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['kind'], properties: {
        kind: { type: 'string', enum: ['visited', 'late', 'no_show'] },
        late_minutes: { type: ['integer', 'null'] },
      } } } } },
      responses: {
        '200': { description: '進んだ状態と付けた印' },
        '400': { description: 'account_id 未指定、または印の種類・分数が正しくない' },
        '404': { description: '予約が無い' },
        '409': { description: '状態が進められない、または締め切っている' },
      },
    },
    delete: {
      tags: ['Booking'],
      summary: '来店の印を取り消す（元に戻す）',
      description: '最新の印を1件消す。印で進んでいた状態（完了・無断）は確定へ戻す。遅れるは印を消すだけ。',
      parameters: [
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '戻した状態' },
        '404': { description: '印または予約が無い' },
        '409': { description: '印のあとに状態が変わっていて戻せない' },
      },
    },
  },
  '/api/liff/booking/waitlist': {
    get: {
      tags: ['Booking'],
      summary: '自分のキャンセル待ち一覧（お客さま用）',
      security: [],
      description: 'waiting・invited だけを開始時刻順で最大50件。本人の分だけ返す。',
      responses: {
        '200': { description: 'waitlist の配列' },
        '401': { description: '本人確認ができない' },
      },
    },
    post: {
      tags: ['Booking'],
      summary: 'キャンセル待ちを自分で登録（お客さま用）',
      security: [],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['staff_id', 'menu_id', 'starts_at'], properties: {
        staff_id: { type: 'string' },
        menu_id: { type: 'string' },
        starts_at: { type: 'string' },
      } } } } },
      responses: {
        '201': { description: '登録した待ちの id' },
        '400': { description: 'JSON・値が正しくない' },
        '401': { description: '本人確認ができない' },
        '404': { description: '担当・メニューが無い' },
        '409': { description: '同じ枠に既に待ちがある' },
      },
    },
  },
  '/api/liff/booking/waitlist/{id}': {
    delete: {
      tags: ['Booking'],
      summary: 'キャンセル待ちを自分で取り消す（今回は見送る）',
      security: [],
      description: '招待ずみ（仮押さえ中）の取り消しでは、次の人へすぐ繰り上げる。本人の分だけ消せる。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'status=cancelled' },
        '401': { description: '本人確認ができない' },
        '404': { description: '待ちが無い、または締め切っている' },
      },
    },
  },
  '/api/liff/booking/seat-waitlist': {
    get: {
      tags: ['Booking'],
      summary: '自分の席のキャンセル待ち一覧（お客さま用・飲食店）',
      security: [],
      description: '本人の分だけ、開始時刻の新しい順で最大100件。?id= で1件に絞れる。仮押さえの期限切れは先に片付ける。飲食店向け機能が無い環境では 404。',
      parameters: [
        { name: 'id', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'waitlist の配列' },
        '401': { description: '本人確認ができない' },
        '404': { description: '飲食店向け機能が無い' },
      },
    },
    post: {
      tags: ['Booking'],
      summary: '席のキャンセル待ちを自分で登録（お客さま用・飲食店）',
      security: [],
      description: '人数に合う卓がすべて予約か仮押さえで埋まっている枠だけ受け付ける。開始1時間前で締め切る。',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['store_id', 'starts_at', 'guest_count'], properties: {
        store_id: { type: 'string' },
        starts_at: { type: 'string' },
        guest_count: { type: 'integer', minimum: 1, maximum: 100 },
      } } } } },
      responses: {
        '201': { description: '登録した待ちの id' },
        '400': { description: 'JSON・日時・人数が正しくない、または人数に合う卓が無い' },
        '401': { description: '本人確認ができない' },
        '404': { description: '店舗が無い、または飲食店向け機能が無い' },
        '409': { description: '空いている卓がある・締め切り後・同じ枠に待ちがある・登録数の上限' },
      },
    },
  },
  '/api/liff/booking/seat-waitlist/{id}': {
    delete: {
      tags: ['Booking'],
      summary: '席のキャンセル待ちを自分で取り消す（お客さま用・飲食店）',
      security: [],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'status=cancelled' },
        '401': { description: '本人確認ができない' },
        '404': { description: '待ちが無い、または取り消せない状態' },
      },
    },
  },
  '/api/liff/booking/seat-waitlist/{id}/accept': {
    post: {
      tags: ['Booking'],
      summary: '席のキャンセル待ちの案内を受けて予約にする（お客さま用・飲食店）',
      security: [],
      description: 'Idempotency-Key が必須。同じ待ちから作った予約があればそれを返す。仮押さえの期限が過ぎていたら 409。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '同じ待ちから作った予約が既にある（reservation_id と status）' },
        '201': { description: '予約を作った（reservation_id と status=confirmed）' },
        '400': { description: 'Idempotency-Key が無い、または予約の値が正しくない' },
        '401': { description: '本人確認ができない' },
        '404': { description: '待ちが無い、または飲食店向け機能が無い' },
        '409': { description: '案内の期限が切れている、または卓がふさがった' },
      },
    },
  },
};
