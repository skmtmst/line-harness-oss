import { inputJsonBoundary } from '../lib/input-errors.js';

import { Hono } from 'hono';

import type { Env } from '../worker-env.js';
import { requireDeliveryAccess, requireRole } from '../middleware/role-guard.js';

import { get__api_media_quota_1, post__api_media_upload_sessions_2, post__api_media_upload_sessions_id_complete_3, post__api_media_id_versions_4, post__api_media_id_replacement_preview_5, get__api_media_counts_6, get__api_media_7, get__api_media_id_8, get__api_media_id_download_9, get__api_media_id_content_10, get__api_media_id_versions_versionNo_download_11 } from './contents-uploads-handlers.js';

import { get__media_id_content_1, patch__api_media_id_2, post__api_media_id_archive_3, post__api_media_id_restore_4, get__api_media_id_delete_impact_5, get__api_media_id_replacement_impact_6, post__api_media_id_replace_usages_7, delete__api_media_id_8, get__api_common_vars_9, get__api_common_vars_id_10 } from './contents-media-lifecycle-handlers.js';
import { REPLACEMENT_BODY_MAX_BYTES } from './contents-definition.js';
import { post__api_common_vars_1, patch__api_common_vars_id_2, post__api_common_vars_id_status_3, get__api_common_vars_id_delete_impact_4, post__api_common_vars_id_impact_preview_5, post__api_common_vars_id_replace_6, delete__api_common_vars_id_7, get__api_common_vars_id_schedules_8, post__api_common_vars_id_schedules_9, delete__api_common_vars_id_schedules_scheduleId_10 } from './contents-common-variables-handlers.js';
import { parseCommonVarImpactProof, buildCommonVarImpactProof, isValidScheduleDateTime } from './contents-definition.js';

/**
 * メディアライブラリと共通情報。
 *
 * どちらも「1か所に置いて使い回す」ための機能で、画面も同じ /contents の
 * タブなので1つのルータにまとめている。
 */
const contents = new Hono<Env>();
export { buildCommonVarImpactProof } from './contents-definition.js';
export { parseCommonVarImpactProof } from './contents-definition.js';
export { isValidScheduleDateTime } from './contents-definition.js';

// 容量は現行ファイルだけでなく旧版と期限内アップロード予約も含める。
contents.get('/api/media/quota', get__api_media_quota_1);

contents.post(
  '/api/media/upload-sessions',
  requireRole('owner', 'admin', 'staff'),
  inputJsonBoundary({"files":["array"]}), post__api_media_upload_sessions_2,
);

contents.post(
  '/api/media/upload-sessions/:id/complete',
  requireRole('owner', 'admin', 'staff'),
  inputJsonBoundary(), post__api_media_upload_sessions_id_complete_3,
);

contents.post('/api/media/:id/versions', requireRole('owner', 'admin', 'staff'), inputJsonBoundary(), post__api_media_id_versions_4);

contents.post(
  '/api/media/:id/replacement-preview',
  requireRole('owner', 'admin', 'staff'),
  inputJsonBoundary(), post__api_media_id_replacement_preview_5,
);

contents.get('/api/media/counts', get__api_media_counts_6);

contents.get('/api/media', get__api_media_7);

/**
 * 詳細URLから1件だけ復元する。IDだけで探すと別アカウントの存在を漏らすため、
 * 担当者のaccount範囲を先に確かめ、同じaccount条件を付けた取得だけを行う。
 */
contents.get('/api/media/:id', requireDeliveryAccess('contents'), get__api_media_id_8);

/**
 * 登録メディアのダウンロード。添付ファイルとして受け渡し、
 * 成功・拒否のどちらもURLや秘密値なしで監査へ残す。
 */
contents.get('/api/media/:id/download', requireRole('owner', 'admin', 'staff'), get__api_media_id_download_9);

/**
 * 登録メディアの表示用中身。縮小表示・試し見・ファイル開きが使う。
 * 認可は download と同じだが、閲覧のたびに監査行は残さない。
 */
contents.get('/api/media/:id/content', requireRole('owner', 'admin', 'staff'), get__api_media_id_content_10);

/**
 * 版ごとのダウンロード（IDEA-15）。
 *
 * 版を追加すると media.r2_key は新しい版へ進むが、旧版の実体は
 * media_versions に残る。第1版＝登録時の元ファイルを含め、指定した版を
 * 取り戻せる口。権限確認と監査は /download と同じ決まりで、
 * 保存用の公開URL（/images/*）へは直接行かせない。
 */
contents.get('/api/media/:id/versions/:versionNo/download', requireRole('owner', 'admin', 'staff'), get__api_media_id_versions_versionNo_download_11);

/**
 * ライブ参照の公開配信。
 *
 * 使用先へライブ参照を選んだ場所には、このメディアIDのURLが
 * 配信本文へ埋め込まれる。取りに来た時点の最新版へ解決するため、
 * 版を追加するとこのURLの中身は新しい版へ切り替わる。
 * `/images/*` の版固定URLと同じく、知っている人だけが取れる能力URL
 * で、中身が版ごとに変わるURLの実体上書きはしない。
 * 固定参照は変わらないようimmutableで返すが、こちらは再検証させる。
 */
contents.get('/media/:id/content', get__media_id_content_1);

contents.patch('/api/media/:id', requireDeliveryAccess('contents'), inputJsonBoundary({"filename":["string"],"folderId":["null","string"],"usageReference":["object"]}), patch__api_media_id_2);

contents.post('/api/media/:id/archive', requireDeliveryAccess('contents'), inputJsonBoundary(), post__api_media_id_archive_3);

contents.post('/api/media/:id/restore', requireDeliveryAccess('contents'), inputJsonBoundary(), post__api_media_id_restore_4);

// 削除前に、現在記録されている使用先を名前と導線付きで確認する。
contents.get('/api/media/:id/delete-impact', requireDeliveryAccess('contents'), get__api_media_id_delete_impact_5);

// 差し替える前に、現在の使用先を7種類すべて読み直す。内部IDは返さない。
contents.get('/api/media/:id/replacement-impact', requireDeliveryAccess('contents'), get__api_media_id_replacement_impact_6);

// 画面で読んだ影響は信用せず、同じ7種類を実行直前にも読み直す。
// scope=replaceable は「置換可能な使用先だけ」を明示選択した部分実行。
// 置き忘れ防止に、scope の省略・不正値は全件実行として扱わず 400/409 で止める。
contents.post('/api/media/:id/replace-usages', requireDeliveryAccess('contents'), inputJsonBoundary({}, { maxBytes: REPLACEMENT_BODY_MAX_BYTES }), post__api_media_id_replace_usages_7);

// 使われていれば最新の影響を返して止める。画面で前に読んだ結果は信用しない。
contents.delete('/api/media/:id', requireDeliveryAccess('contents'), delete__api_media_id_8);

contents.get('/api/common-vars', get__api_common_vars_9);

contents.get('/api/common-vars/:id', get__api_common_vars_id_10);

contents.post('/api/common-vars', requireDeliveryAccess('commonVars'), inputJsonBoundary(), post__api_common_vars_1);

contents.patch('/api/common-vars/:id', requireDeliveryAccess('commonVars'), inputJsonBoundary(), patch__api_common_vars_id_2);

// Q: 状態の切替。下書き→使用中（公開）、使用中→止めた、止めた→使用中（再開）。
// 値の変更ではないので影響確認は求めないが、状態を変える操作なので理由は必須。
contents.post('/api/common-vars/:id/status', requireDeliveryAccess('commonVars'), inputJsonBoundary(), post__api_common_vars_id_status_3);

contents.get('/api/common-vars/:id/delete-impact', requireDeliveryAccess('commonVars'), get__api_common_vars_id_delete_impact_4);

contents.post('/api/common-vars/:id/impact-preview', requireDeliveryAccess('commonVars'), inputJsonBoundary({}, { maxBytes: REPLACEMENT_BODY_MAX_BYTES }), post__api_common_vars_id_impact_preview_5);

contents.post('/api/common-vars/:id/replace', requireDeliveryAccess('commonVars'), inputJsonBoundary({}, { maxBytes: REPLACEMENT_BODY_MAX_BYTES }), post__api_common_vars_id_replace_6);

contents.delete('/api/common-vars/:id', requireDeliveryAccess('commonVars'), delete__api_common_vars_id_7);

contents.get('/api/common-vars/:id/schedules', get__api_common_vars_id_schedules_8);

contents.post('/api/common-vars/:id/schedules', requireDeliveryAccess('commonVars'), inputJsonBoundary({}, { maxBytes: REPLACEMENT_BODY_MAX_BYTES }), post__api_common_vars_id_schedules_9);

contents.delete(
  '/api/common-vars/:id/schedules/:scheduleId',
  requireDeliveryAccess('commonVars'),
  delete__api_common_vars_id_schedules_scheduleId_10,
);

export { contents };
