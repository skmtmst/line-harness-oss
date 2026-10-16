/** 統括の素材・配信・請求。実装済みのAPI1の契約を公開する。 */
type Schema = Record<string, unknown>;
const string: Schema = { type: 'string' };
const count: Schema = { type: 'integer', minimum: 0 };
const nullableCount: Schema = { type: ['integer', 'null'], minimum: 0 };
const object: Schema = { type: 'object' };
const array = (items: Schema): Schema => ({ type: 'array', items });
const record = (properties: Record<string, Schema>, required?: string[]): Schema => ({
  type: 'object', properties, ...(required ? { required } : {}),
});
function operation(summary: string, data: Schema, options: {
  params?: string[]; query?: Record<string, Schema>; body?: Schema;
  created?: boolean; description?: string;
} = {}) {
  return {
    tags: ['HQ Templates', 'HQ Broadcasts', 'HQ Billing'], summary,
    description: options.description ?? '同じ統括全体のowner/adminのみ。別統括やアカウント限定の担当者は利用できない。',
    parameters: [
      ...(options.params ?? []).map(name => ({ name, in: 'path', required: true, schema: string })),
      ...Object.entries(options.query ?? {}).map(([name, schema]) => ({ name, in: 'query', schema })),
    ],
    ...(options.body ? { requestBody: { required: true, content: { 'application/json': { schema: options.body } } } } : {}),
    responses: {
      [options.created ? '201' : '200']: {
        description: '処理結果。未取得の数値はnull。',
        content: { 'application/json': { schema: record({ success: { const: true }, data }, ['success', 'data']) } },
      },
      '400': { description: '入力が不正' }, '401': { description: '管理認証が必要' },
      '403': { description: '所属・権限が不足' }, '404': { description: '対象が見つからない' },
      '409': { description: '版や対象の状態が変わった' }, '500': { description: '取得・処理に失敗' },
    },
  };
}
const copyBody = record({ requestId: string, expectedVersion: { type: 'integer', minimum: 1 }, title: string }, ['requestId', 'expectedVersion']);
const draft = record({ sent: { const: 0 }, followupAudienceCount: count, followupAudience: array(object) });

export const hqAuthoringPaths = {
  '/api/hq/billing/metrics': { get: operation('統括の請求・契約・未払いの実績を読む', record({
    source: { const: 'stored_invoices' }, period: object, observedInvoiceCount: count,
    lastSyncedAt: { type: ['string', 'null'] }, thisMonthBilledYen: nullableCount,
    contractCount: count, contractUnit: { const: 'organization' }, activeAccountCount: count,
    contractAccountCount: { type: 'null' }, trialCount: count, unpaidInvoiceCount: nullableCount,
    paymentFailureCount: { type: 'null' }, nextBillingAt: { type: ['string', 'null'] }, unavailable: object,
  })) },
  '/api/hq/broadcasts/quota': { get: operation('各アカウントの今月の配信残数を読む', record({
    source: { const: 'operation_health_cache' }, maxAgeSeconds: { const: 900 },
    remaining: nullableCount, used: nullableCount, limit: nullableCount,
    perAccount: array(record({ accountId: string, accountName: string, remaining: nullableCount,
      used: nullableCount, limit: nullableCount, observedAt: { type: ['string', 'null'] }, fresh: { type: 'boolean' } })),
  }), { description: '統括全体のowner/admin。15分以内・同じ月の運用状態の記録を使う。未取得・古い計測は0にせずnull。' }) },
  '/api/hq/broadcasts/{id}/reactions': { get: operation('統括配信のリンク・反応を読む', record({
    windowDays: { const: 14 }, minimumPeople: { const: 20 }, sampleBasis: { const: 'sent_recipients' },
    links: array(record({ accountId: string, broadcastId: string, linkId: string, label: string, url: string,
      uniqueClickCount: nullableCount, clickCount: nullableCount, clickRate: { type: ['number', 'null'] },
      suppressed: { type: 'boolean' } })),
  }), { params: ['id'], description: '統括全体のowner/admin。送信成功した宛先の14日間を計測。母数20人未満の値はnull。' }) },
  '/api/hq/broadcasts/{id}/duplicate': { post: operation('統括配信を下書きへ複製する', draft,
    { params: ['id'], body: copyBody, created: true, description: '統括全体のowner/admin。版を照合して下書きだけを作る。送信・承認は別の操作。' }) },
  '/api/hq/broadcasts/{id}/followup': { post: operation('統括配信の追送用の下書きを作る', draft,
    { params: ['id'], body: copyBody, created: true, description: '統括全体のowner/admin。送信済みでリンク計測がある対象店から宛先を計算し、下書きだけを作る。' }) },
  '/api/hq/templates/media': { get: operation('同じ統括の登録済み素材を読む', record({
    items: array(record({ id: string, kind: { enum: ['video', 'audio', 'image'] }, filename: string,
      sizeBytes: count, sizeKb: { type: 'number' }, selectable: { type: 'boolean' } })),
    nextCursor: { type: ['string', 'null'] },
  }), { query: { kind: { enum: ['video', 'audio', 'image'] }, cursor: { type: 'string', maxLength: 2048 },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 } } }),
      post: {
        tags: ['HQ Templates'], summary: '統括ひな形のPNG/JPEG画像を登録',
        parameters: [
          { name: 'purpose', in: 'query', required: true, schema: { type: 'string', enum: ['message', 'rich_menu', 'rich_message', 'rich_video_preview'] } },
          { name: 'filename', in: 'query', required: true, schema: { type: 'string', minLength: 1, maxLength: 200 } },
          { name: 'width', in: 'query', required: false, schema: { type: 'integer' }, description: '採用できる幅。画像が違う寸法なら登録せず422' },
          { name: 'height', in: 'query', required: false, schema: { type: 'integer' }, description: '採用できる高さ。画像が違う寸法なら登録せず422' },
        ],
        requestBody: { required: true, content: { 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/jpeg': { schema: { type: 'string', format: 'binary' } } } },
        responses: { '201': { description: '統括の画像。rich_message・rich_video_previewは原本と5サイズのmediaとbaseUrl/baseSizeを返す。message/rich_menuの同一再送は既存画像を再利用する' }, '403': { description: 'Tenant-wide owner/admin write permission required' }, '422': { description: 'Invalid image, dimensions, size or unconfirmed upload' } },
      },
      delete: {
        tags: ['HQ Templates'], summary: '採用されなかった統括ひな形の画像を回収（所有確認つき）',
        parameters: [
          { name: 'r2Key', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Deleted flag; missing objects are a no-op' }, '403': { description: 'Tenant-wide owner/admin write permission required' }, '404': { description: 'Outside the caller tenant ownership' }, '422': { description: 'Invalid image key' } },
      },
  },
  '/api/hq/templates/rich-menu-preview': { post: operation('リッチメニューの配布先・参照・画像を保存前に確かめる', record({
    name: string, stores: array(object), references: array(object), images: array(object),
    summary: object, requiresPreflight: { const: true },
  }), { body: record({ name: { type: 'string', minLength: 1, maxLength: 200 }, accountIds: array(string), definition: object }, ['name', 'accountIds']),
    description: '統括全体のowner/admin。保存・配布をしない確認。配布前の正式なpreflightは別途必須。' }) },
  '/api/hq/templates/{id}/test-send': { post: operation('保存済み回答フォームの入力と答えを試す', record({
    dryRun: { const: true }, sent: { const: 0 }, persistsAnswers: { const: false }, templateId: string,
    templateVersionId: string, revision: count, form: object, answerValidation: { type: ['object', 'null'] },
    testUrl: { type: 'null' }, testUrlUnavailableReason: { const: 'HQ_TEST_TOKEN_STORAGE_REQUIRED' },
  }), { params: ['id'], body: record({ expectedRevision: { type: 'integer', minimum: 1 }, answers: object }),
    description: '統括全体のowner/admin。回答フォーム専用。答えを検証するだけで送信・回答保存はしない。試し用URLは未発行。' }) },
};
