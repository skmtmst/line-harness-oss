import { boundedListLimit, jstNow, nonNegativeListOffset } from './utils.js';
// オペレーター＆チャット管理クエリヘルパー

export interface OperatorRow {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ChatRow {
  id: string;
  friend_id: string;
  operator_id: string | null;
  status: string;
  notes: string | null;
  last_message_at: string | null;
  revision?: number;
  last_customer_message_at?: string | null;
  last_operator_message_at?: string | null;
  next_response_due_at?: string | null;
  created_at: string;
  updated_at: string;
}

// --- オペレーター ---

export async function getOperators(db: D1Database): Promise<OperatorRow[]> {
  const result = await db.prepare(`SELECT * FROM operators ORDER BY created_at DESC`).all<OperatorRow>();
  return result.results;
}

export async function getOperatorById(db: D1Database, id: string): Promise<OperatorRow | null> {
  return db.prepare(`SELECT * FROM operators WHERE id = ?`).bind(id).first<OperatorRow>();
}

export async function createOperator(
  db: D1Database,
  input: { name: string; email: string; role?: string },
): Promise<OperatorRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO operators (id, name, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, input.name, input.email, input.role ?? 'operator', now, now).run();
  return (await getOperatorById(db, id))!;
}

export async function updateOperator(
  db: D1Database,
  id: string,
  updates: Partial<{ name: string; email: string; role: string; isActive: boolean }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.email !== undefined) { sets.push('email = ?'); values.push(updates.email); }
  if (updates.role !== undefined) { sets.push('role = ?'); values.push(updates.role); }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE operators SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteOperator(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM operators WHERE id = ?`).bind(id).run();
}

// --- チャット ---

export async function getChats(
  db: D1Database,
  opts: { status?: string; operatorId?: string; limit?: number; offset?: number } = {},
): Promise<ChatRow[]> {
  const limit = boundedListLimit(opts.limit, 200);
  const offset = nonNegativeListOffset(opts.offset);
  if (opts.status && opts.operatorId) {
    const result = await db.prepare(`SELECT * FROM chats WHERE status = ? AND operator_id = ? ORDER BY last_message_at DESC LIMIT ? OFFSET ?`)
      .bind(opts.status, opts.operatorId, limit, offset).all<ChatRow>();
    return result.results;
  }
  if (opts.status) {
    const result = await db.prepare(`SELECT * FROM chats WHERE status = ? ORDER BY last_message_at DESC LIMIT ? OFFSET ?`)
      .bind(opts.status, limit, offset).all<ChatRow>();
    return result.results;
  }
  if (opts.operatorId) {
    const result = await db.prepare(`SELECT * FROM chats WHERE operator_id = ? ORDER BY last_message_at DESC LIMIT ? OFFSET ?`)
      .bind(opts.operatorId, limit, offset).all<ChatRow>();
    return result.results;
  }
  const result = await db.prepare(`SELECT * FROM chats ORDER BY last_message_at DESC LIMIT ? OFFSET ?`)
    .bind(limit, offset).all<ChatRow>();
  return result.results;
}

export async function getChatById(db: D1Database, id: string): Promise<ChatRow | null> {
  return db.prepare(`SELECT * FROM chats WHERE id = ?`).bind(id).first<ChatRow>();
}

export async function getChatByFriendId(db: D1Database, friendId: string): Promise<ChatRow | null> {
  return db.prepare(`SELECT * FROM chats WHERE friend_id = ? ORDER BY created_at DESC LIMIT 1`).bind(friendId).first<ChatRow>();
}

export async function createChat(
  db: D1Database,
  input: { friendId: string; operatorId?: string },
): Promise<ChatRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  // 1 friend = 1 chat 行 (idx_chats_friend_unique)。同時実行でも重複しないよう
  // WHERE NOT EXISTS + OR IGNORE で原子挿入し、挿入の成否に関わらず既存行を返して収束する。
  await db.prepare(
    `INSERT OR IGNORE INTO chats (id, friend_id, operator_id, last_message_at, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM chats WHERE friend_id = ?)`,
  )
    .bind(id, input.friendId, input.operatorId ?? null, now, now, now, input.friendId).run();
  return (await getChatByFriendId(db, input.friendId))!;
}

export async function updateChat(
  db: D1Database,
  id: string,
  updates: Partial<{ operatorId: string | null; status: string; notes: string; lastMessageAt: string }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.operatorId !== undefined) { sets.push('operator_id = ?'); values.push(updates.operatorId); }
  if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status); }
  if (updates.notes !== undefined) { sets.push('notes = ?'); values.push(updates.notes); }
  if (updates.lastMessageAt !== undefined) { sets.push('last_message_at = ?'); values.push(updates.lastMessageAt); }
  if (sets.length === 0) return;
  sets.push('revision = revision + 1');
  if (updates.status === 'in_progress' && updates.lastMessageAt !== undefined) {
    sets.push('last_operator_message_at = ?');
    values.push(updates.lastMessageAt);
  }
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

/** 友だちからメッセージ受信時にチャットを作成/更新 */
export async function upsertChatOnMessage(db: D1Database, friendId: string): Promise<ChatRow> {
  const now = jstNow();
  // createChat はレースで負けた場合も相手が作った行を返すので、必ずその行に対して
  // 受信時の更新 (resolved→unread, last_message_at) を適用する。挿入直後の自行にも
  // 適用されるが no-op 相当なので害はない。
  const chat = (await getChatByFriendId(db, friendId)) ?? (await createChat(db, { friendId }));
  const newStatus = chat.status === 'resolved' || chat.status === 'on_hold' ? 'unread' : chat.status;
  await updateChat(db, chat.id, { status: newStatus, lastMessageAt: now });

  // 受信の時刻を残し、初回返信の時計を巻き直す（107）。
  //
  // 「受信 → 返信までの時間」を出すために要る。新しい問い合わせが来たら、
  // 前の往復の first_replied_at は関係ないので消す。消さないと、
  // 2回目の問い合わせに何時間かかっても「初回返信は速かった」ままになる。
  //
  // 更新に失敗しても受信そのものは成立しているので、握りつぶさず投げる。
  // ここが落ちるのは列が無いときで、それは配布の抜けなので気づきたい。
  await db
    .prepare(
      `UPDATE chats
       SET last_incoming_at = ?, last_customer_message_at = ?, first_replied_at = NULL
       WHERE id = ?`,
    )
    .bind(now, now, chat.id)
    .run();

  return (await getChatById(db, chat.id))!;
}
