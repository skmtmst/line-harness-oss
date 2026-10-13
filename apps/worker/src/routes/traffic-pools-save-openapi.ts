const parameters = [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }];
const poolResponse = { description: 'プールの内容と最新の保存版（updatedAt）', content: { 'application/json': { schema: {
  type: 'object', properties: { success: { const: true }, data: { type: 'object', required: ['id', 'name', 'updatedAt'], properties: {
    id: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' }, activeAccountId: { type: 'string' },
    accountName: { type: ['string', 'null'] }, liffId: { type: ['string', 'null'] }, isActive: { type: 'boolean' },
    createdAt: { type: 'string' }, updatedAt: { type: 'string' },
  } } },
} } } };

export const trafficPoolSavePaths = {
  '/api/traffic-pools/{id}': {
    get: {
      tags: ['TrafficPools'], summary: 'プールの最新内容と保存版を読む（owner/admin）', parameters,
      description: 'owner/adminかつ所属アカウントを閲覧できる人だけに返す。比較と明示的な読み直しに使う。',
      responses: { '200': poolResponse, '401': { description: '認証なし' }, '403': { description: 'owner/adminでない' }, '404': { description: 'プールがない、または閲覧権限なし' } },
    },
    put: {
      tags: ['TrafficPools'], summary: '保存版を照合してプールを更新する（owner）', parameters,
      description: '名前を送る場合は読んだupdatedAtをexpectedUpdatedAtとして必ず送る。保存時の照合で先の更新を上書きしない。名前以外の更新でも書き込み直前の保存版を照合する。',
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', dependentRequired: { name: ['expectedUpdatedAt'] }, properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 }, expectedUpdatedAt: { type: 'string', minLength: 1 },
          activeAccountId: { type: 'string' }, isActive: { type: 'boolean' },
        },
      } } } },
      responses: { '200': poolResponse, '400': { description: 'JSONまたは項目の型が不正' }, '401': { description: '認証なし' },
        '403': { description: 'ownerでない、閲覧のみ、または切り替え先を操作できない' },
        '404': { description: 'プールがない、または閲覧権限なし' }, '422': { description: '名前または保存版がない・不正' },
        '409': { description: 'save_conflict：ほかの人が先に保存した。入力を保って比較／読み直しを行う。', content: { 'application/json': { schema: {
          type: 'object', properties: { success: { const: false }, code: { const: 'save_conflict' }, error: { type: 'string' }, updatedAt: { type: 'string' }, data: { type: 'object', properties: { updatedAt: { type: 'string' } } } },
        } } } },
      },
    },
  },
};
