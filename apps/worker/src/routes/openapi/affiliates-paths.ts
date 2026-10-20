// Definitions only. Runtime handlers remain in their feature routes.
export const affiliatesPaths = {
  // ── Affiliates ──────────────────────────────────────────────────────────
  '/api/affiliates': {
    get: { tags: ['Affiliates'], summary: 'アフィリエイト一覧', responses: { '200': { description: 'All affiliates' } } },
    post: {
      tags: ['Affiliates'],
      summary: 'アフィリエイト作成',
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, code: { type: 'string' }, commissionRate: { type: 'number' }, isActive: { type: 'boolean' } }, required: ['name', 'code'] } } } },
      responses: { '201': { description: 'Created' } },
    },
  },
  '/api/affiliates/{id}': {
    get: { tags: ['Affiliates'], summary: 'アフィリエイト詳細', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Affiliate' } } },
    put: { tags: ['Affiliates'], summary: 'アフィリエイト更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
    delete: { tags: ['Affiliates'], summary: 'アフィリエイト削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
  },
  '/api/affiliates/{id}/report': {
    get: {
      tags: ['Affiliates'],
      summary: 'アフィリエイトレポート',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'startDate', in: 'query', schema: { type: 'string' } },
        { name: 'endDate', in: 'query', schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'Report' } },
    },
  },
  '/api/affiliates/click': {
    post: {
      tags: ['Affiliates'],
      summary: 'クリック記録',
      description: '紹介コードからの公開クリック記録。認証なしで呼べる。',
      security: [],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { code: { type: 'string' }, url: { type: 'string' } }, required: ['code'] } } } },
      responses: { '201': { description: 'Recorded' } },
    },
  },
  '/api/affiliate-offers/{id}/versions': {
    get: {
      tags: ['Affiliates'],
      summary: '案件の決まりの版の履歴(#823)',
      description: '保存のたびに足した版を新しい順に返す。前の版は変わらない。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': { description: '版の一覧 { versionNumber・rewardAmount・windowDays・caps・reception }' },
        '404': { description: 'Not found in account scope' },
      },
    },
    post: {
      tags: ['Affiliates'],
      summary: '案件の決まりの新しい版を保存(#823)',
      description: 'owner/admin 専用。指定しなかった項目は今の版を引き継ぐ。同じ確認キーの再送では版を増やさない。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { rewardAmount: { type: 'number' }, rewardMiles: { type: 'number' }, windowDays: { type: 'number' }, capTotal: { type: 'number', nullable: true }, capMonthlyPerAffiliate: { type: 'number', nullable: true }, receptionFrom: { type: 'string', nullable: true }, receptionTo: { type: 'string', nullable: true }, idempotencyKey: { type: 'string' } } } } } },
      responses: {
        '201': { description: '新しい版' },
        '400': { description: '期間・上限の値が不正' },
        '404': { description: '案件が見つからない' },
      },
    },
  },
  '/api/affiliate-offers/{id}/cap-status': {
    get: {
      tags: ['Affiliates'],
      summary: '案件の今の決まりと上限の残り(#823)',
      description: '上限に達したら受付は自動で止まる。affiliateId を渡すと1人あたり月の残りも返す。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'affiliateId', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '今の版と残り { version・capped・totalRemaining・monthlyRemaining }' },
        '404': { description: 'Not found in account scope' },
      },
    },
  },
};
