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

/**
 * 実装側のoff強制の在り処(#643)。
 *
 * manifest に名前を足すだけでは「本当に止まるか」は分からない。
 * `gated` は判定を書いたファイルと、そこに必ず現れる目印を持ち、
 * feature-job-manifest.test.ts が実ソースを読んで機械照合する。
 * `exempt` は外部呼び出しも状態更新もしない処理だけで、理由を必ず書く。
 */
export type FeatureJobEnforcement =
  | {
    readonly mode: 'gated';
    /** 判定を書いたファイル(リポジトリ相対)。全て存在すること。 */
    readonly sources: readonly string[];
    /** sources のどこかに必ず現れる判定の目印。全て見つかること。 */
    readonly markers: readonly string[];
  }
  | { readonly mode: 'exempt'; readonly reason: string };

export type FeatureJobMetadata = {
  name: string;
  classification:
    | { kind: 'feature'; featureId: FeatureId }
    | { kind: 'core'; reason: string };
  enforcement: FeatureJobEnforcement;
};

/**
 * scheduled dispatcher に登録される処理の分類正本。
 *
 * 各行は「どの機能に属するか」と「off強制が実装のどこにあるか」を持つ。
 * enforcement の目印は feature-job-manifest.test.ts が実ソースを読んで
 * 照合するため、判定を消したり移したりすると必ずテストが落ちる。
 */
export const FEATURE_JOB_MANIFEST: readonly FeatureJobMetadata[] = [
  {
    name: 'friend bulk runs',
    classification: { kind: 'core', reason: '複数機能の友だち一括操作' },
    enforcement: { mode: 'exempt', reason: '共通の一括操作で、単一機能に属さない' },
  },
  {
    name: 'mileage reward delivery retry',
    classification: { kind: 'feature', featureId: 'mileage' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/mileage-reward-delivery.ts'],
      markers: [
        "job: 'mileage reward delivery retry'",
        "job: 'mileage reward delivery'",
        "accountFeatureOffExclusionSql('mileage_redemptions.line_account_id', 'mileage')",
      ],
    },
  },
  {
    name: 'analytics cross',
    classification: { kind: 'feature', featureId: 'analytics' },
    enforcement: {
      mode: 'gated',
      sources: ['packages/db/src/analytics-cross.ts'],
      markers: [
        "isAccountFeatureEnabled(db, row.line_account_id, 'analytics')",
        // 取り出し(LIMIT前)と停滞回収の両方をSQLで止める。
        "accountFeatureOffExclusionSql('analytics_cross_runs.line_account_id', 'analytics')",
      ],
    },
  },
  {
    name: 'mileage projection',
    classification: { kind: 'feature', featureId: 'mileage' },
    enforcement: {
      mode: 'gated',
      sources: ['packages/db/src/mileage.ts'],
      markers: [
        "isAccountFeatureEnabled(db, owner.line_account_id, 'mileage')",
        // 取り出し(LIMIT前)と停滞回収の両方をSQLで止める。
        'function mileageOwnerOffSql(',
        'AND NOT ${mileageOwnerOffSql(',
      ],
    },
  },
  {
    name: 'analytics url exposure projection',
    classification: { kind: 'feature', featureId: 'analytics' },
    enforcement: {
      mode: 'gated',
      sources: ['packages/db/src/analytics-url-exposures.ts'],
      markers: [
        "isAccountFeatureEnabled(db, item.line_account_id, 'analytics')",
        "accountFeatureOffExclusionSql('analytics_url_exposure_queue.line_account_id', 'analytics')",
      ],
    },
  },
  {
    name: 'analytics projection',
    classification: { kind: 'feature', featureId: 'analytics' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/analytics-projection.ts'],
      markers: ["job: 'analytics projection'"],
    },
  },
  {
    name: 'analytics scheduled reports',
    classification: { kind: 'feature', featureId: 'analytics' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/analytics-reports.ts'],
      markers: ["job: 'analytics scheduled reports'"],
    },
  },
  {
    name: 'account health',
    classification: { kind: 'core', reason: 'LINEアカウント稼働監視' },
    enforcement: { mode: 'exempt', reason: 'LINEアカウント自体の稼働監視で、機能設定に属さない' },
  },
  {
    name: 'broadcast insights',
    classification: { kind: 'feature', featureId: 'broadcasts' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/insight-fetcher.ts'],
      markers: ["job: 'broadcast insights'"],
    },
  },
  {
    name: 'NEN rich menu jobs',
    classification: { kind: 'feature', featureId: 'rich_menus' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/nen-rich-menu.ts'],
      markers: ["job: 'NEN rich menu jobs'"],
    },
  },
  {
    name: 'support email sync',
    classification: { kind: 'core', reason: '運用問い合わせ受信' },
    enforcement: { mode: 'exempt', reason: '運用の問い合わせ受信で、アカウント機能に属さない' },
  },
  {
    name: 'friend field reminders',
    classification: { kind: 'feature', featureId: 'friend_fields' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/friend-field-reminders.ts'],
      markers: ["job: 'friend field reminders'"],
    },
  },
  {
    name: 'action score inactivity',
    classification: { kind: 'feature', featureId: 'mileage' },
    enforcement: {
      mode: 'gated',
      sources: [
        'packages/db/src/action-score-rules.ts',
        'apps/worker/src/services/action-score-events.ts',
      ],
      markers: [
        "isAccountFeatureEnabled(db, row.line_account_id, 'mileage')",
        "job: 'action score applications'",
      ],
    },
  },
  {
    name: 'NEN tag refresh',
    classification: { kind: 'feature', featureId: 'photo_review' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/nen-tag-sync.ts'],
      markers: ["'photo_review', 'NEN tag refresh'"],
    },
  },
  {
    name: 'analytics retention purge',
    classification: { kind: 'feature', featureId: 'analytics' },
    enforcement: {
      mode: 'gated',
      sources: ['packages/db/src/analytics-projection.ts'],
      markers: ['const offAnalytics = (table: string): string =>', 'accountFeatureOffExclusionSql('],
    },
  },
  {
    name: 'friend snapshot',
    classification: { kind: 'core', reason: '友だち基礎集計' },
    enforcement: { mode: 'exempt', reason: '友だちの基礎集計で、外部呼び出しも機能の状態更新もしない' },
  },
  {
    name: 'media usage scan',
    classification: { kind: 'feature', featureId: 'media' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/media-usage-scan.ts'],
      markers: ["'media', 'media usage scan'"],
    },
  },
  {
    name: 'following mileage',
    classification: { kind: 'feature', featureId: 'mileage' },
    enforcement: {
      mode: 'gated',
      sources: ['packages/db/src/mileage.ts'],
      markers: ["accountFeatureOffExclusionSql('f.line_account_id', 'mileage')"],
    },
  },
  {
    name: 'booking expirer',
    classification: { kind: 'feature', featureId: 'booking' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/booking-expirer.ts'],
      markers: ["job: 'booking expirer'"],
    },
  },
  {
    name: 'event booking expirer',
    classification: { kind: 'feature', featureId: 'events' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/event-booking-expirer.ts'],
      markers: ["job: 'event booking expirer'"],
    },
  },
  {
    name: 'restaurant raw mail retention',
    classification: { kind: 'feature', featureId: 'restaurant_test' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/restaurant-email-intake.ts'],
      markers: ["accountFeatureOffExclusionSql('st.line_account_id', 'restaurant_test')"],
    },
  },
  {
    name: 'automation deliveries',
    classification: { kind: 'feature', featureId: 'automations' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/automation-engine.ts'],
      markers: ["job: 'automation runs'"],
    },
  },
  {
    name: 'booking reminders',
    classification: { kind: 'feature', featureId: 'booking' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/booking-reminders.ts'],
      markers: ["job: 'booking reminders'"],
    },
  },
  {
    name: 'event reminders',
    classification: { kind: 'feature', featureId: 'events' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/event-booking-reminders.ts'],
      markers: ["job: 'event reminders'"],
    },
  },
  {
    name: 'meet consultation reminders',
    classification: { kind: 'feature', featureId: 'booking' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/meet-consultation-reminders.ts'],
      markers: ["job: 'meet consultation reminders'"],
    },
  },
  {
    name: 'webinar reminders',
    classification: { kind: 'feature', featureId: 'webinars' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/webinar-reminders.ts'],
      markers: ["job: 'webinar-reminders'"],
    },
  },
  {
    name: 'webinar notifications',
    classification: { kind: 'feature', featureId: 'webinars' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/webinar-notifications.ts'],
      markers: ["job: 'webinar-notifications'"],
    },
  },
  {
    name: 'webinar followups',
    classification: { kind: 'feature', featureId: 'webinars' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/webinar-followups.ts'],
      markers: ["job: 'webinar followups'"],
    },
  },
  {
    name: 'NEN campaign deliveries',
    classification: { kind: 'feature', featureId: 'nen_campaigns' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/nen-engagement.ts'],
      markers: [
        "job: 'NEN campaign deliveries'",
        "accountFeatureOffExclusionSql('nen_delivery_jobs.line_account_id', 'nen_campaigns')",
      ],
    },
  },
  {
    name: 'common variable schedules',
    classification: { kind: 'feature', featureId: 'common_vars' },
    enforcement: {
      mode: 'gated',
      sources: ['packages/db/src/common-vars.ts'],
      markers: ['isCommonVarsEnabled(db, current.line_account_id)'],
    },
  },
  {
    name: 'scenario deliveries',
    classification: { kind: 'feature', featureId: 'scenarios' },
    enforcement: {
      mode: 'gated',
      sources: [
        'apps/worker/src/services/step-delivery.ts',
        'packages/db/src/scenario-delivery-timestamps.ts',
        'packages/db/src/scenarios.ts',
      ],
      markers: [
        "job: 'scenario deliveries'",
        // 取り出し(LIMIT前)と停滞回収の両方をSQLで止める。
        "accountFeatureOffExclusionSql('s.line_account_id', 'scenarios')",
      ],
    },
  },
  {
    name: 'broadcast deliveries',
    classification: { kind: 'feature', featureId: 'broadcasts' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/broadcast.ts'],
      markers: ["job: 'broadcast deliveries'"],
    },
  },
  {
    name: 'reminder deliveries',
    classification: { kind: 'feature', featureId: 'reminders' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/reminder-delivery.ts'],
      markers: ["job: 'reminder deliveries'"],
    },
  },
  {
    name: 'booking calendar delete retry',
    classification: { kind: 'feature', featureId: 'booking' },
    enforcement: {
      mode: 'gated',
      sources: ['apps/worker/src/services/booking-calendar-sync.ts'],
      markers: [
        "'booking', 'booking calendar delete retry'",
        // 候補読取(LIMIT前)でオフのアカウントを外す。
        "accountFeatureOffExclusionSql('booking_operation_runs.line_account_id', 'booking')",
      ],
    },
  },
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
