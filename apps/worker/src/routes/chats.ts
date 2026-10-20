import { inputJsonBoundary } from '../lib/input-errors.js';
import { Hono } from 'hono';

import type { Env } from '../worker-env.js';

import { requireRole } from '../middleware/role-guard.js';

import { get__api_operators_1, post__api_operators_2, put__api_operators_id_3, delete__api_operators_id_4, get__api_chats_stats_5, get__api_chats_quick_counts_6, get__api_chats_outbound_failures_7 } from './chats-operators-handlers.js';
import { get__api_chats_1, get__api_chats_id_2, post__api_chats_id_read_3, post__api_chats_read_all_4, get__api_chats_id_events_5 } from './chats-threads-handlers.js';
import { requireVisibleChat } from './chats-definition.js';
import { get__api_inbox_saved_views_1, post__api_inbox_saved_views_2, patch__api_inbox_saved_views_id_3, delete__api_inbox_saved_views_id_4, post__api_chats_5, put__api_chats_id_6, post__api_chats_id_loading_7 } from './chats-saved-views-handlers.js';

import { post__api_chats_id_send_1, post__api_chats_id_render_preview_2 } from './chats-send-handlers.js';

import { post__api_chats_id_send_combined_1, post__api_chats_id_schedule_2, get__api_chats_id_scheduled_3, patch__api_chats_id_scheduled_scheduleId_4, delete__api_chats_id_scheduled_scheduleId_5 } from './chats-scheduled-handlers.js';

const chats = new Hono<Env>();

// ========== オペレーターCRUD ==========

chats.get('/api/operators', requireRole('owner', 'admin', 'staff'), get__api_operators_1);

chats.post('/api/operators', requireRole('owner', 'admin'), inputJsonBoundary({"name":["string"],"email":["string"],"role":["string"]}), post__api_operators_2);

chats.put('/api/operators/:id', requireRole('owner', 'admin'), inputJsonBoundary(), put__api_operators_id_3);

chats.delete('/api/operators/:id', requireRole('owner', 'admin'), delete__api_operators_id_4);

// ========== チャットCRUD ==========

/**
 * 受信箱の上部に出す数（設計 `V2 2-1 受信箱` の KPIs）。
 *
 * :id より先に置く。あとに置くと 'stats' が id として解釈される。
 */
chats.get('/api/chats/stats', requireRole('owner', 'admin', 'staff'), get__api_chats_stats_5);

/**
 * 受信箱のクイック絞り込み（すべて／要返信／1時間以上待ち）の件数。
 *
 * INBOX-09: 「すべて」は読み込み済みの行数、「要返信」は別の集計口を
 * 見ていたため、表示された件数と押したときの結果が一致しなかった。
 * ここでは一覧（GET /api/chats・GET /api/support/inbox?channel=email）と
 * 同じ条件（アカウント・検索語・担当・未読・経路）を1回の応答へまとめ、
 * ページに載った行数ではなく条件全体をサーバーで数える。
 *
 * quickFilter 自体は引数に取らない。各札の件数は「その札を押したときの
 * 条件」をこちらで足して数える。返すのは選択中の経路（channel）で
 * 画面に見える側だけの合計。
 *
 * :id より先に置く。あとに置くと 'quick-counts' が id として解釈される。
 */
chats.get('/api/chats/quick-counts', requireRole('owner', 'admin', 'staff'), get__api_chats_quick_counts_6);

/** 個別送信の失敗台帳。必ずLINEアカウントを指定し、担当範囲の中だけ返す。 */
chats.get('/api/chats/outbound-failures', requireRole('owner', 'admin', 'staff'), get__api_chats_outbound_failures_7);

chats.get('/api/chats', requireRole('owner', 'admin', 'staff'), get__api_chats_1);

chats.get('/api/chats/:id', requireVisibleChat, get__api_chats_id_2);

// 開いた担当者だけを既読にする。対応状態は共有だが、既読位置は共有しない。
chats.post('/api/chats/:id/read', requireRole('owner', 'admin', 'staff'), requireVisibleChat, inputJsonBoundary(), post__api_chats_id_read_3);

chats.post('/api/chats/read-all', requireRole('owner', 'admin', 'staff'), inputJsonBoundary(), post__api_chats_read_all_4);

chats.get(
  '/api/chats/:id/events',
  requireRole('owner', 'admin', 'staff'),
  requireVisibleChat,
  get__api_chats_id_events_5,
);

chats.get('/api/inbox/saved-views', requireRole('owner', 'admin', 'staff'), get__api_inbox_saved_views_1);

chats.post('/api/inbox/saved-views', requireRole('owner', 'admin', 'staff'), inputJsonBoundary(), post__api_inbox_saved_views_2);

chats.patch('/api/inbox/saved-views/:id', requireRole('owner', 'admin', 'staff'), inputJsonBoundary(), patch__api_inbox_saved_views_id_3);

chats.delete('/api/inbox/saved-views/:id', requireRole('owner', 'admin', 'staff'), delete__api_inbox_saved_views_id_4);

chats.post('/api/chats', requireRole('owner', 'admin', 'staff'), inputJsonBoundary({"friendId":["string"],"operatorId":["string"],"lineAccountId":["null","string"]}), post__api_chats_5);

// チャットのアサイン/ステータス更新/ノート更新
chats.put('/api/chats/:id', requireRole('owner', 'admin', 'staff'), requireVisibleChat, inputJsonBoundary({"operatorId":["null","string"],"status":["string"],"notes":["string"],"revision":["number"],"reason":["string"]}), put__api_chats_id_6);

// オペレーター入力中のローディング表示を開始
chats.post('/api/chats/:id/loading', requireRole('owner', 'admin', 'staff'), requireVisibleChat, inputJsonBoundary({"loadingSeconds":["number"]}), post__api_chats_id_loading_7);

// オペレーターからメッセージ送信
chats.post('/api/chats/:id/send', requireRole('owner', 'admin', 'staff'), requireVisibleChat, inputJsonBoundary({"messageType":["string"],"content":["string"],"revision":["number"],"quotedMessageId":["string"]}), post__api_chats_id_send_1);

/**
 * POST /api/chats/:id/render-preview — 送信内容の差し込み解決プレビュー(N-026)。
 *
 * 送信口(`/send`)と同じ解決器を通した本文を返す。読み取りだけで
 * LINE呼出し・履歴書込みはしない。`unresolved` に残る差し込みは
 * 送信時にそのまま拒否されるので、画面はここで事前に見せられる。
 */
chats.post('/api/chats/:id/render-preview', requireRole('owner', 'admin', 'staff'), requireVisibleChat, inputJsonBoundary(), post__api_chats_id_render_preview_2);

/**
 * POST /api/chats/:id/send-combined — 画像と本文を1回の送信単位にする(N-022)。
 *
 * 単体送信口を2回呼ぶと、画像だけ届いて本文が落ちる部分送信になる。
 * 結合口は画像URL・本文長・権限・所属を外部送信前にすべて検証し、
 * LINEへは1回のpush要求のメッセージ配列として送る。片方の検証失敗時は
 * LINE呼び出し0回・保存0件。冪等予約は単体口と共用する。
 */
chats.post('/api/chats/:id/send-combined', requireRole('owner', 'admin', 'staff'), requireVisibleChat, inputJsonBoundary(), post__api_chats_id_send_combined_1);

/**
 * POST /api/chats/:id/schedule — 返信の予約作成。
 * Idempotency-Keyは必須で、同じキーの再送は新しい予約を作らず既存を返す。
 * 別キーでも「対象・内容・送信予定時刻」が一致する処理中の予約があれば
 * 新しい行を作らず既存行を返す(#977)。replayed=true でどちらの再利用かは
 * 区別せず、画面は返された予約1件だけを表示すればよい。
 */
chats.post('/api/chats/:id/schedule', requireRole('owner', 'admin', 'staff'), requireVisibleChat, inputJsonBoundary(), post__api_chats_id_schedule_2);

/** GET /api/chats/:id/scheduled — 会話の待機中・送信中の予約一覧。 */
chats.get('/api/chats/:id/scheduled', requireRole('owner', 'admin', 'staff'), requireVisibleChat, get__api_chats_id_scheduled_3);

/**
 * PATCH /api/chats/:id/scheduled/:scheduleId — 予約の時刻・本文変更。
 * scheduled の行だけCASで書き換える。sending以降は409。
 */
chats.patch('/api/chats/:id/scheduled/:scheduleId', requireRole('owner', 'admin', 'staff'), requireVisibleChat, inputJsonBoundary(), patch__api_chats_id_scheduled_scheduleId_4);

/** DELETE /api/chats/:id/scheduled/:scheduleId — 予約の取消。scheduled の行だけCAS。 */
chats.delete('/api/chats/:id/scheduled/:scheduleId', requireRole('owner', 'admin', 'staff'), requireVisibleChat, delete__api_chats_id_scheduled_scheduleId_5);

export { chats };
