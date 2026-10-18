// Definitions only. Runtime handlers remain in their feature routes.
export const bookingSelfPaths = {
  // ── LIFF Booking settings（日時を選ぶ段の最初の形） ─────────────────────
  '/api/liff/booking/settings': {
    get: {
      tags: ['Booking'],
      summary: 'LIFF予約の日時表示の最初の形と受付期間を取得',
      description: 'liffId で決まる店舗の設定だけを返す。設定行が無い・列が無い行は既定値（list・60日）。空き枠そのものは /api/liff/booking/availability を期間指定で呼ぶ。',
      security: [],
      parameters: [
        { name: 'liffId', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'liff_date_view（list/calendar）とbooking_window_days' },
        '404': { description: 'Unknown LIFF ID' },
      },
    },
  },
  // ── LIFF Booking self change (F6 本人日時変更・取消) ─────────────────────
  '/api/liff/booking/{id}/reschedule': {
    post: {
      tags: ['Booking'],
      summary: '本人の予約日時を変更',
      description: '本人確認→店→友だちの所有だけに許可。管理者キーは要求しない。期限・締切・空き・CASを検査し、Google同期とMeet連携の結果を返す。待ち列は含まない。',
      security: [],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '変更成立（meet_sync 付き）・同日時再送は changed:false' },
        '401': { description: '本人確認ができない' },
        '403': { description: '期限切れ' },
        '404': { description: '予約なし' },
        '409': { description: '版競合・枠なし' },
        '422': { description: '不正な日時・締切切れ' },
      },
    },
  },
  '/api/liff/booking/{id}/cancel': {
    post: {
      tags: ['Booking'],
      summary: '本人の予約を取消',
      description: '本人確認→店→友だちの所有だけに許可。期限・CASを検査し、リマインダ停止・カレンダー削除・Meet取消の結果を返す。取消ずみ再送は副作用をそろえて 200。待ち列は含まない。',
      security: [],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: '取消成立（calendar_sync・meet_sync 付き）' },
        '401': { description: '本人確認ができない' },
        '403': { description: '期限切れ' },
        '404': { description: '予約なし' },
        '409': { description: '版競合・送信中の再試行' },
      },
    },
  },
  // ── Booking plus (前回・キャンセル待ち・今日・来店の印) ──────────────────
  '/api/liff/booking/last-booking': {
    get: {
      tags: ['Booking'],
      summary: '本人の前回の予約（メニュー・担当）を取得',
      description: '本人確認→店→友だちだけに許可。取り消し・却下・期限切れを除く最新1件。担当が辞めた・メニューが止まっているときは available=false。写真は担当の顔写真。',
      security: [],
      responses: {
        '200': { description: 'available と前回の予約（menu・staff）または available=false と理由' },
        '401': { description: '本人確認ができない' },
      },
    },
  },
  '/api/liff/booking/waitlist/mine': {
    get: {
      tags: ['Booking'],
      summary: '枠を指定して自分の待ち登録を取得',
      description: '本人確認→店→友だちだけに許可。待っている・仮押さえ中の登録があれば返す。シートの登録・取り消しの切り替え用。',
      security: [],
      parameters: [
        { name: 'staff_id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'menu_id', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'starts_at', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'entry（登録）または entry: null' },
        '400': { description: '枠の指定が不正' },
        '401': { description: '本人確認ができない' },
      },
    },
  },
};
