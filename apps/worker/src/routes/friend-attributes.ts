import { inputJsonBoundary } from '../lib/input-errors.js';
import { Hono } from 'hono';

import type { Env } from '../worker-env.js';
import { requireRole, denyReadOnly } from '../middleware/role-guard.js';

import { get__api_support_marks_1, post__api_support_marks_id_restore_2, post__api_support_marks_3, patch__api_support_marks_reorder_4, patch__api_support_marks_id_5, get__api_support_marks_id_automation_rules_6, post__api_support_marks_id_automation_rules_7, patch__api_support_mark_rules_ruleId_8, delete__api_support_mark_rules_ruleId_9, get__api_support_marks_id_archive_impact_10, post__api_support_marks_id_archive_11, delete__api_support_marks_id_12, patch__api_friends_id_support_mark_13 } from './friend-attributes-support-marks-handlers.js';

import { post__api_friends_support_mark_bulk_1, get__api_saved_searches_2, get__api_saved_searches_id_3, post__api_saved_searches_preview_4, post__api_saved_searches_5, patch__api_saved_searches_reorder_6, patch__api_saved_searches_id_7, delete__api_saved_searches_id_8, get__api_login_audit_9, get__api_folders_10 } from './friend-attributes-searches-handlers.js';

import { post__api_folders_1, patch__api_folders_id_2, post__api_folders_id_swap_order_3, delete__api_folders_id_4 } from './friend-attributes-folders-handlers.js';

/**
 * 対応マーク・保存した検索・汎用フォルダ。
 *
 * 3つとも「友だち属性」の画面の中のタブなので、1つのルータにまとめている。
 * どれも小さく、別ファイルに散らすと登録漏れの方が起きやすい。
 */
const friendAttributes = new Hono<Env>();

// ── 対応マーク ──────────────────────────────────────────────

friendAttributes.get('/api/support-marks', get__api_support_marks_1);

friendAttributes.post('/api/support-marks/:id/restore', requireRole('owner', 'admin'), denyReadOnly(), post__api_support_marks_id_restore_2);

friendAttributes.post('/api/support-marks', requireRole('owner', 'admin'), inputJsonBoundary(), post__api_support_marks_3);

/**
 * PATCH /api/support-marks/reorder — 並び順をまとめて書く（#1014 ATTR-02/03/04）。
 *
 * /api/support-marks/:id より前に置く。共有マークは `updateSupportMark` で
 * 複製＋付け替えが走るため、行ごとの PATCH に混ぜると「並び替えただけで
 * 共有マークが複製される」事故になる。ここでは動かせる行だけを入れ替える。
 */
friendAttributes.patch('/api/support-marks/reorder', requireRole('owner', 'admin'), inputJsonBoundary(), patch__api_support_marks_reorder_4);

friendAttributes.patch('/api/support-marks/:id', requireRole('owner', 'admin'), inputJsonBoundary(), patch__api_support_marks_id_5);

friendAttributes.get(
  '/api/support-marks/:id/automation-rules',
  requireRole('owner', 'admin'),
  get__api_support_marks_id_automation_rules_6,
);

friendAttributes.post(
  '/api/support-marks/:id/automation-rules',
  requireRole('owner', 'admin'),
  inputJsonBoundary(), post__api_support_marks_id_automation_rules_7,
);

friendAttributes.patch(
  '/api/support-mark-rules/:ruleId',
  requireRole('owner', 'admin'),
  inputJsonBoundary(), patch__api_support_mark_rules_ruleId_8,
);

friendAttributes.delete(
  '/api/support-mark-rules/:ruleId',
  requireRole('owner', 'admin'),
  delete__api_support_mark_rules_ruleId_9,
);

friendAttributes.get(
  '/api/support-marks/:id/archive-impact',
  requireRole('owner', 'admin'),
  get__api_support_marks_id_archive_impact_10,
);

friendAttributes.post(
  '/api/support-marks/:id/archive',
  requireRole('owner', 'admin'),
  inputJsonBoundary(), post__api_support_marks_id_archive_11,
);

friendAttributes.delete('/api/support-marks/:id', requireRole('owner', 'admin'), delete__api_support_marks_id_12);

friendAttributes.patch(
  '/api/friends/:id/support-mark',
  requireRole('owner', 'admin', 'staff'),
  inputJsonBoundary(), patch__api_friends_id_support_mark_13,
);

friendAttributes.post(
  '/api/friends/support-mark/bulk',
  requireRole('owner', 'admin', 'staff'),
  inputJsonBoundary(), post__api_friends_support_mark_bulk_1,
);

// ── 保存した検索 ────────────────────────────────────────────

friendAttributes.get('/api/saved-searches', requireRole('owner', 'admin', 'staff'), get__api_saved_searches_2);

friendAttributes.get(
  '/api/saved-searches/:id',
  requireRole('owner', 'admin', 'staff'),
  get__api_saved_searches_id_3,
);

friendAttributes.post(
  '/api/saved-searches/preview',
  requireRole('owner', 'admin', 'staff'),
  inputJsonBoundary(), post__api_saved_searches_preview_4,
);

friendAttributes.post('/api/saved-searches', requireRole('owner', 'admin', 'staff'), inputJsonBoundary(), post__api_saved_searches_5);

/**
 * PATCH /api/saved-searches/reorder — 並び順をまとめて書く（#1014 ATTR-02/03）。
 *
 * /api/saved-searches/:id より前に置く。他人が作った検索へ行ごとの
 * PATCH は404で途中までしか反映されなかった。ここでは「動かせる行だけの
 * 新しい順」を受け取り、触れない行の位置を保ったまま1回で書く。
 */
friendAttributes.patch(
  '/api/saved-searches/reorder',
  requireRole('owner', 'admin', 'staff'),
  inputJsonBoundary(), patch__api_saved_searches_reorder_6,
);

friendAttributes.patch(
  '/api/saved-searches/:id',
  requireRole('owner', 'admin', 'staff'),
  inputJsonBoundary(), patch__api_saved_searches_id_7,
);

friendAttributes.delete(
  '/api/saved-searches/:id',
  requireRole('owner', 'admin', 'staff'),
  delete__api_saved_searches_id_8,
);

// ── ログイン履歴 ────────────────────────────────────────────
//
// 誰がいつ入ったか、誰が個人情報を開いたか。個人情報保護法上の利用記録
// として残す必要がある。
//
// オーナーと管理者だけが見られる。誰がいつ入ったかは、それ自体が
// 見せてよい情報とは限らない。
friendAttributes.get('/api/login-audit', requireRole('owner', 'admin'), get__api_login_audit_9);

// ── 汎用フォルダ ────────────────────────────────────────────

friendAttributes.get('/api/folders', get__api_folders_10);

friendAttributes.post('/api/folders', requireRole('owner', 'admin'), inputJsonBoundary(), post__api_folders_1);

friendAttributes.patch('/api/folders/:id', requireRole('owner', 'admin'), inputJsonBoundary(), patch__api_folders_id_2);

/*
 * V6R-S2-c: 隣り合う2つのフォルダの並びを、1回で入れ替える。
 *
 * 以前は画面が PATCH を2回送っていた。1回目だけ成功すると同じ番号のフォルダが
 * 2つ残り、番号が同じ2つは入れ替えても並びが変わらなかった。
 * 同じ種類・同じアカウント・同じ親のフォルダ同士だけを受け付ける。
 */
friendAttributes.post('/api/folders/:id/swap-order', requireRole('owner', 'admin'), inputJsonBoundary(), post__api_folders_id_swap_order_3);

// 中身は消えず「未分類」に戻る。ただし子フォルダは一緒に消える。
friendAttributes.delete('/api/folders/:id', requireRole('owner', 'admin'), delete__api_folders_id_4);

export { friendAttributes };
