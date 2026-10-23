/** イベントルート試験の状態とD1操作をまとめたfixture。SQLの対象・条件を状態へ適用する。 */
export interface EventRow {
  id: string;
  line_account_id: string;
  name: string;
  venue_name: string | null;
  venue_url: string | null;
  image_url: string | null;
  description: string | null;
  description_centered: number;
  max_bookings_per_friend: number | null;
  requires_approval: number;
  approval_deadline_hours: number;
  cancel_deadline_hours_before: number | null;
  reminder_day_before_enabled: number;
  reminder_hours_before: number | null;
  is_published: number;
  folder_id: string | null;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  current_published_version_id: string | null;
  version_write_token?: string | null;
  target_type?: 'single' | 'multi-account-dedup';
  account_ids?: string | null;
  dedup_priority?: string | null;
  [k: string]: unknown;
}

export interface SlotRow {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active: number;
  sort_order: number;
  deleted_at: string | null;
  [k: string]: unknown;
}

export interface BookingRow {
  id: string;
  event_id: string;
  status: string;
  slot_id?: string;
  friend_id?: string;
  [k: string]: unknown;
}

interface LineAccount {
  id: string;
  liff_id: string;
  is_active: number;
  tenant_id?: string | null;
  channel_access_token?: string;
}

interface FriendRow {
  id: string;
  line_account_id: string;
  line_user_id: string;
  user_id?: string | null;
  picture_url?: string | null;
}

export function makeEventDb(state: {
  events: EventRow[];
  slots?: SlotRow[];
  bookings?: BookingRow[];
  accounts?: LineAccount[];
  friends?: FriendRow[];
  /** [friendId, tagId] の組。公開対象の絞り込みで引かれる */
  friendTags?: Array<{ friend_id: string; tag_id: string }>;
  /** タグの名前。一覧の「申込条件」が visible_tag_id から名前を引く */
  tags?: Array<{ id: string; name: string }>;
  /** キャンセル待ちの行。INSERT がここへ積まれる */
  waitlist?: Array<Record<string, unknown>>;
  /** 予約ごとの通知予定 (event_booking_reminders)。IDEA-07 の一覧添付用。 */
  reminders?: Array<Record<string, unknown>>;
}): D1Database {
  state.slots ??= [];
  // 本番の event_slots.version は DEFAULT 1（migration 324）。版を持たない
  //  fixture は初版として扱い、m26g の期待版の事前確認が本番と同じになる。
  for (const s of state.slots) s.version ??= 1;
  state.bookings ??= [];
  state.accounts ??= [];
  state.friends ??= [];
  state.friendTags ??= [];
  state.tags ??= [];
  state.waitlist ??= [];
  state.reminders ??= [];
  const eventMatchesAccount = (event: EventRow, account: string): boolean => {
    if (event.target_type === 'multi-account-dedup') {
      try {
        return (JSON.parse(event.account_ids ?? '[]') as string[]).includes(account);
      } catch {
        return false;
      }
    }
    return event.line_account_id === account;
  };
  const filterAdminEvents = (sql: string, bound: unknown[]): EventRow[] => {
    const account = bound[0] as string;
    // #625: 名前検索は LIKE ではなく instr(lower(e.name), lower(?)) > 0。
    // 束縛は `%q%` ではなく検索語そのものが来る。
    const query = sql.includes('instr(lower(e.name)') ? String(bound[2] ?? '') : '';
    return state.events.filter((event) => {
      if (event.deleted_at != null || !eventMatchesAccount(event, account)) return false;
      if (query && !event.name.includes(query)) return false;
      if (sql.includes('e.is_published = 1') && event.is_published !== 1) return false;
      // R81: 公開済みを要求する問い（受付中のみ・全体集計）は、今後の有効な
      // 枠がある行だけ（本番の EXISTS と同じ決め方）。次回日時の副問い合わせ
      // にも同じ文字列があるため、公開条件と組み合わせて判定する。
      if (sql.includes('e.is_published = 1') && sql.includes('s.starts_at >= strftime')) {
        const hasFuture = (state.slots ?? []).some(
          (slot) => slot.event_id === event.id && slot.deleted_at == null && slot.is_active === 1
            && slot.starts_at > new Date().toISOString(),
        );
        if (!hasFuture) return false;
      }
      if (sql.includes('pending.event_id = e.id') && !(state.bookings ?? []).some((booking) => booking.event_id === event.id && booking.status === 'requested')) return false;
      if (sql.includes('NOT EXISTS (SELECT 1 FROM event_slots cap')) {
        const slots = (state.slots ?? []).filter((slot) => slot.event_id === event.id && slot.deleted_at == null && slot.is_active === 1);
        if (slots.length === 0 || slots.some((slot) => slot.capacity == null)) return false;
        const capacity = slots.reduce((sum, slot) => sum + (slot.capacity ?? 0), 0);
        const active = (state.bookings ?? []).filter((booking) => booking.event_id === event.id && ['requested', 'confirmed'].includes(booking.status)).length;
        if (active < capacity) return false;
      }
      return true;
    });
  };
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T>() {
          // SELECT id FROM line_accounts WHERE liff_id = ? AND is_active = 1
          if (sql.startsWith('SELECT id FROM line_accounts')) {
            const [liff_id] = bound as [string];
            const acc = (state.accounts ?? []).find(
              (a) => a.liff_id === liff_id && a.is_active === 1,
            );
            return (acc ? { id: acc.id } : null) as T | null;
          }
          // SELECT channel_access_token FROM line_accounts WHERE id = ?
          if (sql.startsWith('SELECT channel_access_token FROM line_accounts')) {
            const [id] = bound as [string];
            const acc = (state.accounts ?? []).find((a) => a.id === id);
            return (acc ? { channel_access_token: acc.channel_access_token ?? '' } : null) as T | null;
          }
          // immediate booking notification: SELECT la.channel_access_token,
          //   la.channel_access_token_encrypted, e.confirmation_message_extra
          //   FROM line_accounts la JOIN events e ON e.id = ? WHERE la.id = ?
          if (
            sql.startsWith('SELECT la.channel_access_token,') &&
            sql.includes('la.channel_access_token_encrypted') &&
            sql.includes('e.confirmation_message_extra')
          ) {
            const [event_id, account_id] = bound as [string, string];
            const acc = (state.accounts ?? []).find((a) => a.id === account_id);
            const ev = state.events.find((x) => x.id === event_id);
            if (!acc || !ev) return null as T | null;
            return {
              channel_access_token: acc.channel_access_token ?? '',
              channel_access_token_encrypted: null,
              confirmation_message_extra: (ev as Record<string, unknown>).confirmation_message_extra ?? null,
            } as T;
          }
          // SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ?
          // FROM friends より前に置く。詳細画面側の JOIN 版も "FROM friends" を
          // 含むので、後ろに置くと友だちの検索として拾われてしまう。
          if (sql.includes('friend_tags')) {
            if (sql.includes('JOIN friends')) {
              const [lineUserId, account, tagId] = bound as [string, string, string];
              const f = (state.friends ?? []).find(
                (x) => x.line_user_id === lineUserId && x.line_account_id === account,
              );
              const hit =
                f && (state.friendTags ?? []).some((t) => t.friend_id === f.id && t.tag_id === tagId);
              return (hit ? { 1: 1 } : null) as T | null;
            }
            const [friendId, tagId] = bound as [string, string];
            const hit = (state.friendTags ?? []).some(
              (t) => t.friend_id === friendId && t.tag_id === tagId,
            );
            return (hit ? { 1: 1 } : null) as T | null;
          }
          // SELECT id [, user_id] FROM friends WHERE line_user_id = ? AND line_account_id = ?
          if (sql.includes('FROM friends')) {
            const [lineUserId, account] = bound as [string, string];
            const f = (state.friends ?? []).find(
              (x) => x.line_user_id === lineUserId && x.line_account_id === account,
            );
            if (!f) return null as T | null;
            // POST 予約用は is_following = 1 の filter があるが、テスト friend は
            // 既存テストで is_following を持たないため pass。SELECT が user_id を
            // 含めば返す。
            if (sql.includes('user_id') || sql.includes('picture_url')) {
              return {
                id: f.id,
                user_id: f.user_id ?? null,
                picture_url: f.picture_url ?? null,
              } as T;
            }
            return { id: f.id } as T;
          }
          // LIFF event row for booking creation: SELECT id, name, ... FROM events WHERE ...
          if (sql.includes('SELECT id, name, image_url, description, venue_name')) {
            const [id, account] = bound as [string, string];
            const e = state.events.find(
              (x) => x.id === id && x.line_account_id === account && x.deleted_at == null && x.is_published === 1,
            );
            return (e ? {
              ...e,
              approval_deadline_hours: e.approval_deadline_hours ?? 24,
              current_published_version_id: e.current_published_version_id ?? null,
            } : null) as T | null;
          }
          if(sql.startsWith('SELECT capacity,classroom_capacity,online_capacity FROM event_slots')){
            const slot=(state.slots??[]).find(row=>row.id===bound[0]);
            return (slot?{capacity:slot.capacity,classroom_capacity:null,online_capacity:null}:null) as T|null;
          }
          if(sql.startsWith('SELECT COALESCE((SELECT SUM(party_size) FROM event_bookings')){
            const count=(state.bookings??[]).filter(row=>(row as Record<string,unknown>).slot_id===bound[0]&&['requested','confirmed'].includes(row.status)).reduce((n,row)=>n+Number((row as Record<string,unknown>).party_size??1),0)+(state.waitlist??[]).filter(row=>row.slot_id===bound[3]&&['offered','accepted'].includes(String(row.status))).reduce((n,row)=>n+Number(row.party_size??1),0);
            return {count} as T;
          }
          // SELECT capacity FROM event_slots WHERE id = ?
          if (sql.startsWith('SELECT capacity FROM event_slots')) {
            const [id] = bound as [string];
            const s = (state.slots ?? []).find((x) => x.id === id);
            return (s ? { capacity: s.capacity } : null) as T | null;
          }
          // SELECT id, event_id, starts_at, is_active, deleted_at FROM event_slots WHERE id = ? AND event_id = ?
          if (sql.startsWith('SELECT id, event_id, starts_at, ends_at, is_active, deleted_at')) {
            const [id, event_id] = bound as [string, string];
            const s = (state.slots ?? []).find(
              (x) => x.id === id && x.event_id === event_id && x.deleted_at == null,
            );
            return (s ?? null) as T | null;
          }
          // notification JOIN: SELECT e.name AS event_name, e.venue_name, ... line_accounts la
          if (sql.includes('FROM event_bookings b') && sql.includes('channel_access_token')) {
            const [bookingId] = bound as [string];
            const b = (state.bookings ?? []).find((x) => x.id === bookingId);
            if (!b) return null as T | null;
            const e = state.events.find((x) => x.id === b.event_id);
            const s = (state.slots ?? []).find((x) => x.id === (b as Record<string, unknown>).slot_id);
            const la = (state.accounts ?? []).find((x) => x.id === (b as Record<string, unknown>).line_account_id);
            const f = (state.friends ?? []).find((x) => x.id === (b as Record<string, unknown>).friend_id);
            if (!e || !s || !la || !f) return null as T | null;
            return {
              event_name: e.name,
              venue_name: e.venue_name,
              venue_url: e.venue_url,
              confirmation_message_extra: (e as Record<string, unknown>).confirmation_message_extra ?? null,
              slot_starts_at: s.starts_at,
              channel_access_token: la.channel_access_token ?? '',
              channel_access_token_encrypted: null,
              line_user_id: f.line_user_id,
            } as T;
          }
          // booking action loader: SELECT id, line_account_id, event_id, slot_id, friend_id, status, decided_at FROM event_bookings WHERE id = ? AND event_id = ?
          // (multi-account 対応で line_account_id 制約を削除)
          if (sql.includes('FROM event_bookings\n        WHERE id = ? AND event_id = ?')) {
            const [id, event_id] = bound as [string, string];
            const b = (state.bookings ?? []).find(
              (x) =>
                x.id === id &&
                (x as Record<string, unknown>).event_id === event_id,
            );
            if (!b) return null as T | null;
            return {
              id: b.id,
              line_account_id: (b as Record<string, unknown>).line_account_id as string,
              event_id: b.event_id,
              slot_id: (b as Record<string, unknown>).slot_id as string,
              friend_id: (b as Record<string, unknown>).friend_id as string,
              status: b.status,
              decided_at: ((b as Record<string, unknown>).decided_at as string | null) ?? null,
            } as T;
          }
          // SELECT * FROM event_bookings WHERE id = ?
          if (sql.startsWith('SELECT * FROM event_bookings')) {
            const [id] = bound as [string];
            const b = (state.bookings ?? []).find((x) => x.id === id);
            return (b ?? null) as T | null;
          }
          // SELECT starts_at FROM event_slots WHERE id = ?
          if (sql.startsWith('SELECT starts_at FROM event_slots')) {
            const [id] = bound as [string];
            const s = (state.slots ?? []).find((x) => x.id === id);
            return (s ? { starts_at: s.starts_at } : null) as T | null;
          }
          // SELECT reminder_day_before_enabled, reminder_hours_before FROM events WHERE id = ?
          if (sql.startsWith('SELECT reminder_day_before_enabled')) {
            const [id] = bound as [string];
            const e = state.events.find((x) => x.id === id);
            return (e ? {
              reminder_day_before_enabled: e.reminder_day_before_enabled,
              reminder_hours_before: e.reminder_hours_before,
            } : null) as T | null;
          }
          // notifications/pending count: SELECT COUNT(*) AS c FROM event_bookings WHERE line_account_id = ? AND status = 'requested'
          if (sql.includes('COUNT(*) AS c') && sql.includes('FROM event_bookings') && sql.includes("status = 'requested'")) {
            const [account_id] = bound as [string];
            const c = (state.bookings ?? []).filter(
              (b) =>
                (b as Record<string, unknown>).line_account_id === account_id &&
                b.status === 'requested',
            ).length;
            return { c } as T;
          }
          // POST の sameIdentityActive 検出 (window 関数 COUNT(*) OVER  で total を返す)
          if (sql.includes('FROM event_bookings b') && sql.includes('identity_key') && sql.includes('COUNT(*) OVER')) {
            const [event_id, idKey] = bound as [string, string];
            const matches = (state.bookings ?? [])
              .filter(
                (x) =>
                  x.event_id === event_id &&
                  (x as Record<string, unknown>).identity_key === idKey &&
                  (x.status === 'requested' || x.status === 'confirmed'),
              );
            if (matches.length === 0) return null as T | null;
            const b = matches[0];
            const s = (state.slots ?? []).find((x) => x.id === (b as Record<string, unknown>).slot_id);
            return {
              id: b.id,
              status: b.status,
              slot_starts_at: s?.starts_at ?? null,
              total: matches.length,
            } as T;
          }
          // POST post-insert verify: COUNT(*) AS c FROM event_bookings WHERE event_id = ? AND identity_key = ?
          if (sql.includes('FROM event_bookings') && sql.includes('COUNT(*) AS c') && sql.includes('identity_key')) {
            const [event_id, idKey] = bound as [string, string];
            const c = (state.bookings ?? []).filter(
              (x) =>
                x.event_id === event_id &&
                (x as Record<string, unknown>).identity_key === idKey &&
                (x.status === 'requested' || x.status === 'confirmed'),
            ).length;
            return { c } as T;
          }
          // self-cancel JOIN: SELECT b.id, b.status, e.cancel_deadline_hours_before, s.starts_at
          // LIFF GET event の my_existing_booking 検出:
          // SELECT b.id, b.status, b.line_account_id, s.starts_at FROM event_bookings b
          //   JOIN event_slots s WHERE b.event_id = ? AND b.identity_key = ?
          if (sql.includes('FROM event_bookings b') && sql.includes('identity_key')) {
            const [event_id, idKey] = bound as [string, string];
            const b = (state.bookings ?? []).find(
              (x) =>
                x.event_id === event_id &&
                (x as Record<string, unknown>).identity_key === idKey &&
                (x.status === 'requested' || x.status === 'confirmed'),
            );
            if (!b) return null as T | null;
            const s = (state.slots ?? []).find((x) => x.id === (b as Record<string, unknown>).slot_id);
            return {
              id: b.id,
              status: b.status,
              line_account_id: (b as Record<string, unknown>).line_account_id,
              slot_starts_at: s?.starts_at ?? null,
            } as T;
          }
          // booking detail: SELECT b.id, ... e.description AS event_description, CASE WHEN ... END AS confirmation_message_extra
          //   FROM event_bookings b JOIN events e JOIN event_slots s WHERE b.id = ? AND b.friend_id = ? AND b.line_account_id = ?
          if (sql.includes('FROM event_bookings b') && sql.includes('event_description') && sql.includes('cancel_deadline_hours_before')) {
            const [bookingId, friend_id, account_id] = bound as [string, string, string];
            const b = (state.bookings ?? []).find(
              (x) => x.id === bookingId && (x as Record<string, unknown>).friend_id === friend_id && (x as Record<string, unknown>).line_account_id === account_id,
            );
            if (!b) return null as T | null;
            const e = state.events.find((x) => x.id === b.event_id);
            const s = (state.slots ?? []).find((x) => x.id === (b as Record<string, unknown>).slot_id);
            if (!e || !s) return null as T | null;
            return {
              id: b.id,
              event_id: b.event_id,
              status: b.status,
              customer_note: (b as Record<string, unknown>).customer_note ?? null,
              requested_at: null,
              decided_at: null,
              cancelled_at: null,
              event_name: e.name,
              event_image_url: e.image_url,
              venue_name: e.venue_name,
              venue_url: e.venue_url,
              cancel_deadline_hours_before: e.cancel_deadline_hours_before,
              event_description: (e as Record<string, unknown>).description ?? null,
              confirmation_message_extra: b.status === 'confirmed' ? ((e as Record<string, unknown>).confirmation_message_extra ?? null) : null,
              slot_starts_at: s.starts_at,
              slot_ends_at: s.ends_at,
            } as T;
          }
          // self-cancel JOIN: SELECT b.id, b.status, e.cancel_deadline_hours_before, s.starts_at
          if (sql.includes('FROM event_bookings b') && sql.includes('cancel_deadline_hours_before')) {
            const [bookingId, friend_id, account_id] = bound as [string, string, string];
            const b = (state.bookings ?? []).find(
              (x) => x.id === bookingId && (x as Record<string, unknown>).friend_id === friend_id && (x as Record<string, unknown>).line_account_id === account_id,
            );
            if (!b) return null as T | null;
            const e = state.events.find((x) => x.id === b.event_id);
            const s = (state.slots ?? []).find((x) => x.id === (b as Record<string, unknown>).slot_id);
            if (!e || !s) return null as T | null;
            return {
              id: b.id,
              status: b.status,
              line_account_id: (b as Record<string, unknown>).line_account_id,
              event_id: b.event_id,
              slot_id: (b as Record<string, unknown>).slot_id,
              cancel_deadline_hours_before: e.cancel_deadline_hours_before,
              slot_starts_at: s.starts_at,
            } as T;
          }
          // SELECT id FROM event_slots WHERE id = ? AND event_id = ? AND deleted_at IS NULL
          if (sql.startsWith('SELECT id FROM event_slots')) {
            const [id, event_id] = bound as [string, string];
            const s = (state.slots ?? []).find(
              (x) => x.id === id && x.event_id === event_id && x.deleted_at == null,
            );
            return (s ? { id: s.id } : null) as T | null;
          }
          // SELECT * FROM event_slots WHERE id = ? AND event_id = ? AND deleted_at IS NULL
          if (sql.startsWith('SELECT * FROM event_slots') && sql.includes('event_id')) {
            const [id, event_id] = bound as [string, string];
            const s = (state.slots ?? []).find(
              (x) => x.id === id && x.event_id === event_id && x.deleted_at == null,
            );
            return (s ?? null) as T | null;
          }
          // SELECT * FROM event_slots WHERE id = ?
          if (sql.startsWith('SELECT * FROM event_slots')) {
            const [id] = bound as [string];
            const s = (state.slots ?? []).find((x) => x.id === id);
            return (s ?? null) as T | null;
          }
          if (
            sql.includes('SELECT COUNT(*) AS c FROM event_bookings')
            && sql.includes("status = 'attended'")
          ) {
            const [friend_id, checked_at] = bound as [string, string];
            const c = (state.bookings ?? []).filter((booking) => {
              const row = booking as Record<string, unknown>;
              return row.friend_id === friend_id
                && booking.status === 'attended'
                && String(row.requested_at ?? '') < checked_at;
            }).length;
            return { c } as T;
          }
          if (sql.includes('AS requested_count') && sql.includes('FROM event_bookings WHERE event_id = ?')) {
            const [event_id] = bound as [string];
            const rows = (state.bookings ?? []).filter((booking) => booking.event_id === event_id);
            const count = (status: string) => rows.filter((booking) => booking.status === status).length;
            const seats = (status: string) => rows
              .filter((booking) => booking.status === status)
              .reduce((sum, booking) => sum + Number((booking as Record<string, unknown>).party_size ?? 1), 0);
            return {
              total: rows.length,
              requested_count: count('requested'),
              confirmed_count: count('confirmed'),
              rejected_count: count('rejected'),
              cancelled_count: count('cancelled'),
              expired_count: count('expired'),
              attended_count: count('attended'),
              no_show_count: count('no_show'),
              requested_seats: seats('requested'),
              confirmed_seats: seats('confirmed'),
            } as T;
          }
          // bookings/summary の待ち列集計。同じテーブルへの別SELECT
          // (SELECT id FROM event_waitlist ...) と混ざらないよう waiting_seats で絞る。
          if (sql.includes('waiting_seats') && sql.includes('FROM event_waitlist WHERE event_id = ?')) {
            const [event_id] = bound as [string];
            const active = new Set(['waiting', 'offered', 'accepted']);
            const rows = (state.waitlist ?? []).filter(
              (row) => row.event_id === event_id && active.has(String(row.status)),
            );
            const seats = (statuses: string[]) => rows
              .filter((row) => statuses.includes(String(row.status)))
              .reduce((sum, row) => sum + Number((row as Record<string, unknown>).party_size ?? 1), 0);
            return {
              c: rows.length,
              waiting_seats: seats(['waiting']),
              offered_seats: seats(['offered', 'accepted']),
            } as T;
          }
          if (sql.includes('AS slot_count') && sql.includes('FROM event_slots WHERE event_id = ?')) {
            const [event_id] = bound as [string];
            const slots = (state.slots ?? []).filter(
              (slot) => slot.event_id === event_id && slot.deleted_at == null && slot.is_active === 1,
            );
            return {
              slot_count: slots.length,
              uncapped_count: slots.filter((slot) => slot.capacity == null).length,
              total_capacity: slots.reduce((sum, slot) => sum + (slot.capacity ?? 0), 0),
            } as T;
          }
          // 申込一覧の総数(点検#520の中8)。使用席数の枝より前に置く。
          // 絞りがあるときは bound が [event_id, status?, slot_id?] の順に積まれる。
          if (sql.startsWith('SELECT COUNT(*) AS c FROM event_bookings b')) {
            const [event_id, second, third] = bound as [string, string?, string?];
            const filterStatus = sql.includes('b.status = ?') ? second : null;
            const filterSlot = sql.includes('b.slot_id = ?') ? (filterStatus ? third : second) : null;
            const c = (state.bookings ?? []).filter(
              (b) => b.event_id === event_id
                && (filterStatus ? b.status === filterStatus : true)
                && (filterSlot ? (b as Record<string, unknown>).slot_id === filterSlot : true),
            ).length;
            return { c } as T;
          }
          // 開催回の使用席数。複数人申込は party_size の合計で数える。
          if (
            sql.includes('FROM event_bookings')
            && (sql.includes('COUNT(*) AS c') || sql.includes('SUM(party_size)'))
            && sql.includes('slot_id = ?')
          ) {
            const [slot_id] = bound as [string];
            const c = (state.bookings ?? [])
              .filter(
                (b) => (b as BookingRow & { slot_id?: string }).slot_id === slot_id && (b.status === 'requested' || b.status === 'confirmed'),
              )
              .reduce((sum, booking) => sum + Number((booking as Record<string, unknown>).party_size ?? 1), 0);
            return { c } as T;
          }
          // Multi-account 対応の events lookup helper:
          // single モード → line_account_id 一致、multi-account-dedup モード
          // → account_ids JSON 配列に含まれる、のどちらか。
          // LIFF SELECT id FROM events ... AND is_published = 1
          if (sql.includes('SELECT id FROM events') && sql.includes('is_published')) {
            const [id, account, account2] = bound as [string, string, string?];
            const acct = account2 ?? account;
            const e = state.events.find(
              (x) => x.id === id && x.deleted_at == null && x.is_published === 1 && eventMatchesAccount(x, acct),
            );
            return (e ? { id: e.id } : null) as T | null;
          }
          // admin SELECT id FROM events
          if (sql.includes('SELECT id FROM events')) {
            const [id, account, account2] = bound as [string, string, string?];
            const acct = account2 ?? account;
            const e = state.events.find(
              (x) => x.id === id && x.deleted_at == null && eventMatchesAccount(x, acct),
            );
            return (e ? { id: e.id } : null) as T | null;
          }
          // LIFF SELECT * FROM events ... AND is_published = 1
          if (sql.includes('SELECT * FROM events') && sql.includes('is_published')) {
            const [id, account, account2] = bound as [string, string, string?];
            const acct = account2 ?? account;
            const e = state.events.find(
              (x) => x.id === id && x.deleted_at == null && x.is_published === 1 && eventMatchesAccount(x, acct),
            );
            return (e ?? null) as T | null;
          }
          // admin SELECT * FROM events ... 単独 / multi 両対応
          if (sql.includes('SELECT * FROM events') && (sql.includes('line_account_id') || sql.includes('target_type'))) {
            const [id, account, account2] = bound as [string, string, string?];
            const acct = account2 ?? account;
            const e = state.events.find(
              (x) => x.id === id && x.deleted_at == null && eventMatchesAccount(x, acct),
            );
            return (e ?? null) as T | null;
          }
          // SELECT * FROM events WHERE id = ?
          if (sql.includes('SELECT * FROM events')) {
            const [id] = bound as [string];
            const e = state.events.find((x) => x.id === id);
            return (e ?? null) as T | null;
          }
          // イベント一覧の総数(点検#520の中8)。
          if (sql.startsWith('SELECT COUNT(*) AS c FROM events e')) {
            const c = filterAdminEvents(sql, bound).length;
            return { c } as T;
          }
          return null;
        },
        async all<T>() {
          if (
            sql.includes('SELECT id, tenant_id, parent_line_account_id') &&
            sql.includes('FROM line_accounts')
          ) {
            const includeLegacyNull = sql.includes('WHERE (tenant_id = ? OR tenant_id IS NULL)');
            if ((!includeLegacyNull && !sql.includes('WHERE tenant_id = ?')) || bound.length !== 1) {
              throw new Error('unsupported_line_account_scope_query');
            }
            const [tenantId] = bound as [string];
            const results = (state.accounts ?? [])
              .filter((account) => account.tenant_id === tenantId || (includeLegacyNull && account.tenant_id == null))
              .map((account) => ({
                id: account.id,
                tenant_id: account.tenant_id ?? null,
                parent_line_account_id: null,
                is_active: account.is_active,
                archived_at: null,
                login_channel_id: null,
                liff_id: account.liff_id,
              }));
            return { results } as { results: T[] };
          }
          if (sql.startsWith('SELECT * FROM line_accounts')) {
            return { results: state.accounts ?? [] } as { results: T[] };
          }
          // R79/R80: 一覧の全体集計。今後の有効な枠だけを数える。
          // 管理一覧の問い（`FROM events e` を含む）より前に置く。
          if (sql.includes('e.id = s.event_id')) {
            const nowIso = new Date().toISOString();
            const targets = filterAdminEvents(sql, bound);
            const rows = [];
            for (const e of targets) {
              for (const s of (state.slots ?? []).filter(
                (slot) => slot.event_id === e.id && slot.deleted_at == null && slot.is_active === 1
                  && slot.starts_at > nowIso,
              )) {
                const active = (state.bookings ?? [])
                  .filter((b) => (b.slot_id === s.id) && (b.status === 'requested' || b.status === 'confirmed'))
                  .reduce((sum, b) => sum + (Number((b as Record<string, unknown>).party_size) || 1), 0)
                  + (state.waitlist ?? [])
                    .filter((w) => w.slot_id === s.id && (w.status === 'offered' || w.status === 'accepted'))
                    .reduce((sum, w) => sum + (Number(w.party_size) || 1), 0);
                rows.push({ id: s.id, event_id: s.event_id, starts_at: s.starts_at, capacity: s.capacity, active_count: active });
              }
            }
            return { results: rows as unknown as T[] };
          }
          // admin events list (must come before event_slots branch since
          // its sub-queries also reference event_slots s)
          if (sql.startsWith('SELECT\n         e.*') || (sql.includes('FROM events e') && (sql.includes('e.line_account_id') || sql.includes('e.target_type')))) {
            const items = filterAdminEvents(sql, bound)
              .map((e) => {
                const slots = (state.slots ?? []).filter(
                  (s) => s.event_id === e.id && s.deleted_at == null && s.is_active === 1,
                );
                const futureSlots = slots.filter(
                  (s) => s.starts_at > new Date().toISOString(),
                );
                const next_slot_starts_at =
                  futureSlots.length > 0
                    ? futureSlots
                        .map((s) => s.starts_at)
                        .sort()[0]
                    : null;
                // 本番と同じ決め方(点検#520の中6): 定員なしの枠が混ざれば合計なし。
                const cap = slots.some((s) => s.capacity == null)
                  ? null
                  : slots.length > 0
                    ? slots.reduce((acc, s) => acc + (s.capacity ?? 0), 0)
                    : null;
                const total_active = (state.bookings ?? []).filter(
                  (b) => b.event_id === e.id && (b.status === 'requested' || b.status === 'confirmed'),
                ).length;
                const pending_count = (state.bookings ?? []).filter(
                  (b) => b.event_id === e.id && b.status === 'requested',
                ).length;
                // 消えたタグを指したままの行は名前が引けず null になる。
                const visible_tag_name = e.visible_tag_id
                  ? ((state.tags ?? []).find((t) => t.id === e.visible_tag_id)?.name ?? null)
                  : null;
                return {
                  ...e,
                  next_slot_starts_at,
                  total_capacity: cap,
                  total_active,
                  pending_count,
                  visible_tag_name,
                };
              })
              .sort((a, b) => sql.includes('e.name COLLATE NOCASE')
                ? a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
                : (a.next_slot_starts_at == null ? 1 : b.next_slot_starts_at == null ? -1 : a.next_slot_starts_at.localeCompare(b.next_slot_starts_at)) || a.id.localeCompare(b.id));
            // 本番は LIMIT/OFFSET を付ける(点検#520の中8)。bound の末尾2つ。
            const limit = typeof bound[bound.length - 2] === 'number' ? (bound[bound.length - 2] as number) : items.length;
            const offset = typeof bound[bound.length - 1] === 'number' ? (bound[bound.length - 1] as number) : 0;
            return { results: items.slice(offset, offset + limit) as unknown as T[] };
          }
          // IDEA-07: 一覧に添える通知予定。booking_id IN (...) の行だけ返す。
          if (sql.includes('FROM event_booking_reminders')) {
            const ids = new Set(sql.includes('json_each(?)')
              ? JSON.parse(bound[0] as string) as string[]
              : bound as string[]);
            const rows = (state.reminders ?? [])
              .filter((r) => ids.has(String(r.booking_id)))
              .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
            return { results: rows as unknown as T[] };
          }
          // admin bookings list: SELECT b.*, s.starts_at, ..., friends.display_name FROM event_bookings b JOIN event_slots s ...
          if (sql.includes('FROM event_bookings b') && sql.includes('friend_display_name')) {
            const event_id = bound[0] as string;
            const filterStatus = sql.includes('b.status = ?') ? (bound[1] as string) : null;
            const filterSlot = sql.includes('b.slot_id = ?')
              ? (bound[filterStatus ? 2 : 1] as string)
              : null;
            const items = (state.bookings ?? [])
              .filter((b) => b.event_id === event_id)
              .filter((b) => (filterStatus ? b.status === filterStatus : true))
              .filter((b) => (filterSlot ? (b as Record<string, unknown>).slot_id === filterSlot : true))
              .map((b) => {
                const s = (state.slots ?? []).find((x) => x.id === (b as Record<string, unknown>).slot_id);
                const f = (state.friends ?? []).find((x) => x.id === (b as Record<string, unknown>).friend_id);
                return {
                  ...b,
                  slot_starts_at: s?.starts_at ?? null,
                  slot_ends_at: s?.ends_at ?? null,
                  friend_display_name: (f as { display_name?: string } | undefined)?.display_name ?? null,
                  friend_line_user_id: f?.line_user_id ?? null,
                };
              });
            // 本番は LIMIT/OFFSET を付ける(点検#520の中8)。bound の末尾2つ。
            const limit = typeof bound[bound.length - 2] === 'number' ? (bound[bound.length - 2] as number) : items.length;
            const offset = typeof bound[bound.length - 1] === 'number' ? (bound[bound.length - 1] as number) : 0;
            return { results: items.slice(offset, offset + limit) as unknown as T[] };
          }
          // LIFF history JOIN: FROM event_bookings b JOIN events e JOIN event_slots s
          if (sql.includes('FROM event_bookings b') && sql.includes('event_name')) {
            const [friend_id, account_id, nowIso] = bound as [string, string, string];
            const isUpcoming = sql.includes("status IN ('requested','confirmed')")
              && sql.includes("json_extract(b.event_snapshot_json, '$.slotStartsAt')")
              && sql.includes('>= ?');
            const items = (state.bookings ?? [])
              .filter((b) => {
                const r = b as Record<string, unknown>;
                return r.friend_id === friend_id && r.line_account_id === account_id;
              })
              .map((b) => {
                const e = state.events.find((x) => x.id === b.event_id);
                const s = (state.slots ?? []).find((x) => x.id === (b as Record<string, unknown>).slot_id);
                if (!e || !s) return null;
                return {
                  id: b.id,
                  status: b.status,
                  customer_note: (b as Record<string, unknown>).customer_note ?? null,
                  requested_at: null,
                  decided_at: null,
                  cancelled_at: null,
                  event_name: e.name,
                  event_image_url: e.image_url,
                  venue_name: e.venue_name,
                  venue_url: e.venue_url,
                  cancel_deadline_hours_before: e.cancel_deadline_hours_before,
                  slot_starts_at: s.starts_at,
                  slot_ends_at: s.ends_at,
                };
              })
              .filter((r): r is NonNullable<typeof r> => r !== null)
              .filter((r) => {
                const isActive = r.status === 'requested' || r.status === 'confirmed';
                if (isUpcoming) return isActive && r.slot_starts_at >= nowIso;
                return !isActive || r.slot_starts_at < nowIso;
              })
              .sort((a, b) =>
                isUpcoming
                  ? a.slot_starts_at.localeCompare(b.slot_starts_at)
                  : b.slot_starts_at.localeCompare(a.slot_starts_at),
              );
            return { results: items as unknown as T[] };
          }
          // admin slots list: SELECT s.*, COUNT(...) AS active_count FROM event_slots s
          if (sql.includes('SELECT id, event_id, starts_at, ends_at, capacity, is_active, sort_order')
            && sql.includes('FROM event_slots WHERE event_id = ?')) {
            const [event_id] = bound as [string];
            const items = (state.slots ?? [])
              .filter((slot) => slot.event_id === event_id && slot.deleted_at == null && slot.is_active === 1)
              .sort((a, b) => a.sort_order - b.sort_order || a.starts_at.localeCompare(b.starts_at));
            return { results: items as unknown as T[] };
          }
          if (sql.includes('FROM event_slots s')) {
            const [event_id] = bound as [string];
            const items = (state.slots ?? [])
              .filter((s) => s.event_id === event_id && s.deleted_at == null)
              .map((s) => {
                const active_count = (state.bookings ?? []).filter(
                  (b) => (b as BookingRow & { slot_id?: string }).slot_id === s.id && (b.status === 'requested' || b.status === 'confirmed'),
                ).length;
                return { ...s, active_count };
              })
              .sort((a, b) =>
                a.sort_order !== b.sort_order
                  ? a.sort_order - b.sort_order
                  : a.starts_at.localeCompare(b.starts_at),
              );
            return { results: items as unknown as T[] };
          }
          if (sql.startsWith('SELECT * FROM event_slots WHERE id IN (')) {
            const ids = new Set(bound as string[]);
            return {
              results: (state.slots ?? []).filter((slot) => ids.has(slot.id)) as unknown as T[],
            };
          }
          // #1000: SELECT * FROM event_slots WHERE event_id = ? AND deleted_at IS NULL AND client_key IN (...)
          if (sql.startsWith('SELECT * FROM event_slots') && sql.includes('client_key IN (')) {
            const [event_id, ...keys] = bound as [string, ...string[]];
            const keySet = new Set(keys);
            return {
              results: (state.slots ?? []).filter(
                (slot) =>
                  slot.event_id === event_id &&
                  slot.deleted_at == null &&
                  keySet.has((slot as Record<string, unknown>).client_key as string),
              ) as unknown as T[],
            };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes('INSERT OR IGNORE INTO event_waitlist')) {
            const [
              id, line_account_id, event_id, slot_id, friend_id, identity_key,
              party_size, answer_snapshot_json, first_participation,
              first_participation_attended_count, first_participation_checked_at,
              event_version_id, event_snapshot_json,
              created_at, updated_at,
            ] = bound as string[];
            const dup = (state.waitlist ?? []).some(
              (w) => w.slot_id === slot_id && w.identity_key === identity_key,
            );
            if (dup) return { success: true, meta: { changes: 0 } };
            (state.waitlist ??= []).push({
              id,
              line_account_id,
              event_id,
              slot_id,
              friend_id,
              identity_key,
              status: 'waiting',
              party_size,
              answer_snapshot_json,
              first_participation,
              first_participation_attended_count,
              first_participation_checked_at,
              event_version_id,
              event_snapshot_json,
              created_at,
              updated_at,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_bookings') && sql.includes('internal_note = COALESCE')) {
            // reject reason append
            const [appended, _updated_at, id] = bound as [string, string, string];
            const b = (state.bookings ?? []).find((x) => x.id === id);
            if (!b) return { success: true, meta: { changes: 0 } };
            const cur = (b as Record<string, unknown>).internal_note as string | null;
            (b as Record<string, unknown>).internal_note = (cur ? cur + '\n' : '') + appended;
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_bookings') && sql.includes('decided_at = ?, decided_by_staff_id')) {
            // decide
            const [next, decided_at, decided_by, _updated_at, id] = bound as [string, string, string | null, string, string];
            const b = (state.bookings ?? []).find((x) => x.id === id);
            if (!b) return { success: true, meta: { changes: 0 } };
            b.status = next;
            (b as Record<string, unknown>).decided_at = decided_at;
            (b as Record<string, unknown>).decided_by_staff_id = decided_by;
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_bookings') && sql.includes("status = 'cancelled'")) {
            // admin or friend cancel
            const isFriend = sql.includes("cancelled_by = 'friend'");
            const [cancelled_at, _updated_at, id] = bound as [string, string, string];
            const b = (state.bookings ?? []).find((x) => x.id === id);
            if (!b) return { success: true, meta: { changes: 0 } };
            b.status = 'cancelled';
            (b as Record<string, unknown>).cancelled_at = cancelled_at;
            (b as Record<string, unknown>).cancelled_by = isFriend ? 'friend' : 'admin';
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_bookings SET ')) {
            // generic PUT — conditional on (id, expected status)
            // bound = [...setValues, id, expectedStatus]
            const expectedStatus = bound[bound.length - 1] as string;
            const id = bound[bound.length - 2] as string;
            const b = (state.bookings ?? []).find((x) => x.id === id);
            if (!b) return { success: true, meta: { changes: 0 } };
            if (b.status !== expectedStatus) return { success: true, meta: { changes: 0 } };
            const setPart = sql.substring('UPDATE event_bookings SET '.length, sql.indexOf(' WHERE'));
            const cols = setPart.split(',').map((x) => x.trim());
            let valIdx = 0;
            for (const col of cols) {
              const m = /^(\w+)\s*=\s*(\?|strftime)/.exec(col);
              if (!m) continue;
              const colName = m[1];
              if (m[2] === '?') {
                if (colName === 'status') b.status = bound[valIdx] as string;
                else (b as Record<string, unknown>)[colName] = bound[valIdx];
                valIdx++;
              }
            }
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('INSERT INTO event_bookings')) {
            const [
              id, line_account_id, event_id, slot_id, friend_id, status, customer_note,
              requested_at, identity_key, party_size, answer_snapshot_json,
              first_participation, first_participation_attended_count,
              first_participation_checked_at, event_version_id, event_snapshot_json,
              approval_expires_at,
            ] = bound as [
              string, string, string, string, string, string, string | null,
              string, string | undefined, number, string | null, number, number, string,
              string | null, string | null, string | null,
            ];
            (state.bookings ?? []).push({
              id, event_id, status,
              slot_id, friend_id,
              line_account_id,
              customer_note,
              identity_key,
              requested_at,
              party_size,
              answer_snapshot_json,
              first_participation,
              first_participation_attended_count,
              first_participation_checked_at,
              event_version_id,
              event_snapshot_json,
              approval_expires_at,
            } as BookingRow & Record<string, unknown>);
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('INSERT INTO event_slots')) {
            const [
              id, event_id, starts_at, ends_at, capacity, is_active, sort_order, client_key,
            ] = bound as [string, string, string, string, number | null, number, number, string | null];
            (state.slots ?? []).push({
              id, event_id, starts_at, ends_at, capacity,
              is_active, sort_order, deleted_at: null,
              client_key: client_key ?? null,
              version: 1,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_slots SET deleted_at')) {
            const [deleted_at, _updated, id] = bound as [string, string, string];
            const s = (state.slots ?? []).find((x) => x.id === id);
            if (!s) return { success: true, meta: { changes: 0 } };
            s.deleted_at = deleted_at;
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_slots SET ')) {
            // m26g: 条件付き更新（AND version = ?）を本番どおりに再現する。
            const conditionalVersion = sql.includes('AND version = ?');
            const id = bound[bound.length - (conditionalVersion ? 2 : 1)] as string;
            const s = (state.slots ?? []).find((x) => x.id === id);
            if (!s) return { success: true, meta: { changes: 0 } };
            if (conditionalVersion && (s.version ?? 1) !== bound[bound.length - 1]) {
              return { success: true, meta: { changes: 0 } };
            }
            const setPart = sql.substring('UPDATE event_slots SET '.length, sql.indexOf(' WHERE'));
            const cols = setPart.split(',').map((x) => x.trim());
            let valIdx = 0;
            for (const col of cols) {
              if (/^version\s*=\s*version\s*\+\s*1$/.test(col)) {
                s.version = ((s.version ?? 1) as number) + 1;
                continue;
              }
              const m = /^(\w+)\s*=\s*(\?|strftime)/.exec(col);
              if (!m) continue;
              const colName = m[1];
              if (m[2] === '?') {
                (s as Record<string, unknown>)[colName] = bound[valIdx];
                valIdx++;
              }
            }
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('INSERT INTO events')) {
            const [
              id, line_account_id, name, venue_name, venue_url, image_url,
              description, description_centered,
              max_bookings_per_friend, requires_approval, approval_deadline_hours, cancel_deadline_hours_before,
              reminder_day_before_enabled, reminder_hours_before,
              is_published, sort_order,
              target_type, account_ids, dedup_priority,
            ] = bound as [
              string, string, string, string | null, string | null, string | null,
              string | null, number,
              number | null, number, number, number | null,
              number, number | null,
              number, number,
              string, string | null, string | null,
            ];
            const now = new Date().toISOString();
            state.events.push({
              id,
              line_account_id,
              name,
              venue_name,
              venue_url,
              image_url,
              description,
              description_centered,
              max_bookings_per_friend,
              requires_approval,
              approval_deadline_hours,
              cancel_deadline_hours_before,
              reminder_day_before_enabled,
              reminder_hours_before,
              is_published,
              folder_id: null,
              sort_order,
              deleted_at: null,
              created_at: now,
              updated_at: now,
              target_type: target_type as 'single' | 'multi-account-dedup',
              account_ids,
              dedup_priority,
              questions_json: (bound[27] as string | null) ?? null,
              version: 1,
              current_published_version_id: (bound[28] as string | null) ?? null,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE events SET deleted_at')) {
            // 認可は handler 内で ownsEvent 経由で済んでいるので、ここでは
            // id + deleted_at IS NULL のみで一致させる。
            const [deleted_at, updated_at, id] = bound as [
              string, string, string,
            ];
            const e = state.events.find(
              (x) => x.id === id && x.deleted_at == null,
            );
            if (!e) return { success: true, meta: { changes: 0 } };
            e.deleted_at = deleted_at;
            e.updated_at = updated_at;
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE events SET ')) {
            // Generic field update — parse SET ... WHERE id = ?
            const conditionalVersion = sql.includes('AND version = ?');
            const conditionalToken = sql.includes('AND version_write_token = ?');
            const id = bound[bound.length - (conditionalToken ? 3 : conditionalVersion ? 2 : 1)] as string;
            const e = state.events.find((x) => x.id === id);
            if (!e) return { success: true, meta: { changes: 0 } };
            if (conditionalVersion && e.version !== bound[bound.length - 1]) {
              return { success: true, meta: { changes: 0 } };
            }
            // Extract column list from SET clause
            const setPart = sql.substring('UPDATE events SET '.length, sql.indexOf(' WHERE'));
            const cols = setPart.split(',').map((s) => s.trim());
            let valIdx = 0;
            for (const col of cols) {
              if (/^version\s*=\s*version\s*\+\s*1$/.test(col)) {
                e.version += 1;
                continue;
              }
              const m = /^(\w+)\s*=\s*(\?|strftime)/.exec(col);
              if (!m) continue;
              const colName = m[1];
              if (m[2] === '?') {
                (e as Record<string, unknown>)[colName] = bound[valIdx];
                valIdx++;
              } else {
                e.updated_at = new Date().toISOString();
              }
            }
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
      return stmt;
    },
    async batch(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;
  return db;
}
