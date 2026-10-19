import type { FeatureJobMetadata } from './feature-job-types.js';

// Retention keeps running when a product feature is disabled. Each service
// still applies its own store policy, hold and data-protection checks.
export const PERSONAL_DATA_RETENTION_JOB = {
  name: 'personal data retention',
  classification: { kind: 'core', reason: '店が承認した保存期限に従う個人情報の削除' },
  // Product feature switches do not suspend retention, but the store's
  // explicit approval and hold checks must remain enforced and audited.
  enforcement: {
    mode: 'gated',
    sources: ['apps/worker/src/services/personal-data-retention.ts'],
    markers: [
      'if (!policy.enabled) continue;',
      'if (policy.hold) { held++; continue; }',
      'if (JSON.stringify(current)!==JSON.stringify(policy)) { held++; continue accounts; }',
    ],
  },
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
