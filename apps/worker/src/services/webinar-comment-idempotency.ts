import { countSessionUserComments, insertWebinarUserComment } from '@line-crm/db';

type Comment = { webinarId: string; friendId: string; sessionStartAt: number; atSeconds: number; body: string };
type Stored = { webinar_id: string; friend_id: string; session_start_at: number; at_seconds: number; body: string };

/** ID は対象と本人に閉じる。既存の主キーを使い、並行再送も一件にする。 */
export async function recordKeyedWebinarComment(db: D1Database, comment: Comment, requestId: string, limit: number) {
  const input = JSON.stringify([comment.webinarId, comment.friendId, requestId]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const id = `wc_${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  const lookup = () => db.prepare('SELECT webinar_id, friend_id, session_start_at, at_seconds, body FROM webinar_user_comments WHERE id = ?').bind(id).first<Stored>();
  const matches = (row: Stored) => row.webinar_id === comment.webinarId && row.friend_id === comment.friendId
    && row.session_start_at === comment.sessionStartAt && row.at_seconds === comment.atSeconds && row.body === comment.body;
  const existing = await lookup();
  if (existing) return matches(existing) ? 'duplicate' : 'conflict';
  if (await countSessionUserComments(db, comment.webinarId, comment.friendId, comment.sessionStartAt) >= limit) return 'limit';
  await insertWebinarUserComment(db, { ...comment, id });
  const saved = await lookup();
  return saved && matches(saved) ? 'saved' : 'conflict';
}
