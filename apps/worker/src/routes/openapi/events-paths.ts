// Definitions only. Runtime handlers remain in their feature routes.
export const eventsPaths = {
  // ── Event applicant operations ─────────────────────────────────────────
  '/api/events/admin/events/{id}/occurrence-selector': {
    get: {
      tags: ['Events'],
      summary: '申込者画面用の開催回選択肢を取得',
      description: '予約件数・集計を含めず、指定LINEアカウントに属する有効な開催回だけを返す。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '開催回のID、日時、定員、並び順' },
        '400': { description: 'account_id が無い' },
        '403': { description: 'イベント閲覧権限が無い' },
        '404': { description: 'イベントが無い、またはアカウント範囲外' },
      },
    },
  },
  '/api/events/admin/occurrences/{id}/applicants.csv': {
    get: {
      tags: ['Events'],
      summary: '表示時に固定した開催回申込者をCSVで書き出す',
      description: 'snapshot_id は申込者画面の取得時に発行される短期ID。後から申込・取消があっても、同じ表示対象だけを書き出す。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'snapshot_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'UTF-8 BOM付きCSV', content: { 'text/csv': { schema: { type: 'string' } } } },
        '400': { description: 'account_id が無い' },
        '403': { description: 'イベント閲覧権限が無い' },
        '404': { description: '開催回またはsnapshotがアカウント範囲外' },
        '409': { description: 'snapshotの内容が不正' },
        '410': { description: 'snapshotの期限切れ' },
        '422': { description: 'snapshot_id が無い' },
      },
    },
  },
  '/api/events/admin/occurrences/{id}/applicant-broadcasts/preview': {
    post: {
      tags: ['Events'],
      summary: '固定済みの開催回申込者を一斉案内の下書きへ保存',
      description: '同じIdempotency-Keyと同じ内容は、後から申込者が変わっても固定済み宛先を再生する。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', required: ['title', 'messageContent', 'snapshotId'],
        properties: {
          title: { type: 'string', minLength: 1 },
          messageContent: { type: 'string', minLength: 1, maxLength: 5000 },
          snapshotId: { type: 'string' },
        },
      } } } },
      responses: {
        '200': { description: '同じ冪等キーの下書きを再生', headers: { 'Idempotency-Replayed': { schema: { type: 'boolean' } } } },
        '201': { description: '送信前確認用の下書きを作成' },
        '400': { description: 'アカウント、冪等キー、または本文が不正' },
        '403': { description: 'owner/admin権限が無い' },
        '404': { description: '開催回またはsnapshotがアカウント範囲外' },
        '409': { description: '冪等キーが別内容に使われた、またはsnapshotが不正' },
        '410': { description: 'snapshotの期限切れ' },
        '422': { description: 'snapshotId が無い' },
      },
    },
  },
  // ── Event lifecycle and change review ─────────────────────────────────
  '/api/events/admin/events/{id}/lifecycle': {
    post: {
      tags: ['Events'],
      summary: 'イベントの状態を切り替える',
      description: '下書き・公開中・一時停止・終了・中止を切り替える。一時停止と中止は理由が必須。公開可否へ両書きする。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', required: ['to'],
        properties: {
          to: { type: 'string', enum: ['draft', 'published', 'paused', 'ended', 'cancelled'] },
          reason: { type: 'string' },
          idempotency_key: { type: 'string' },
        },
      } } } },
      responses: {
        '200': { description: '切り替え後の状態と版' },
        '400': { description: 'account_id が無い' },
        '403': { description: 'owner/admin権限が無い、またはアカウント範囲外' },
        '404': { description: 'イベントが無い、またはアカウント範囲外' },
        '409': { description: '許さない遷移、または版の食い違い' },
        '422': { description: '状態または理由が不正' },
      },
    },
  },
  '/api/events/admin/events/{id}/change-review': {
    post: {
      tags: ['Events'],
      summary: '日時・定員・会場の変更前に影響を確かめる',
      description: '読み取り専用の事前表示。影響人数と止める理由を返す。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', required: ['slot_changes'],
        properties: {
          slot_changes: { type: 'array', items: { type: 'object', required: ['slot_id'], properties: {
            slot_id: { type: 'string' },
            starts_at: { type: 'string' },
            ends_at: { type: 'string' },
            capacity: { type: 'integer', minimum: 1 },
            is_active: { type: 'integer', enum: [0, 1] },
          } } },
          event_changes: { type: 'object', properties: {
            venue_name: { type: 'string' },
            venue_url: { type: 'string' },
          } },
        },
      } } } },
      responses: {
        '200': { description: '影響人数と止める理由の事前表示' },
        '400': { description: 'account_id が無い' },
        '403': { description: 'owner/admin権限が無い' },
        '404': { description: 'イベントが無い、またはアカウント範囲外' },
        '422': { description: 'slot_changes が不正' },
      },
    },
  },
  '/api/events/admin/events/{id}/change-review/apply': {
    post: {
      tags: ['Events'],
      summary: '確かめた変更を版の一致で適用する',
      description: '版の一致で直列化し、二重実行は冪等キーで吸収する。日時・会場が動いた回の確定申込へは届く範囲でLINE通知する。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', required: ['expected_version', 'idempotency_key', 'slot_changes'],
        properties: {
          expected_version: { type: 'integer', minimum: 1 },
          idempotency_key: { type: 'string', minLength: 1 },
          change_reason: { type: 'string' },
          slot_changes: { type: 'array', items: { type: 'object', required: ['slot_id'], properties: {
            slot_id: { type: 'string' },
            starts_at: { type: 'string' },
            ends_at: { type: 'string' },
            capacity: { type: 'integer', minimum: 1 },
            is_active: { type: 'integer', enum: [0, 1] },
          } } },
          event_changes: { type: 'object', properties: {
            venue_name: { type: 'string' },
            venue_url: { type: 'string' },
          } },
        },
      } } } },
      responses: {
        '200': { description: '適用済み（同じ冪等キーの再実行を含む）' },
        '400': { description: 'account_id または冪等キーが無い' },
        '403': { description: 'owner/admin権限が無い' },
        '404': { description: 'イベントが無い、またはアカウント範囲外' },
        '409': { description: '版の食い違い' },
        '422': { description: '版・変更内容が不正' },
      },
    },
  },
  '/api/events/admin/occurrences/{id}/waitlist/reorder': {
    post: {
      tags: ['Events'],
      summary: '待ち順を手で並べ直す',
      description: '枠の待ち全件の並べ直しで受ける。理由が必須。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', required: ['reason', 'ordered_ids'],
        properties: {
          reason: { type: 'string', minLength: 1 },
          ordered_ids: { type: 'array', items: { type: 'string' } },
          expected_version: { type: 'integer', minimum: 1 },
        },
      } } } },
      responses: {
        '200': { description: '並べ直し後の順番と開催回の版' },
        '400': { description: 'account_id が無い' },
        '403': { description: 'owner/admin/staff権限が無い' },
        '404': { description: '開催回が無い、またはアカウント範囲外' },
        '409': { description: '版の食い違い' },
        '422': { description: '理由または ordered_ids が不正' },
      },
    },
  },
  '/api/events/admin/occurrences/{id}/waitlist/skip': {
    post: {
      tags: ['Events'],
      summary: '待ちの案内を今回見送り最後尾へ回す',
      description: '飛ばし。行は消さない。理由が必須。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', required: ['reason', 'waitlist_id'],
        properties: {
          reason: { type: 'string', minLength: 1 },
          waitlist_id: { type: 'string', minLength: 1 },
          expected_version: { type: 'integer', minimum: 1 },
        },
      } } } },
      responses: {
        '200': { description: '最後尾へ回した待ちと開催回の版' },
        '400': { description: 'account_id が無い' },
        '403': { description: 'owner/admin/staff権限が無い' },
        '404': { description: '開催回または待ちが無い、アカウント範囲外' },
        '409': { description: '版の食い違い' },
        '422': { description: '理由または waitlist_id が不正' },
      },
    },
  },
  '/api/events/liff/bookings/{id}/change': {
    post: {
      tags: ['Events'],
      summary: '本人が予約を別の開催回へ移す',
      description: '新しい席を確保できた時だけ元の申込を取り消す、まとめて1つの操作。確保に失敗したら旧予約を維持する。券の利用記録は移し、再消費しない。予約の版と各段の記録を残す。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', required: ['to_slot_id'],
        properties: {
          to_slot_id: { type: 'string', minLength: 1 },
        },
      } } } },
      responses: {
        '200': { description: '移し先の予約IDと状態（同じ冪等キーの再実行を含む）' },
        '400': { description: '本人確認・冪等キーが無い' },
        '401': { description: 'LINE本人確認に失敗' },
        '403': { description: '変更締切を過ぎたなど変更できない' },
        '404': { description: '予約が無い、または本人・アカウント範囲外' },
        '409': { description: '満席・締切・上限などにより移動できない' },
        '410': { description: '移し先の開催回が始まった、または受付終了' },
        '422': { description: '移し先の指定が不正' },
      },
    },
  },
  // ── Event waitlist ────────────────────────────────────────────────────
  '/api/liff/events/waitlist/{token}': {
    get: {
      tags: ['Events'],
      summary: 'キャンセル待ちの繰上げ案内を本人が確認',
      description: '案内対象の本人だけに、イベント名・日時・会場・人数・回答期限と残り秒数・承諾できるかを返す。',
      security: [],
      parameters: [
        { name: 'token', in: 'path', required: true, schema: { type: 'string', minLength: 32, maxLength: 256 }, description: 'LINEで本人へ送った期限付き案内token' },
      ],
      responses: {
        '200': { description: '{ success・data: 案内の詳細 }' },
        '401': { description: 'LINE本人確認に失敗' },
        '404': { description: '案内なし、または案内対象と異なるLINEユーザー' },
      },
    },
  },
  '/api/liff/events/me/waitlist': {
    get: {
      tags: ['Events'],
      summary: '本人のイベントのキャンセル待ちを一覧',
      description: '本人の待ちを、自分のイベントの行と同じ項目に source=waitlist と待機中の順番（queue_position）を足して返す。',
      security: [],
      parameters: [{ name: 'liffId', in: 'query', required: true, schema: { type: 'string' }, description: 'LIFF ID。LINEアカウントの解決に使う' }],
      responses: {
        '200': { description: '{ items: 待ちの行 }' },
        '400': { description: 'LIFF IDからLINEアカウントを解決できない' },
        '401': { description: 'LINE本人確認に失敗' },
      },
    },
  },
  '/api/liff/events/me/waitlist/{waitlistId}': {
    get: {
      tags: ['Events'],
      summary: '本人のイベントのキャンセル待ちを1件取得',
      security: [],
      parameters: [{ name: 'waitlistId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'liffId', in: 'query', required: true, schema: { type: 'string' }, description: 'LIFF ID。LINEアカウントの解決に使う' }],
      responses: {
        '200': { description: '待ちの行（順番付き）' },
        '400': { description: 'LIFF IDからLINEアカウントを解決できない' },
        '401': { description: 'LINE本人確認に失敗' },
        '404': { description: '待ちが無い、または本人・アカウント範囲外' },
      },
    },
  },
  '/api/liff/events/me/waitlist/{waitlistId}/cancel': {
    post: {
      tags: ['Events'],
      summary: '本人がイベントのキャンセル待ちを取り下げる',
      security: [],
      parameters: [{ name: 'waitlistId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'liffId', in: 'query', required: true, schema: { type: 'string' }, description: 'LIFF ID。LINEアカウントの解決に使う' }],
      responses: {
        '200': { description: '{ ok: true }' },
        '400': { description: 'LIFF IDからLINEアカウントを解決できない' },
        '401': { description: 'LINE本人確認に失敗' },
        '404': { description: '待ちが無い、または本人・アカウント範囲外' },
        '409': { description: '予約化済みなど取り下げできない状態' },
      },
    },
  },
  '/api/liff/webinars/{slug}/audience': {
    get: {
      tags: ['Webinars'],
      summary: 'ウェビナーの配信中の視聴人数を本人が取得',
      description: '既存の視聴状態の返しとは別に、人数の更新だけに使う。LINE本人確認とウェビナー機能の有効判定を通す。配信中でない・登録の無い回は live=false・viewerCount=null。',
      parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': { description: '{ live・sessionStartAt・viewerCount・activeWindowSeconds・lecturerName }' },
        '401': { description: 'LINE本人確認に失敗' },
        '403': { description: 'このアカウントの友だちではない' },
        '404': { description: 'ウェビナーが無い、または公開期間外' },
      },
    },
  },
  '/api/liff/events/waitlist/{token}/accept': {
    post: {
      tags: ['Events'],
      summary: 'キャンセル待ちの繰上げ案内を本人が承諾',
      security: [],
      parameters: [
        {
          name: 'token',
          in: 'path',
          required: true,
          schema: { type: 'string', minLength: 32, maxLength: 256 },
          description: 'LINEで本人へ送った期限付き案内token',
        },
      ],
      responses: {
        '200': { description: '確定予約へ変換済み（同じ案内の再実行を含む）' },
        '401': { description: 'LINE本人確認に失敗' },
        '404': { description: '案内なし、または案内対象と異なるLINEユーザー' },
        '409': { description: '満席・本人上限などにより確定不能' },
        '410': { description: '回答期限切れ' },
      },
    },
  },
};
