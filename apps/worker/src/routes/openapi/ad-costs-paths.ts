// Definitions only. Runtime handlers remain in their feature routes.
export const adCostsPaths = {
  // ── 広告費 (#818) ────────────────────────────────────────────────────
  '/api/ad-costs': {
    get: {
      tags: ['Ads'], summary: '流入元ごとの広告費と取込状況（期間指定は日付。手入力分は source=manual）',
      parameters: [
        { name: 'accountId', in: 'query', schema: { type: 'string' } },
        { name: 'from', in: 'query', schema: { type: 'string', example: '2026-09-01' } },
        { name: 'to', in: 'query', schema: { type: 'string', example: '2026-09-30' } },
      ],
      responses: { '200': { description: 'Cost rows with per-platform import status' }, '400': { description: 'accountId・期間の指定が無い' } },
    },
    post: {
      tags: ['Ads'], summary: '広告費の手入力（同じ流入元・同じ日は上書き）',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['sourceLabel', 'day', 'amountMinor'],
              properties: {
                lineAccountId: { type: 'string' },
                sourceLabel: { type: 'string', maxLength: 100 },
                entryRouteId: { type: 'string' },
                day: { type: 'string', example: '2026-09-25' },
                amountMinor: { type: 'integer', minimum: 0, description: '最小通貨単位（JPYなら円）' },
                currency: { type: 'string', default: 'JPY' },
              },
            },
          },
        },
      },
      responses: { '201': { description: 'Recorded' }, '400': { description: 'Validation error' }, '404': { description: 'LINEアカウント・流入元が見つからない' } },
    },
  },
  '/api/ad-platforms/logs/{id}/retry': {
    post: {
      tags: ['Ads'],
      summary: '失敗した広告送信を同じ内容でやり直す',
      description: '広告設定の変更と同じく、変更可能なオーナーだけが実行できる。閲覧のみの権限では実行できない。本文は不要で、閲覧できるLINEアカウントの保存済み送信内容・宛先・送信の目印を使う。初回の送信要求から90日以内に限り再送し、送信済みなら再送せず同じ結果を返す。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: '送信記録のID' }],
      responses: {
        '200': {
          description: '再送の結果。外部への送信失敗もHTTP 200で返すため、data.statusを確認する',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'data'],
                properties: {
                  success: { type: 'boolean', const: true },
                  data: {
                    type: 'object',
                    required: ['logId', 'outboxId', 'providerEventId', 'status', 'replayed'],
                    properties: {
                      logId: { type: 'string' },
                      outboxId: { type: 'string' },
                      providerEventId: { type: 'string' },
                      status: { type: 'string', enum: ['sent', 'failed', 'pending'] },
                      replayed: { type: 'boolean', description: '送信済みの結果を返し、再送していない場合はtrue' },
                    },
                  },
                },
              },
            },
          },
        },
        '401': { description: '認証が必要' },
        '403': { description: '広告設定を変更できるオーナー権限が必要。閲覧のみの権限も拒否' },
        '404': { description: '送信記録が存在しない、または閲覧できるLINEアカウントの記録ではない' },
        '409': { description: '送信中、別の処理が先に送信、広告連携の停止・所属変更、または広告送信の緊急停止中' },
        '410': { description: '初回の送信要求から90日が経過し再送期限切れ' },
        '422': { description: '保存した送信内容・目印・接続設定を確認できない、または再送対象ではない' },
        '500': { description: '再送の処理に失敗' },
      },
    },
  },
  '/api/ad-platforms/{id}/cost-import': {
    post: {
      tags: ['Ads'], summary: 'その連携の前日分の広告費をいま取り込む（媒体側の未確定分は取り直せる）',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Imported (or skipped when already fetched)' }, '404': { description: 'Not found' }, '502': { description: '媒体から取り込めなかった' } },
    },
  },
};
