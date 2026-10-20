// Definitions only. Runtime handlers remain in their feature routes.
export const webhooksPaths = {
  // ── Webhooks (外部連携) ──────────────────────────────────────────────────
  '/api/webhooks/outgoing/{id}': {
    get: {
      tags: ['Webhook'],
      summary: '送信Webhookの詳細',
      description: '編集画面が現在値を読むための口(#939 N-363)。secret は返さない。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: '詳細' }, '404': { description: 'Not found' } },
    },
  },
  '/api/webhooks/incoming/{id}/restore': {
    post: {
      tags: ['Webhook'],
      summary: '削除した受信Webhookを元に戻す（戻した直後は停止のまま）',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'Incoming webhook restored as stopped' }, '400': { description: 'LINE account is required' }, '403': { description: 'Owner role required' }, '404': { description: 'Webhook not found or not deleted' } },
    },
  },
  '/api/webhooks/outgoing/{id}/restore': {
    post: {
      tags: ['Webhook'],
      summary: '削除した送信Webhookを元に戻す（戻した直後は停止のまま）',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'Outgoing webhook restored as stopped' }, '400': { description: 'LINE account is required' }, '403': { description: 'Owner role required' }, '404': { description: 'Webhook not found or not deleted' } },
    },
  },
  '/api/webhooks/incoming/{id}/test': {
    post: {
      tags: ['Webhook'],
      summary: '受信Webhookの受け取りの試し',
      description: '見本のJSONを人の照合と行動の組み立てまで試し、結果を返す(S #939 機能26)。'
        + '届物の受領・行動の実行・箱への記録は行わない。結果はやり取り台帳へ test 種別で分けて残す。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['payload'],
              properties: { payload: { description: '届いたつもりのJSON' } },
            },
          },
        },
      },
      responses: {
        '200': { description: '照合結果と行動の組み立て結果' },
        '400': { description: 'Invalid request' },
        '404': { description: 'Not found' },
      },
    },
  },
  '/api/webhooks/incoming/{id}/unmatched': {
    get: {
      tags: ['Webhook'],
      summary: '人が見つからなかった・複数一致で保留した届物の一覧',
      description: '受信Webhookの「未照合時の扱い」で unmatched_box / create_candidate を選んだ口と、'
        + '同じ値の友だちが2人以上いて保留した届物の一覧(S #939 機能26)。'
        + '照合に使った値と形だけの見本・複数一致の候補を返し、生の本文は返さない。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['pending', 'resolved', 'dismissed'] } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } },
        { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0 } },
      ],
      responses: { '200': { description: '一覧（total に同条件の総数を返す）' }, '404': { description: 'Not found' } },
    },
  },
  '/api/webhooks/unmatched/{id}/resolve': {
    post: {
      tags: ['Webhook'],
      summary: '未照合の届物を閉じる',
      description: 'dismiss で何もせず閉じる、link で既存の友だちへ結び付けて閉じる(#939 N-367)。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['action'],
              properties: {
                action: { type: 'string', enum: ['dismiss', 'link'] },
                friendId: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: '閉じた' },
        '400': { description: 'Invalid request' },
        '404': { description: 'Not found' },
        '409': { description: 'すでに処理済み' },
      },
    },
  },
  '/api/webhooks/api-tokens': {
    get: {
      tags: ['Webhook'],
      summary: '公開APIトークンの一覧',
      description: '外部システムが /api/public/v1/* を呼ぶための合言葉の台帳(#939 N-380)。'
        + 'hash・平文は返さず、失効済みは除く。',
      parameters: [
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: '一覧' } },
    },
    post: {
      tags: ['Webhook'],
      summary: '公開APIトークンの発行',
      description: '平文のトークンはこの応答に1回だけ返す。台帳には SHA-256 hash だけを残す(#939 N-380)。',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['lineAccountId', 'name', 'scopes'],
              properties: {
                lineAccountId: { type: 'string' },
                name: { type: 'string', minLength: 1, maxLength: 120 },
                scopes: { type: 'array', items: { type: 'string', enum: ['tags:read', 'tags:write'] } },
              },
            },
          },
        },
      },
      responses: {
        '201': { description: '発行した。data.token に平文が1回だけ入る' },
        '400': { description: 'Invalid request' },
        '403': { description: 'Forbidden' },
      },
    },
  },
  '/api/webhooks/api-tokens/{id}/revoke': {
    post: {
      tags: ['Webhook'],
      summary: '公開APIトークンの失効',
      description: '行は消さず revoked_at に時刻を残す。失効したトークンは即座に使えなくなる(#939 N-380)。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: '失効した' }, '404': { description: 'Not found' } },
    },
  },
  '/api/webhooks/interactions/{id}/payload': {
    get: {
      tags: ['Webhook'],
      summary: 'やり取りの本文（伏せて返す）',
      description: '送った・受け取った本文を伏せて返す(F-18)。'
        + '名前・電話・メール・住所・トークンに当たる値は `***` に置き換える。'
        + 'JSON でない・空の本文は body に null を返す。元やDBは変えない。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '伏せた本文' },
        '404': { description: 'Not found' },
      },
    },
  },
  '/api/webhooks/api-tokens/{id}/reactivate': {
    post: {
      tags: ['Webhook'],
      summary: '止めた公開APIトークンを動かし直す',
      description: '止めている行だけが対象。平文は保存していないが hash が残っているため、'
        + '止める前の合言葉がそのまま使えるようになる（新しい発行はしない）。'
        + '止めた人（revoked_by）は履歴として残し、動かし直しは監査記録へ残す(F-17)。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '動かし直した。止める前の合言葉が使える' },
        '404': { description: 'Not found' },
        '409': { description: '止められていない' },
      },
    },
  },
  '/api/webhooks/api-tokens/{id}/rotate': {
    post: {
      tags: ['Webhook'],
      summary: '公開APIトークンの再発行',
      description: '旧トークンを即座に失効させ、同じ名前・範囲の新しいトークンを発行する(#939 N-380)。'
        + '新しい平文はこの応答に1回だけ返す。'
        + '同じ旧IDへの同時再発行は1本だけ成功し、負けた側は409 TOKEN_ROTATE_CONFLICT'
        + '（新トークンなし・現在の一覧付き）で返す。失効が先に確定した後の再発行も作らない。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '再発行した。data.token に新しい平文が1回だけ入る' },
        '404': { description: 'Not found' },
        '409': { description: '同時再発行に負けた。data を見ず一覧を読み直す' },
      },
    },
  },
  '/api/public/v1/tags': {
    get: {
      tags: ['Webhook'],
      summary: 'タグ一覧（公開API）',
      description: '外部システム向け公開API(#939 N-380)。管理画面の認証境界の外にあるため'
        + ' security は空。route が `Authorization: Bearer lhp_…` の公開APIトークンを'
        + '自分で照合し、scope tags:read が必要。トークンのアカウントのタグと'
        + '共通タグだけを返す。外部連携を止めている間も読み取りは使える'
        + '（書き込みの POST は 403 FEATURE_DISABLED で止まる）。',
      security: [],
      responses: {
        '200': { description: 'タグ一覧' },
        '401': { description: 'トークンが無いか無効' },
        '403': { description: 'scope 不足' },
      },
    },
  },
  '/api/public/v1/friends/{friendId}/tags': {
    post: {
      tags: ['Webhook'],
      summary: '友だちへのタグ付与（公開API）',
      description: '外部システム向け公開API(#939 N-380)。管理画面の認証境界の外にあるため'
        + ' security は空。route が `Authorization: Bearer lhp_…` の公開APIトークンを'
        + '自分で照合し、scope tags:write が必要。'
        + '友だちはトークンのアカウント所属、タグは同じアカウントか共通で、'
        + '手動付与が禁じられたタグは付けない。管理画面の付与と同じ効果を持つ。'
        + '書き込みは外部連携が有効なアカウントだけが使える。止めている間は'
        + '403 FEATURE_DISABLED でタグは増えない（読み取りの GET tags は棚卸しのため使える）。'
        + '始まるシナリオは友だちと同じアカウント・全体共通の公開済みだけ。'
        + '同じ要求の再送は不足の購読だけを一度完成させ、二重には作らない。'
        + 'タグ変化の出来事は発生元の不変ID付きで公開版オートメーションへ渡す。',
      security: [],
      parameters: [{ name: 'friendId', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['tagId'],
              properties: { tagId: { type: 'string' } },
            },
          },
        },
      },
      responses: {
        '200': { description: 'すでに付いていた（不足の購読があれば今回完成させた）' },
        '201': { description: '付けた' },
        '400': { description: 'Invalid request' },
        '401': { description: 'トークンが無いか無効' },
        '403': { description: 'scope 不足または外部連携がオフ' },
        '404': { description: 'Not found' },
      },
    },
  },
  // ── Webhooks (保守) ──────────────────────────────────────────────────────
  '/api/webhooks/maintenance/secret-backfill': {
    post: {
      tags: ['Webhook'],
      summary: 'Webhook secret の暗号化移行',
      description: '旧平文・旧鍵のWebhook secretを現行鍵へ寄せ直す(#650)。dryRunは件数だけ数えて書かない。'
        + 'べき等なので中断したら同じ条件で呼び直せば残りが進む。秘密値は要求にも応答にも含めない。',
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                lineAccountId: { type: 'string' },
                dryRun: { type: 'boolean', default: true },
                batchSize: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
              },
              required: ['lineAccountId'],
            },
          },
        },
      },
      responses: {
        '200': { description: '件数と成否だけの報告' },
        '400': { description: 'Invalid request' },
        '403': { description: 'Forbidden' },
        '503': { description: '鍵がないため移行できない' },
      },
    },
  },
};
