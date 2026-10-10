const parameters = [
  { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
  { in: 'query', name: 'account_id', required: true, schema: { type: 'string' } },
];
const requestBody = {
  required: true,
  content: { 'application/json': { schema: {
    type: 'object', required: ['expectedVersion'],
    properties: { expectedVersion: { type: 'integer', minimum: 1 } },
  } } },
};
const errors = {
  '400': { description: 'JSONまたはアカウント指定が不正' },
  '403': { description: '更新権限なし' },
  '404': { description: '対象がない、または別アカウント' },
  '409': { description: '版または状態の競合' },
  '422': { description: '入力不正。fieldsに欄ごとの理由を返す' },
};
export const pagesParityPaths = {
  '/api/events/admin/events/{id}/duplicate': { post: {
    tags: ['Events'], summary: '設定と開催回を下書きへ複製する。申込・公開版・通知は写さない',
    parameters, requestBody, responses: { ...errors, '201': { description: '作成したidとdraft状態' } },
  } },
  '/api/friend-add-rules/{id}/duplicate': { post: {
    tags: ['Friend Add Rules'], summary: '保存済みの初回案内を下書きへ複製する',
    parameters: [...parameters, { in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string', minLength: 16, maxLength: 200 } }],
    requestBody, responses: { ...errors, '201': { description: '作成したid。同じ操作の再送では同じ下書きを返す' } },
  } },
  '/api/friend-add-rules/{id}/unarchive': { post: {
    tags: ['Friend Add Rules'], summary: '保管した初回案内を未テストの下書きへ戻す。配信は再開しない',
    parameters, requestBody, responses: { ...errors, '200': { description: '復元したid、draft状態、更新後の版' } },
  } },
};
