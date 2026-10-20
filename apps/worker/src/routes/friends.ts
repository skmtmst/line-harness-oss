import { registerFriendDeliveryConsents } from './friend-delivery-consents.js';

import { inputJsonBoundary } from '../lib/input-errors.js';

import { Hono } from 'hono';

import type { Env } from '../worker-env.js';

import { denyReadOnly, requireIrreversibleConfirmation, requireRole } from '../middleware/role-guard.js';

import { delete__api_friends_id_data_1, get__api_friends_saved_views_2, post__api_friends_saved_views_3 } from './friends-saved-views-handlers.js';
import { requireVisibleFriend } from './friends-definition.js';
import { get__api_friends_1, get__api_friends_add_breakdown_2, get__api_friends_count_3, get__api_friends_ref_stats_4 } from './friends-list-handlers.js';
import { escapeLikePattern } from './friends-definition.js';
import { get__api_friends_id_mileage_1, get__api_friends_id_upcoming_2, get__api_friends_stats_3, get__api_friends_id_summary_4, get__api_friends_id_5, get__api_friends_id_form_submissions_6, post__api_friends_id_tags_7, delete__api_friends_id_tags_tagId_8, put__api_friends_id_metadata_9, get__api_friends_id_messages_10 } from './friends-summaries-handlers.js';

import { get__api_friends_id_timeline_1, post__api_friends_id_messages_2 } from './friends-timeline-handlers.js';
import { requireIdempotencyKey } from './friends-definition.js';

const friends = new Hono<Env>();
export { escapeLikePattern } from './friends-definition.js';
export { requireVisibleFriend } from './friends-definition.js';

// customer-requested erasure. Unfollow never calls this route.
friends.delete('/api/friends/:id/data', requireRole('owner', 'admin'), denyReadOnly(), requireIrreversibleConfirmation('delete-friend-data'), delete__api_friends_id_data_1);

registerFriendDeliveryConsents(friends, requireVisibleFriend);

// 機能3の正規URL。旧 /api/saved-searches は互換口として残す。
friends.get('/api/friends/saved-views', requireRole('owner', 'admin', 'staff'), get__api_friends_saved_views_2);

friends.post('/api/friends/saved-views', requireRole('owner', 'admin', 'staff'), inputJsonBoundary(), post__api_friends_saved_views_3);

// GET /api/friends - list with pagination
friends.get('/api/friends', requireRole('owner', 'admin', 'staff'), get__api_friends_1);

// GET /api/friends/count - friend count (must be before /:id)
// 友だち追加の内訳（設計 V2 4-6）。「はじめての人」と「以前からの友だち」を
// 分けて数える。追加時の配信を1本しか持てないうちは、returning の人数が
// そのまま「はじめまして」を誤って送った人数になる。
friends.get('/api/friends/add-breakdown', get__api_friends_add_breakdown_2);

friends.get('/api/friends/count', get__api_friends_count_3);

// GET /api/friends/ref-stats - ref code attribution stats
friends.get('/api/friends/ref-stats', get__api_friends_ref_stats_4);

// GET /api/friends/:id/mileage - admin wallet summary + recent ledger history
friends.get('/api/friends/:id/mileage', requireVisibleFriend, get__api_friends_id_mileage_1);

/*
 * GET /api/friends/:id/upcoming — 受信箱の顧客情報に出す「次の予定」(IDEA-02)。
 *
 * 返すのは確定している未来の予定だけ:
 *   - nextBooking … 予約（bookings / event_bookings / meet_consultations の
 *     うち status が requested/confirmed で開始が未来のものの最先着）
 *   - nextAutoDelivery … 確定した自動配信（friend_scenarios の
 *     next_delivery_at と、queued 済みの reminder_delivery_runs の最先着）
 *
 * 条件付きでしか出ない将来配信（絞り込み配信の動的対象など）はここに
 * 含めない。「未確定を確定予定と表示しない」ため。
 *
 * それぞれの取得は独立させ、片方の失敗でもう片方まで隠さない。
 * 失敗は null ではなく *_Error=true で返し、画面が「未取得」と
 * 「予定なし」を区別できるようにする。
 */
friends.get('/api/friends/:id/upcoming', requireVisibleFriend, get__api_friends_id_upcoming_2);

// GET /api/friends/:id - get single friend with tags
/**
 * 友だち画面の上部に出す数（設計 `V2 2-2 友だち` の KPIs）。
 *
 * :id より前に置くこと。あとに置くと 'stats' が id として拾われる。
 */
friends.get('/api/friends/stats', get__api_friends_stats_3);

// 既存の友だち詳細を変えず、数の帯用の集計を別の口で返す。
friends.get('/api/friends/:id/summary', requireVisibleFriend, get__api_friends_id_summary_4);

friends.get('/api/friends/:id', requireVisibleFriend, get__api_friends_id_5);

/*
 * PERF-13: フォーム回答履歴をカーソル式で取る口。
 * 友だち詳細の「回答フォーム」タブが開かれたときに呼ばれる。
 * 10件ずつ、nextCursor で古い回答へ遡れる。認証とアカウント所属の
 * 確認は requireVisibleFriend が担う（本体と同じ境界）。
 */
friends.get('/api/friends/:id/form-submissions', requireVisibleFriend, get__api_friends_id_form_submissions_6);

// POST /api/friends/:id/tags - add tag
friends.post('/api/friends/:id/tags', requireRole('owner', 'admin', 'staff'), requireVisibleFriend, inputJsonBoundary({"tagId":["string"]}), post__api_friends_id_tags_7);

// DELETE /api/friends/:id/tags/:tagId - remove tag
friends.delete('/api/friends/:id/tags/:tagId', requireRole('owner', 'admin', 'staff'), requireVisibleFriend, delete__api_friends_id_tags_tagId_8);

// PUT /api/friends/:id/metadata - merge metadata fields
friends.put('/api/friends/:id/metadata', requireRole('owner', 'admin', 'staff'), requireVisibleFriend, inputJsonBoundary(), put__api_friends_id_metadata_9);

// GET /api/friends/:id/messages - get message history
friends.get('/api/friends/:id/messages', requireVisibleFriend, get__api_friends_id_messages_10);

friends.get(
  '/api/friends/:id/timeline',
  requireRole('owner', 'admin', 'staff'),
  requireVisibleFriend,
  get__api_friends_id_timeline_1,
);

// POST /api/friends/:id/messages - send message to friend
friends.post('/api/friends/:id/messages', requireRole('owner', 'admin', 'staff'), requireIdempotencyKey, requireVisibleFriend, inputJsonBoundary({"messageType":["string"],"content":["string"],"altText":["string"],"trackLinks":["boolean"]}), post__api_friends_id_messages_2);

export { friends };
