// Definitions only. Runtime handlers remain in their feature routes.
export const bookingPaymentsPaths = {
  // ── Booking payments（決済の差し替え制 #1318） ──────────────────────────
  '/api/booking/admin/payment-config': {
    get: {
      tags: ['Booking'],
      summary: '店のお支払い既定と鍵の有無を取得',
      description: '鍵の値は返さず、有無だけ返す。テストモードの印を含む。',
      parameters: [
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '店のお支払い既定' },
        '400': { description: 'account_id 未指定' },
        '404': { description: '対象が見つからない' },
      },
    },
    put: {
      tags: ['Booking'],
      summary: '店のお支払い既定を保存',
      parameters: [
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['mode', 'provider', 'holdMinutes'],
              properties: {
                mode: { type: 'string', enum: ['none', 'onsite', 'online', 'customer_choice'] },
                provider: { type: 'string', enum: ['none', 'onsite', 'stripe'] },
                holdMinutes: { type: 'integer', minimum: 5, maximum: 1440 },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: '保存した店のお支払い既定' },
        '400': { description: '入力が正しくない' },
        '404': { description: '対象が見つからない' },
      },
    },
  },
  '/api/booking/admin/menus/{id}/payment': {
    put: {
      tags: ['Booking'],
      summary: 'メニューのお支払いを上書き保存',
      parameters: [
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['mode', 'provider'],
              properties: {
                mode: { type: 'string', enum: ['none', 'onsite', 'online', 'customer_choice'] },
                provider: { type: 'string', enum: ['none', 'onsite', 'stripe'] },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: 'メニューに効くお支払い設定' },
        '400': { description: '入力が正しくない' },
        '404': { description: '対象が見つからない' },
      },
    },
    delete: {
      tags: ['Booking'],
      summary: 'メニューのお支払い上書きを消して店の既定に戻す',
      parameters: [
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '店の既定に戻した' },
        '404': { description: '対象が見つからない' },
      },
    },
  },
  '/api/booking/payments/start': {
    post: {
      tags: ['Booking'],
      summary: '支払いを始める（担当者用）',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['bookingId'],
              properties: {
                bookingId: { type: 'string' },
                idempotencyKey: { type: 'string', maxLength: 200 },
              },
            },
          },
        },
      },
      responses: {
        '201': { description: '支払いを始めた（決済画面のURL付き）' },
        '200': { description: '既にある支払いを返した' },
        '404': { description: '対象が見つからない' },
        '409': { description: '支払いの対象でない・準備ができていない' },
      },
    },
  },
  '/api/booking/payments/by-booking': {
    get: {
      tags: ['Booking'],
      summary: '支払いの状態を見る（担当者用、仮押さえ期限切れも落とす）',
      parameters: [
        { name: 'bookingId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '支払いの記録（無いときは null）' },
        '404': { description: '対象が見つからない' },
      },
    },
  },
  '/api/booking/payments/{id}/refund': {
    post: {
      tags: ['Booking'],
      summary: '試験用の支払いを一部または全額返金する',
      description: 'owner/admin、閲覧のみ不可。697が必要。試験用Stripe IDとJPYだけ。amount省略は残額全部。同じidempotencyKeyは1回だけ、本文違い409。data:{payment,refund,duplicate,simulation:true,sent:false}。LINE希望は保存するが送信しない。',
      requestBody: {required:true,content:{'application/json':{schema:{type:'object',required:['reason','idempotencyKey'],properties:{
        amount:{type:'integer',minimum:1},reason:{type:'string',minLength:1,maxLength:500},notifyLine:{type:'boolean',default:false},idempotencyKey:{type:'string',minLength:1,maxLength:200}
      }}}}},
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '返金済みにした' },
        '404': { description: '対象が見つからない' },
        '409': { description: '支払い済みでない' },
      },
    },
  },
  '/api/booking/payments/webhook/{provider}': {
    post: {
      tags: ['Booking'],
      summary: '支払い済みの知らせを受ける',
      description: '署名を確かめ、二重の知らせは受け付け済みで返す。manual の店は承認待ちのまま、automatic の店は確定する。',
      parameters: [
        { name: 'provider', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '反映した（二重含む）' },
        '401': { description: '署名が正しくない' },
        '404': { description: '知らない決済サービス' },
      },
    },
  },
  '/api/liff/booking/payments/start': {
    post: {
      tags: ['Booking'],
      summary: '支払いを始める（お客さま用）',
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['bookingId'],
              properties: { bookingId: { type: 'string' } },
            },
          },
        },
      },
      responses: {
        '201': { description: '支払いを始めた（決済画面のURL付き）' },
        '200': { description: '既にある支払いを返した' },
        '404': { description: '対象が見つからない' },
        '409': { description: '支払いの対象でない' },
      },
    },
  },
  '/api/liff/booking/payments/by-booking': {
    get: {
      tags: ['Booking'],
      summary: '支払いの状態を見る（お客さま用）',
      security: [],
      parameters: [
        { name: 'bookingId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '自分の予約の支払いの記録' },
        '404': { description: '対象が見つからない' },
      },
    },
  },
};
