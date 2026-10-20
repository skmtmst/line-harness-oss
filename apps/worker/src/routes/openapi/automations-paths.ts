// Definitions only. Runtime handlers remain in their feature routes.
export const automationsPaths = {
  '/api/automation-runs/{id}': {
    get: {
      tags: ['Automations'],
      summary: '実行記録1件の詳細を取得（版番号・テスト印・処理ごとの結果）',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': { description: 'Run detail with pinned version number, test flag and per-step results' },
        '403': { description: 'Automations permission required' },
        '404': { description: 'Run not found in account scope' },
      },
    },
  },
  '/api/automation-runs/{id}/cancel': {
    post: {
      tags: ['Automations'],
      summary: '終わっていない実行を取りやめる（記録は残る）',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': { description: 'Run cancelled (idempotent for already-cancelled runs)' },
        '403': { description: 'Automations permission required' },
        '404': { description: 'Run not found in account scope' },
        '409': { description: 'Run already finished and cannot be cancelled' },
      },
    },
  },
  '/api/automations/{id}/draft': {
    post: {
      tags: ['Automations'],
      summary: '公開済みオートメーションに改訂用の下書きを作る（冪等）',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '201': { description: 'Draft created or the existing draft returned' },
        '403': { description: 'Automations permission required' },
        '404': { description: 'Automation not found in account scope' },
      },
    },
  },
  '/api/automations/{id}/duplicate': {
    post: {
      tags: ['Automations'],
      summary: 'オートメーションを複製して新しい下書きにする',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '201': { description: 'Duplicated draft created' },
        '403': { description: 'Automations permission required' },
        '404': { description: 'Automation not found in account scope' },
      },
    },
  },
  '/api/automations/{id}/status': {
    post: {
      tags: ['Automations'],
      summary: 'オートメーションの稼働状態を切り替える（active/stopped/archived）',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', required: ['status'],
        properties: { status: { type: 'string', enum: ['active', 'stopped', 'archived'] } },
      } } } },
      responses: {
        '200': { description: 'Status updated (archived is one-way)' },
        '400': { description: 'Invalid status value' },
        '403': { description: 'Automations permission required' },
        '404': { description: 'Automation not found in account scope' },
        '409': { description: 'Status changed concurrently' },
        '422': { description: 'Transition not allowed (e.g. archived restore, unpublished activate)' },
      },
    },
  },
};
