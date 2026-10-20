// Definitions only. Runtime handlers remain in their feature routes.
export const commonVarsPaths = {
  // ── Common Vars (audited async CSV export, N-192) ─────────────────────
  '/api/common-vars/exports': {
    get: {
      tags: ['Common Vars'],
      summary: '共通情報CSVの書き出し台帳一覧を取得',
      parameters: [{ name: 'accountId', in: 'query', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Recent export jobs for the account' }, '400': { description: 'accountId query param required' }, '404': { description: 'Account not found or not visible' } },
    },
    post: {
      tags: ['Common Vars'],
      summary: '共通情報CSVの非同期書き出しを依頼（owner/admin）',
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['accountId'], properties: { accountId: { type: 'string' }, folderId: { type: 'string', nullable: true }, ungrouped: { type: 'boolean' } } } } } },
      responses: { '201': { description: 'Export job queued; returns job with progress' }, '400': { description: 'Invalid request or folder' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Account not found or not visible' } },
    },
  },
  '/api/common-vars/exports/{id}': {
    get: {
      tags: ['Common Vars'],
      summary: '書き出しの状態・進捗を取得（期限超過の完了行は expired に確定）',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Job status, progress and downloadUrl' }, '404': { description: 'Not found or not visible' } },
    },
  },
  '/api/common-vars/exports/{id}/download': {
    get: {
      tags: ['Common Vars'],
      summary: '完成したCSVを期限付きでダウンロード（owner/admin）',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'text/csv attachment' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found or not visible' }, '409': { description: 'Not downloadable yet' }, '410': { description: 'Download expired; regenerate required' } },
    },
  },
  '/api/common-vars/exports/{id}/regenerate': {
    post: {
      tags: ['Common Vars'],
      summary: '同じ条件で書き出しを作り直す（owner/admin）',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '201': { description: 'New export job queued with the same filter' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found or not visible' } },
    },
  },
};
