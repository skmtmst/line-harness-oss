import { inputJsonBoundary } from '../lib/input-errors.js';

import { Hono } from 'hono';

import type { Env } from '../worker-env.js';

import { requireRole } from '../middleware/role-guard.js';

import { get__api_conversions_definitions_1, post__api_conversions_definitions_2, post__api_conversions_definitions_preview_3, get__api_conversions_definitions_id_4, get__api_conversions_definitions_id_delete_impact_5, post__api_conversions_definitions_id_stop_6, post__api_conversions_definitions_id_revise_7, post__api_conversions_definitions_id_replace_8, delete__api_conversions_definitions_id_9, post__api_conversions_definitions_id_publish_10, post__api_conversions_definitions_id_ingest_secret_11, post__api_conversions_definitions_id_ingest_disable_12, post__api_conversions_definitions_id_ingest_enable_13, get__api_conversions_definitions_id_ingest_events_14, get__api_conversions_definitions_id_events_15, post__api_conversions_ingest_id_16 } from './conversions-definitions-handlers.js';
import { conversionPermission } from './conversions-definition.js';
import { post__api_conversions_definitions_id_usages_1, get__api_conversions_export_2, get__api_conversions_points_3, post__api_conversions_points_4, put__api_conversions_points_id_5, delete__api_conversions_points_id_6, post__api_conversions_track_7, get__api_conversions_events_8, get__api_conversions_events_id_reversals_9, post__api_conversions_events_id_reversals_10, get__api_conversions_report_11, get__api_conversions_approvals_counts_12, get__api_conversions_approvals_13 } from './conversions-reports-handlers.js';
import { requireVisibleConversionPoint } from './conversions-definition.js';
import { get__api_conversions_events_id_attribution_1, patch__api_conversions_events_id_approval_2, post__api_conversions_approvals_bulk_3 } from './conversions-attribution-handlers.js';
import { requireVisibleConversionEvent, requireApprovalPermission } from './conversions-definition.js';

const conversions = new Hono<Env>();

// ── Conversion Points ───────────────────────────────────────────────────────

// GET /api/conversions/definitions - list, filters, state counts and metrics
conversions.get('/api/conversions/definitions', conversionPermission('view'), get__api_conversions_definitions_1);

// POST /api/conversions/definitions - save the complete definition and its initial usages
conversions.post('/api/conversions/definitions', conversionPermission('edit'), inputJsonBoundary(), post__api_conversions_definitions_2);

// POST /api/conversions/definitions/preview - calculate from the submitted draft without saving it
conversions.post('/api/conversions/definitions/preview', conversionPermission('edit'), inputJsonBoundary(), post__api_conversions_definitions_preview_3);

// GET /api/conversions/definitions/:id - definition, current version and usages
conversions.get('/api/conversions/definitions/:id', conversionPermission('view'), get__api_conversions_definitions_id_4);

conversions.get('/api/conversions/definitions/:id/delete-impact', conversionPermission('view'), get__api_conversions_definitions_id_delete_impact_5);

conversions.post('/api/conversions/definitions/:id/stop', conversionPermission('edit'), inputJsonBoundary(), post__api_conversions_definitions_id_stop_6);

/*
 * POST /api/conversions/definitions/:id/revise — 履歴を保ったまま編集して次の版にする（N-252）。
 *
 * 停止・差し替えと同じく、版は本文で受けて CAS に使う。負けたら 409 で、
 * DBには何も残さない。過去の成果は書き換えない（集計は計測時の控えを見ている）。
 */
conversions.post('/api/conversions/definitions/:id/revise', conversionPermission('edit'), inputJsonBoundary(), post__api_conversions_definitions_id_revise_7);

conversions.post('/api/conversions/definitions/:id/replace', conversionPermission('edit'), inputJsonBoundary(), post__api_conversions_definitions_id_replace_8);

conversions.delete('/api/conversions/definitions/:id', conversionPermission('edit'), delete__api_conversions_definitions_id_9);

/*
 * POST /api/conversions/definitions/:id/publish — 下書きを計測中へ(N-268)。
 *
 * 下書きは保存だけの状態で、どの計測経路にも乗らない。公開すると
 * status='active' になり、内部起点・外部受信の両方で数え始める。
 */
conversions.post('/api/conversions/definitions/:id/publish', conversionPermission('edit'), inputJsonBoundary(), post__api_conversions_definitions_id_publish_10);

// ── 外部受信 (N-270) ─────────────────────────────────────────────────────────
//
// 地点ごとの受信鍵で HMAC-SHA256 を照合する。受信の成否は
// conversion_ingestion_events に残す(秘密値・署名・本文は残さない)。

/**
 * POST /api/conversions/definitions/:id/ingest-secret — 受信鍵の発行・再発行。
 * 平文はこの応答でだけ返す。再発行は古い鍵をその場で無効にする。
 */
conversions.post('/api/conversions/definitions/:id/ingest-secret', conversionPermission('edit'), inputJsonBoundary(), post__api_conversions_definitions_id_ingest_secret_11);

/** POST /api/conversions/definitions/:id/ingest-disable — 外部受信を止める(起点停止)。 */
conversions.post('/api/conversions/definitions/:id/ingest-disable', conversionPermission('edit'), inputJsonBoundary(), post__api_conversions_definitions_id_ingest_disable_12);

/** POST /api/conversions/definitions/:id/ingest-enable — 止めた外部受信を再開する。 */
conversions.post('/api/conversions/definitions/:id/ingest-enable', conversionPermission('edit'), inputJsonBoundary(), post__api_conversions_definitions_id_ingest_enable_13);

/** GET /api/conversions/definitions/:id/ingest-events — 受信の成否履歴。 */
conversions.get('/api/conversions/definitions/:id/ingest-events', conversionPermission('view'), get__api_conversions_definitions_id_ingest_events_14);

/**
 * GET /api/conversions/definitions/:id/events — 成果1件ずつの一覧(IDEA-19)。
 *
 * 「購入」「相談完了」など成果名の下に、1件ごとの状態(確定・確認待ち・
 * 却下・取消)を新しい順で返す。承認状態と取消台帳からの導出は
 * listConversionDefinitionEvents が担い、画面は状態を組み立て直さない。
 * 検証の受信は成果表へ書かないため、この一覧には本番実績だけが並ぶ。
 */
conversions.get('/api/conversions/definitions/:id/events', conversionPermission('view'), get__api_conversions_definitions_id_events_15);

/**
 * POST /api/conversions/ingest/:id — 外部システムからの成果受信(N-270)。
 *
 * 管理認証を通さない公開口(isPublicApiBoundary で公開境界に登録済み)。
 * 地点ごとの受信鍵で HMAC-SHA256 を照合する。友だちは friendId または
 * lineUserId で指定し、sourceEventId で再送を冪等に捌く。
 *
 * 成否は conversion_ingestion_events に残す。台帳の失敗で受信そのものを
 * 止めないよう、台帳への書き込みは握りつぶしてログだけ残す。
 */
conversions.post('/api/conversions/ingest/:id', inputJsonBoundary(), post__api_conversions_ingest_id_16);

conversions.post('/api/conversions/definitions/:id/usages', conversionPermission('edit'), inputJsonBoundary(), post__api_conversions_definitions_id_usages_1);

// GET /api/conversions/export - same filters as the list, bounded to 10,000 rows
conversions.get('/api/conversions/export', conversionPermission('export'), get__api_conversions_export_2);

// GET /api/conversions/points - list all
//
// 旧口だが成果・承認待ち(友だち名含む)を返すので、定義系と同じ
// `conversionPermission('view')` で縛る(#513 M1)。アカウント境界の
// 可視範囲はDB問い合わせのWHEREへ渡し、全件をメモリへ載せない(#513 L13)。
conversions.get('/api/conversions/points', conversionPermission('view'), get__api_conversions_points_3);

// POST /api/conversions/points - create
conversions.post('/api/conversions/points', requireRole('owner', 'admin'), inputJsonBoundary(), post__api_conversions_points_4);

// PUT /api/conversions/points/:id - update
// 送られた項目だけを触る。画面が「計測方法だけ変える」ような部分更新をするため。
// ただし旧口のまま版・利用先確認を通さず上書きすると、稼働中の数え方が
// 後から変わる(N-254)。定義系と同じく版の一致を求め、稼働中または
// 成果・利用先のある地点の数え方は新版作成か停止後の手順へ案内する。
conversions.put('/api/conversions/points/:id', requireRole('owner', 'admin'), requireVisibleConversionPoint, inputJsonBoundary(), put__api_conversions_points_id_5);

// DELETE /api/conversions/points/:id - stop tracking and preserve history
//
// 停止も版を進める操作のため、旧PUTと同じく版の一致を必須にする(N-254)。
// 版は本文が正本。代理やプロキシで本文が落ちたときだけクエリを見る(#513 L11)。
conversions.delete('/api/conversions/points/:id', requireRole('owner', 'admin'), requireVisibleConversionPoint, delete__api_conversions_points_id_6);

// ── Conversion Tracking ─────────────────────────────────────────────────────

// POST /api/conversions/track - record conversion
conversions.post('/api/conversions/track', requireRole('owner', 'admin'), inputJsonBoundary({"conversionPointId":["string"],"friendId":["string"],"userId":["null","string"],"affiliateCode":["null","string"],"metadata":["null","object"],"idempotencyKey":["null","string"]}), post__api_conversions_track_7);

// GET /api/conversions/events - list events with filters
//
// 旧口だが友だち単位の成果記録を返すので、`conversionPermission('view')`
// で縛る(#513 M1)。アカウント境界の絞り込みはそのまま残す。
conversions.get('/api/conversions/events', conversionPermission('view'), get__api_conversions_events_8);

// GET /api/conversions/events/:id/reversals — 取消の履歴（新しい順）
conversions.get(
  '/api/conversions/events/:id/reversals',
  conversionPermission('view'),
  get__api_conversions_events_id_reversals_9,
);

// POST /api/conversions/events/:id/reversals — 取消と取消の取消を理由付きで追記
conversions.post(
  '/api/conversions/events/:id/reversals',
  requireRole('owner', 'admin'),
  inputJsonBoundary(), post__api_conversions_events_id_reversals_10,
);

// GET /api/conversions/report - report; keep the old date-query response for the current screen
conversions.get('/api/conversions/report', conversionPermission('view'), get__api_conversions_report_11);

// GET /api/conversions/approvals?status=pending|approved|rejected
// Affiliate-attributed CVs awaiting/holding an approval decision. duplicateFlag
// reuses the Phase 1 identity_key heuristic scoped per affiliate.
// 承認待ち(友だち名・案件名含む)を返すので、定義系と同じ
// `conversionPermission('view')` で縛る(#513 M1)。利用者は
// /conversions 画面のタブだけなので、affiliates 側の導線は変えない。
conversions.get('/api/conversions/approvals/counts', conversionPermission('view'), get__api_conversions_approvals_counts_12);

conversions.get('/api/conversions/approvals', conversionPermission('view'), get__api_conversions_approvals_13);

// GET /api/conversions/events/:id/attribution - どの紹介に成果を付けたかの記録(#823)
// 候補になった紹介を並べ、付けた先と付けなかった理由を1件ずつ返す。
// 記録が無い昔の成果は 404。
conversions.get('/api/conversions/events/:id/attribution', conversionPermission('view'), requireVisibleConversionEvent, get__api_conversions_events_id_attribution_1);

// PATCH /api/conversions/events/:id/approval - approve/reject an attributed CV
conversions.patch('/api/conversions/events/:id/approval', requireApprovalPermission, requireVisibleConversionEvent, inputJsonBoundary(), patch__api_conversions_events_id_approval_2);

conversions.post('/api/conversions/approvals/bulk', requireApprovalPermission, inputJsonBoundary(), post__api_conversions_approvals_bulk_3);

export { conversions };
