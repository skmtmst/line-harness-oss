// Definitions only. Runtime handlers remain in their feature routes.
export const accountHandoversPaths = {
  // ── アカウントの乗り換え（引き継ぎ。X-3・設計 ★33-4）──────────────
  '/api/account-handovers': {
    post: {
      tags: ['LINE Accounts'],
      summary: '段1。引き継ぎコードを出す',
      description: 'コードの期限は72時間で1回だけ使える（X-3）。',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['fromAccountId'],
              properties: { fromAccountId: { type: 'string' } },
            },
          },
        },
      },
      responses: { '201': { description: '発行した' }, '400': { description: 'Invalid request' } },
    },
  },
  '/api/account-handovers/link': {
    post: {
      tags: ['LINE Accounts'],
      summary: '段2。受け取り先でコードを読む',
      parameters: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['code', 'toAccountId'],
              properties: {
                code: { type: 'string' },
                toAccountId: { type: 'string' },
              },
            },
          },
        },
      },
      responses: { '200': { description: 'つないだ' }, '422': { description: '期限切れ・使用済み' } },
    },
  },
  '/api/account-handovers/{id}': {
    get: {
      tags: ['LINE Accounts'],
      summary: '引き継ぎの詳細（判断の一覧つき）',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: '詳細' }, '404': { description: 'Not found' } },
    },
  },
  '/api/account-handovers/{id}/preview': {
    post: {
      tags: ['LINE Accounts'],
      summary: '段3。事前確認の結果を保存する',
      description: '**事前確認だけでは元のアカウントは何も変わらない。** '
        + '4区分の合計が元の友だち数と合わない・実際の友だち数と違うときは断る。'
        + '移し元システム側の申告件数（declaredFriendTotal）もここで受ける。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: '保存した' }, '422': { description: '合計が合わない' } },
    },
  },
  '/api/account-handovers/{id}/decisions': {
    put: {
      tags: ['LINE Accounts'],
      summary: '段4。競合の判断を保存する',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: '保存した' } },
    },
  },
  '/api/account-handovers/{id}/execute': {
    post: {
      tags: ['LINE Accounts'],
      summary: '段5。本実行と照合',
      description: '要確認がのこっている・申告件数と事前確認が違うままでは止まる。'
        + '本人確認（step-up）が要る（X-3）。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': { description: '実行した（照合結果つき）' },
        '401': { description: 'STEP_UP_REQUIRED' },
        '409': { description: 'もう実行済み' },
        '422': { description: '要確認がのこっている・件数が違う' },
      },
    },
  },
  '/api/account-handovers/{id}/cancel': {
    post: {
      tags: ['LINE Accounts'],
      summary: '進行中の引き継ぎを取り消す',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: '取り消した' }, '409': { description: '終わった引き継ぎは消せない' } },
    },
  },
  '/api/account-handovers/{id}/rollback': {
    post: {
      tags: ['LINE Accounts'],
      summary: '段6。切り戻し（本実行から7日間だけ）',
      description: '動かした友だちを元のアカウントへ戻す（X-3）。'
        + '期限を過ぎた引き継ぎ・もう戻した引き継ぎは断る。本人確認（step-up）が要る。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { note: { type: 'string', nullable: true } },
            },
          },
        },
      },
      responses: {
        '200': { description: '切り戻した（restoredCountつき）' },
        '401': { description: 'STEP_UP_REQUIRED' },
        '422': { description: '期限切れ・実行前・戻し済み' },
      },
    },
  },
  '/api/accounts/health-summary': {
    get: {
      tags: ['LINE Accounts'],
      summary: 'アカウントヘルス要約',
      description: 'staff可視範囲のアカウントの最新riskLevelだけを1回で返す。ログ本文は含めない(サイドバーのN+1解消用 #630)。',
      responses: { '200': { description: 'Health summary' } },
    },
  },
};
