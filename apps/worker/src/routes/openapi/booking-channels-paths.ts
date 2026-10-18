// Definitions only. Runtime handlers remain in their feature routes.
export const bookingChannelsPaths = {
  // ── Booking channels (V8-B) ──────────────────────────────────────────────
  '/api/booking/admin/channels': {
    get: {
      tags: ['Booking'],
      summary: '予約の受付経路・担当カレンダー接続・自動割り当ての状態を取得',
      description: '接続済みの担当カレンダーは今週分を読み、自社から書き出した予約を除いた外の予定件数と最終読込日時を返す（最終読込日時は保存する）。今日の件数は店舗の暦日、週は月曜開始。Cache-Control: no-store。',
      parameters: [{ name: 'account_id', in: 'query', required: true, schema: { type: 'string' } }],
      responses: {
        '200': {
          description: '受付経路ごとの今日の件数と担当ごとのカレンダー状態',
          content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', const: true }, data: {
            type: 'object',
            required: ['timeZone', 'todayFrom', 'todayTo', 'weekFrom', 'weekTo', 'staff', 'autoAssign', 'channels'],
            properties: {
              timeZone: { type: 'string' },
              todayFrom: { type: 'string', format: 'date-time' },
              todayTo: { type: 'string', format: 'date-time' },
              weekFrom: { type: 'string', format: 'date-time' },
              weekTo: { type: 'string', format: 'date-time' },
              autoAssign: { type: 'boolean' },
              staff: { type: 'array', items: { type: 'object', required: ['staffId', 'displayName', 'status', 'externalEventsThisWeek', 'lastReadAt', 'readError'], properties: {
                staffId: { type: 'string' },
                displayName: { type: 'string' },
                status: { type: 'string', enum: ['connected', 'disconnected', 'expired'] },
                externalEventsThisWeek: { type: ['integer', 'null'] },
                lastReadAt: { type: ['string', 'null'] },
                readError: { type: ['string', 'null'], enum: ['calendar_auth_expired', 'calendar_read_unavailable', null] },
              } } },
              channels: { type: 'array', items: { type: 'object', required: ['key', 'status', 'todayCount'], properties: {
                key: { type: 'string', enum: ['line', 'manual', 'hot_pepper_beauty', 'google_reserve', 'epark'] },
                status: { type: 'string', enum: ['active', 'preparing'] },
                todayCount: { type: ['integer', 'null'] },
              } } },
            },
          } } } } },
        },
        '400': { description: 'account_id 未指定' },
      },
    },
  },
  '/api/booking/admin/channels/settings': {
    put: {
      tags: ['Booking'],
      summary: '指名なし予約の担当自動割り当てを切り替え',
      parameters: [{ name: 'account_id', in: 'query', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['autoAssign'], properties: { autoAssign: { type: 'boolean' } } } } } },
      responses: {
        '200': { description: '保存した設定', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', const: true }, data: { type: 'object', required: ['autoAssign'], properties: { autoAssign: { type: 'boolean' } } } } } } } },
        '400': { description: 'account_id 未指定または autoAssign が真偽値でない' },
        '403': { description: '予約設定の権限がない' },
      },
    },
  },
  '/api/booking/admin/conflicts': {
    get: {
      tags: ['Booking'],
      summary: '同じ担当で時間が重なっている予約の組を取得',
      description: '受付中・確定の予約だけを対象に、同じ担当で時間が重なる2件の組を開始日時順に返す。',
      parameters: [{ name: 'account_id', in: 'query', required: true, schema: { type: 'string' } }],
      responses: {
        '200': {
          description: '重なっている予約の組',
          content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', const: true }, data: { type: 'object', required: ['conflicts'], properties: {
            conflicts: { type: 'array', items: { type: 'object', required: ['staffId', 'staffName', 'bookingId', 'otherBookingId', 'startsAt', 'endsAt', 'otherStartsAt', 'otherEndsAt', 'version', 'otherVersion'], properties: {
              staffId: { type: 'string' },
              staffName: { type: 'string' },
              bookingId: { type: 'string' },
              otherBookingId: { type: 'string' },
              startsAt: { type: 'string' },
              endsAt: { type: 'string' },
              otherStartsAt: { type: 'string' },
              otherEndsAt: { type: 'string' },
              version: { type: 'integer', minimum: 0 },
              otherVersion: { type: 'integer', minimum: 0 },
            } } },
          } } } } } },
        },
        '400': { description: 'account_id 未指定' },
      },
    },
  },
  '/api/booking/admin/sync-rules': {
    get: {
      tags: ['Booking'], summary: '予約の同期・自動割り当て・通知ルールを取得',
      description: '未保存なら既定値と version=0 を返す。カレンダーの空き時間除外とLINE予約の書き込みは常に有効。Cache-Control: no-store。',
      parameters: [{ name: 'account_id', in: 'query', required: true, schema: { type: 'string' } }],
      responses: {
        '200': { description: '現在の予約ルール', content: { 'application/json': { schema: {
          type: 'object', required: ['success', 'data'], properties: {
            success: { type: 'boolean', const: true }, data: { $ref: '#/components/schemas/BookingSyncRules' },
          },
        } } } },
        '400': { description: 'account_id 未指定' },
        '403': { description: 'このLINEアカウントを表示する権限がない' },
      },
    },
    put: {
      tags: ['Booking'], summary: '予約の同期・通知ルールを版付きで保存',
      description: '予約設定の編集権限が必要。expectedVersion=0 は初回保存、既存行は版一致時だけ更新する。nearLimitRemaining は dailyLimit より小さい値。保存後に通知条件を再評価する。',
      parameters: [{ name: 'account_id', in: 'query', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object',
        required: ['expectedVersion', 'autoAssign', 'notifyConflicts', 'notifyCalendarDisconnected', 'notifyDailyLimit', 'dailyLimit', 'nearLimitRemaining'],
        properties: {
          expectedVersion: { type: 'integer', minimum: 0 },
          autoAssign: { type: 'boolean' },
          notifyConflicts: { type: 'boolean' },
          notifyCalendarDisconnected: { type: 'boolean' },
          notifyDailyLimit: { type: 'boolean' },
          dailyLimit: { type: 'integer', minimum: 1, maximum: 1000 },
          nearLimitRemaining: { type: 'integer', minimum: 0, maximum: 999 },
          excludeCalendarBusy: { type: 'boolean', const: true },
          writeLineBookingsToCalendar: { type: 'boolean', const: true },
        },
      } } } },
      responses: {
        '200': { description: '保存後の予約ルール', content: { 'application/json': { schema: {
          type: 'object', required: ['success', 'data'], properties: {
            success: { type: 'boolean', const: true }, data: { $ref: '#/components/schemas/BookingSyncRules' },
          },
        } } } },
        '400': { description: 'account_id 未指定、入力または版が不正' },
        '403': { description: '予約設定の編集権限がない、または担当外のLINEアカウント' },
        '409': { description: '別の担当者が先に保存した', content: { 'application/json': { schema: {
          type: 'object', required: ['success', 'error', 'currentVersion'], properties: {
            success: { type: 'boolean', const: false }, error: { type: 'string' },
            currentVersion: { type: 'integer', minimum: 0 },
          },
        } } } },
      },
    },
  },
  '/api/booking/admin/sync-notices': {
    get: {
      tags: ['Booking'], summary: '予約のカレンダー未接続・上限接近・重複の知らせを取得',
      description: '対応済み・解消済みも含め、対象日と作成日時の降順で最大500件を返す。Cache-Control: no-store。',
      parameters: [{ name: 'account_id', in: 'query', required: true, schema: { type: 'string' } }],
      responses: {
        '200': { description: '予約の知らせ一覧', content: { 'application/json': { schema: {
          type: 'object', required: ['success', 'data'], properties: {
            success: { type: 'boolean', const: true },
            data: { type: 'array', maxItems: 500, items: { $ref: '#/components/schemas/BookingSyncNotice' } },
          },
        } } } },
        '400': { description: 'account_id 未指定' },
        '403': { description: 'このLINEアカウントを表示する権限がない' },
      },
    },
  },
  '/api/booking/admin/sync-notices/{id}/done': {
    post: {
      tags: ['Booking'], summary: '予約の知らせを対応済みにする',
      description: 'owner・admin・staff が操作可能。対応済みの再操作も成功する。条件が解消済みなら409、担当外の知らせは404。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'account_id', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '対応済みの知らせ', content: { 'application/json': { schema: {
          type: 'object', required: ['success', 'data'], properties: {
            success: { type: 'boolean', const: true }, data: {
              type: 'object', required: ['id', 'status'], properties: {
                id: { type: 'string' }, status: { type: 'string', const: 'done' },
              },
            },
          },
        } } } },
        '400': { description: 'account_id 未指定' },
        '403': { description: '操作できる役割がない、または担当外のLINEアカウント' },
        '404': { description: 'このLINEアカウントの知らせが存在しない' },
        '409': { description: '知らせの条件がすでに解消している' },
      },
    },
  },
};
