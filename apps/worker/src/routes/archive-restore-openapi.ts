const parameters = [
  { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
  { in: 'query', name: 'lineAccountId', required: true, schema: { type: 'string' } },
];
const responses = {
  '200': { description: '同じ定義を保管から戻す。再送では版と監査を重複させない' },
  '400': { description: 'アカウントまたは版の指定が不正' },
  '403': { description: '更新権限がない' },
  '404': { description: '対象がない、または対象アカウントを参照できない' },
  '409': { description: '別の担当者が先に更新した。読み直して再試行する' },
  '500': { description: '保管から戻す処理に失敗した' },
};
const requestBody = { required: true, content: { 'application/json': { schema: {
  type: 'object', required: ['expectedVersion'], properties: { expectedVersion: { type: 'integer', minimum: 1 } },
} } } };
export const archiveRestorePaths = {
  '/api/tags/{id}/restore': { post: { tags: ['Tags'], summary: 'タグを保管から戻す。友だちの置換は戻さない', parameters, requestBody, responses } },
  '/api/support-marks/{id}/restore': { post: { tags: ['Friend Attributes'], summary: '対応マークを保管から戻す。初期値・受信時自動変更は再開しない', parameters, requestBody, responses } },
  '/api/automations/{id}/restore': { post: { tags: ['Automations'], summary: 'ルールを保管から戻す。公開版ありは停止中、公開前は下書き', parameters: parameters.map(parameter => parameter.in === 'query' ? { ...parameter, required: false } : parameter), responses } },
};
