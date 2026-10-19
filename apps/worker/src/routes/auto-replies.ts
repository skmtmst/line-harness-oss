import { inputJsonBoundary } from '../lib/input-errors.js';
import { Hono } from 'hono';

import type { Env } from '../worker-env.js';

import { requireDeliveryAccess, requireRole } from '../middleware/role-guard.js';

import { get__api_auto_replies_1, get__api_auto_replies_conflicts_2, post__api_auto_replies_drafts_3, get__api_auto_replies_id_4, get__api_auto_replies_id_draft_5, put__api_auto_replies_id_draft_6, post__api_auto_replies_id_validate_7, get__api_auto_replies_id_conflicts_8, post__api_auto_replies_id_test_9, post__api_auto_replies_id_publish_10 } from './auto-replies-drafts-handlers.js';
import { readDraftSettings, requireVisibleAutoReply } from './auto-replies-definition.js';
import { post__api_auto_replies_1, put__api_auto_replies_id_2, post__api_auto_replies_id_stop_3, delete__api_auto_replies_id_4, post__api_auto_replies_id_restore_5 } from './auto-replies-lifecycle-handlers.js';
import { AUTO_REPLY_KEYWORD_MAX, AUTO_REPLY_RESPONSE_MAX } from './auto-replies-definition.js';

const autoReplies = new Hono<Env>();
export { AUTO_REPLY_KEYWORD_MAX } from './auto-replies-definition.js';
export { AUTO_REPLY_KEYWORDS_MAX } from './auto-replies-definition.js';
export { AUTO_REPLY_RESPONSE_MAX } from './auto-replies-definition.js';
export { readDraftSettings } from './auto-replies-definition.js';

// GET /api/auto-replies — list all auto-replies (optional ?accountId filter)
autoReplies.get('/api/auto-replies', requireRole('owner', 'admin', 'staff'), get__api_auto_replies_1);

/** 一覧・競合画面用。公開中ルール同士と、直近28日の実測だけを返す。 */
autoReplies.get('/api/auto-replies/conflicts', get__api_auto_replies_conflicts_2);

/** 新規設定は下書きだけを作り、この時点では返信を始めない。 */
autoReplies.post('/api/auto-replies/drafts', requireDeliveryAccess('autoReplies'), inputJsonBoundary(), post__api_auto_replies_drafts_3);

// GET /api/auto-replies/:id — get by ID
autoReplies.use('/api/auto-replies/:id', requireVisibleAutoReply);

autoReplies.use('/api/auto-replies/:id/*', requireVisibleAutoReply);

autoReplies.get('/api/auto-replies/:id', get__api_auto_replies_id_4);

autoReplies.get('/api/auto-replies/:id/draft', get__api_auto_replies_id_draft_5);

autoReplies.put('/api/auto-replies/:id/draft', requireDeliveryAccess('autoReplies'), inputJsonBoundary(), put__api_auto_replies_id_draft_6);

// validate と conflicts は公開判断に使う管理操作なので、下書きを書ける人だけ。
// test は本番状態を変えない試運転で、実施結果と担当者だけを監査用に記録する。
// staff にはこの test だけを許可し、作成・更新・公開の権限は広げない。
autoReplies.post('/api/auto-replies/:id/validate', requireDeliveryAccess('autoReplies'), inputJsonBoundary(), post__api_auto_replies_id_validate_7);

autoReplies.get('/api/auto-replies/:id/conflicts', requireDeliveryAccess('autoReplies'), get__api_auto_replies_id_conflicts_8);

autoReplies.post('/api/auto-replies/:id/test', requireRole('owner', 'admin', 'staff'), inputJsonBoundary(), post__api_auto_replies_id_test_9);

autoReplies.post('/api/auto-replies/:id/publish', requireDeliveryAccess('autoReplies'), inputJsonBoundary(), post__api_auto_replies_id_publish_10);

// POST /api/auto-replies — create
// 用途: 一覧の編集ダイアログからの新規作成と、既存ルールの直接更新（PUT :id）。
// 下書き経由（PUT :id/draft → validate/conflicts/test → publish）に寄せていない
// 理由: 新規作成時は下書きが存在せず、版の取得・テスト必須の公開フローに
// 乗せられない。公開前のテスト・競合確認は公開画面のフローで担保する。
// いずれも owner/admin 専用で、本文の長さ上限は下書きと同じ基準を見る。
//
// isActive は省略・false ともに「止まった状態」で作る（AUTOREPLY-08）。
// 前は入力を無視して常に有効で作っていたため、オフで保存したルールが
// 届いたメッセージへ応答していた。動かすのは isActive: true の明示指定か、
// 保存後の再開・公開操作だけにする。
// F7: isActive: true の指定があっても、作る前に既存の有効ルールと当てる。
// 当たれば有効化せず下書きで作り、理由を社内メモへ残す（応答にも返す）。
// 当たらなければ要求どおりすぐ有効にする。
autoReplies.post('/api/auto-replies', requireDeliveryAccess('autoReplies'), inputJsonBoundary({"keyword":["string"],"matchType":["string"],"responseType":["string"],"responseContent":["string"],"templateId":["null","string"],"lineAccountId":["null","string"],"respondToAll":["boolean"],"name":["null","string"],"keywordMatchMode":["string"],"normalizeKeywords":["boolean"],"folderId":["null","string"]}), post__api_auto_replies_1);

// PUT /api/auto-replies/:id — update
autoReplies.put('/api/auto-replies/:id', requireDeliveryAccess('autoReplies'), inputJsonBoundary({"keyword":["string"],"matchType":["string"],"responseType":["string"],"responseContent":["string"],"templateId":["null","string"],"lineAccountId":["null","string"],"isActive":["boolean"]}), put__api_auto_replies_id_2);

/**
 * POST /api/auto-replies/:id/stop — 専用の停止口（機能08 点検 E-01）。
 *
 * isActive の素のトグルでは「いつ・誰が・なぜ止めたか」が残らない。
 * 停止は運用の判断なので、理由（任意）・担当者・日時を記録する。
 * 確認キー（Idempotency-Key）必須。同じキーの再送は新しい停止として残さない。
 */
autoReplies.post('/api/auto-replies/:id/stop', requireDeliveryAccess('autoReplies'), inputJsonBoundary(), post__api_auto_replies_id_stop_3);

// DELETE /api/auto-replies/:id
// 物理削除ではなく履歴を残す方式（機能08 点検 N-085）。設定と担当者を残し、
// 一覧・評価・集計からは外れる。過去の一致記録と実行台帳はそのまま残る。
autoReplies.delete('/api/auto-replies/:id', requireDeliveryAccess('autoReplies'), delete__api_auto_replies_id_4);

/**
 * POST /api/auto-replies/:id/restore — 削除の取り消し（B 元に戻す）。
 *
 * 論理削除（deleted_at）の行だけを戻す。戻した直後は止めたまま
 * （is_active = 0）で送り出さない。再開は画面の再開操作で行う。
 * 消していない行・無い行は 404。
 */
autoReplies.post('/api/auto-replies/:id/restore', requireDeliveryAccess('autoReplies'), inputJsonBoundary(), post__api_auto_replies_id_restore_5);

export { autoReplies };
