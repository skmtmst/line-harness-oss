const count = { type: 'integer', minimum: 0 } as const;
function countsOperation(summary: string, properties: Record<string, unknown>, accountKey?: string) {
  return {
    summary,
    ...(accountKey ? { parameters: [{ name: accountKey, in: 'query', required: true, schema: { type: 'string' } }] } : {}),
    responses: {
      '200': { description: '担当範囲内のタブ件数', content: { 'application/json': { schema: {
        type: 'object', required: ['success', 'data'], properties: {
          success: { const: true }, data: { type: 'object', required: Object.keys(properties), properties },
        },
      } } } },
      '400': { description: 'アカウントの指定がない' },
      '401': { description: '未認証' },
      '403': { description: '閲覧権限がない、または機能オフ' },
      '404': { description: '担当範囲外のアカウント' },
      '500': { description: '件数の取得に失敗（0件として返さない）' },
    },
  };
}
export const tabCountPaths = {
  '/api/automations/counts': { get: countsOperation('ルール・共通アクション・ひな形の件数', {
    rules: count, commonActions: count, templates: count,
  }, 'account_id') },
  '/api/media/counts': { get: countsOperation('登録メディアの種類・未使用・保管済みの件数', {
    total: count, unused: count, archived: count,
    byKind: { type: 'object', required: ['image', 'video', 'audio', 'file'], properties: {
      image: count, video: count, audio: count, file: count,
    } },
  }, 'accountId') },
  '/api/conversions/approvals/counts': { get: countsOperation('紹介成果の承認状態ごとの件数', {
    pending: count, approved: count, rejected: count, total: count,
  }) },
};
