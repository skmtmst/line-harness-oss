import type { FeatureJobMetadata } from './feature-enforcement.js';

// Retention keeps running when a product feature is disabled. Each service
// still applies its own store policy, hold and data-protection checks.
export const PERSONAL_DATA_RETENTION_JOB = {
  name: 'personal data retention',
  classification: { kind: 'core', reason: '店が承認した保存期限に従う個人情報の削除' },
  enforcement: { mode: 'exempt', reason: '機能の停止中も保存期限を守る。既定は無効で、店ごとの有効化と保留を削除ごとに確認する' },
} as const satisfies FeatureJobMetadata;

export const TENANT_DATA_RETENTION_JOB = {
  name: 'tenant data retention purge',
  classification: { kind: 'core', reason: '退会後の顧客データ保存期限（★V6 36-2）' },
  enforcement: {
    mode: 'exempt',
    reason: '契約が終わった統括のデータ削除で、機能スイッチのon/offに関係なく実行する',
  },
} as const satisfies FeatureJobMetadata;

export const GOOGLE_CONTENT_RETENTION_JOB = {
  name: 'google business content retention',
  classification: { kind: 'core', reason: 'Googleから受け取った内容の保存期限（暦日30日）' },
  enforcement: {
    mode: 'exempt',
    reason:
      'Googleの利用者データポリシーで決まった保存期限の掃除で、機能をoffにした店舗の古いコピーが残り続けるほうが違反になる',
  },
} as const satisfies FeatureJobMetadata;
