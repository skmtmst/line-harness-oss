import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8');
const api = readFileSync(join(import.meta.dirname, '..', '..', 'lib', 'api.ts'), 'utf8');

describe('V6 photo review contract', () => {
  it('uses only the common top bar for the page title', () => {
    expect(page).not.toContain("import Header from '@/components/layout/header'");
    expect(page).not.toContain('<Header');
    expect(page).not.toContain('準備中');
  });

  it('loads and reviews photos for the selected LINE account', () => {
    expect(page).toContain('api.nenMembers.photos(selectedAccountId)');
    expect(page).toContain('accountId: selectedAccountId');
    expect(page).toContain('loadSequence.current');
    expect(api).toContain('/api/nen-members/photos?accountId=');
  });

  it('requires a reason and previews the submitter message', () => {
    expect(page).toContain('写真を戻す理由を選ぶ');
    expect(page).toContain('投稿者に届く内容');
    expect(page).toContain("reasonCode === 'other' && !reasonNote.trim()");
    for (const code of ['quality', 'privacy', 'unrelated', 'duplicate', 'other']) {
      expect(page).toContain(`value: '${code}'`);
    }
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
});
