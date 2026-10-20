// QA routes are mounted normally, but their environment gate runs before authentication/DB.
const roles = ['hq', 'store', 'viewer', 'impersonation'];
const jobs = ['booking_waitlists', 'restaurant_holds', 'restaurant_menu_prices'];
const uuid = { type: 'string', format: 'uuid' };
const id = { name: 'id', in: 'path', required: true, schema: uuid };
const run = {
  type: 'object', required: ['id', 'tenantId', 'accountId', 'organizationId', 'storeId', 'status', 'users', 'friendIds'],
  properties: {
    id: uuid, tenantId: { type: 'string' }, accountId: { type: 'string' }, organizationId: { type: 'string' }, storeId: { type: 'string' },
    status: { type: 'string', enum: ['active', 'archived'] },
    users: { type: 'array', items: { type: 'object', required: ['id', 'role', 'email'], properties: {
      id: { type: 'string' }, role: { type: 'string', enum: roles }, email: { type: 'string', format: 'email' },
    } } },
    friendIds: { type: 'array', maxItems: 100, items: { type: 'string' } },
  },
};
const json = (schema: object) => ({ 'application/json': { schema } });
const response = (description: string, data: object) => ({ description, content: json({
  type: 'object', required: ['success', 'data'], properties: { success: { const: true }, data },
}) });
const body = (schema: object) => ({ required: true, content: json(schema) });
const gate = {
  tags: ['Ops Console'], security: [{ bearerAuth: [] }],
  description: '検証専用。環境名・Worker名・DB識別子・公開URLが検証の値と一致し、QAと送信停止の両旗がtrueの時だけ使用可。通常の運営認証と書込権限が必要（閲覧のみ・環境ownerキーは不可）。Cookie認証時は通常のCSRF検査も行う。本番・無効時は認証やDB操作より先に404。実送信・決済は停止。',
};
const errors = {
  '400': { description: 'Invalid input' }, '401': { description: 'Authentication or impersonation step-up verification required' },
  '403': { description: 'Writable platform administrator required, or CSRF mismatch' },
  '404': { description: 'QA disabled, production environment, or run not found' },
  '409': { description: 'Run busy/archived, friend limit reached, or requestId already used for another/unfinished job' },
};
const receipt = {
  type: 'object', required: ['job', 'status'], properties: {
    job: { type: 'string', enum: jobs }, status: { type: 'string', enum: ['running', 'completed', 'failed'] },
    accountId: { type: 'string' }, outboundStopped: { const: true }, completedAt: { type: 'string', format: 'date-time' },
  },
};
export const stagingQaPaths = {
  '/api/ops/staging-qa/safety': { get: {
    ...gate, summary: '検証用の送信停止と対象処理を確認', responses: { ...errors, '200': response('Safety boundary', {
      type: 'object', required: ['environment', 'outboundStopped', 'simulatedLineOnly', 'jobs'], properties: {
        environment: { const: 'staging' }, outboundStopped: { const: true }, simulatedLineOnly: { const: true },
        jobs: { type: 'array', items: { type: 'string', enum: jobs } },
      },
    }) },
  } },
  '/api/ops/staging-qa/runs': {
    get: { ...gate, summary: '試験台帳を最大50件取得', parameters: [{ name: 'after', in: 'query', schema: uuid }], responses: {
      ...errors, '200': response('Runs without credentials', { type: 'object', required: ['runs', 'nextCursor'], properties: {
        runs: { type: 'array', maxItems: 50, items: run }, nextCursor: { type: ['string', 'null'], format: 'uuid' },
      } }),
    } },
    post: { ...gate, summary: '隔離した試験統括・店舗・4役を準備', requestBody: body({
      type: 'object', required: ['passwords'], properties: { passwords: { type: 'object', required: roles, properties:
        Object.fromEntries(roles.map(role => [role, { type: 'string', minLength: 8, maxLength: 128, pattern: '^(?=.*[A-Za-z])(?=.*[0-9])[^\\s]+$', writeOnly: true }])),
      } },
    }), responses: { ...errors, '201': response('Synthetic run; passwords and tokens are never returned', run) } },
  },
  '/api/ops/staging-qa/runs/{id}': {
    get: { ...gate, summary: '試験台帳を取得', parameters: [id], responses: { ...errors, '200': response('Synthetic run', run) } },
    delete: { ...gate, summary: '試験対象を履歴を残して停止・セッション失効', parameters: [id], responses: {
      ...errors, '200': response('Archived', { type: 'object', required: ['id', 'status'], properties: { id: uuid, status: { const: 'archived' } } }),
    } },
  },
  '/api/ops/staging-qa/runs/{id}/friends': { post: {
    ...gate, summary: '試験の友だちを追加（1回20人・試験全体100人まで）', parameters: [id],
    requestBody: body({ type: 'object', required: ['count'], properties: { count: { type: 'integer', minimum: 1, maximum: 20 } } }),
    responses: { ...errors, '201': response('Synthetic friends', { type: 'object', required: ['runId', 'accountId', 'friends'], properties: {
      runId: uuid, accountId: { type: 'string' }, friends: { type: 'array', maxItems: 20, items: {
        type: 'object', required: ['id', 'lineUserId'], properties: { id: { type: 'string' }, lineUserId: { type: 'string' } },
      } },
    } }) },
  } },
  '/api/ops/staging-qa/runs/{id}/session': { post: {
    ...gate, summary: '試験用ログインを準備（代理は運営本人の既存セッションと再確認が必要）', parameters: [id],
    requestBody: body({ type: 'object', required: ['role'], properties: { role: { type: 'string', enum: roles } } }),
    responses: { ...errors, '200': response('Session cookie only; impersonation retains the operator identity in read mode', {
      type: 'object', required: ['id', 'role', 'tenantId'], properties: {
        id: { type: 'string' }, role: { type: 'string', enum: roles }, tenantId: { type: 'string' }, mode: { const: 'read' },
      },
    }), '503': { description: 'Session environment misconfigured' } },
  } },
  '/api/ops/staging-qa/runs/{id}/cron': { post: {
    ...gate, summary: '試験対象だけの期限処理を実行（世界の時計は変更しない）', parameters: [id],
    description: `${gate.description} 同じrequestIdは保存結果だけを返す。処理中・失敗済みのIDは再実行しない。予約の口へは現在の公開形のまま試験アカウント/店を渡す。`,
    requestBody: body({ type: 'object', required: ['job', 'requestId'], properties: {
      job: { type: 'string', enum: jobs }, requestId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$', minLength: 1, maxLength: 64 },
    } }), responses: { ...errors,
      '200': { description: 'Completed receipt (replayed=true on reuse)', content: json({ type: 'object', required: ['success', 'data', 'replayed'],
        properties: { success: { const: true }, data: receipt, replayed: { type: 'boolean' } },
      }) },
      '409': { description: 'Busy, conflicting job, or unfinished receipt (success=false, data/replayed included for an existing receipt)' },
      '500': { description: 'Failed receipt retained; do not automatically rerun' },
    },
  } },
};
