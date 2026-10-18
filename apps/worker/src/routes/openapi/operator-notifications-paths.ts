// Definitions only. Runtime handlers remain in their feature routes.
export const operatorNotificationsPaths = {
  // ── Operator notifications ──────────────────────────────────────────────
  '/api/notifications/operator-event-types': {
    get: {
      tags: ['Operator notifications'],
      summary: '運用者通知が自動発火できるきっかけ一覧',
      description: '公開済みルールが反応できる業務イベントと、実producerへの接続状況を返す。connected=false は未接続で、そのきっかけでは自動発火しない。',
      parameters: [
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'きっかけ一覧（items[].connected と publishedRules、summary の接続済み・未接続件数）' },
        '400': { description: 'lineAccountId が無い' },
        '403': { description: 'このLINEアカウントを表示する権限がない' },
      },
    },
  },
  '/api/notifications/operator-outbox/sweep': {
    post: {
      tags: ['Operator notifications'],
      summary: '送り残した運用者通知の回収と再送',
      description: 'Worker中断や一時失敗で pending / retry_wait のまま残った送達を拾い直して送る。冪等キーで取るため同時実行でも二重送信しない。',
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                lineAccountId: { type: 'string', description: '省略時は権限内の全アカウントを対象にする' },
                limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: '回収結果（swept, accepted, excluded, failed, pending）' },
        '403': { description: 'このLINEアカウントを変更する権限がない' },
      },
    },
  },
  // ── LINE通知（機能24の正本API。/api/notifications 配下は互換用） ──────────
  '/api/line-notifications/operator-rules': {
    get: {
      tags: ['Operator notifications'],
      summary: '運用者へのお知らせルール一覧',
      description: '選択中LINEアカウントの運用者通知ルールと、本日の発生・受理・対象外の集計を返す。',
      parameters: [
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'ルール一覧（items と summary）' },
        '400': { description: 'lineAccountId が無い' },
        '403': { description: 'このLINEアカウントを表示する権限がない' },
      },
    },
    post: {
      tags: ['Operator notifications'],
      summary: '運用者へのお知らせルールを作る',
      description: '下書きとしてルールを1件作る。公開は publish で行う。',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['lineAccountId', 'name', 'eventType'],
              properties: {
                lineAccountId: { type: 'string' },
                name: { type: 'string' },
                eventType: { type: 'string' },
                conditions: { type: 'object' },
                channels: { type: 'array', items: { type: 'string', enum: ['dashboard', 'email', 'line'] } },
              },
            },
          },
        },
      },
      responses: {
        '201': { description: '作成したルール' },
        '400': { description: '必須項目または通知方法の指定が不正' },
        '403': { description: 'このLINEアカウントを変更する権限がない' },
      },
    },
  },
  '/api/line-notifications/operator-rules/{id}': {
    get: {
      tags: ['Operator notifications'],
      summary: '運用者へのお知らせルール1件',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'ルール1件' },
        '400': { description: 'lineAccountId が無い' },
        '403': { description: 'このLINEアカウントを表示する権限がない' },
        '404': { description: 'お知らせが見つからない' },
      },
    },
  },
  '/api/line-notifications/operator-rules/{id}/draft': {
    patch: {
      tags: ['Operator notifications'],
      summary: '運用者へのお知らせルールの下書きを保存',
      description: '名前・きっかけ・条件・通知方法を保存する。公開・停止は publish / stop で行い、isActive は受け付けない。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['lineAccountId', 'expectedVersion'],
              properties: {
                lineAccountId: { type: 'string' },
                expectedVersion: { type: 'integer', minimum: 1 },
                name: { type: 'string' },
                eventType: { type: 'string' },
                conditions: { type: 'object' },
                channels: { type: 'array', items: { type: 'string', enum: ['dashboard', 'email', 'line'] } },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: '保存したルール' },
        '400': { description: '必須項目または通知方法の指定が不正' },
        '403': { description: 'このLINEアカウントを変更する権限がない' },
        '404': { description: 'お知らせが見つからない' },
        '409': { description: 'isActive が指定された（公開・停止は別の操作で行う）、または読んだ版が古い（現在値を返して開き直しを案内する）' },
      },
    },
  },
  '/api/line-notifications/operator-rules/recipients-preview': {
    post: {
      tags: ['Operator notifications'],
      summary: '受け取る人の到達可否プレビュー',
      description: '作成前のルール向けに、指定した受け取る人と通知方法で実際に届くかを返す。',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['lineAccountId', 'channels'],
              properties: {
                lineAccountId: { type: 'string' },
                recipientIds: { type: 'array', items: { type: 'string' } },
                channels: { type: 'array', items: { type: 'string', enum: ['dashboard', 'email', 'line'] } },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: '受け取る人ごとの到達可否と集計' },
        '400': { description: '必須項目の指定が不正' },
        '403': { description: 'このLINEアカウントを表示する権限がない' },
      },
    },
  },
  '/api/line-notifications/operator-rules/{id}/recipients-preview': {
    post: {
      tags: ['Operator notifications'],
      summary: 'ルールの受け取る人到達可否プレビュー',
      description: '保存済みルールの受け取る人・通知方法を既定にプレビューする。本文で上書きもできる。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['lineAccountId'],
              properties: {
                lineAccountId: { type: 'string' },
                recipientIds: { type: 'array', items: { type: 'string' } },
                channels: { type: 'array', items: { type: 'string', enum: ['dashboard', 'email', 'line'] } },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: '受け取る人ごとの到達可否と集計' },
        '400': { description: '必須項目または通知方法の指定が不正' },
        '403': { description: 'このLINEアカウントを表示する権限がない' },
        '404': { description: 'お知らせが見つからない' },
      },
    },
  },
  '/api/line-notifications/operator-rules/{id}/publish': {
    post: {
      tags: ['Operator notifications'],
      summary: '運用者へのお知らせを公開',
      description: 'きっかけが実際に接続されていて、受け取れる人が1人以上いるときだけ公開できる。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['lineAccountId'],
              properties: { lineAccountId: { type: 'string' } },
            },
          },
        },
      },
      responses: {
        '200': { description: '公開したルール' },
        '400': { description: 'lineAccountId が無い' },
        '403': { description: 'このLINEアカウントを変更する権限がない' },
        '404': { description: 'お知らせが見つからない' },
        '409': { description: 'きっかけ未接続・受け取る人なし等で公開できない' },
      },
    },
  },
  '/api/line-notifications/operator-rules/{id}/stop': {
    post: {
      tags: ['Operator notifications'],
      summary: '運用者へのお知らせを停止',
      description: '新規受付を止める。送信中のものは取り消さない。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['lineAccountId'],
              properties: { lineAccountId: { type: 'string' } },
            },
          },
        },
      },
      responses: {
        '200': { description: '停止したルール' },
        '400': { description: 'lineAccountId が無い' },
        '403': { description: 'このLINEアカウントを変更する権限がない' },
        '404': { description: 'お知らせが見つからない' },
      },
    },
  },
  '/api/line-notifications/operator-rules/{id}/test': {
    post: {
      tags: ['Operator notifications'],
      summary: '運用者へのお知らせのテスト送信',
      description: '操作した本人だけを受け取る人にして試行送信する。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['lineAccountId'],
              properties: {
                lineAccountId: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: 'テスト送信の結果' },
        '400': { description: 'lineAccountId が無い' },
        '403': { description: 'このLINEアカウントを変更する権限がない' },
        '404': { description: 'お知らせが見つからない' },
        '409': { description: '自分の受信設定が無い' },
      },
    },
  },
  '/api/line-notifications/operator-event-types': {
    get: {
      tags: ['Operator notifications'],
      summary: '運用者通知が自動発火できるきっかけ一覧',
      description: '/api/notifications/operator-event-types と同じ。要件の正本名。',
      parameters: [
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'きっかけ一覧（items[].connected と publishedRules、summary の接続済み・未接続件数）' },
        '400': { description: 'lineAccountId が無い' },
        '403': { description: 'このLINEアカウントを表示する権限がない' },
      },
    },
  },
  '/api/line-notifications/operator-events': {
    post: {
      tags: ['Operator notifications'],
      summary: '運用者通知イベントの手動発火',
      description: '登録簿にあるきっかけを1件発火し、公開済みルールへ送る。',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['lineAccountId', 'eventType', 'sourceEventId'],
              properties: {
                lineAccountId: { type: 'string' },
                eventType: { type: 'string' },
                sourceEventId: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: '発火したルールの結果一覧' },
        '400': { description: '必須項目が無い・きっかけが登録簿に無い' },
        '403': { description: 'このLINEアカウントを変更する権限がない' },
      },
    },
  },
  '/api/line-notifications/operator-outbox/sweep': {
    post: {
      tags: ['Operator notifications'],
      summary: '送り残した運用者通知の回収と再送',
      description: '/api/notifications/operator-outbox/sweep と同じ。要件の正本名。',
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                lineAccountId: { type: 'string', description: '省略時は権限内の全アカウントを対象にする' },
                limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: '回収結果（swept, accepted, excluded, failed, pending）' },
        '403': { description: 'このLINEアカウントを変更する権限がない' },
      },
    },
  },
  '/api/line-notifications/operator-deliveries.csv': {
    get: {
      tags: ['Operator notifications'],
      summary: '運用者通知の実行記録CSV',
      description: 'アカウント内の運用者向け送達をCSVで書き出す。理由は必須で監査へ残る。',
      parameters: [
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'reason', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'CSV(text/csv; charset=utf-8、BOM付き)' },
        '400': { description: 'lineAccountId・reason が無い' },
        '403': { description: 'このLINEアカウントを出力する権限がない' },
      },
    },
  },
  '/api/line-notifications/deliveries/{id}': {
    get: {
      tags: ['Customer notifications'],
      summary: '顧客通知の送信記録1件',
      description: '送信台帳の1件を一覧と同じ形で返す。アカウント境界の外側は404に倒す。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '送信記録1件' },
        '400': { description: 'lineAccountId が無い' },
        '403': { description: 'このLINEアカウントを表示する権限がない' },
        '404': { description: '送信記録が見つからない' },
      },
    },
  },
  '/api/line-notifications/quota': {
    get: {
      tags: ['Customer notifications'],
      summary: '顧客通知の送信枠',
      description: 'LINE公式の今月の送信枠（総量・使用・残り）を単体で返す。一覧の includeQuota=1 と同じ中身。',
      parameters: [
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '送信枠（available/unlimited/unavailable）' },
        '400': { description: 'lineAccountId が無い' },
        '403': { description: 'このLINEアカウントを表示する権限がない' },
      },
    },
  },
  '/api/line-notifications/send-counts': {
    get: {
      tags: ['Customer notifications'],
      summary: '顧客通知の送信件数（今日・この30日）',
      description: '共通送信台帳の受け付け済みをJSTの今日・今日を含む30日で数える。ECの取り込み件数でもLINE集計の全期間合計でもない。試し送りは除く。',
      parameters: [
        { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '送信件数（合計・出来事の種類別・期間）' },
        '400': { description: 'lineAccountId が無い' },
        '403': { description: 'このLINEアカウントを表示する権限がない' },
      },
    },
  },
  '/api/line-notifications/deliveries/{id}/resend': {
    post: {
      tags: ['Customer notifications'],
      summary: '顧客通知の新規再送',
      description: '送れなかった通知を新しい送信として送り直す。元の行は残し、新しい送達行・新しい冪等キーで送る。理由は必須で監査へ残る。店長だけが使える。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['lineAccountId', 'expectedVersion', 'reason'],
              properties: {
                lineAccountId: { type: 'string' },
                expectedVersion: { type: 'integer' },
                reason: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: '新しい送信の記録' },
        '400': { description: 'lineAccountId・expectedVersion・reason が無い' },
        '403': { description: '店長だけが使える' },
        '404': { description: '送信記録が見つからない' },
        '409': { description: '送り直せない状態・版競合・送信枠不足' },
      },
    },
  },
  '/api/line-notifications/customer-definitions/{id}/test': {
    post: {
      tags: ['Customer notifications'],
      summary: '顧客のお知らせの試し送り',
      description: '編集中の下書き文面を指定した友だち（1〜5人）だけに試し送りする。先頭に確認用の断りを付けて送り、記録は test 扱いで再試行しない。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['lineAccountId', 'friendIds'],
              properties: {
                lineAccountId: { type: 'string' },
                friendIds: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: '宛先ごとの試し送り結果' },
        '400': { description: 'lineAccountId・friendIds が無い' },
        '403': { description: 'このLINEアカウントを変更する権限がない' },
        '404': { description: 'お知らせ・受け取れる友だちが見つからない' },
        '409': { description: '文面未設定・送信枠不足' },
      },
    },
  },
};
