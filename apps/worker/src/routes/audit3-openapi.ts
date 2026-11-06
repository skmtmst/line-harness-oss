export const audit3Paths = {
  '/api/booking/admin/menus/order': {
    put: {
      tags: ['Booking'], summary: '予約メニューの並びを版付きで原子的に保存する',
      parameters: [{ name: 'account_id', in: 'query', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', required: ['changes'], properties: { changes: { type: 'array', minItems: 1, maxItems: 1000,
          items: { type: 'object', required: ['id', 'expectedVersion', 'sortOrder'], properties: {
            id: { type: 'string', minLength: 1 }, expectedVersion: { type: 'integer', minimum: 1 }, sortOrder: { type: 'integer' },
          } },
        } },
      } } } },
      responses: {
        '200': { description: '全件保存。各IDと更新後のversionを返す' },
        '400': { description: '入力不正' }, '403': { description: '編集権限なし' },
        '409': { description: '対象または版が不一致。全件未変更' },
      },
    },
  },
};
