import {
  getAccountSetting,
  getVersionedAccountSetting,
  recordAuditEvent,
} from '@line-crm/db';
import {
  featureCatalogEntry,
  type FeatureId,
} from '@line-crm/shared';

const FEATURE_SETTINGS_BUNDLE_KEY = 'feature.settings_bundle_v1';

type FeatureSettingsBundle = {
  features?: Partial<Record<FeatureId, boolean>>;
};

export type FeatureJobMetadata = {
  name: string;
  classification:
    | { kind: 'feature'; featureId: FeatureId }
    | { kind: 'core'; reason: string };
};

/** scheduled dispatcher に登録される処理の分類正本。 */
export const FEATURE_JOB_MANIFEST: readonly FeatureJobMetadata[] = [
  { name: 'friend bulk runs', classification: { kind: 'core', reason: '複数機能の友だち一括操作' } },
  { name: 'mileage reward delivery retry', classification: { kind: 'feature', featureId: 'mileage' } },
  { name: 'analytics cross', classification: { kind: 'feature', featureId: 'analytics' } },
  { name: 'mileage projection', classification: { kind: 'feature', featureId: 'mileage' } },
  { name: 'analytics url exposure projection', classification: { kind: 'feature', featureId: 'analytics' } },
  { name: 'analytics projection', classification: { kind: 'feature', featureId: 'analytics' } },
  { name: 'analytics scheduled reports', classification: { kind: 'feature', featureId: 'analytics' } },
  { name: 'account health', classification: { kind: 'core', reason: 'LINEアカウント稼働監視' } },
  { name: 'broadcast insights', classification: { kind: 'feature', featureId: 'broadcasts' } },
  { name: 'NEN rich menu jobs', classification: { kind: 'feature', featureId: 'rich_menus' } },
  { name: 'support email sync', classification: { kind: 'core', reason: '運用問い合わせ受信' } },
  { name: 'friend field reminders', classification: { kind: 'feature', featureId: 'friend_fields' } },
  { name: 'action score inactivity', classification: { kind: 'feature', featureId: 'mileage' } },
  { name: 'NEN tag refresh', classification: { kind: 'feature', featureId: 'photo_review' } },
  { name: 'analytics retention purge', classification: { kind: 'feature', featureId: 'analytics' } },
  { name: 'friend snapshot', classification: { kind: 'core', reason: '友だち基礎集計' } },
  { name: 'media usage scan', classification: { kind: 'feature', featureId: 'media' } },
  { name: 'following mileage', classification: { kind: 'feature', featureId: 'mileage' } },
  { name: 'booking expirer', classification: { kind: 'feature', featureId: 'booking' } },
  { name: 'event booking expirer', classification: { kind: 'feature', featureId: 'events' } },
  { name: 'restaurant raw mail retention', classification: { kind: 'feature', featureId: 'restaurant_test' } },
  { name: 'automation deliveries', classification: { kind: 'feature', featureId: 'automations' } },
  { name: 'booking reminders', classification: { kind: 'feature', featureId: 'booking' } },
  { name: 'event reminders', classification: { kind: 'feature', featureId: 'events' } },
  { name: 'meet consultation reminders', classification: { kind: 'feature', featureId: 'booking' } },
  { name: 'webinar reminders', classification: { kind: 'feature', featureId: 'webinars' } },
  { name: 'webinar notifications', classification: { kind: 'feature', featureId: 'webinars' } },
  { name: 'webinar followups', classification: { kind: 'feature', featureId: 'webinars' } },
  { name: 'NEN campaign deliveries', classification: { kind: 'feature', featureId: 'nen_campaigns' } },
  { name: 'common variable schedules', classification: { kind: 'feature', featureId: 'common_vars' } },
  { name: 'scenario deliveries', classification: { kind: 'feature', featureId: 'scenarios' } },
  { name: 'broadcast deliveries', classification: { kind: 'feature', featureId: 'broadcasts' } },
  { name: 'reminder deliveries', classification: { kind: 'feature', featureId: 'reminders' } },
];

export async function accountFeatureIsEnabled(
  db: D1Database,
  accountId: string,
  featureId: FeatureId,
): Promise<boolean> {
  const bundle = await getVersionedAccountSetting<FeatureSettingsBundle>(
    db,
    accountId,
    FEATURE_SETTINGS_BUNDLE_KEY,
  );
  const bundled = bundle?.data.features?.[featureId];
  if (typeof bundled === 'boolean') return bundled;

  const legacy = await getAccountSetting(db, accountId, `feature.${featureId}`);
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy) as boolean | { enabled?: boolean };
      if (typeof parsed === 'boolean') return parsed;
      if (typeof parsed.enabled === 'boolean') return parsed.enabled;
    } catch {
      // 壊れた旧値はカタログの既定値へ戻す。設定画面の読取と同じ扱い。
    }
  }
  return featureCatalogEntry(featureId).defaultEnabled;
}

export async function recordFeatureExecutionSkipped(
  db: D1Database,
  input: { accountId: string; featureId: FeatureId; job: string; occurredAt?: string },
): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  console.info(JSON.stringify({
    event: 'feature.execution.skipped',
    lineAccountId: input.accountId,
    featureId: input.featureId,
    job: input.job,
    occurredAt,
  }));
  // 同じ job が5分ごとに監査表を増やさないよう、日・account・feature・job を
  // 一意な監査IDにする。構造化ログはtickごとの観測用なので毎回残す。
  const auditId = `feature-skip:${occurredAt.slice(0, 10)}:${input.accountId}:${input.featureId}:${input.job}`;
  try {
    await recordAuditEvent(db, {
      id: auditId,
      lineAccountId: input.accountId,
      category: 'business',
      actorPrincipalId: 'system',
      actorRole: 'system',
      action: 'feature.execution.skipped',
      targetKind: 'scheduled_job',
      targetId: input.job,
      result: 'denied',
      createdAt: occurredAt,
    });
  } catch (error) {
    if (!String(error).toLowerCase().includes('unique')) throw error;
  }
}

export async function featureJobCanRun(
  db: D1Database,
  input: { accountId: string; featureId: FeatureId; job: string; occurredAt?: string },
): Promise<boolean> {
  if (await accountFeatureIsEnabled(db, input.accountId, input.featureId)) return true;
  await recordFeatureExecutionSkipped(db, input);
  return false;
}

/**
 * 1 tick内で使い回す判定器。友だち単位など件数が多い処理で、
 * 同じアカウントの判定を繰り返さない。tickをまたいで持たないこと。
 */
export function createFeatureJobGate() {
  const cache = new Map<string, boolean>();
  return {
    async canRun(
      db: D1Database,
      accountId: string | null,
      featureId: FeatureId,
      job: string,
    ): Promise<boolean> {
      // 持ち主不明の旧行は従来どおり進める。止めるのは持ち主が分かる行だけ。
      if (!accountId) return true;
      const key = `${featureId}:${accountId}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const ok = await featureJobCanRun(db, { accountId, featureId, job });
      cache.set(key, ok);
      return ok;
    },
  };
}
