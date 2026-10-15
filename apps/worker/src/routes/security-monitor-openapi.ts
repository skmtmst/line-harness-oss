const account = { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } };
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
const offset = { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 1000000, default: 0 } };
const errors = {
  '401': { description: '管理ログインが必要' },
  '403': { description: '役割・店の所属・運営権限なし。変更は閲覧のみ・代理ログインも拒否' },
  '503': { description: '監視の記録が未適用または取得失敗。正常な0件ではない' },
};
const alert = { type: 'object', properties: {
  id: { type: 'string' }, ruleKey: { type: 'string' }, summary: { type: 'string' },
  count: { type: 'integer', minimum: 0 }, threshold: { type: 'integer', minimum: 1 },
  status: { type: 'string', enum: ['open', 'acknowledged', 'resolved'] }, version: { type: 'integer' },
  firstDetectedAt: { type: 'string', format: 'date-time' }, lastDetectedAt: { type: 'string', format: 'date-time' },
  reviewedAt: { type: 'string', format: 'date-time', nullable: true },
  notification: { type: 'string', enum: ['sent', 'pending', 'unconfigured'] },
  scope: { type: 'object', description: '運営APIだけ。店APIとSlackへ出さない', properties: {
    tenantId: { type: 'string' }, lineAccountId: { type: 'string', nullable: true },
  } },
} };
function list(platform: boolean) {
  return { tags: ['Operations'], summary: platform ? '運営マスターが安全監視の要対応を取得' : '担当店の安全監視の要対応を取得',
    parameters: [...(platform ? [] : [account]), offset], responses: { ...errors,
      '400': { description: '表示位置が不正' },
      '200': { description: '未解決の監視記録。空でも全操作の安全を保証しない', content: { 'application/json': { schema: {
        type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: {
          items: { type: 'array', items: alert }, limit: { type: 'integer', enum: [200] }, offset: { type: 'integer' }, total: { type: 'integer' },
          windowMinutes: { type: 'integer', enum: [15] }, configurationValid: { type: 'boolean' },
          thresholds: { type: 'object', additionalProperties: { type: 'integer', minimum: 1 } },
          monitor: { type: 'object', properties: {
            status: { type: 'string', enum: ['unknown', 'failed', 'stale', 'running'] },
            lastStartedAt: { type: 'string', nullable: true }, lastCompletedAt: { type: 'string', nullable: true }, configurationValid: { type: 'boolean' },
          } },
        } } },
      } } } },
    } };
}
function review(platform: boolean, status: string) {
  return { tags: ['Operations'], summary: `${platform ? '運営マスターが' : '担当店の管理者が'}安全監視を${status === 'resolved' ? '解消' : '受領'}`,
    parameters: [...(platform ? [] : [account]), id],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expectedVersion'],
      properties: { expectedVersion: { type: 'integer', minimum: 1 } } } } } },
    responses: { ...errors, '200': { description: 'successとdata: id / status / version。更新後に一覧を読み直す' },
      '400': { description: '版の指定が不正' }, '404': { description: '記録なし、または担当外の記録' }, '409': { description: '版の競合。最新の状態を読み直す' } },
  };
}
export const securityMonitorPaths = Object.fromEntries([false, true].flatMap(platform => {
  const base = platform ? '/api/ops/security-alerts' : '/api/operations/security-alerts';
  return [
    [base, { get: list(platform) }],
    [`${base}/{id}/acknowledge`, { post: review(platform, 'acknowledged') }],
    [`${base}/{id}/resolve`, { post: review(platform, 'resolved') }],
  ];
}));
