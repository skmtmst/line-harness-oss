import { inputJsonBoundary } from '../lib/input-errors.js';

import { Hono } from 'hono';

import type { Env } from '../worker-env.js';
import { requireRole } from '../middleware/role-guard.js';
import { requirePhotoPermission } from './nen-photo-operations.js';

import { get__api_liff_nen_member_1, get__api_public_nen_adopted_photos_2, get__api_public_nen_gallery_preview_3, post__api_liff_nen_pets_4, put__api_liff_nen_pets_id_5, post__api_liff_nen_pets_id_photo_6, post__api_liff_nen_health_logs_7, get__api_liff_nen_health_logs_8, get__api_liff_nen_health_logs_summary_9, post__api_liff_nen_photos_10, put__api_liff_nen_photos_id_publication_consent_11, get__api_nen_members_overview_12, get__api_nen_members_care_flags_13 } from './nen-members-public-handlers.js';

import { put__api_nen_members_care_flags_id_1, get__api_nen_members_photos_2, get__api_nen_members_photos_publications_3, get__api_nen_members_photos_publications_order_4, put__api_nen_members_photos_publications_order_5, post__api_nen_members_photos_id_publish_6, put__api_nen_members_photos_publications_id_withdraw_7, put__api_nen_members_photos_publications_id_placements_8, get__api_nen_members_photos_id_9 } from './nen-members-photo-list-handlers.js';

import { put__api_nen_members_photos_id_review_1, post__api_nen_members_photos_id_point_retry_2, post__api_nen_members_photos_id_point_reconcile_3, put__api_nen_members_photos_id_rotation_4, post__api_nen_members_photos_id_notification_retry_5, post__api_nen_members_tags_resync_6, get__api_nen_members_friends_friendId_7, get__api_nen_members_ranks_8, post__api_nen_members_rich_menu_install_9 } from './nen-members-photo-review-handlers.js';
import { loadPhotoReviewRecipient, deliverPhotoReviewNotification, PhotoReviewReasonCode, ReviewPhotoRow } from './nen-members-definition.js';

const nenMembers = new Hono<Env>();
export type { PhotoReviewReasonCode } from './nen-members-definition.js';
export type { ReviewPhotoRow } from './nen-members-definition.js';
export { sendPhotoReviewNotification } from './nen-members-definition.js';
export { loadPhotoReviewRecipient } from './nen-members-definition.js';
export { PHOTO_NOTIFICATION_LEASE_TTL_MS } from './nen-members-definition.js';
export { mirrorReviewNotificationStatus } from './nen-members-definition.js';
export { deliverPhotoReviewNotification } from './nen-members-definition.js';

nenMembers.get('/api/liff/nen/member', get__api_liff_nen_member_1);

nenMembers.get('/api/public/nen/adopted-photos', get__api_public_nen_adopted_photos_2);

nenMembers.get('/api/public/nen/gallery-preview', get__api_public_nen_gallery_preview_3);

nenMembers.post('/api/liff/nen/pets', inputJsonBoundary({}, { maxBytes: Math.ceil(1_500_000 / 3) * 4 + 4096 }), post__api_liff_nen_pets_4);

/**
 * ペットの変更（★37-2 マイペット「編集」）。体重・避妊去勢・活動量・主食・お悩みなど、
 * 送られてきた項目だけを変える。目安（daily_kcal / recommended_*）はそのたびに計算し直す。
 */
nenMembers.put('/api/liff/nen/pets/:id', inputJsonBoundary(), put__api_liff_nen_pets_id_5);

nenMembers.post('/api/liff/nen/pets/:id/photo', inputJsonBoundary({"data":["string"]}, { maxBytes: Math.ceil(1_500_000 / 3) * 4 + 4096 }), post__api_liff_nen_pets_id_photo_6);

nenMembers.post('/api/liff/nen/health-logs', inputJsonBoundary(), post__api_liff_nen_health_logs_7);

nenMembers.get('/api/liff/nen/health-logs', get__api_liff_nen_health_logs_8);

/**
 * 「獣医師に見せる（直近30日のまとめ）」（★37-2-B）。管理画面の 30日のまとめ（★37-4）と同じ計算。
 * 本人のペットだけ。医療判断は含めない。
 */
nenMembers.get('/api/liff/nen/health-logs/summary', get__api_liff_nen_health_logs_summary_9);

nenMembers.post('/api/liff/nen/photos', inputJsonBoundary({"petId":["string"],"data":["string"],"mimeType":["string"],"caption":["string"]}, { maxBytes: Math.ceil((8 * 1024 * 1024) / 3) * 4 + 4096 }), post__api_liff_nen_photos_10);

nenMembers.put('/api/liff/nen/photos/:id/publication-consent', inputJsonBoundary({"consent":["boolean"],"consentVersion":["string"],"showPetName":["boolean"]}), put__api_liff_nen_photos_id_publication_consent_11);

nenMembers.get('/api/nen-members/overview', get__api_nen_members_overview_12);

nenMembers.get('/api/nen-members/care-flags', get__api_nen_members_care_flags_13);

nenMembers.put('/api/nen-members/care-flags/:id', requireRole('owner', 'admin', 'staff'), inputJsonBoundary({"status":["string"],"adviceReady":["boolean"],"expectedUpdatedAt":["string"]}), put__api_nen_members_care_flags_id_1);

nenMembers.get('/api/nen-members/photos', requirePhotoPermission('photo.submission.view'), get__api_nen_members_photos_2);

nenMembers.get(
  '/api/nen-members/photos/publications',
  requirePhotoPermission('photo.submission.view'),
  get__api_nen_members_photos_publications_3,
);

// 順序編集は通常一覧の200件上限を越えて全掲載のIDと版を取得する。
nenMembers.get('/api/nen-members/photos/publications/order', requirePhotoPermission('photo.publication.manage'), get__api_nen_members_photos_publications_order_4);

nenMembers.put('/api/nen-members/photos/publications/order', requireRole('owner', 'admin', 'staff'), requirePhotoPermission('photo.publication.manage'), inputJsonBoundary({"accountId":["string"],"items":["array"]}), put__api_nen_members_photos_publications_order_5);

nenMembers.post('/api/nen-members/photos/:id/publish', requireRole('owner', 'admin', 'staff'), requirePhotoPermission('photo.publication.manage'), inputJsonBoundary(), post__api_nen_members_photos_id_publish_6);

// 公開の撤回・掲載先の変更は、審査とは別の上位権限だけでできるようにする（#931 N-311）。
// 「審査できる人なら公開範囲も変えられる」状態を止め、掲載管理の権限を明示的に分ける。
nenMembers.put('/api/nen-members/photos/publications/:id/withdraw', requireRole('owner', 'admin', 'staff'), requirePhotoPermission('photo.publication.manage'), inputJsonBoundary({"accountId":["string"],"expectedVersion":["number"]}), put__api_nen_members_photos_publications_id_withdraw_7);

nenMembers.put('/api/nen-members/photos/publications/:id/placements', requireRole('owner', 'admin', 'staff'), requirePhotoPermission('photo.publication.manage'), inputJsonBoundary({"accountId":["string"],"expectedVersion":["number"],"placements":["array"]}), put__api_nen_members_photos_publications_id_placements_8);

nenMembers.get('/api/nen-members/photos/:id', requirePhotoPermission('photo.submission.view'), get__api_nen_members_photos_id_9);

nenMembers.put('/api/nen-members/photos/:id/review', requireRole('owner', 'admin', 'staff'), requirePhotoPermission('photo.submission.review'), inputJsonBoundary({"accountId":["string"],"status":["string"],"reasonCode":["string"],"reasonNote":["string"],"expectedVersion":["number"],"resubmitInvite":["boolean"],"watchSubmitter":["boolean"],"withoutReward":["boolean"]}), put__api_nen_members_photos_id_review_1);

nenMembers.post(
  '/api/nen-members/photos/:id/point-retry',
  requireRole('owner', 'admin', 'staff'),
  requirePhotoPermission('photo.reward.reconcile'),
  inputJsonBoundary(), post__api_nen_members_photos_id_point_retry_2,
);

nenMembers.post(
  '/api/nen-members/photos/:id/point-reconcile',
  requireRole('owner', 'admin', 'staff'),
  requirePhotoPermission('photo.reward.reconcile'),
  inputJsonBoundary(), post__api_nen_members_photos_id_point_reconcile_3,
);

/*
 * 詳細画面で直した写真の向きを版つきで保存する（#931 N-309）。
 * 「回す」が見た目だけだと、向きを直して通したつもりが元の向きで残る。
 * 版（expectedVersion）を要求するのは、審査と同じく並行する直しと
 * 通しの順序ずれを「別の担当者が更新しました」として気づけるようにするため。
 */
nenMembers.put('/api/nen-members/photos/:id/rotation', requireRole('owner', 'admin', 'staff'), requirePhotoPermission('photo.submission.review'), inputJsonBoundary({"accountId":["string"],"rotation":["number"],"expectedVersion":["number"]}), put__api_nen_members_photos_id_rotation_4);

nenMembers.post('/api/nen-members/photos/:id/notification/retry', requireRole('owner', 'admin', 'staff'), requirePhotoPermission('photo.submission.review'), inputJsonBoundary({"accountId":["string"]}), post__api_nen_members_photos_id_notification_retry_5);

nenMembers.post('/api/nen-members/tags/resync', requireRole('owner', 'admin'), inputJsonBoundary({"limit":["number"]}), post__api_nen_members_tags_resync_6);

nenMembers.get('/api/nen-members/friends/:friendId', requireRole('owner', 'admin', 'staff'), get__api_nen_members_friends_friendId_7);

nenMembers.get('/api/nen-members/ranks', get__api_nen_members_ranks_8);

nenMembers.post('/api/nen-members/rich-menu/install', requireRole('owner', 'admin'), inputJsonBoundary({"accountId":["string"]}), post__api_nen_members_rich_menu_install_9);

export { nenMembers };
