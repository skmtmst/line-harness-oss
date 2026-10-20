// Definitions only. Runtime handlers remain in their feature routes.
export const richMenusPaths = {
  // ── Rich Menus (publish schedules) ────────────────────────────────────
  '/api/rich-menu-groups/{groupId}/schedule': {
    post: {
      tags: ['Rich Menus'],
      summary: 'リッチメニューの公開予約を作成',
      parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { mode: { type: 'string', enum: ['scheduled', 'period'] }, startsAt: { type: 'string', format: 'date-time' }, endsAt: { type: 'string', format: 'date-time' }, restoreGroupId: { type: 'string' } }, required: ['mode', 'startsAt'] } } } },
      responses: { '201': { description: 'Schedule created' }, '200': { description: 'Same Idempotency-Key content exists' }, '400': { description: 'Invalid input' }, '404': { description: 'Not found' }, '409': { description: 'Idempotency-Key used with different content' } },
    },
  },
  '/api/rich-menu-groups/{groupId}/schedules': {
    get: {
      tags: ['Rich Menus'],
      summary: 'リッチメニューの公開予約一覧を取得',
      parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Schedules with status and retry info' }, '404': { description: 'Not found' } },
    },
  },
  '/api/rich-menu-groups/{groupId}/schedules/{scheduleId}/cancel': {
    post: {
      tags: ['Rich Menus'],
      summary: '実行前の公開予約を取り消し',
      parameters: [
        { name: 'groupId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'scheduleId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'Cancelled' }, '404': { description: 'Not found' }, '409': { description: 'Already started' } },
    },
  },
  // ── Rich Menus (運用: 履歴・再試行・照合・複製・集計・テスト適用) ──────
  '/api/rich-menu-groups/{groupId}/publish-runs': {
    get: {
      tags: ['Rich Menus'],
      summary: 'リッチメニューの公開履歴を取得（版・状態・最終エラー・LINE ID）',
      parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Publish runs newest first' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found or not visible' } },
    },
  },
  '/api/rich-menu-groups/{groupId}/publish-runs/{requestId}/retry': {
    post: {
      tags: ['Rich Menus'],
      summary: '失敗した公開runだけを保存された版のまま再試行（owner/admin）',
      parameters: [
        { name: 'groupId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'requestId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'Retry result or replayed success' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' }, '409': { description: 'Run still in progress' } },
    },
  },
  '/api/rich-menu-groups/{groupId}/reconcile': {
    post: {
      tags: ['Rich Menus'],
      summary: 'DBとLINEのずれを点検（dryRun）し、明示したときだけ修復（owner/admin）',
      parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { dryRun: { type: 'boolean' } } } } } },
      responses: { '200': { description: 'Diffs listed or repaired' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found or not visible' }, '502': { description: 'LINE state unreadable' } },
    },
  },
  '/api/rich-menu-groups/{groupId}/publish-progress': {
    get: {
      tags: ['Rich Menus'],
      summary: 'K-1: 最新の公開実行の4段（画像・メニュー・割り当て・片付け）（owner/admin）',
      parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Steps with per-step status and message' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found or not visible' } },
    },
  },
  '/api/rich-menu-groups/{groupId}/prepublish-check': {
    get: {
      tags: ['Rich Menus'],
      summary: 'O-1: 公開前の確認（自前検査・実機・版）。LINE検査は別口（owner/admin）',
      parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Self check, device confirmation and version state' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found or not visible' } },
    },
  },
  '/api/rich-menu-groups/{groupId}/validate': {
    post: {
      tags: ['Rich Menus'],
      summary: 'O-1: 公開する形のままLINEの検査APIに通す。下書きもLINEも変えない（owner/admin）',
      parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Self and LINE check results' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found or not visible' } },
    },
  },
  '/api/rich-menu-groups/{groupId}/device-confirm': {
    post: {
      tags: ['Rich Menus'],
      summary: 'O-1: 実機で見た記録。今の下書きにひもづく（owner/admin）',
      parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Confirmation recorded' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found or not visible' } },
    },
  },
  '/api/rich-menu-groups/{groupId}/duplicate': {
    post: {
      tags: ['Rich Menus'],
      summary: 'メニュー全体（ページ・ボタン・画像参照・出し分け）を下書きとして複製（owner/admin）',
      parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } } },
      responses: { '201': { description: 'Duplicated as a new draft' }, '200': { description: 'Same Idempotency-Key replayed' }, '400': { description: 'Idempotency-Key header required' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found or not visible' }, '409': { description: 'Idempotency-Key used with different content' } },
    },
  },
  '/api/rich-menu-groups/{groupId}/audience-summary': {
    get: {
      tags: ['Rich Menus'],
      summary: 'このメニューが実際に出る人数の集計だけを返す（staff可・個人情報なし）',
      parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Aggregate counts only' }, '404': { description: 'Not found or not visible' }, '503': { description: 'Counts unavailable' } },
    },
  },
  '/api/rich-menu-groups/{groupId}/test-apply': {
    get: {
      tags: ['Rich Menus'],
      summary: '本人LINEへのテスト適用の状態を取得（連携済みか・適用中か）',
      parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Link state and active apply' }, '404': { description: 'Not found or not visible' } },
    },
    post: {
      tags: ['Rich Menus'],
      summary: '本人確認済みのLINEだけへテスト適用（owner/admin・confirm必須）',
      parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['confirm'], properties: { confirm: { type: 'boolean', const: true } } } } } },
      responses: { '200': { description: 'Applied to operator LINE' }, '400': { description: 'Not linked or confirm missing' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found or not visible' }, '409': { description: 'Another apply in progress or key conflict' } },
    },
  },
  '/api/rich-menu-groups/{groupId}/test-apply/revert': {
    post: {
      tags: ['Rich Menus'],
      summary: 'テスト適用を取り消し、適用前のメニューへ戻す（冪等・owner/admin）',
      parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['confirm'], properties: { confirm: { type: 'boolean', const: true }, applyId: { type: 'string' } } } } } },
      responses: { '200': { description: 'Reverted (idempotent)' }, '400': { description: 'confirm required' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'No active apply' }, '409': { description: 'Conflicting revert in progress' } },
    },
  },
};
