// Definitions only. Runtime handlers remain in their feature routes.
export const friendsPaths = {
  // ── Friends ─────────────────────────────────────────────────────────────
  '/api/friends': {
    get: {
      tags: ['Friends'],
      summary: '友だち一覧取得',
      parameters: [
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        { name: 'pagination', in: 'query', schema: { type: 'string', enum: ['cursor'] }, description: '日時とIDで安定したページ送り。検索とoffsetとは併用不可。data.nextCursorを次のcursorへ渡す。' },
        { name: 'cursor', in: 'query', schema: { type: 'string', maxLength: 1024 } },
        { name: 'tagId', in: 'query', schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'Paginated friends list' } },
    },
  },
  '/api/friends/count': {
    get: { tags: ['Friends'], summary: '友だち数取得', responses: { '200': { description: 'Count' } } },
  },
  '/api/friends/bulk-runs/{id}/approve': {
    post: {
      tags: ['Friends'],
      summary: '人数基準を超えた一括送信の実行承認',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { confirmedRecipientCount: { anyOf: [{ type: 'integer' }, { type: 'string' }], description: '1人運用の人数確認（整数または空でない数値文字列。対象人数と一致する場合のみ）' } } } } } },
      responses: {
        '202': { description: '承認を受け付けた（approval を返す。送信の完了は実行の取得で確認）' },
        '400': { description: '指定を読み取れません' },
        '403': { description: '承認する権限がありません' },
        '404': { description: '一括操作が見つかりません' },
        '409': { description: '承認待ちなし・期限切れ・人数不一致・本人の承認' },
        '413': { description: '一括操作の指定が大きすぎます' },
        '500': { description: '一括操作を処理できませんでした' },
      },
    },
  },
  '/api/friends/{id}': {
    get: {
      tags: ['Friends'],
      summary: '友だち詳細取得',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Friend with tags' }, '404': { description: 'Not found' } },
    },
  },
  '/api/friends/{id}/data': {
    delete: {
      tags: ['Friends'], summary: 'お客さまの依頼で友だちの顧客データと書類を削除（B-215）',
      description: '書込可能なオーナー・管理者だけ。友だちのアカウントの所属を照合し、R2・DB・完了監査を再試行可能に削除する。成功済みの再実行はreplayed=true。同時実行は409。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'X-Confirm-Irreversible', in: 'header', required: true, schema: { type: 'string', enum: ['delete-friend-data'] } },
      ],
      responses: {
        '200': { description: '削除完了または成功済みの再実行。data.deleted=true、data.replayedはboolean' },
        '403': { description: 'スタッフ・閲覧のみ・未認証は実行不可' },
        '404': { description: '対象が無いか、アカウントが範囲外' },
        '409': { description: 'deletion_in_progress または deletion_schema_approval_required（保存対象の保護にmigration承認が必要）' },
        '428': { description: '確認ヘッダーが無いか不一致' },
        '503': { description: 'deletion_retry_required。同じ対象で再試行する' },
      },
    },
  },
  '/api/friends/{id}/form-submissions': {
    get: {
      tags: ['Friends'],
      summary: '友だちのフォーム回答履歴をカーソル式で取得（回答フォームタブ用・PERF-13）',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 10, maximum: 50 } },
        { name: 'cursor', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'Form submissions page with total count and nextCursor' },
        '404': { description: 'Friend not found in account scope' },
      },
    },
  },
  '/api/friends/{id}/summary': {
    get: {
      tags: ['Friends'], summary: '閲覧できる友だちの直近90日間の集計を読む',
      description: '取消・全額返金を除き、部分返金は金額から差し引く。個人の開封率は未計測のためnull。EC未連携なら購入集計もnull。複数通貨は合算しない。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': {
          description: '集計期間、開封の計測状態、通貨別の購入件数・金額',
          content: { 'application/json': { schema: {
            type: 'object', required: ['success', 'data'],
            properties: {
              success: { const: true },
              data: {
                type: 'object', required: ['periodDays', 'from', 'to', 'deliveryOpenRate90Days', 'deliveryOpenMeasuredCount90Days', 'purchases90Days'],
                properties: {
                  periodDays: { const: 90 },
                  from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' },
                  deliveryOpenRate90Days: { type: ['number', 'null'] },
                  deliveryOpenMeasuredCount90Days: { type: 'integer', minimum: 0 },
                  purchases90Days: {
                    type: ['object', 'null'], required: ['count', 'totalAmountMinor', 'currency', 'byCurrency'],
                    properties: {
                      count: { type: 'integer', minimum: 0 },
                      totalAmountMinor: { type: ['integer', 'null'], description: '通貨の最小単位。複数通貨または金額不明ならnull。' },
                      currency: { type: ['string', 'null'] },
                      byCurrency: { type: 'array', items: {
                        type: 'object', required: ['currency', 'count', 'totalAmountMinor'],
                        properties: {
                          currency: { type: 'string' }, count: { type: 'integer', minimum: 0 },
                          totalAmountMinor: { type: ['integer', 'null'] },
                        },
                      } },
                    },
                  },
                },
              },
            },
          } } },
        },
        '401': { description: '認証が必要' },
        '404': { description: '友だちが見つからない、または閲覧範囲外' },
        '500': { description: '集計を取得できない' },
      },
    },
  },
  '/api/friends/{id}/upcoming': {
    get: {
      tags: ['Friends'],
      summary: '友だちの次回予約と次の確定した自動配信を取得（受信箱の顧客情報用・IDEA-02）',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': { description: 'Earliest confirmed booking and automated delivery; per-source error flags distinguish fetch failure from none scheduled' },
        '404': { description: 'Friend not found in account scope' },
      },
    },
  },
  '/api/friends/{id}/tags': {
    post: {
      tags: ['Friends'],
      summary: '友だちにタグ追加',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { tagId: { type: 'string' } }, required: ['tagId'] } } } },
      responses: { '201': { description: 'Tag added' } },
    },
  },
  '/api/friends/{id}/tags/{tagId}': {
    delete: {
      tags: ['Friends'],
      summary: '友だちからタグ削除',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'tagId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'Tag removed' } },
    },
  },
};
