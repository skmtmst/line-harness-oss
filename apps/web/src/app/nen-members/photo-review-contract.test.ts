import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8');
const api = readFileSync(join(import.meta.dirname, '..', '..', 'lib', 'api.ts'), 'utf8');
const helper = readFileSync(join(import.meta.dirname, 'photo-text.ts'), 'utf8');
const detail = readFileSync(join(import.meta.dirname, 'photo-review-detail.tsx'), 'utf8');

describe('V6 photo review contract', () => {
  it('uses only the common top bar for the page title', () => {
    expect(page).not.toContain("import Header from '@/components/layout/header'");
    expect(page).not.toContain('<Header');
    expect(page).not.toContain('準備中');
  });

  it('loads and reviews photos for the selected LINE account', () => {
    // 一覧は続きを取れるよう offset 付きで呼ぶ（#666）。呼ぶ先の口は同じ。
    expect(page).toContain('fetchApi<PhotoPageResponse>(photoPagePath(selectedAccountId, 0))');
    expect(page).toContain("`/api/nen-members/photos?${params.toString()}`");
    expect(page).toContain('accountId: selectedAccountId');
    expect(page).toContain('loadSequence.current');
    expect(api).toContain('/api/nen-members/photos?accountId=');
  });

  it('loads review metrics and shows unknown values as unknown', () => {
    expect(page).toContain('api.nenMembers.photoReviewMetrics(selectedAccountId)');
    expect(page).toContain('reviewMetrics.pendingCount');
    expect(page).toContain('reviewMetrics.attentionCount');
    expect(page).toContain('formatAverageReviewTime(reviewMetrics?.averageReviewMinutes)');
    expect(page).toContain("if (minutes == null || !Number.isFinite(minutes)) return '—'");
  });

  it('loads derivative status with the detail and can regenerate the review image', () => {
    expect(page).toContain('api.nenMembers.photoAssetStatus(id, accountId)');
    expect(page).toContain('api.nenMembers.photoDerivatives(id, accountId)');
    expect(page).toContain('api.nenMembers.processPhotoAssets(id, {');
    expect(page).toContain("operation: 'review'");
  });

  it('separates loading, empty and failed states without making zero counts', () => {
    expect(page).toContain("import ListState from '@/components/shared/list-state'");
    expect(page).toContain('kind="loading"');
    expect(page).toContain('kind="empty"');
    expect(page).toContain('kind="error"');
    expect(page).toContain('kind="forbidden"');
    expect(page).toContain('onRetry={() => void load()}');
    expect(page).toContain("countsReady ? counts.pending : '—'");
    expect(page).toContain("countsReady ? counts[value] : '—'");
  });

  it('requires a reason and previews the submitter message', () => {
    expect(page).toContain("'N2J629'");
    expect(page).toContain('この写真を戻しますか？');
    expect(page).toContain('お客様にはこう届きます');
    expect(page).toContain("reasonCode === 'other' && !reasonNote.trim()");
    for (const code of ['quality', 'privacy', 'unrelated', 'other']) {
      expect(page).toContain(`value: '${code}'`);
    }
    expect(page).toContain('うしろに他のお客様が写っているようです。もう一度お願いできますか。');
    expect(page).toContain('商品の名前が入っていない写真をいただけますか。');
    expect(page).toContain('明るいところで、もう一度お願いできますか。');
    expect(page).toContain('お客様に届く補足（直せます）');
    expect(page).toContain('お客様にはこう届きます（直せます）');
    expect(page).toContain('戻しても、この方のマイルは減りません。');
  });

  it('uses one set of operator words for reviewed states', () => {
    expect(page).toContain("['adopted', '通したもの']");
    expect(page).toContain("['rejected', '戻したもの']");
    expect(page).toContain("['pending', '見ていないもの']");
    expect(page).toContain("reviewing === photo.id ? '処理中...' : '通す'");
    expect(page).toContain('response.data.awardedPoints');
    expect(page).not.toContain('承認済');
    expect(page).not.toContain('採用済み');
  });

  it('shows whose photo and when before sending the rejection', () => {
    expect(page).toContain("text(rejectingPhoto.owner_name) || 'お名前は未取得'");
    expect(page).toContain('formatPhotoReceivedAt(rejectingPhoto.created_at)');
    expect(page).toContain('この方を前に戻した回数は未取得です');
  });

  it('does not claim a photo is public without consent', () => {
    expect(page).toContain("photo.publication_consent_at && !photo.publication_withdrawn_at");
    expect(page).toContain('公開は未同意');
    expect(page).not.toContain('公開ギャラリーへ掲載しました');
  });

  it('shows a failed submitter notification separately from the saved decision', () => {
    expect(page).toContain("response.data.notificationStatus === 'sent'");
    expect(page).toContain("photo.review_notification_status === 'failed'");
    expect(page).toContain('審査結果は保存しましたが、LINE通知は送れませんでした');
    expect(page).toContain('retryPhotoReviewNotification');
    expect(page).toContain('LINE通知を再送');
  });

  it('shows the received time in Japan time instead of slicing UTC text', () => {
    expect(page).toContain('formatPhotoReceivedAt(photo.created_at)');
    expect(page).not.toContain("text(photo.created_at).replace('T', ' ').slice(0, 16)");
  });

  it('shows bulk notification failures with resend paths instead of a fixed message (#639)', () => {
    // 一括審査の口は審査の確定と通知の送達を分けて返す。失敗件数・対象を
    // 出し、審査保存済みと通知だけの再送導線（移動・再送）を添える。
    expect(page).toContain('notificationFailures');
    expect(page).toContain('通知だけ再送できます');
    expect(page).toContain('LINE通知を送れなかった写真');
    expect(page).toContain('大きく見る');
    expect(page).toContain('setBulkFailed');
    expect(page).not.toContain('（通知は順次送信）');
  });

  it('types the bulk review result with per-photo delivery outcomes (#639)', () => {
    expect(api).toContain('PhotoBulkReviewResult');
    expect(api).toContain('notificationFailures: Array<{ photoId: string; error: string }>');
    expect(api).toContain("notificationStatus: 'sent' | 'failed'");
  });

  it('sends an integer review version so a broken value does not become a 400 (#580)', () => {
    // 版が読めない値は初版に倒し、サーバの版競合フローに載せる。
    expect(page).toContain('reviewVersionOf(');
    expect(page).not.toContain('Number(photo.review_version ?? 1)');
    expect(page).not.toContain('Number(detailPhoto.review_version ?? 1)');
    expect(helper).toContain('Number.isInteger(version)');
  });

  it('lets the user reload derivative status after a quiet failure (#580)', () => {
    expect(page).toContain('assetsFailed={detailAssetsFailed}');
    expect(page).toContain('onReloadAssets={() => {');
    expect(detail).toContain('assetsFailed');
    expect(detail).toContain('状態を読み直す');
  });
});
