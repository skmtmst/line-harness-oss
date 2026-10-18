// Definitions only. Runtime handlers remain in their feature routes.
export const analyticsDashboardPaths = {
  // ── Analytics ──────────────────────────────────────────────────────────
  '/api/analytics/report-schedules/{id}': {
    put: {
      tags: ['Analytics'], summary: '定期レポートの内容を更新（楽観ロック: expectedUpdatedAt 必須、1回限りの依頼は不可）',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expectedUpdatedAt'], properties: { expectedUpdatedAt: { type: 'string' }, name: { type: 'string' }, cadence: { type: 'string', enum: ['weekly', 'monthly'] }, weekday: { type: 'integer', minimum: 0, maximum: 6 }, monthDay: { type: 'integer', minimum: 1, maximum: 31 }, sendTime: { type: 'string' }, timeZone: { type: 'string' }, channels: { type: 'array', items: { type: 'string' } }, savedAnalysisIds: { type: 'array', items: { type: 'string' } }, recipients: { type: 'array', items: { type: 'object' } } } } } } },
      responses: { '200': { description: 'Updated report schedule' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' }, '409': { description: 'Updated elsewhere first' }, '422': { description: 'Validation failed' } },
    },
  },
  '/api/analytics/report-schedules/{id}/status': {
    put: {
      tags: ['Analytics'], summary: '定期レポートの停止・再開・しまう（楽観ロック: expectedUpdatedAt 必須。再開は次回を未来へ置き直す）',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status', 'expectedUpdatedAt'], properties: { status: { type: 'string', enum: ['paused', 'active', 'archived'] }, expectedUpdatedAt: { type: 'string' } } } } } },
      responses: { '200': { description: 'Updated report schedule' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' }, '409': { description: 'Updated elsewhere first' }, '422': { description: 'Validation failed' } },
    },
  },
  '/api/analytics/funnels/{id}': {
    get: {
      tags: ['Analytics'], summary: 'ファネル1件と現在版の全定義（編集画面の読み込み用）',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'Funnel with current version' }, '404': { description: 'Not found' } },
    },
  },
  '/api/analytics/funnels/{id}/status': {
    put: {
      tags: ['Analytics'], summary: 'ファネルの停止・再開・保管（expectedStatus 必須。保管は終端で復帰不可）',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status', 'expectedStatus'], properties: { status: { type: 'string', enum: ['active', 'stopped', 'archived'] }, expectedStatus: { type: 'string', enum: ['active', 'stopped', 'archived'] } } } } } },
      responses: { '200': { description: 'Updated funnel' }, '403': { description: 'Owner or admin role required' }, '404': { description: 'Not found' }, '409': { description: 'Status changed elsewhere first' }, '422': { description: 'Invalid status or transition' } },
    },
  },
  '/api/analytics/audiences/{id}': {
    get: {
      tags: ['Analytics'], summary: '分析の一時対象者の詳細（配信作成の読み直し用。友だちIDは返さない）',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'Audience detail' }, '404': { description: 'Not found' }, '410': { description: 'Audience expired (24h)' } },
    },
  },
  '/api/analytics/exports': {
    post: {
      tags: ['Analytics'], summary: '分析CSVの非同期書き出し（画面内のCSVと同じ中身）',
      description: '書き出し対象（配信の反応・URLクリック・クロス・ファネル・保存した分析）を選び、画面のCSVと同じ列で書き出す。202で書き出しIDを返し、状態確認・ダウンロードと進める。統括・管理者だけが使える。',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['accountId', 'target'],
              properties: {
                accountId: { type: 'string' },
                target: { type: 'string', enum: ['reactions', 'url-clicks', 'cross', 'funnel', 'saved'] },
                params: {
                  type: 'object',
                  properties: {
                    from: { type: 'string' }, to: { type: 'string' }, query: { type: 'string' },
                    resultId: { type: 'string' }, funnelId: { type: 'string' }, groupKey: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        '202': { description: '書き出しID（非同期）' },
        '400': { description: 'accountId・target が無い' },
        '403': { description: '統括・管理者だけが使える' },
        '404': { description: 'LINEアカウント・集計が見つからない' },
        '422': { description: '結果・ファネルの指定が無い' },
      },
    },
  },
  '/api/analytics/exports/{id}': {
    get: {
      tags: ['Analytics'], summary: '分析CSVの書き出し状態',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: '書き出しの状態' }, '400': { description: 'accountId が無い' }, '404': { description: 'Not found' } },
    },
  },
  '/api/analytics/exports/{id}/download': {
    get: {
      tags: ['Analytics'], summary: '分析CSVのダウンロード',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'accountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'CSV(text/csv; charset=utf-8、BOM付き)' },
        '404': { description: 'Not found' },
        '409': { description: 'まだダウンロードできない' },
        '410': { description: 'ダウンロード期限切れ' },
      },
    },
  },
  '/api/analytics/ref/{refCode}/orders': {
    get: {
      tags: ['Analytics'], summary: '流入経路(REF)から来た友だちの注文明細。経路別集計(ref-summaryのorderCount)と同じfirst-touch条件で返す（IDEA-18）',
      parameters: [
        { name: 'refCode', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'lineAccountId', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 50 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
      ],
      responses: { '200': { description: 'Orders attributed to the ref code with status summary' }, '403': { description: 'LINEアカウントの表示権限なし' } },
    },
  },
  // ── ダッシュボード: 今後の予定・数字の出どころ・印刷用PDF（L #824・M） ──
  '/api/dashboard/upcoming': {
    get: {
      tags: ['Dashboard'], summary: '今後の予定（予約配信・リマインダー・予約の7日分、読むだけ）',
      parameters: [
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'days', in: 'query', schema: { type: 'integer', default: 7, minimum: 1, maximum: 31 } },
      ],
      responses: { '200': { description: 'Upcoming items' }, '400': { description: 'LINEアカウント未指定' }, '404': { description: 'LINEアカウント範囲外' } },
    },
  },
  '/api/dashboard/activity': {
    get: {
      tags: ['Dashboard'], summary: '配信・予約・回答・友だち追加の最近の動きを新しい順に読む',
      description: '所有者・管理者・スタッフが閲覧できるLINEアカウントの記録だけを返す。試し回答は除く。',
      parameters: [
        { name: 'account_id', in: 'query', schema: { type: 'string' }, description: 'LINEアカウントID。accountIdとどちらか一方が必須。' },
        { name: 'accountId', in: 'query', schema: { type: 'string' }, description: 'account_idの別名。' },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 10, minimum: 1, maximum: 100 } },
      ],
      responses: {
        '200': {
          description: '最近の動きの一覧',
          content: { 'application/json': { schema: {
            type: 'object', required: ['success', 'data'],
            properties: {
              success: { const: true },
              data: {
                type: 'object', required: ['items'],
                properties: { items: { type: 'array', items: {
                  type: 'object', required: ['id', 'kind', 'summary', 'occurredAt', 'href'],
                  properties: {
                    id: { type: 'string' },
                    kind: { type: 'string', enum: ['broadcast_sent', 'booking_created', 'event_booking_created', 'form_submitted', 'friend_added'] },
                    summary: { type: 'string' }, occurredAt: { type: 'string' }, href: { type: 'string' },
                  },
                } } },
              },
            },
          } } },
        },
        '400': { description: 'アカウント未指定、または件数が1〜100の整数ではない' },
        '401': { description: '認証が必要' },
        '403': { description: '所有者・管理者・スタッフの権限が必要' },
        '404': { description: 'アカウントが見つからない、または閲覧範囲外' },
        '500': { description: '最近の動きを取得できない' },
      },
    },
  },
  '/api/dashboard/delivery-failure-origins': {
    get: {
      tags: ['Dashboard'], summary: '失敗の数を通知の送達台帳から出どころ別に数える（同じ失敗は1件・送り直し除外）',
      parameters: [
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'since', in: 'query', schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'Failure origins' }, '400': { description: '指定が正しくない' }, '404': { description: 'LINEアカウント範囲外' } },
    },
  },
  '/api/entry-routes/{id}/qr-pdf': {
    post: {
      tags: ['Dashboard'], summary: '印刷用PDFをサーバーで作る（止めた経路は出さない）',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { paper: { type: 'string', enum: ['A4', 'A5'], default: 'A4' } } } } } },
      responses: { '200': { description: 'A4 または A5 の店頭用PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } }, '400': { description: '用紙の指定が正しくない' }, '404': { description: '経路が見つからない、または閲覧範囲外' }, '409': { description: '経路またはクーポンが利用できない' } },
    },
  },
  '/api/entry-routes/{id}/qr-image': {
    post: {
      tags: ['Dashboard'], summary: '流入経路のQR画像を保存する',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
        format: { type: 'string', enum: ['png', 'svg'], default: 'png' },
        size: { type: 'string', enum: ['small', 'medium', 'large'], default: 'medium', description: '256・512・1024ピクセル' },
      } } } } },
      responses: { '200': { description: 'QR画像', content: { 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/svg+xml': { schema: { type: 'string', format: 'binary' } } } }, '400': { description: '形式または大きさが正しくない' }, '404': { description: '経路が見つからない、または閲覧範囲外' }, '409': { description: '経路は停止中' } },
    },
  },
  '/api/liff/entry-route-coupon': {
    post: {
      tags: ['LIFF'], summary: '流入経路のクーポンを本人として受け取る（同じ経路では1人1回）',
      security: [],
      description: '管理APIキーは使わず、店舗のLINE Login IDトークンで個別に本人確認する。',
      parameters: [{ name: 'Authorization', in: 'header', required: true, schema: { type: 'string' }, description: 'Bearer <LINE Login IDトークン>' }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } } } } } },
      responses: { '200': { description: '受け取ったクーポンと使用回数（再読込では同じ受取記録）' }, '400': { description: '経路の指定が正しくない' }, '401': { description: 'LINEの本人確認が必要' }, '404': { description: '経路または友だちが見つからない' }, '409': { description: 'クーポンが利用できない、または対象外' } },
    },
  },
  '/api/liff/entry-route-coupon/use': {
    post: {
      tags: ['LIFF'], summary: '本人が受け取ったクーポンの使用を記録する（再試行は同じ結果）',
      security: [],
      description: '管理APIキーは使わず、店舗のLINE Login IDトークンで個別に本人確認する。',
      parameters: [{ name: 'Authorization', in: 'header', required: true, schema: { type: 'string' }, description: 'Bearer <LINE Login IDトークン>' }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['receiptId', 'requestId'], properties: {
        receiptId: { type: 'string' }, requestId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
      } } } } },
      responses: { '200': { description: '使用を記録した結果（同じrequestIdは重複記録しない）' }, '400': { description: '受取記録または再試行の識別子が正しくない' }, '401': { description: 'LINEの本人確認が必要' }, '404': { description: '本人の受取記録が見つからない' }, '409': { description: '使用済み、期限切れ、またはクーポンが利用できない' } },
    },
  },
};
