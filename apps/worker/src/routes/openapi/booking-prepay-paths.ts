// Definitions only. Runtime handlers remain in their feature routes.
export const bookingPrepayPaths = {
  // ── Booking plus B: sales + noshow/prepay ───────────────────────────────
  '/api/booking/admin/sales-summary': {
    get: {
      tags: ['Booking'],
      summary: '予約からの売上集計を見る',
      description: '確定のみ集計。無断キャンセルは売上に入れない。',
      parameters: [
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'from', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'to', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '売上合計と件数' },
        '400': { description: 'account_id 未指定' },
      },
    },
  },
  '/api/booking/admin/noshow-settings': {
    get: {
      tags: ['Booking'],
      summary: '無断キャンセルの数え方を見る',
      parameters: [
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'オン／オフ・何回目から・数える期間・決済が無い店の扱い' },
        '400': { description: 'account_id 未指定' },
      },
    },
    put: {
      tags: ['Booking'],
      summary: '無断キャンセルの数え方を保存',
      parameters: [
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                threshold: { type: 'integer', minimum: 1, maximum: 100 },
                windowMonths: { type: 'integer', minimum: 1, maximum: 120 },
                noPaymentMode: { type: 'string', enum: ['notice', 'notice_call'] },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: '保存した数え方' },
        '400': { description: '入力が正しくない' },
      },
    },
  },
  '/api/booking/admin/friends/{friendId}/noshow': {
    get: {
      tags: ['Booking'],
      summary: 'お客さまの無断キャンセル回数を見る',
      parameters: [
        { name: 'friendId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '無断キャンセル回数と前払いのみの有無' },
        '400': { description: 'account_id 未指定' },
        '404': { description: '対象が見つからない' },
      },
    },
  },
  '/api/booking/admin/friends/{friendId}/prepay': {
    post: {
      tags: ['Booking'],
      summary: 'お客さまを手で前払いのみにする・外す',
      parameters: [
        { name: 'friendId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                mode: { type: 'string', enum: ['manual_on', 'manual_off'] },
                reason: { type: 'string', description: '印を外すときは必須の1行' },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: '前払いのみにした・外した結果' },
        '400': { description: 'account_id 未指定・印を外すとき理由が無い' },
        '404': { description: '対象が見つからない' },
      },
    },
    delete: {
      tags: ['Booking'],
      summary: 'お客さまの前払いのみを手で外して自動に戻す',
      parameters: [
        { name: 'friendId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '自動に戻した結果' },
        '400': { description: 'account_id 未指定' },
        '404': { description: '対象が見つからない' },
      },
    },
  },
};
