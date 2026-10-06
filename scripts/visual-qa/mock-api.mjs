/**
 * 画面確認だけのための、Workerの代わりになる小さなAPI。
 *
 * 管理画面は `AuthGuard` が `/api/auth/session` を見に行き、失敗すると
 * `/login` へ飛ぶ。そのため本物のWorkerとD1が無いとローカルで1画面も
 * 見られなかった。ここが無い間、PRは「画面を見ないまま」積まれていた。
 *
 * これは本物の代わりではない。**空の状態**を全画面で描かせるためのもの。
 *
 * 守っていること
 * - ローカル専用。`NODE_ENV=production` では起動しない。127.0.0.1 にだけ開く
 * - **更新は原則失敗させる。** 画面確認専用の固定結果だけは返すが、保存も配信も起きない
 * - 実データ・秘密値を持たない。名前も固定の作り物
 * - 毎回まったく同じものを返す。乱数も時刻も使わない（画像が毎回同じになる）
 *
 * 使い方
 *   node scripts/visual-qa/mock-api.mjs            # 既定 8788番
 *   PORT=9000 node scripts/visual-qa/mock-api.mjs
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

/** このファイル自身の指紋。動いている中身が古くないかを言うために持つ。 */
const FINGERPRINT = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 16)
import { readArrayGetPaths } from './api-shapes.mjs'
import { BILLING_INVOICES, BILLING_SUMMARY } from './billing-fixture.mjs'
import {
  mileageWriteResponse,
  MILEAGE_REWARDS,
  FORM_DELETE_IMPACT_FIXTURES,
  COMMON_VARS,
  COMMON_VAR_FOLDERS,
  COMMON_VAR_DETAIL,
  COMMON_VAR_DELETE_IMPACT,
  COMMON_VAR_SCHEDULES,
  COMMON_VAR_HOURS_DETAIL,
  COMMON_VAR_HOURS_DELETE_IMPACT,
  COMMON_VAR_HOURS_SCHEDULES,
  commonVarChangeImpact,
  commonVarChangeImpactHours,
  COMMON_VAR_DELETE_IMPACT_EMPTY,
  COMMON_VAR_REPLACEMENT_CANDIDATES,
  COMMON_VAR_REPLACEMENT_PREVIEW,
  COMMON_VAR_REPLACEMENT_RESULT,
  COMMON_VAR_DELETE_IMPACT_PHONE,
  COMMON_VAR_DELETE_IMPACT_CAMPAIGN,
  COMMON_VAR_REPLACEMENT_CANDIDATES_PHONE,
  COMMON_VAR_REPLACEMENT_PREVIEW_PHONE,
  MEDIA_DELETE_IMPACT,
  MEDIA_DELETE_IMPACT_EMPTY,
  MEDIA_REPLACEMENT_IMPACT,
  MEDIA_REPLACEMENT_IMPACT_BLOCKED,
  MEDIA_REPLACEMENT_IMPACT_EMPTY,
  MEDIA_FOLDERS,
  MEDIA_ITEMS,
  MEDIA_QUOTA,
  FILE_SCAN_ITEMS,
  FILE_SCAN_CONFIG,
  FRIEND_ADD_RUNS,
  AUTO_REPLIES, AUTO_REPLY_NEW_DRAFT, AUTO_REPLY_NEW_LIVE, AUTO_REPLY_NEW_CONFLICTS, AUTO_REPLY_FOLDERS, AUTO_REPLY_RUNS, AUTO_REPLY_CONFLICT_SUMMARY,
  AUTO_REPLY_PUBLISH_CONFLICTS, AUTO_REPLY_PUBLISH_DRAFT,
  AUTO_REPLY_PUBLISH_RESULT, AUTO_REPLY_PUBLISH_TEST, AUTO_REPLY_PUBLISH_VALIDATION,
  BROADCASTS, BROADCAST_FOLDERS, BROADCAST_INSIGHTS, BROADCAST_LIST_META,
  BROADCAST_NOTIFICATION_SETTINGS,
  BROADCAST_APPROVAL_CONFIG, BROADCAST_APPROVAL_CANDIDATES, BROADCAST_APPROVAL_STATE,
  BROADCAST_RECIPIENTS, BROADCAST_ACTIVITY,
  BROADCAST_PREFLIGHT, BROADCAST_SAVED_VIEWS, CHATS, FRIEND_FIELDS, FRIEND_ATTRIBUTE_FIELDS, FRIEND_FIELD_FOLDERS,
  FRIEND_ATTRIBUTE_SAVED_SEARCH_DETAIL, FRIEND_ATTRIBUTE_SAVED_SEARCH_RESPONSE, FRIEND_FIELD_MIGRATION_PREVIEW,
  INBOX_STATS, INBOX_SAVED_VIEWS, FRIEND_MESSAGES, FRIEND_MILEAGE, FRIEND_DETAILS,
  TEMPLATES, TEMPLATE_FOLDERS, TEMPLATE_TEST_RECIPIENTS,
  DUPLICATE_STATS, FRIENDS, FRIEND_BULK_RUN, FRIEND_SCENARIOS, FRIEND_STATS,
  IDENTITY_CANDIDATE_DETECTION, IDENTITY_CANDIDATE_EC, IDENTITY_CANDIDATE_ERROR, IDENTITY_CANDIDATE_FRIEND,
  IDENTITY_CANDIDATE_LISTS,
  FRIEND_DUPLICATE_DETAIL,
  FRIEND_SAVED_VIEWS, MERGED_PERSON_DETAIL, MERGED_PERSON_EMPTY, MERGED_PERSON_ERROR,
  LIST_STATS, NEN_BIRTHDAY_COUPON, NEN_CAMPAIGN_SETTINGS, NEN_COLUMN_CREATE, NEN_COLUMN_OPERATIONS, NEN_COLUMNS, NEN_JOBS, NEN_PETS,
  NEN_FLOW_METRICS, NEN_COLUMN_METRICS, NEN_PET_METRICS, NEN_DELIVERIES, NEN_DELIVERY_DETAILS,
  OPERATORS, REMINDERS, REMINDER_DRAFT, REMINDER_NEW_DRAFT, REMINDER_FOLDERS, REMINDER_VALIDATE, REMINDER_AUDIENCE, REMINDER_PREVIEW, REMINDER_NEW_PREVIEW, REMINDER_TEST_SEND, REMINDER_PUBLISH, SCENARIO_ACTIONS, SCENARIO_DRAFT, SCENARIO_FOLDERS, SCENARIO_STATS, SCENARIO_STEPS, SCENARIO_SIMULATION, SCENARIO_RUNS, SCENARIO_TRIGGERS, SCENARIO_PREVIEW, USERS_GROUPED,
  RICH_MENU_DELETE_IMPACT, RICH_MENU_DELETE_IMPACT_EMPTY,
  RICH_MENU_GROUPS, RICH_MENU_FOLDERS, RICH_MENU_GROUP_DETAILS, RICH_MENU_EXTERNAL, RICH_MENU_TAP_STATS,
  TAGS, TAG_GROUPS, TAG_DEFINITION_NEN_SUBSCRIPTION, TAG_DEPENDENCIES_NEN_SUBSCRIPTION,
  TAG_ARCHIVE_RESULT,
  TAG_IMPORT_SAMPLE_ROWS, tagImportPreview, tagImportResult, REMINDER_RUNS,
  ACTION_SCORE_RULES,
  SUPPORT_MARKS, SUPPORT_MARK_ARCHIVE_IMPACT, SUPPORT_MARK_AUTOMATION_RULES,
  OUTGOING_WEBHOOKS, OUTGOING_WEBHOOK_TEST_RESULT, INCOMING_WEBHOOKS, INCOMING_WEBHOOK_DETAILS, INCOMING_WEBHOOK_UNMATCHED, ENTRY_ROUTES, INFLOW_SUMMARY,
  SITE_TRACKING_SUMMARY, SITE_TRACKING_PAGES, AD_PLATFORMS, AD_CONVERSION_LOGS, TRACKED_LINKS,
  AD_COST_ROWS, AD_COST_PLATFORMS,
  STAFF_MEMBERS, LOGIN_AUDIT,
  AFFILIATES, AFFILIATE_OFFERS, AFFILIATE_REPORT, AFFILIATE_REPORT_DETAIL, AFFILIATE_LINKS,
  AFFILIATE_SETTLEMENT_PREVIEW, AFFILIATE_SETTLEMENT_CREATED, AFFILIATE_PAYOUT_BATCH, AFFILIATE_STATEMENT,
  OFFER_VERSIONS, OFFER_CAP_STATUS, ATTRIBUTION_DECISION,
  MILEAGE_EARNING_RULES, MILEAGE_FRIENDS, MILEAGE_HISTORY, MILEAGE_OVERVIEW,
  COMMON_ACTIONS, COMMON_ACTION_DETAIL, COMMON_ACTION_DETAIL_PURCHASE, AUTOMATIONS, AUTOMATION_RUNS, AUTOMATION_TEMPLATES,
  BOOKING_MENUS, BOOKING_CHANNELS, BOOKING_MENU_VERSIONS, BOOKING_SETTINGS, BOOKING_STAFF, BOOKING_STAFF_MENUS, BOOKING_MENU_STAFF, BOOKING_AVAILABILITY, BOOKING_RESOURCES,
  BOOKING_AVAILABILITY_RULES, BOOKING_BREAKS, BOOKING_BREAK_DATES, BOOKING_STAFF_SHIFTS, BOOKING_EXCEPTIONS, BOOKING_GOOGLE_CALENDAR,
  BOOKING_PROXY_CREATE, BOOKING_REQUESTS,
  BOOKING_ADMIN_DETAIL, BOOKING_CUSTOMER_CONTEXT, BOOKING_REMINDER_PREVIEW, BOOKING_CONFLICT_ALTERNATIVES,
  EC_NOTIFICATION_SETTINGS, EC_NOTIFICATION_RUNS, LINE_NOTIFICATION_DEFINITIONS, LINE_NOTIFICATION_METRICS, LINE_NOTIFICATION_SEND_COUNTS, LINE_NOTIFICATION_DELIVERIES,
  OPERATOR_NOTIFICATION_RECIPIENTS, OPERATOR_NOTIFICATION_RULES, ADMIN_EVENTS, EVENT_FOLDERS, EVENT_DETAIL, EVENT_SLOTS, EVENT_OCCURRENCE_APPLICANTS, EVENT_WAITLIST, EVENT_BOOKINGS, EVENT_CHANGE_PREVIEW, EVENT_CHANGE_APPLY_RESULT, EVENT_LIFECYCLE_RESULT, EVENT_WAITLIST_REORDER_RESULT, EVENT_WAITLIST_SKIP_RESULT, EVENT_LIFF_CHANGE_RESULT, NEN_PHOTOS, NEN_PHOTO_DETAIL,
  NEN_PHOTO_REVIEW_METRICS, NEN_PHOTO_ASSET_STATUS, NEN_PHOTO_DERIVATIVES,
  NEN_PHOTO_ASSET_PROCESS_RESULT, NEN_PHOTO_BULK_DECISION_RESULT,
  NEN_PHOTO_REWARD_POLICY_VERSIONS,
  NEN_PHOTO_PUBLICATIONS, EC_EVENTS, EC_OVERVIEW, EC_ORDERS, EC_ACTION_EXECUTIONS, EC_IDENTITY_CANDIDATES, MILEAGE_RULES,
  FORM_FOLDERS, FORMS, FORM_LIST, FORM_DETAIL, FORM_SUBMISSIONS, FORM_VISIT_DETAIL, FORM_VISIT_SUBMISSIONS,
  LINE_ACCOUNTS, LINE_ACCOUNT_TAGS, LINE_ACCOUNT_DETAIL, LINE_ACCOUNT_VERIFY_CONNECTION, ACCOUNT_HANDOVER, ACCOUNT_HANDOVER_DECISIONS,
  ACCOUNT_HEALTH_LOGS,
  CONVERSION_POINTS, CONVERSION_REPORT_CURRENT, CONVERSION_REPORT_PREVIOUS,
  CONVERSION_DEFINITIONS, CONVERSION_DEFINITION_REPORT, CONVERSION_EXPORT_CSV,
  CONVERSION_DEFINITION_PREVIEW, CONVERSION_DEFINITION_DELETE_IMPACT,
  OPERATION_CONTROL_PREVIEW, OPERATION_HEALTH, OPERATION_HISTORY, OPERATION_ALERTS,
  WEBINARS, WEBINAR_FOLDERS, WEBINAR_OVERVIEW, WEBINAR_NOTIFICATIONS, WEBINAR_CTAS, WEBINAR_ACTIONS, WEBINAR_COMMENTS, WEBINAR_ANALYTICS,
  WEBINAR_EDITOR, WEBINAR_PUBLISH_VALIDATION, WEBINAR_PARTICIPANTS, WEBINAR_VIDEO_ASSET,
  FRIEND_ADD_RULE_PUBLISH, FRIEND_ADD_RULE_VALIDATE,
  ACCESS_USERS, ACCESS_ROLES, ACCESS_AUDIT_EVENTS,
  GETTING_STARTED, RECIPES, MANUAL_LINKS,
  TEST_RECIPIENT_LOGIN_USERS,
  HQ_BANNER_PRESETS, HQ_BANNER_USAGE, HQ_BANNER_STATS, HQ_BANNER_PROJECTS, HQ_BANNER_IMAGES,
  HQ_BANNER_ARCHIVED_PROJECTS, HQ_BANNER_IMAGE_COUNTS,
  NEN_RANK_SETTINGS, NEN_MEMBER_LIST, NEN_PET_LIST, NEN_HEALTH_LIST,
  FRIEND_ADD_RUN_DETAIL, OPERATION_SEND_PATHS, REMINDER_REGISTRANTS,
} from './fixtures.mjs'

if (process.env.NODE_ENV === 'production') {
  console.error('[visual-qa] 本番では起動しない。画面確認専用のため。')
  process.exit(1)
}

const PORT = Number(process.env.PORT ?? 8788)
const HOST = '127.0.0.1'

// 機能10専用。フォルダ操作後の再取得でも、同じプロセス内では保存結果を返す。
let webinarFolders = WEBINAR_FOLDERS.map((folder) => ({ ...folder }))

// J-1・N 撮影用。動画の準備の段と開催回の定員を同じプロセス内で保存結果として返す。
let mockVideoAsset = WEBINAR_VIDEO_ASSET ? { ...WEBINAR_VIDEO_ASSET } : null
let mockSessionCapacity = 50
/* 日時指定の見本（LPOe7）の開催回：日時・定員（null は無制限）・申込。 */
const SCHEDULED_SESSIONS = [
  ['2026-10-08T20:00:00+09:00', 50, 38],
  ['2026-10-15T20:00:00+09:00', 50, 20],
  ['2026-10-22T12:00:00+09:00', null, 0],
]

// R25専用。回答フォームの箱も作る・直す・消すを見本で返す。
let formFolders = FORM_FOLDERS.map((folder) => ({ ...folder }))
// R37 撮影用。登録メディア・共通情報のフォルダ名変更・削除を同じ
// プロセス内で保存結果として返す。
let mediaFolders = MEDIA_FOLDERS.map((folder) => ({ ...folder }))
let commonVarFolders = COMMON_VAR_FOLDERS.map((folder) => ({ ...folder }))

// 機能15専用。版追加の撮影では、差し替え用セッションの確定が本番口と同じ
// `verified` を返す必要がある。申告時に受けた targetMediaId を覚えておく。
const mediaUploadSessionTargets = new Map()

/** 画面を見るだけなので、いちばん権限のある人で固定する。実在しない名前。 */
const STAFF = {
  id: 'visual-qa-owner',
  name: 'Kenta Kawano',
  role: 'owner',
  readOnly: false,
  permissionKeys: [],
  assignedLineAccountId: null,
  canAccessDescendantAccounts: true,
  tenantId: null,
}

/**
 * LINEアカウントが1つも無いと、どの画面も「店舗が選ばれていません」で
 * 止まり、中身が描けない。**1件だけ**固定で置く。値はすべて作り物で、
 * 秘密値は持たない（`*Configured` は true にするが、値そのものは無い）。
 */
const ACCOUNT = {
  id: 'visual-qa-account',
  channelId: '0000000000',
  name: '画面確認アカウント',
  /*
    **権限を持たせる。** 無いと `canRunBulk(role)` が false になり、
    友だち一覧の「操作を選ぶ」が描かれない。押しどころが無いので、
    その先の一括操作 5 状態（`IAf7j`）が1枚も撮れなかった。
    撮影用の器なので、いちばん広い `owner` を置く。
  */
  role: 'owner',
  channelAccessTokenConfigured: true,
  channelSecretConfigured: true,
  loginChannelId: null,
  loginChannelSecretConfigured: false,
  liffId: null,
  isActive: true,
  friendCapacity: null,
  capacityWarnAt: null,
  iconUrl: null,
}

/**
 * 画面ごとに欲しい形が違う。`items` も `total` も持つ器を既定にし、
 * 配列を直接読む先だけ配列で返す（配列にすると `data.items` を読む画面が
 * 落ちるため、混ぜられない）。
 */
const EMPTY_PAGE = { items: [], total: 0, page: 1, limit: 20 }

/**
 * 運営コンソール（`/ops/*`）の見本データ。形は Worker の
 * `apps/worker/src/routes/ops.ts`・`ops-dashboard.ts`・`ops-support.ts`・
 * `ops-knowledge.ts`・`ops-announcements.ts` と `apps/web/src/lib/api.ts`
 * の `Ops*` 型に合わせる。名前はすべて作り物で、実在の個人情報は入れない。
 * 日時は固定（撮るたびに同じ絵になる）。
 */
const OPS_ME = {
  id: 'visual-qa-ops',
  name: '検証 太郎',
  email: null,
  readOnly: false,
  totpEnabled: true,
  lineLinked: false,
  legacy: false,
  impersonation: null,
}
const OPS_TENANTS = [
  {
    id: 'visual-tenant-1', name: '検証商事', status: 'active', featurePacks: [],
    plan_key: 'standard', plan_status: 'active', trial_ends_at: null,
    current_period_ends_at: '2027-03-31T00:00:00+09:00',
    created_at: '2026-04-01T10:00:00+09:00', updated_at: '2026-09-01T10:00:00+09:00',
    account_count: 2, staff_count: 5, last_login_at: '2026-10-02T08:00:00+09:00',
  },
  {
    id: 'visual-tenant-4', name: '見本サロン', status: 'active', featurePacks: [],
    plan_key: 'pro', plan_status: 'past_due', trial_ends_at: null,
    current_period_ends_at: '2026-10-12T00:00:00+09:00',
    created_at: '2026-06-12T10:00:00+09:00', updated_at: '2026-09-01T10:00:00+09:00',
    account_count: 2, staff_count: 3, last_login_at: '2026-10-01T10:00:00+09:00',
  },
  {
    id: 'visual-tenant-5', name: '見本牧場', status: 'active', featurePacks: [],
    plan_key: 'light', plan_status: 'active', trial_ends_at: null,
    current_period_ends_at: '2026-10-20T00:00:00+09:00',
    created_at: '2026-08-20T10:00:00+09:00', updated_at: '2026-09-01T10:00:00+09:00',
    account_count: 1, staff_count: 1, last_login_at: '2026-09-29T10:00:00+09:00',
  },
  {
    id: 'visual-tenant-2', name: '見本物産', status: 'active', featurePacks: ['restaurant'],
    plan_key: null, plan_status: 'trialing', trial_ends_at: '2026-10-04T00:00:00+09:00',
    current_period_ends_at: null,
    created_at: '2026-09-20T10:00:00+09:00', updated_at: '2026-09-01T10:00:00+09:00',
    account_count: 1, staff_count: 2, last_login_at: '2026-10-02T10:00:00+09:00',
  },
  {
    id: 'visual-tenant-6', name: '見本食堂', status: 'active', featurePacks: ['restaurant'],
    plan_key: 'light', plan_status: 'active', trial_ends_at: null,
    current_period_ends_at: '2026-10-01T00:00:00+09:00',
    created_at: '2026-09-01T10:00:00+09:00', updated_at: '2026-09-01T10:00:00+09:00',
    account_count: 1, staff_count: 1, last_login_at: '2026-09-30T10:00:00+09:00',
  },
  {
    id: 'visual-tenant-3', name: 'サンプル商店', status: 'suspended', featurePacks: [],
    plan_key: null, plan_status: 'canceled', trial_ends_at: null,
    current_period_ends_at: null,
    created_at: '2025-12-01T10:00:00+09:00', updated_at: '2026-09-01T10:00:00+09:00',
    account_count: 0, staff_count: 1, last_login_at: '2026-06-10T10:00:00+09:00',
  },
]
const OPS_TENANT_SUMMARY = { active: 3, trialing: 1, suspended: 1, pastDue: 1 }
const OPS_AUDIT = [
  {
    id: 'visual-audit-1', staff_id: 'visual-qa-ops', staff_name: '検証 太郎',
    tenant_id: 'visual-tenant-1', tenant_name: '検証商事',
    action: 'impersonation.start', reason: '問い合わせの確認', detail: null,
    ip: null, visible_to_tenant: 1, created_at: '2026-10-01T15:20:00+09:00',
  },
  {
    id: 'visual-audit-2', staff_id: 'visual-qa-ops', staff_name: '検証 太郎',
    tenant_id: 'visual-tenant-3', tenant_name: 'サンプル商店',
    action: 'tenant.status.change', reason: '検証用の記録', detail: '{"from":"active","to":"suspended"}',
    ip: null, visible_to_tenant: 1, created_at: '2026-09-30T09:12:00+09:00',
  },
  {
    id: 'visual-audit-3', staff_id: 'visual-ops-member', staff_name: '見本 次郎',
    tenant_id: 'visual-tenant-2', tenant_name: '見本物産',
    action: 'impersonation.write', reason: '初期設定の代行（本人の依頼）', detail: null,
    ip: null, visible_to_tenant: 1, created_at: '2026-09-28T18:40:00+09:00',
  },
  {
    id: 'visual-audit-4', staff_id: 'visual-qa-ops', staff_name: '検証 太郎',
    tenant_id: 'visual-tenant-1', tenant_name: '検証商事',
    action: 'pii.reveal', reason: '請求先の確認（本人の依頼）', detail: null,
    ip: null, visible_to_tenant: 1, created_at: '2026-09-12T10:02:00+09:00',
  },
  {
    id: 'visual-audit-5', staff_id: 'visual-ops-member', staff_name: '見本 次郎',
    tenant_id: null, tenant_name: null,
    action: 'member.invite', reason: '見本 花子 を招待', detail: null,
    ip: null, visible_to_tenant: 0, created_at: '2026-09-05T11:30:00+09:00',
  },
]
const OPS_MEMBERS = [
  {
    staffId: 'visual-qa-ops', name: '検証 太郎', email: null, isActive: true,
    totpEnabled: true, lineLinked: false, inviteStatus: 'accepted', activationState: 'active',
    invitedAt: '2026-04-01T10:00:00+09:00', approvedBy: null,
    lastLoginAt: '2026-09-07T08:00:00+09:00', createdAt: '2026-04-01T10:00:00+09:00',
  },
  {
    staffId: 'visual-ops-member', name: '見本 次郎', email: null, isActive: true,
    totpEnabled: true, lineLinked: false, inviteStatus: 'accepted', activationState: 'active',
    invitedAt: '2026-05-01T10:00:00+09:00', approvedBy: '検証 太郎',
    lastLoginAt: '2026-10-01T22:40:00+09:00', createdAt: '2026-05-01T10:00:00+09:00',
  },
  {
    staffId: 'visual-ops-invited', name: '見本 花子', email: null, isActive: true,
    totpEnabled: false, lineLinked: false, inviteStatus: 'sent', activationState: 'invited',
    invitedAt: '2026-09-06T10:00:00+09:00', approvedBy: '検証 太郎',
    lastLoginAt: null, createdAt: '2026-09-06T10:00:00+09:00',
  },
]
const OPS_MEMBER_SUMMARY = {
  members: 3, invited: 1, awaitingTotp: 0, totpEnabled: 2,
  impersonationsThisMonth: 1, writeImpersonationsThisMonth: 0, piiRevealsThisMonth: 0,
}
const OPS_DASHBOARD = {
  period: 'month',
  periodLabel: '2026年9月',
  pricing: 'list_price',
  lastSyncedAt: null,
  ai: { callsThisMonth: 312, draftsThisMonth: 9, articlesActive: 3 },
  plans: [
    { key: 'light', label: 'ライト', monthlyYen: 9800 },
    { key: 'standard', label: 'スタンダード', monthlyYen: 29800 },
    { key: 'pro', label: 'プロ', monthlyYen: 59800 },
  ],
  kpis: {
    revenueThisMonth: 39600, revenueDelta: 9800, refundsThisMonth: 0,
    contractMonthlyTotal: 99400, filledByListPriceCount: 2, active: 3,
    byPlan: { light: 1, standard: 1, pro: 1 },
    trialing: 1, newInPeriod: 1, newTrialsInPeriod: 1,
    churnInPeriod: 0, churnRate: 0,
  },
  revenueByMonth: [
    { month: '2026-04', label: '4月', yen: 99400, current: false },
    { month: '2026-05', label: '5月', yen: 99400, current: false },
    { month: '2026-06', label: '6月', yen: 109200, current: false },
    { month: '2026-07', label: '7月', yen: 119400, current: false },
    { month: '2026-08', label: '8月', yen: 119400, current: false },
    { month: '2026-09', label: '9月', yen: 119400, current: false },
    { month: '2026-10', label: '10月', yen: 129200, current: true },
  ],
  planShare: {
    total: 6,
    rows: [
      { key: 'light', label: 'ライト', count: 1, percent: 17 },
      { key: 'standard', label: 'スタンダード', count: 2, percent: 33 },
      { key: 'pro', label: 'プロ', count: 1, percent: 17 },
      { key: 'trial', label: 'トライアル', count: 2, percent: 33 },
    ],
  },
  alerts: { pastDue: 1, trialEndingSoon: 1, lineTokenExpiring: 2, unansweredTickets: 2 },
  tickets: { newCount: 2, inProgressCount: 3, avgFirstReplyMinutes: 144, closedInPeriod: 5 },
  lineRegistration: { registered: 8, total: 10, unregisteredCount: 2 },
  usage: [
    {
      tenantId: 'visual-tenant-1', tenantName: '検証商事', planKey: 'standard', planLabel: 'スタンダード',
      messages: 12000, bannerUnits: 3, mediaBytes: 800000000,
      limits: { messages: 30000, images: 10, mediaBytes: 1000000000 }, usageRate: 80,
    },
    {
      tenantId: 'visual-tenant-3', tenantName: 'サンプル商店', planKey: 'light', planLabel: 'ライト',
      messages: 4500, bannerUnits: 0, mediaBytes: 100000000,
      limits: { messages: 5000, images: 3, mediaBytes: 300000000 }, usageRate: 90,
    },
  ],
  generatedAt: '2026-09-07T06:00:00+09:00',
}
const OPS_LINE_UNREGISTERED = {
  registered: 8,
  total: 10,
  people: [
    { staffId: 'visual-staff-1', name: '検証 一郎', tenantName: '検証商事', hasEmail: true },
    { staffId: 'visual-staff-2', name: '見本 二郎', tenantName: '見本物産', hasEmail: false },
  ],
}
const OPS_SUPPORT_SUMMARY = {
  byStage: { all: 5, new: 2, in_progress: 3, waiting: 1, resolved: 12, closed: 40 },
  kpis: {
    untouched: 2, untouchedFromLine: 1,
    avgFirstReplyMinutes: 95, prevAvgFirstReplyMinutes: 120,
    resolutionRate: 80, prevResolutionRate: 75,
    avgResolutionMinutes: 300, prevAvgResolutionMinutes: 360,
  },
}
/* 運営のお問い合わせ（V8 P0jhqO）の並び：優先度順に5件。名前は作り物。 */
const OPS_SUPPORT_TICKETS = [
  {
    id: 'visual-ticket-1', ticketNo: 1042, ticketLabel: '#1042',
    tenantId: 'visual-tenant-1', tenantName: '検証商事',
    tenantPlanKey: 'standard', tenantPlanStatus: 'active', tenantStatus: 'active',
    staffId: 'visual-staff-1', staffName: '検証 一郎', staffRole: 'owner', staffEmailRegistered: true,
    kind: 'bug', kindLabel: '不具合',
    subject: 'LINE の Webhook が遅れる', subjectAuto: false,
    body: '画面確認用の問い合わせ本文。朝から知らせが遅れて届きます。',
    attachments: [],
    stage: 'in_progress', stageLabel: '対応中', priority: 'high', priorityLabel: '高',
    channel: 'admin', channelLabel: '管理画面',
    assigneeStaffId: null, replyCount: 1, firstRepliedAt: null,
    lastMessageAt: '2026-09-30T11:00:00+09:00', resolvedAt: null, closedAt: null,
    createdAt: '2026-09-30T11:00:00+09:00', updatedAt: '2026-09-30T11:00:00+09:00',
  },
  {
    id: 'visual-ticket-2', ticketNo: 1045, ticketLabel: '#1045',
    tenantId: 'visual-tenant-1', tenantName: '検証商事',
    tenantPlanKey: 'standard', tenantPlanStatus: 'active', tenantStatus: 'active',
    staffId: 'visual-staff-1', staffName: '検証 一郎', staffRole: 'owner', staffEmailRegistered: true,
    kind: 'usage', kindLabel: '使い方',
    subject: 'バナー生成で日本語が崩れる', subjectAuto: false,
    body: '画面確認用の問い合わせ本文。朝から知らせが遅れて届きます。',
    attachments: [],
    stage: 'new', stageLabel: '新規', priority: 'medium', priorityLabel: '中',
    channel: 'admin', channelLabel: '管理画面',
    assigneeStaffId: null, replyCount: 1, firstRepliedAt: null,
    lastMessageAt: '2026-10-01T10:00:00+09:00', resolvedAt: null, closedAt: null,
    createdAt: '2026-10-01T10:00:00+09:00', updatedAt: '2026-10-01T10:00:00+09:00',
  },
  {
    id: 'visual-ticket-3', ticketNo: 1046, ticketLabel: '#1046',
    tenantId: 'visual-tenant-5', tenantName: '見本牧場',
    tenantPlanKey: 'light', tenantPlanStatus: 'active', tenantStatus: 'active',
    staffId: 'visual-staff-1', staffName: '検証 一郎', staffRole: 'owner', staffEmailRegistered: true,
    kind: 'billing', kindLabel: '料金・請求',
    subject: '年払いへの切り替え', subjectAuto: false,
    body: '画面確認用の問い合わせ本文。朝から知らせが遅れて届きます。',
    attachments: [],
    stage: 'new', stageLabel: '新規', priority: 'low', priorityLabel: '低',
    channel: 'line', channelLabel: 'LINE',
    assigneeStaffId: null, replyCount: 1, firstRepliedAt: null,
    lastMessageAt: '2026-10-01T12:00:00+09:00', resolvedAt: null, closedAt: null,
    createdAt: '2026-10-01T12:00:00+09:00', updatedAt: '2026-10-01T12:00:00+09:00',
  },
  {
    id: 'visual-ticket-4', ticketNo: 1039, ticketLabel: '#1039',
    tenantId: 'visual-tenant-2', tenantName: '見本物産',
    tenantPlanKey: null, tenantPlanStatus: 'active', tenantStatus: 'active',
    staffId: 'visual-staff-1', staffName: '検証 一郎', staffRole: 'owner', staffEmailRegistered: true,
    kind: 'usage', kindLabel: '使い方',
    subject: '予約台帳に卓を足したい', subjectAuto: false,
    body: '画面確認用の問い合わせ本文。朝から知らせが遅れて届きます。',
    attachments: [],
    stage: 'in_progress', stageLabel: '対応中', priority: 'medium', priorityLabel: '中',
    channel: 'admin', channelLabel: '管理画面',
    assigneeStaffId: null, replyCount: 1, firstRepliedAt: null,
    lastMessageAt: '2026-09-28T10:00:00+09:00', resolvedAt: null, closedAt: null,
    createdAt: '2026-09-28T10:00:00+09:00', updatedAt: '2026-09-28T10:00:00+09:00',
  },
  {
    id: 'visual-ticket-5', ticketNo: 1031, ticketLabel: '#1031',
    tenantId: 'visual-tenant-4', tenantName: '見本サロン',
    tenantPlanKey: 'pro', tenantPlanStatus: 'active', tenantStatus: 'active',
    staffId: 'visual-staff-1', staffName: '検証 一郎', staffRole: 'owner', staffEmailRegistered: true,
    kind: 'billing', kindLabel: '料金・請求',
    subject: '請求書の宛名変更', subjectAuto: false,
    body: '画面確認用の問い合わせ本文。朝から知らせが遅れて届きます。',
    attachments: [],
    stage: 'in_progress', stageLabel: '対応中', priority: 'low', priorityLabel: '低',
    channel: 'admin', channelLabel: '管理画面',
    assigneeStaffId: null, replyCount: 1, firstRepliedAt: null,
    lastMessageAt: '2026-09-25T10:00:00+09:00', resolvedAt: null, closedAt: null,
    createdAt: '2026-09-25T10:00:00+09:00', updatedAt: '2026-09-25T10:00:00+09:00',
  },
]
const OPS_SUPPORT_DETAIL = {
  ticket: { ...OPS_SUPPORT_TICKETS[0], replyCount: 1 },
  tenant: { accountCount: 2, staffCount: 5, staffWithLine: 3, pastTickets: 2, pastOpen: 1 },
  messages: [
    {
      id: 'visual-msg-2', authorKind: 'ops', authorName: '検証 太郎',
      body: '確認しました。受け口の処理を直しました。今朝以降はいかがでしょうか。', attachments: [],
      aiAssisted: false, deliveredVia: ['admin'],
      createdAt: '2026-09-30T13:12:00+09:00',
    },
  ],
  // 絵は AI の下書きがある形（作り直す・下書きを保存する・返信する）。
  draft: {
    body: 'ご確認ありがとうございます。10/1 以降の受け口の記録では遅れは出ていません。',
    aiGenerated: true, generatedAt: '2026-10-01T09:00:00+09:00', updatedAt: '2026-10-01T09:00:00+09:00', references: [],
  },
  ai: { available: true },
  knowledge: { article: null, job: null },
}
/**
 * 統括のお問い合わせの続き（`/hq/support/detail?id=…`）。
 * `apps/web/src/lib/hq-support.ts` の `HqSupportDetail` と同じ器。
 * 名前はすべて作り物で、日時は固定（撮るたびに同じ絵になる）。
 */
const HQ_SUPPORT_REQUESTS = [
  /* 絵 `b8xBtZ`・`OhguS`（2026-10-06 絵に合わせた）：対応中の #1042 と解決済みの #1031。 */
  {
    id: 'visual-ticket-1', kind: 'bug', kindLabel: '不具合の報告',
    subject: 'LINE の Webhook が遅れる', body: '夕方の一斉配信のあと、友だちの返信が管理画面に出るまで 10 分ほどかかります。昨日から急に遅くなりました。',
    lineAccountId: 'visual-qa-account', attachments: [],
    status: 'open', staffName: '高田 誠', notified: true,
    createdAt: '2026-09-29T18:20:00+09:00', ticketLabel: '#1042',
  },
  {
    id: 'visual-ticket-2', kind: 'billing', kindLabel: '料金・契約について',
    subject: '年払いへの切り替え', body: '年払いに切り替えるときの差額を教えてください。',
    lineAccountId: null, attachments: [],
    status: 'closed', staffName: '高田 誠', notified: true,
    createdAt: '2026-09-21T15:20:00+09:00', ticketLabel: '#1031',
  },
]
const HQ_SUPPORT_DETAIL = {
  ...HQ_SUPPORT_REQUESTS[0],
  stageLabel: '対応中',
  /*
   * 本物（`apps/worker/src/routes/hq-support.ts`）と同じく、最初の本文は
   * `body` にだけ置き、`messages` には追記だけを入れる。本文を両方に
   * 入れると画面で2回出る。運営の名は `musubo 運営 ／ 名前` の形。
   */
  messages: [
    {
      id: 'visual-support-msg-1', authorKind: 'ops', authorName: 'musubo 運営 ／ 検証 太郎',
      body: 'ご連絡ありがとうございます。LINE 側の遅延の可能性があるため調べています。遅れた時間帯がわかれば教えてください。', attachments: [],
      createdAt: '2026-09-30T10:05:00+09:00',
    },
    {
      id: 'visual-support-msg-2', authorKind: 'tenant', authorName: '高田 誠',
      body: '18:00〜18:30 の配信のあとです。画面の写しを添えます。', attachments: [],
      createdAt: '2026-09-30T11:00:00+09:00',
    },
  ],
  canFollowUp: true,
}
const OPS_KNOWLEDGE = [
  {
    id: 'visual-article-1', version: 1,
    title: 'Webhook の通知が遅れるとき', question: '画面確認用の質問文。', answer: '画面確認用の回答文。',
    kind: 'bug', keywords: ['検証', '手順'],
    sourceRequestId: 'visual-ticket-1', ticketNo: 1, sourceCurrent: true,
    articleKind: 'verified',
    reviewState: 'approved', status: 'active', reviewReason: '',
    evidence: [], usedCount: 12, helpfulCount: 9, unhelpfulCount: 0,
    updatedAt: '2026-10-01T10:00:00+09:00',
  },
  {
    id: 'visual-article-3', version: 1,
    title: 'バナー生成で日本語が崩れる', question: 'バナーの文字が崩れたり、別の字になったりします。', answer: '日本語の文字は崩れることがあります。文字は短くし、仕上がりを確かめてください。',
    kind: 'usage', keywords: ['バナー', '文字化け', '日本語', '生成'],
    sourceRequestId: 'visual-ticket-1', ticketNo: 1045, sourceCurrent: true,
    articleKind: 'answer_example',
    reviewState: 'pending', status: 'disabled', reviewReason: '',
    evidence: [
      { messageId: 'visual-msg-1', createdAt: '2026-10-02T10:00:00+09:00', authorKind: 'ops', quote: '文字を短くして作り直してください', role: 'answer' },
    ],
    usedCount: 0, helpfulCount: 0, unhelpfulCount: 0,
    updatedAt: '2026-10-02T10:00:00+09:00',
  },
  {
    id: 'visual-article-4', version: 1,
    title: '年払いへの切り替え方法', question: '画面確認用の質問文。', answer: '画面確認用の回答文。',
    kind: 'billing', keywords: ['料金'],
    sourceRequestId: 'visual-ticket-1', ticketNo: 3, sourceCurrent: true,
    articleKind: 'verified',
    reviewState: 'approved', status: 'active', reviewReason: '',
    evidence: [], usedCount: 8, helpfulCount: 7, unhelpfulCount: 0,
    updatedAt: '2026-09-21T10:00:00+09:00',
  },
  {
    id: 'visual-article-2', version: 2,
    title: '検証用の回答例', question: '画面確認用の質問文その2。', answer: '画面確認用の回答文その2。',
    kind: 'usage', keywords: ['検証'],
    sourceRequestId: 'visual-ticket-2', ticketNo: 2, sourceCurrent: false,
    articleKind: 'answer_example',
    reviewState: 'needs_review', status: 'active', reviewReason: '',
    evidence: [], usedCount: 0, helpfulCount: 0, unhelpfulCount: 1,
    updatedAt: '2026-09-30T10:00:00+09:00',
  },
  {
    id: 'visual-article-5', version: 1,
    title: '請求書の宛名変更', question: '画面確認用の質問文。', answer: '画面確認用の回答文。',
    kind: 'billing', keywords: ['請求'],
    sourceRequestId: 'visual-ticket-2', ticketNo: 4, sourceCurrent: true,
    articleKind: 'answer_example',
    reviewState: 'dismissed', status: 'disabled', reviewReason: '',
    evidence: [], usedCount: 0, helpfulCount: 0, unhelpfulCount: 0,
    updatedAt: '2026-09-12T10:00:00+09:00',
  },
]
const OPS_ANNOUNCEMENTS = [
  {
    id: 'visual-announcement-sent', subject: '9/20 深夜のメンテナンス', body: '画面確認用のお知らせ本文。',
    audienceKind: 'all', audiencePlans: [], audienceTenantIds: [], audienceLabel: 'すべて',
    channels: ['screen', 'email'], channelLabels: ['画面', 'メール'],
    status: 'sent', statusLabel: '配信済み',
    publishAt: null, sentAt: '2026-09-18T10:00:00+09:00',
    recipientsTotal: 6, lineSent: 0, lineFailed: 0, mailSent: 6, mailFailed: 0,
    screenRead: 5, screenTotal: 6, lastError: null,
    createdByName: '検証 太郎',
    createdAt: '2026-09-17T10:00:00+09:00', updatedAt: '2026-09-18T10:00:00+09:00',
  },
  {
    id: 'visual-announcement-scheduled', subject: '10月の新機能のお知らせ', body: '10/12（月）2:00〜4:00 に管理画面が使えなくなります。配信は止まりません。',
    audienceKind: 'plan', audiencePlans: ['standard', 'pro'], audienceTenantIds: [], audienceLabel: 'プラン別',
    channels: ['screen', 'email'], channelLabels: ['画面', 'メール'],
    status: 'scheduled', statusLabel: '予約',
    publishAt: '2026-10-05T10:00:00+09:00', sentAt: null,
    recipientsTotal: 0, lineSent: 0, lineFailed: 0, mailSent: 0, mailFailed: 0,
    screenRead: 0, screenTotal: 0, lastError: null,
    createdByName: '検証 太郎',
    createdAt: '2026-10-01T10:00:00+09:00', updatedAt: '2026-10-01T10:00:00+09:00',
  },
  {
    id: 'visual-announcement-1', subject: '検証用のお知らせ（下書き）', body: '画面確認用のお知らせ本文。',
    audienceKind: 'all', audiencePlans: [], audienceTenantIds: [], audienceLabel: 'すべて',
    channels: ['screen'], channelLabels: ['画面'],
    status: 'draft', statusLabel: '下書き',
    publishAt: null, sentAt: null,
    recipientsTotal: 10, lineSent: 0, lineFailed: 0, mailSent: 0, mailFailed: 0,
    screenRead: 0, screenTotal: 10, lastError: null,
    createdByName: '検証 太郎',
    createdAt: '2026-09-06T10:00:00+09:00', updatedAt: '2026-09-06T10:00:00+09:00',
  },
]
const OPS_NOTICE_LINE = {
  currentId: 'visual-qa-account',
  current: { id: 'visual-qa-account', name: '画面確認アカウント', basicId: null, addFriendUrl: null },
  candidates: [{ id: 'visual-qa-account', name: '画面確認アカウント', basicId: null }],
  linked: { linked: 8, total: 10 },
}

/** 機能9。設計の一覧・5段編集・削除確認を同じ1組の設定で撮る。 */
const FRIEND_ADD_RULE = {
  id: 'rule-referral',
  accountId: 'visual-qa-account',
  friendKind: 'first_time',
  name: '紹介キャンペーンの初回案内',
  folderName: '紹介',
  priority: 3,
  isFallback: false,
  status: 'published',
  versionId: 'rule-referral-v1',
  versionNumber: 1,
  versionStatus: 'published',
  version: 1,
  lastTestStatus: 'succeeded',
  lastTestedAt: '2026-01-13T10:00:00+09:00',
  publishedAt: '2026-01-13T10:01:00+09:00',
  matchedLast7Days: 9,
  definition: {
    routeIds: ['route-referral'],
    scenarioId: 'scenario-welcome',
    messageType: 'text',
    messageText: 'ご登録ありがとうございます。ご希望の内容をお選びください。',
    timing: 'immediate',
    actions: [
      { type: 'add_tag', label: 'タグ「新規友だち」を付ける', targetId: 'tag-new' },
      { type: 'start_scenario', label: 'シナリオ「新規登録7日間フォロー」を開始する', targetId: 'scenario-welcome' },
    ],
    friendCondition: '紹介キャンペーンから来た人へ特典を案内する。',
    activeFrom: null,
    activeUntil: null,
    weekdays: [1, 2, 3, 4, 5, 6, 0],
    timeWindows: [{ start: '08:00', end: '21:00' }],
    resendSuppressionHours: 24,
    deliveryChoices: { sendWelcomeMessage: true, startScenario: true, runActions: true },
    unknownRouteAction: { sendCommonGuidance: true, notifyStaff: true },
  },
  routeNames: ['紹介キャンペーン'],
  scenarioName: '新規登録7日間フォロー',
}

const FRIEND_ADD_RULE_OPTIONS = {
  // 作る②（h8uNW・xHpkS）の絵の4つ。秋フェアの2つは下書き rule-autumn が選んでいる。
  routes: [
    { id: 'route-autumn-flyer', name: '秋フェア チラシ', kind: 'チラシ' },
    { id: 'route-autumn-poster', name: '秋フェア 店頭ポスター', kind: 'ポスター' },
    { id: 'route-shop', name: '店頭QRコード', kind: 'QR' },
    { id: 'route-instagram', name: 'Instagram プロフィール', kind: '広告' },
  ],
  scenarios: [
    { id: 'scenario-welcome', name: '新規登録7日間フォロー' },
    { id: 'scenario-common', name: '共通のあいさつ' },
  ],
  tags: [{ id: 'tag-new', name: '新規友だち' }, { id: 'tag-delivered', name: '配信済み' }, { id: 'tag-member', name: 'NEN会員' }],
  folders: [
    { id: 'friend-add-folder-store', name: '店頭' },
    { id: 'friend-add-folder-ads', name: '広告' },
    { id: 'friend-add-folder-referral', name: '紹介' },
  ],
}

const FRIEND_ADD_RULES = {
  items: [
    // 一覧の板（MRhef・LEwkJ・P20kYU）の「最初に送るもの」の副行は1つずつ（シナリオ／タグ）。
    { ...FRIEND_ADD_RULE, id: 'rule-shop', name: '店頭QRの初回案内', folderName: '店頭', priority: 1, matchedLast7Days: 41, routeNames: ['店頭QRコード'], scenarioName: '7日間フォロー', definition: { ...FRIEND_ADD_RULE.definition, routeIds: ['route-shop'], messageText: '来店クーポンをご案内します。', actions: [FRIEND_ADD_RULE.definition.actions[1]] } },
    { ...FRIEND_ADD_RULE, id: 'rule-instagram', name: '広告からの初回案内', folderName: '広告', priority: 2, matchedLast7Days: 24, routeNames: ['Instagram プロフィール'], scenarioName: null, definition: { ...FRIEND_ADD_RULE.definition, routeIds: ['route-instagram'], scenarioId: null, messageText: '資料をダウンロードできます。', actions: [{ type: 'add_tag', label: 'タグ「広告から」を付ける', targetId: 'tag-ads' }] } },
    FRIEND_ADD_RULE,
    // 作る①〜③・競合（wDzkc・h8uNW・al47K・h5rm8t）は、この下書きを開いた絵。
    { ...FRIEND_ADD_RULE, id: 'rule-autumn', name: '秋フェアの初回案内', folderName: null, priority: 4, status: 'draft', versionStatus: 'draft', publishedAt: null, matchedLast7Days: null, routeNames: ['秋フェア チラシ'], scenarioName: null, definition: { ...FRIEND_ADD_RULE.definition, routeIds: ['route-autumn-flyer', 'route-autumn-poster'], scenarioId: 'scenario-welcome', messageText: '友だち追加ありがとうございます！\n秋フェアのチラシから来てくださった方へ、会場で使えるクーポンをお送りします。', activeFrom: '2026-10-01T00:00', activeUntil: '2026-11-30T23:59', friendCondition: JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_not_exists', value: 'tag-member' }] }), timeWindows: [], actions: [{ type: 'add_tag', label: 'タグ「秋フェア」を付ける', targetId: 'tag-autumn' }] } },
    { ...FRIEND_ADD_RULE, id: 'rule-fallback', name: '経路が分からなかった人', folderName: '店頭', priority: 999999, isFallback: true, matchedLast7Days: 12, routeNames: [], scenarioName: '共通のあいさつ', definition: { ...FRIEND_ADD_RULE.definition, routeIds: [], scenarioId: 'scenario-common', messageText: '友だち追加ありがとうございます。', actions: [FRIEND_ADD_RULE.definition.actions[1]] } },
  ],
  summary: { rules: 4, active: 3, recentAdds: 86, captured: 74, unknownRoute: 12, delivered: 84, failed: 2 },
  options: FRIEND_ADD_RULE_OPTIONS,
  total: 4,
  nextCursor: null,
}

const FRIEND_ADD_RULE_MATCHES = new Map([
  ['rule-shop', 241],
  ['rule-instagram', 382],
  ['rule-referral', 214],
  ['rule-autumn', 0],
  ['rule-fallback', 12],
])

/** 期間の端。**時計を読まない**（読むと画像が毎回変わる）。 */
const FIXED_FROM = '2026-01-01'
const FIXED_TO = '2026-01-13'

/**
 * ダッシュボードの器（`DashboardOverview`）。
 *
 * 数はすべて0。**「取れなかった」ではなく「0件」として描かせる**ための器で、
 * ここに嘘の実績を入れない。`trend` は空配列のままにする（作り物の折れ線を
 * 入れると、動いていない画面を動いていると読み違える）。
 */
/**
 * ダッシュボードの中身。**設計 `★ V6 1-1` `vUXKb` に書いてある値そのまま。**
 *
 * 全部0で返していたあいだ、ダッシュボードは空の絵しか描けなかった。
 * 受信の表もページ送りも送信枠の帯も出ないので、**設計と並べても
 * 「差が無い」とは言えない**（そもそも比べる中身が無い）。
 *
 * 設計の絵から取った値
 * - 対応が必要な受信 5件（LINE 1・MAIL 4）、最も古い未対応 9,110分前
 * - 今月の送信枠 197 / 200通（残り98.5%）→ 上限200・使用3
 * - 友だち総数 621人・有効 398人・ブロック 223人（35.9%）
 * - 友だち数の推移 7日ぶん。8/13だけ登録1で流入元「検索」
 *
 * **設計の中で数が食い違っている箇所がある。** 「接続状態」の有効友だちは
 * 4人だが、「友だちの状態」の有効は398人。同じ `friends.active` から出る
 * ので、両方は描けない。ここは398で返し、突き合わせ文書に書いてある。
 */
const DASHBOARD_TREND = [
  ['2026-08-13', 1, 0, 4, [{ name: '検索', count: 1 }]],
  ['2026-08-14', 0, 0, 4, []],
  ['2026-08-15', 0, 0, 4, []],
  ['2026-08-16', 0, 0, 4, []],
  ['2026-08-17', 0, 0, 4, []],
  ['2026-08-18', 0, 0, 4, []],
  ['2026-08-19', 0, 0, 4, []],
].map(([date, added, blocked, active, sources]) => ({
  date, added, blocked, active, estimated: false, sources,
}))

/**
 * 指標カード用の7日推移。設計 `vUXKb` は全日とも有効友だち398人で、
 * 日付と数は ★V8 WQmep の絵の7日（9/24〜9/30）。旧グラフ用の active=4 は流用しない。
 */
const DASHBOARD_METRIC_TREND = [
  /* ★V8 ダッシュボード（WQmep）の絵の7日：9/24〜9/30、登録 2・1・3・5・4・2・6、ブロック 0・1・0・1・0・2・1。 */
  ['2026-09-24', 2, 0, 398, [{ name: '検索', count: 2 }]],
  ['2026-09-25', 1, 1, 398, []],
  ['2026-09-26', 3, 0, 398, []],
  ['2026-09-27', 5, 1, 398, []],
  ['2026-09-28', 4, 0, 398, []],
  ['2026-09-29', 2, 2, 398, []],
  ['2026-09-30', 6, 1, 398, []],
].map(([date, added, blocked, active, sources]) => ({
  date, added, blocked, active, estimated: false, sources,
}))

/**
 * 表示するカードと並び。設計 `vUXKb` の右カラムに合わせる。
 * 既定では出ない「友だちの状態」も、設計の絵では出ているので出す。
 */
const DASHBOARD_PREFERENCES = {
  source: 'account-default',
  version: 1,
  updatedAt: `${FIXED_TO}T00:00:00.000Z`,
  cards: {
    today: ['today-inbox', 'today-photo-review', 'today-bookings', 'today-shipments']
      .map((id) => ({ id, visible: true })),
    main: [
      /* 段の並びは ★V8 WQmep の絵（推移 → 受信 → 追加リンク）。 */
      ...['shipment', 'friend-trend', 'pending-inbox', 'friend-add'].map((id) => ({ id, visible: true })),
      ...['scenario-status', 'uid-migration'].map((id) => ({ id, visible: false })),
    ],
    right: [
      ...['send-quota', 'operational-alerts', 'connection-status', 'support-mark-status',
        'friend-status', 'upcoming', 'delivery-failures', 'monthly-delivery', 'recent-results'].map((id) => ({ id, visible: true })),
      ...['booking-status', 'inflow-top', 'funnel-alert', 'automation-failures'].map((id) => ({ id, visible: false })),
    ],
  },
}

/**
 * M (今後の予定)の見本。型は `api.ts` の `DashboardUpcoming` どおり。
 * 予約配信・リマインダー・予約を時刻順に並べた形。
 */
const DASHBOARD_UPCOMING = {
  items: [
    { kind: 'reminder', id: 'fr-1', title: '来店前日（あおい）', startsAt: `${FIXED_TO}T01:00:00.000Z`, href: '/reminders' },
    { kind: 'broadcast', id: 'bc-1', title: '秋の案内', startsAt: `${FIXED_TO}T02:00:00.000Z`, href: '/broadcasts' },
    { kind: 'booking', id: 'bk-1', title: '相談30分（あおい）', startsAt: `${FIXED_TO}T03:00:00.000Z`, href: '/booking/bookings?view=list' },
  ],
  asOf: `${FIXED_TO}T00:00:00.000Z`,
  rangeDays: 7,
}

/**
 * L (#824 数字の出どころ)の見本。型は `api.ts` の `DeliveryFailureOrigins` どおり。
 * 同じ失敗は1件・送り直しは数えない形（合計3件）。
 */
const DASHBOARD_DELIVERY_FAILURE_ORIGINS = {
  total: 3,
  asOf: `${FIXED_TO}T11:50:00.000Z`,
  origins: [
    { source: 'broadcast.failed', failures: 2, latestFailedAt: `${FIXED_TO}T11:50:00.000Z`, sampleDeliveryIds: ['delivery-a', 'delivery-b'] },
    { source: 'scenario.failed', failures: 1, latestFailedAt: `${FIXED_TO}T10:20:00.000Z`, sampleDeliveryIds: ['delivery-c'] },
  ],
}

/** M (止めた経路のQR)の印刷用PDFの見本。A4・1枚の骨組みだけ。 */
const QR_PRINT_PDF_SAMPLE = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] >>
endobj
trailer
<< /Size 4 /Root 1 0 R >>
%%EOF`

const DASHBOARD_OVERVIEW = {
  period: 'today',
  generatedAt: `${FIXED_TO}T00:00:00.000Z`,
  // timezone無しD1値でも、閲覧端末のtimezoneに左右されず「更新 09:30」と確認できる。
  asOf: `${FIXED_TO} 09:30:00`,
  freshness: 'fresh',
  friends: { active: 398, total: 621, blockedByThem: 223, hiddenByUs: 0, blockedBoth: 0 },
  inbox: {
    unanswered: 5,
    inProgress: 0,
    onHold: 0,
    resolved: 38,
    // 受信箱の見本（summary total 5・line 1・email 4・emailUnread 4）と同じ内訳。
    line: { unanswered: 1, inProgress: 0, onHold: 0, resolved: 34 },
    email: { unanswered: 4, inProgress: 0, onHold: 0, resolved: 4 },
    // 設計の運用アラート「最も古い未対応：9,110分前」。
    oldestUnansweredMinutes: 9110,
    averageFirstReplyMinutes: null,
  },
  // 設計「プッシュ 0通 リプライ 0通」「197 / 200通（残り98.5%）」。
  delivery: { sent: 0, push: 0, reply: 0, broadcasts: 0, quotaLimit: 200, quotaUsed: 3 },
  trend: DASHBOARD_TREND,
  conversions: { total: 0, byPoint: [] },
  partialFailures: [],
  sections: {
    friends: { status: 'ok', asOf: `${FIXED_TO} 09:30:00`, freshness: 'fresh', reason: null, period: 'latest' },
    inbox: { status: 'ok', asOf: `${FIXED_TO} 09:30:00`, freshness: 'fresh', reason: null, period: 'latest' },
    delivery: { status: 'empty', asOf: `${FIXED_TO} 09:30:00`, freshness: 'fresh', reason: null, period: 'this-month' },
    quota: { status: 'ok', asOf: `${FIXED_TO} 09:30:00`, freshness: 'fresh', reason: null, period: 'this-month' },
    trend: { status: 'estimated', asOf: `${FIXED_TO} 09:30:00`, freshness: 'fresh', reason: null, period: 'last7-fixed' },
    conversions: { status: 'empty', asOf: `${FIXED_TO} 09:30:00`, freshness: 'fresh', reason: null, period: 'today' },
    operations: { status: 'ok', asOf: `${FIXED_TO} 09:30:00`, freshness: 'fresh', reason: null, period: 'today' },
  },
  operations: {
    scenarios: { active: 0, paused: 0 },
    migrations: { active: 0, completed: 0 },
    bookings: { pending: 0, upcoming: 0 },
    inflowTop: [],
    funnelAlerts: 0,
    automationFailures: 0,
  },
  // PR #1016 の未取得判別契約。値だけでなく、基準時刻と期間も本番APIとそろえる。
  metrics: {
    activeFriends: {
      value: 398,
      state: 'available',
      reason: null,
      asOf: `${FIXED_TO}T00:00:00.000Z`,
      period: 'latest',
    },
    monthlyQuota: {
      value: { used: 3, limit: 200, remaining: 197 },
      state: 'available',
      reason: null,
      asOf: `${FIXED_TO}T00:00:00.000Z`,
      period: 'this-month',
    },
    friendTrend: {
      value: DASHBOARD_METRIC_TREND,
      state: 'estimated',
      reason: null,
      asOf: `${FIXED_TO}T00:00:00.000Z`,
      period: 'last7-fixed',
    },
    officialProfileUrl: {
      value: 'https://lin.ee/nen-official',
      state: 'available',
      reason: null,
      asOf: `${FIXED_TO}T00:00:00.000Z`,
      period: 'latest',
    },
  },
  // 機能1 `JN6mQ`。撮影時だけPencilの見本QRと固定URLへ合わせる。
  // 実環境のQR生成とURL解決にはこの値を返さない。
  visualQa: {
    referenceQr: true,
    friendAddUrl: 'https://nen-line-stg.skmtmst.workers.dev/auth/line?account=2011090867',
    officialProfileUrl: 'https://lin.ee/nen-official',
    pendingPhotos: 1,
    hideBookings: true,
    healthRisk: 'normal',
    operationalAlerts: 2,
    twoFactor: { enabled: 0, total: 6 },
    notificationUnreadCount: 3,
    shipmentStatus: '未処理なし',
    /*
     * 対応状況の差し替えは置かない。本物の概要と同じ数（上の小カード5件と
     * 右の未対応が同じ `overview.inbox`）にする。360件の見本を置いていた頃、
     * 同じ画面で 5件と360件が並んで食い違いに見えた。
     */
  },
}

/**
 * 対応が必要な受信。設計の表の2行そのまま。**総数は5件**なので、
 * ページ送りが「1〜2 / 5件」と2ページ出る。1ページに収まる数で返すと、
 * ページ送りが描かれず、そこを見張れない。
 */
const SUPPORT_INBOX_ITEMS = [
  {
    id: 'inbox-1',
    channel: 'line',
    customerName: 'Kyohei Yamamoto',
    preview: '🚕💐',
    // 「6日前」と出したい。撮るときの時計は `VISUAL_QA_NOW` で止めてある。
    lastIncomingAt: '2026-08-13T12:00:00.000Z',
  },
  {
    id: 'inbox-2',
    channel: 'email',
    customerName: 'テスト 太郎',
    preview: 'テスト太郎 様 この度…',
    // 「4日前」。
    lastIncomingAt: '2026-08-15T12:00:00.000Z',
  },
]

/**
 * 受信箱（`/chats`）に混ぜるメール。ダッシュボードの行とは別の形が要る。
 * `status` が無いと `statusConfig[item.status]` で落ちる。
 */
const SUPPORT_EMAIL_ITEMS = [
  {
    id: 'email:mail-1',
    threadId: 'mail-1',
    customerName: '坂本 真人',
    customerIdentifier: 'sakamoto@example.com',
    subject: '発送について',
    preview: 'ご注文ありがとうございます。発送状況をご案内します。',
    status: 'resolved',
    revision: 1,
    assignedStaffId: null,
    assignedStaffName: null,
    lastIncomingAt: '2026-08-16T02:10:00.000Z',
    isUnread: false,
  },
  {
    id: 'email:mail-2',
    threadId: 'mail-2',
    customerName: 'テスト 太郎',
    customerIdentifier: 'taro@example.com',
    subject: 'ご注文について',
    preview: 'ご注文ありがとうございます。内容を確認して対応します。',
    status: 'resolved',
    revision: 1,
    assignedStaffId: null,
    assignedStaffName: null,
    lastIncomingAt: '2026-08-16T01:30:00.000Z',
    isUnread: false,
  },
]

/**
 * 一覧を配列で返す口。**`api.ts` から読む。手で並べない。**
 *
 * 手で並べていたときは6件しか無く、足りない口が `{items:[],total:0}` に
 * 落ちて、ダッシュボード・分析・一斉配信・リッチメニュー・
 * オートメーションの5画面が `xxx.filter is not a function` で真っ白だった。
 */
const ARRAY_PATHS = readArrayGetPaths()

/**
 * `api.ts` を通らない口。**足すのは、落ちた画面を見てから。**
 *
 * 受信箱の担当者一覧は `api.ts` に無く、自動では拾えない。
 * 消したら `operators.map is not a function` で受信箱が真っ白になった。
 */
for (const extra of ['/api/operators', '/api/feature-settings']) ARRAY_PATHS.add(extra)

/**
 * 後ろが変わる口（`/api/scenarios/{id}/steps` など）。
 * ここは `api.ts` から機械的には決められないので、**落ちた画面を見て足す**。
 */
const ARRAY_PREFIXES = [
  '/api/scenarios/',
  '/api/automations/',
  '/api/media/',
  '/api/common-vars/',
  '/api/entry-routes/',
  '/api/affiliates/',
  '/api/traffic-pools/',
  '/api/ad-platforms/',
  '/api/users/',
]

/** プール管理（設計 `u3iab3`）の2つのプールと所属アカウント。 */
const TRAFFIC_POOLS = [
  { id: 'pool-shibuya', slug: 'shibuya', name: '渋谷エリア', activeAccountId: 'visual-qa-account-prod', isActive: true, createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
  { id: 'pool-event', slug: 'event', name: 'イベント用', activeAccountId: 'visual-qa-account-event-2025', isActive: true, createdAt: '2026-06-02T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
]
const TRAFFIC_POOL_ACCOUNTS = [
  { id: 'pool-shibuya-prod', poolId: 'pool-shibuya', lineAccountId: 'visual-qa-account-prod', isActive: true, createdAt: '2026-06-01T00:00:00.000Z' },
  { id: 'pool-shibuya-store', poolId: 'pool-shibuya', lineAccountId: 'visual-qa-account-store', isActive: true, createdAt: '2026-06-01T00:00:00.000Z' },
  { id: 'pool-event-2025', poolId: 'pool-event', lineAccountId: 'visual-qa-account-event-2025', isActive: true, createdAt: '2026-06-02T00:00:00.000Z' },
]

/** 機能31の固定応答。本物と同じ全ID・既定値・版を返す。 */
const FEATURES = {
  scenarios: true, broadcasts: true, templates: true, reminders: true,
  auto_replies: true, rich_menus: true, inflow_tracking: true, forms: true,
  photo_review: true, automations: true, external_integrations: true,
  friend_add_routing: true, multi_store_hierarchy: false,
  friend_fields: true, support_marks: true, saved_searches: true,
  media: true, common_vars: true, analytics: true, site_tracking: true,
  webinars: false, events: true, booking: true, affiliates: false, mileage: true,
  ec_commerce: true, line_notifications: true, nen_campaigns: true,
  restaurant_test: true,
}

/** 設計 `bfB50` / `oHAN4` を確認するための固定ECデータ。秘密値そのものは置かない。 */
const EC_SUBSCRIPTIONS = {
  items: [
    { id: 'sub-1', friendId: 'friend-1', ownerName: '高橋 直人', petName: 'ももちゃん', contractNumber: 'SUB-12492', status: 'active', statusLabel: 'よく続いています', riskReason: null, nextShippingAt: '2026-09-08', cycle: 'フード定期便（毎月）', items: '鹿肉フード × 2', amount: 12800, continuedCount: 10, startedAt: '2025-11-01', cancelledAt: null, cancellationReason: null, syncedAt: '2026-09-06T09:58:00+09:00' },
    { id: 'sub-2', friendId: 'friend-2', ownerName: '前田 さくら', petName: 'そらくん', contractNumber: 'SUB-12503', status: 'active', statusLabel: 'よく続いています', riskReason: null, nextShippingAt: '2026-09-09', cycle: 'おやつ定期便（毎月）', items: '鹿肉ジャーキー × 1', amount: 4200, continuedCount: 8, startedAt: '2026-01-01', cancelledAt: null, cancellationReason: null, syncedAt: '2026-09-06T09:58:00+09:00' },
    { id: 'sub-3', friendId: 'friend-3', ownerName: '木村 亮', petName: 'こむぎちゃん', contractNumber: 'SUB-12511', status: 'at_risk', statusLabel: '決済の確認が必要です', riskReason: '定期便のお支払いを確認できませんでした', nextShippingAt: '2026-09-12', cycle: 'フード定期便（2か月に1回）', items: '鹿肉フード × 1', amount: 8600, continuedCount: 7, startedAt: '2025-08-01', cancelledAt: null, cancellationReason: null, syncedAt: '2026-09-06T09:58:00+09:00' },
    { id: 'sub-4', friendId: 'friend-4', ownerName: '中村 彩', petName: 'ぷりんちゃん', contractNumber: 'SUB-12528', status: 'paused', statusLabel: '休止中です', riskReason: null, nextShippingAt: null, cycle: 'おやつ定期便（毎月）', items: '鹿肉クッキー × 2', amount: 3600, continuedCount: 4, startedAt: '2026-05-01', cancelledAt: null, cancellationReason: null, syncedAt: '2026-09-06T09:58:00+09:00' },
    { id: 'sub-5', friendId: 'friend-5', ownerName: '大西 健一', petName: 'レオくん', contractNumber: 'SUB-12532', status: 'cancelled', statusLabel: '止まりました', riskReason: null, nextShippingAt: null, cycle: 'フード定期便（毎月）', items: '鹿肉フード × 1', amount: 9800, continuedCount: 3, startedAt: '2026-05-01', cancelledAt: '2026-09-01', cancellationReason: '使いきれない', syncedAt: '2026-09-06T09:58:00+09:00' },
  ],
  summary: { total: 186, active: 172, paused: 5, atRisk: 14, cancelled: 8, monthlyAmount: 1482000, startedThisMonth: 12, cancelledThisMonth: 3, cancellationTopReason: '使いきれない', monthlyStats: [
    { month: '2026-06', count: 158, amount: 1248000 }, { month: '2026-07', count: 169, amount: 1324000 }, { month: '2026-08', count: 172, amount: 1482000 },
  ] },
  risk: { source: 'payment_status', ruleVersion: 'subscription-payment-status-v1', calculatedAt: '2026-09-06T09:58:00+09:00', predictiveScoreAvailable: false },
}

const EC_CONNECTOR = {
  configured: true,
  connector: {
    id: 'connector-visual', provider: 'shopify', shopDomain: 'nen-store.myshopify.com', status: 'connected',
    secretConfigured: true, secretLastFour: '8f3a', secretUpdatedAt: '2026-02-14T10:00:00+09:00',
    eventTypes: ['ec.order.confirmed', 'ec.order.payment_received', 'ec.order.shipped', 'ec.order.cancelled', 'ec.order.refunded', 'ec.customer.profile_updated'],
    identityRules: ['verified_email', 'verified_phone', 'manual_name_postal'], version: 3, updatedAt: '2026-09-06T09:58:00+09:00',
  },
  health: { today: 148, last30Days: 2486, failed: 2, lastReceivedAt: '2026-09-06T09:58:00+09:00', lastSucceededAt: '2026-09-06T09:58:00+09:00' },
  impact: { ...EC_OVERVIEW.impact },
  // 本番の口は retryPolicy を常に null で返す(#517 中5b)。つなぎ先単位の
  // やり直し方針は無く、再試行は実行単位(next_retry_at / max_attempts)で持つ。
  // 目視確認が本番と別物にならないよう、モックも null に揃える。
  retryPolicy: null,
}

/*
 * 飲食店向けテスト（`/restaurant-test/*`）のスナップショット。
 * `restaurantTestApi.snapshot` が一度に返す形（`apps/worker` の restaurant-test）を
 * そのまま写す。板 CHz31 の並び（渋谷・表参道・中目黒の3店舗）に寄せた固定データ。
 * 日時は撮るたびに変わる絵にならないよう「今日」を基準に組み立てる。
 */
const RESTAURANT_TODAY = new Date()
const restaurantAt = (hour, minute = 0, dayOffset = 0) => {
  const d = new Date(RESTAURANT_TODAY)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}
const RESTAURANT_STORES = [
  { id: 'store-sby', organization_id: 'org-nen', name: '然 渋谷店', code: 'SBY-01', area: '渋谷', capacity: 80, timezone: 'Asia/Tokyo', status: 'active', line_status: 'connected', google_status: 'connected', line_account_id: 'visual-qa-account', line_account_name: '然 渋谷店', friend_count: 1280 },
  { id: 'store-omt', organization_id: 'org-nen', name: '然 表参道店', code: 'OMT-02', area: '表参道', capacity: 64, timezone: 'Asia/Tokyo', status: 'active', line_status: 'connected', google_status: 'warning', line_account_id: 'visual-qa-account-2', line_account_name: '然 表参道店', friend_count: 842 },
  { id: 'store-nkm', organization_id: 'org-nen', name: '然 中目黒店', code: 'NKM-03', area: '中目黒', capacity: 48, timezone: 'Asia/Tokyo', status: 'active', line_status: 'error', google_status: 'connected', line_account_id: null, line_account_name: null, friend_count: null },
]
/* 板 BERxg（座席・卓管理）の9卓。稼働8卓で26席（予約枠・在庫 Y8SjT2 の総数）、停止中の個室Bを含めて32席。T2・T3 が結合A。 */
const RESTAURANT_TABLES = [
  { id: 'tbl-1', store_id: 'store-sby', code: 'T1', label: '2人卓', seat_type: 'table', min_capacity: 1, max_capacity: 2, floor_x: 0, floor_y: 0, join_group: null, is_active: 1 },
  { id: 'tbl-2', store_id: 'store-sby', code: 'T2', label: '2人卓', seat_type: 'table', min_capacity: 1, max_capacity: 2, floor_x: 1, floor_y: 0, join_group: 'A', is_active: 1 },
  { id: 'tbl-3', store_id: 'store-sby', code: 'T3', label: '窓側4人卓', seat_type: 'table', min_capacity: 2, max_capacity: 4, floor_x: 2, floor_y: 0, join_group: 'A', is_active: 1 },
  { id: 'tbl-4', store_id: 'store-sby', code: 'T4', label: '4人卓', seat_type: 'table', min_capacity: 2, max_capacity: 4, floor_x: 0, floor_y: 1, join_group: null, is_active: 1 },
  { id: 'tbl-6', store_id: 'store-sby', code: 'C1', label: 'カウンター', seat_type: 'counter', min_capacity: 1, max_capacity: 1, floor_x: 1, floor_y: 1, join_group: null, is_active: 1 },
  { id: 'tbl-7', store_id: 'store-sby', code: 'C2', label: 'カウンター', seat_type: 'counter', min_capacity: 1, max_capacity: 1, floor_x: 2, floor_y: 1, join_group: null, is_active: 1 },
  { id: 'tbl-8', store_id: 'store-sby', code: '個室A', label: '個室', seat_type: 'private_room', min_capacity: 4, max_capacity: 8, floor_x: 0, floor_y: 2, join_group: null, is_active: 1 },
  { id: 'tbl-5', store_id: 'store-sby', code: '個室B', label: '個室', seat_type: 'private_room', min_capacity: 4, max_capacity: 6, floor_x: 1, floor_y: 2, join_group: null, is_active: 0 },
  { id: 'tbl-9', store_id: 'store-sby', code: 'TR1', label: 'テラス', seat_type: 'terrace', min_capacity: 2, max_capacity: 4, floor_x: 2, floor_y: 2, join_group: null, is_active: 1 },
]
/* 板 MJoJR（メニュー管理）の6品：有効4・申請中1（ランチコースの価格改定）・保管済1。 */
const RESTAURANT_MENU = [
  { id: 'menu-6', store_id: 'store-sby', kind: 'course', name: '秋の鹿肉コース', price: 8800, tax_mode: 'included', allergens_json: '["小麦","乳"]', service_periods_json: '["dinner"]', duration_minutes: 120, status: 'active' },
  { id: 'menu-1', store_id: 'store-sby', kind: 'course', name: 'おまかせコース', price: 12000, tax_mode: 'included', allergens_json: '["えび","かに"]', service_periods_json: '["dinner"]', duration_minutes: 150, status: 'active' },
  { id: 'menu-5', store_id: 'store-sby', kind: 'course', name: 'ランチコース', price: 4200, tax_mode: 'included', allergens_json: '["小麦"]', service_periods_json: '["lunch"]', duration_minutes: 90, status: 'active', pendingPrice: 4500, pendingEffectiveAt: null, priceChangeStatus: 'pending' },
  { id: 'menu-3', store_id: 'store-sby', kind: 'a_la_carte', name: '鹿肉のロースト', price: 2400, tax_mode: 'included', allergens_json: '[]', service_periods_json: '["lunch","dinner"]', duration_minutes: null, status: 'active' },
  { id: 'menu-4', store_id: 'store-sby', kind: 'a_la_carte', name: '季節の前菜盛り合わせ', price: 1600, tax_mode: 'included', allergens_json: '["卵","乳"]', service_periods_json: '["dinner"]', duration_minutes: null, status: 'active' },
  { id: 'menu-2', store_id: 'store-sby', kind: 'course', name: '夏の冷製コース', price: 6600, tax_mode: 'included', allergens_json: '["小麦"]', service_periods_json: '["dinner"]', duration_minutes: 120, status: 'archived' },
]
/*
 * 板 l9NlC0（予約台帳 今日・時間×卓）の1日：7件・22名＋押さえ1枠（TR1）。承認待ちは山田さん（食べログ）。
 * 卓「T3」には先の予約が3件（板 eY9F3 卓を止める確認）。ほかの店舗の予約は数を見るために少し残す。
 */
const RESTAURANT_RESERVATIONS = [
  { id: 'rsv-1', store_id: 'store-sby', store_name: '然 渋谷店', source: 'tabelog', external_id: 'TB-11230', customer_name: '山田 太郎', customer_phone: '080-1234-5678', line_uid: null, guest_count: 2, starts_at: restaurantAt(18, 30), ends_at: restaurantAt(20, 30), table_id: 'tbl-1', table_label: '2人卓', course_id: 'menu-1', course_name: 'おまかせコース', status: 'pending', allergy_note: '乳', note: null, sync_direction: 'inbound_only' },
  { id: 'rsv-2', store_id: 'store-sby', store_name: '然 渋谷店', source: 'line', external_id: null, customer_name: '佐藤 健', customer_phone: null, line_uid: 'U-demo-1', guest_count: 2, starts_at: restaurantAt(18, 0), ends_at: restaurantAt(20, 0), table_id: 'tbl-2', table_label: '2人卓', course_id: null, course_name: null, status: 'confirmed', allergy_note: null, note: null, sync_direction: 'inbound_only' },
  { id: 'rsv-3', store_id: 'store-sby', store_name: '然 渋谷店', source: 'restaurant_board', external_id: 'RB-55210', customer_name: '田中 明子', customer_phone: '090-5555-1234', line_uid: null, guest_count: 4, starts_at: restaurantAt(18, 0), ends_at: restaurantAt(20, 0), table_id: 'tbl-3', table_label: '窓側4人卓', course_id: 'menu-6', course_name: '秋の鹿肉コース', status: 'confirmed', allergy_note: 'えび', note: null, sync_direction: 'inbound_only' },
  { id: 'rsv-4', store_id: 'store-sby', store_name: '然 渋谷店', source: 'hotpepper', external_id: 'HP-88213', customer_name: '鈴木 真理', customer_phone: null, line_uid: null, guest_count: 4, starts_at: restaurantAt(19, 0), ends_at: restaurantAt(21, 0), table_id: 'tbl-4', table_label: '4人卓', course_id: 'menu-6', course_name: '秋の鹿肉コース', status: 'confirmed', allergy_note: null, note: null, sync_direction: 'inbound_only' },
  { id: 'rsv-5', store_id: 'store-sby', store_name: '然 渋谷店', source: 'phone', external_id: null, customer_name: '小林 健太', customer_phone: '03-5555-6666', line_uid: null, guest_count: 1, starts_at: restaurantAt(18, 30), ends_at: restaurantAt(20, 0), table_id: 'tbl-6', table_label: 'カウンター', course_id: 'menu-1', course_name: 'おまかせコース', status: 'confirmed', allergy_note: null, note: null, sync_direction: 'inbound_only' },
  { id: 'rsv-6', store_id: 'store-sby', store_name: '然 渋谷店', source: 'line', external_id: null, customer_name: '加藤 舞', customer_phone: null, line_uid: 'U-demo-2', guest_count: 1, starts_at: restaurantAt(19, 0), ends_at: restaurantAt(20, 30), table_id: 'tbl-7', table_label: 'カウンター', course_id: null, course_name: null, status: 'confirmed', allergy_note: null, note: null, sync_direction: 'inbound_only' },
  { id: 'rsv-7', store_id: 'store-sby', store_name: '然 渋谷店', source: 'phone', external_id: null, customer_name: '坂本 真人', customer_phone: '03-1111-0000', line_uid: null, guest_count: 8, starts_at: restaurantAt(19, 0), ends_at: restaurantAt(21, 30), table_id: 'tbl-8', table_label: '個室', course_id: 'menu-6', course_name: '秋の鹿肉コース', status: 'confirmed', allergy_note: 'そば・小麦', note: null, sync_direction: 'inbound_only' },
  { id: 'rsv-8', store_id: 'store-sby', store_name: '然 渋谷店', source: 'phone', external_id: null, customer_name: '押さえ', customer_phone: null, line_uid: null, guest_count: 4, starts_at: restaurantAt(20, 0), ends_at: restaurantAt(21, 30), table_id: 'tbl-9', table_label: 'テラス', course_id: null, course_name: null, status: 'pending', allergy_note: '電話のお客さま用', note: '電話のお客さま用', hold_expires_at: restaurantAt(23, 30), sync_direction: 'inbound_only' },
  { id: 'rsv-9', store_id: 'store-sby', store_name: '然 渋谷店', source: 'line', external_id: null, customer_name: '山田 花子', customer_phone: '090-1111-2222', line_uid: 'U-demo-3', guest_count: 4, starts_at: restaurantAt(19, 0, 1), ends_at: restaurantAt(21, 0, 1), table_id: 'tbl-3', table_label: '窓側4人卓', course_id: 'menu-6', course_name: '秋の鹿肉コース', status: 'confirmed', allergy_note: 'えび', note: null, sync_direction: 'inbound_only' },
  { id: 'rsv-10', store_id: 'store-sby', store_name: '然 渋谷店', source: 'phone', external_id: null, customer_name: '佐藤 健', customer_phone: '090-3333-4444', line_uid: null, guest_count: 3, starts_at: restaurantAt(12, 0, 2), ends_at: restaurantAt(14, 0, 2), table_id: 'tbl-3', table_label: '窓側4人卓', course_id: null, course_name: null, status: 'confirmed', allergy_note: null, note: null, sync_direction: 'inbound_only' },
  { id: 'rsv-11', store_id: 'store-sby', store_name: '然 渋谷店', source: 'restaurant_board', external_id: 'RB-55290', customer_name: '田中 明子', customer_phone: '090-5555-1234', line_uid: null, guest_count: 2, starts_at: restaurantAt(18, 30, 7), ends_at: restaurantAt(20, 30, 7), table_id: 'tbl-3', table_label: '窓側4人卓', course_id: 'menu-1', course_name: 'おまかせコース', status: 'confirmed', allergy_note: null, note: null, sync_direction: 'inbound_only' },
  { id: 'rsv-12', store_id: 'store-omt', store_name: '然 表参道店', source: 'hotpepper', external_id: 'HP-88400', customer_name: '小林 誠', customer_phone: null, line_uid: null, guest_count: 4, starts_at: restaurantAt(19, 0), ends_at: restaurantAt(21, 0), table_id: null, table_label: null, course_id: 'menu-1', course_name: 'おまかせコース', status: 'confirmed', allergy_note: null, note: null, sync_direction: 'inbound_only' },
  { id: 'rsv-13', store_id: 'store-nkm', store_name: '然 中目黒店', source: 'manual', external_id: null, customer_name: '松本 大輔', customer_phone: '070-9999-0000', line_uid: null, guest_count: 5, starts_at: restaurantAt(18, 30, 1), ends_at: restaurantAt(20, 30, 1), table_id: null, table_label: null, course_id: 'menu-1', course_name: 'おまかせコース', status: 'confirmed', allergy_note: null, note: null, sync_direction: 'inbound_only' },
]
const RESTAURANT_SNAPSHOT = {
  environment: 'staging_test',
  integrationPolicy: 'inbound_only',
  organization: { id: 'org-nen', account_id: 'visual-qa-account', tenant_id: 'tenant-nen', tenant_name: '株式会社 然', name: '然フードホールディングス', status: 'active' },
  stores: RESTAURANT_STORES,
  memberships: [
    { id: 'mem-1', store_id: null, staff_name: '高田 誠', email: 'takada@example.com', role: 'super_admin', line_uid: 'U-admin-1', google_email: 'takada@example.com', status: 'active' },
    { id: 'mem-2', store_id: 'store-sby', staff_name: '中川 由美', email: 'nakagawa@example.com', role: 'store_manager', line_uid: 'U-mgr-1', google_email: 'nakagawa@example.com', status: 'active' },
    { id: 'mem-3', store_id: 'store-omt', staff_name: '佐野 直人', email: 'sano@example.com', role: 'store_manager', line_uid: null, google_email: 'sano@example.com', status: 'active' },
    { id: 'mem-4', store_id: 'store-sby', staff_name: '山田 花子', email: 'yamada@example.com', role: 'staff', line_uid: 'U-staff-1', google_email: null, status: 'active' },
    { id: 'mem-5', store_id: 'store-nkm', staff_name: '林 直人', email: null, role: 'staff', line_uid: null, google_email: null, status: 'invited' },
    { id: 'mem-6', store_id: 'store-omt', staff_name: '鈴木 一郎', email: 'suzuki@example.com', role: 'staff', line_uid: null, google_email: null, status: 'suspended' },
  ],
  /* 板 t8WgD8 の4枚：承認待ち2（Google投稿・メニュー改定）・差戻し1（LINE配信）・承認済1（Google投稿） */
  approvals: [
    { id: 'apr-1', store_id: 'store-sby', kind: 'gbp_post', title: '秋の鹿肉コース はじまりました', status: 'pending', requested_by: '中川 由美', review_comment: null, created_at: restaurantAt(10, 12, -2), payload_json: JSON.stringify({ typeLabel: 'イベント', title: '秋の鹿肉コース', body: '10月1日から、信州の鹿肉を使った秋のコースをはじめます。ご予約は LINE から。' }) },
    { id: 'apr-2', store_id: 'store-omt', kind: 'menu_change', title: 'ランチコースの価格改定', status: 'pending', requested_by: '佐野 直人', review_comment: null, created_at: restaurantAt(18, 40, -3), payload_json: JSON.stringify({ before: 'ランチコース ¥3,800', after: 'ランチコース ¥4,200' }) },
    { id: 'apr-3', store_id: null, kind: 'line_message', title: '来店お礼メッセージ', status: 'returned', requested_by: '中川 由美', review_comment: 'クーポンの期限を書いてください（高田）', created_at: restaurantAt(15, 2, -5), payload_json: JSON.stringify({ title: 'ご来店ありがとうございました', body: 'またのお越しをお待ちしております。次回使えるクーポンをお送りします。' }) },
    { id: 'apr-4', store_id: 'store-nkm', kind: 'gbp_post', title: '10月の定休日のお知らせ', status: 'approved', requested_by: '高田 誠', review_comment: null, created_at: restaurantAt(9, 30, -7), payload_json: JSON.stringify({ typeLabel: '通常の投稿', body: '10月は毎週火曜が定休日です。' }) },
  ],
  reservations: RESTAURANT_RESERVATIONS,
  reservationTotal: RESTAURANT_RESERVATIONS.length,
  tables: RESTAURANT_TABLES,
  inventory: [17, 18, 19, 20].flatMap((h) => [0, 30].map((m) => ({
    id: `inv-${h}${m}`, store_id: 'store-sby', starts_at: restaurantAt(h, m), slot_minutes: 30,
    total_capacity: 26, ota_capacity: 10, line_capacity: 10, walk_in_capacity: 6,
    reserved_count: h === 19 ? 20 : 8,
  }))),
  menuItems: RESTAURANT_MENU,
  connectors: [
    { id: 'con-1', store_id: 'store-sby', provider: 'restaurant_board', mode: 'inbound_only', status: 'connected', last_synced_at: restaurantAt(8, 0), last_error: null },
    { id: 'con-2', store_id: 'store-omt', provider: 'restaurant_board', mode: 'inbound_only', status: 'connected', last_synced_at: restaurantAt(8, 0), last_error: null },
  ],
  reviews: [
    { id: 'rev-1', store_id: 'store-sby', author_name: 'Googleユーザー', rating: 5, comment: '雰囲気がよく料理も美味しかったです。', reviewed_at: restaurantAt(20, 5, -1), reply_status: 'replied', reply_draft: null, sentiment: 'positive' },
    { id: 'rev-2', store_id: 'store-sby', author_name: 'K.Y', rating: 4, comment: '接客が丁寧でした。', reviewed_at: restaurantAt(13, 42), reply_status: 'unreplied', reply_draft: null, sentiment: 'positive' },
    { id: 'rev-3', store_id: 'store-omt', author_name: 'M.S', rating: 3, comment: '料理は良いが少し待った。', reviewed_at: restaurantAt(21, 10, -1), reply_status: 'unreplied', reply_draft: null, sentiment: 'neutral' },
    { id: 'rev-4', store_id: 'store-nkm', author_name: 'T.K', rating: 2, comment: '予約の確認が取れなかった。', reviewed_at: restaurantAt(10, 0, -2), reply_status: 'unreplied', reply_draft: 'ご不便をおかけし申し訳ありません。', sentiment: 'negative' },
  ],
  posts: [
    { id: 'post-1', store_id: 'store-sby', post_type: 'standard', title: '週末ランチ始めました', body: '土日限定のランチコースをご用意しています。', status: 'draft', scheduled_at: null },
    { id: 'post-2', store_id: 'store-sby', post_type: 'event', title: '臨時休業のお知らせ', body: '設備点検のため休業します。', status: 'pending', scheduled_at: null },
  ],
  lineFlows: [
    /* 種別は本物（rt_line_flows の flow_type）と同じ。文は ★V8 LINE来店フォロー（xLpnS）の絵どおり。 */
    { id: 'flow-1', store_id: null, flow_type: 'reservation_24h', title: '明日 19:00 にお待ちしております', body: 'ご予約内容の確認・変更はこちらから。アレルギーがあればお知らせください。', timing_minutes: -1440, is_enabled: 1, delivery_mode: 'preview_only' },
    { id: 'flow-2', store_id: null, flow_type: 'reservation_2h', title: '本日のご来店をお待ちしております', body: 'お店までの道順と、駐車場のご案内です。', timing_minutes: -120, is_enabled: 1, delivery_mode: 'preview_only' },
    { id: 'flow-3', store_id: null, flow_type: 'post_visit', title: '本日はありがとうございました', body: '次回使えるデザートのサービス券をお送りします。', timing_minutes: 180, is_enabled: 0, delivery_mode: 'preview_only' },
    { id: 'flow-4', store_id: null, flow_type: 'review_request', title: 'よろしければご感想をお聞かせください', body: 'Google の口コミに書いていただけるとうれしいです。', timing_minutes: 1440, is_enabled: 0, delivery_mode: 'preview_only' },
  ],
}
/*
 * 飲食店向け Googleビジネス（`restaurantGoogleApi`・`/api/restaurant-test/google/*`）。
 * ★V8 Googleビジネスの板（口コミ j0Wcg・返信 x9HIR・投稿 Cfed0・投稿を作る T1j2Sw・
 * パフォーマンス SrmVs・プロフィール JUTGz・設定 CuHXG）の文に寄せた固定データ。
 * 返事の形は本物（apps/worker の restaurant-google）と同じく `data` で包まない。
 */
const GOOGLE_STORE = { id: 'store-sby', name: '然 渋谷店', lineAccountId: 'visual-qa-account' }
const GOOGLE_CONNECTION = {
  status: 'connected', googleAccountEmail: 'nen.shibuya@gmail.com', locationName: 'locations/nen-shibuya', locationTitle: '然 渋谷店',
  locationMapsUrl: 'https://maps.google.com/?cid=nen-shibuya', connectedAt: '2026-09-12T10:20:00+09:00', disconnectedAt: null,
  lastSyncedAt: '2026-10-02T08:00:00+09:00', lastSyncError: null, averageRating: 4.2, totalReviewCount: 24,
}
const googleReview = (id, name, rating, comment, at, replyStatus, extra = {}) => ({
  id, reviewName: `accounts/1/locations/1/reviews/${id}`, reviewerDisplayName: name, starRating: rating, comment,
  createTime: at, updateTime: null, needsAttention: rating <= 2, replyStatus, replyDraft: null, replyDraftAiGenerated: false,
  replyDraftGeneratedAt: null, replyComment: null, replyUpdateTime: null, firstSeenAt: at, updatedAt: at, ...extra,
})
const GOOGLE_REVIEWS = [
  googleReview('rv-1', '佐藤 S.', 5, '鹿肉のローストが本当においしかったです。また来ます。', '2026-09-30T21:40:00+09:00', 'unreplied'),
  googleReview('rv-2', 'Kenji', 2, '予約していたのに20分待ちました。料理はよかったです。', '2026-09-30T20:12:00+09:00', 'unreplied', {
    replyDraft: 'Kenji 様、ご来店ありがとうございました。お待たせしてしまい申し訳ございません。ご予約の時間にご案内できるよう、席の準備を見直しました。またのお越しをお待ちしております。',
  }),
  googleReview('rv-3', 'Yuki T.', 4, '個室が落ち着けて、記念日に使えました。', '2026-09-29T22:05:00+09:00', 'draft', { replyDraft: 'Yuki T. 様、記念日にお選びいただきありがとうございました。', replyDraftAiGenerated: true }),
  googleReview('rv-4', 'M. Tanaka', 5, 'コースの説明が丁寧でした。', '2026-09-28T19:30:00+09:00', 'published', { replyComment: 'ありがとうございます。またお待ちしております。', replyUpdateTime: '2026-09-29T10:00:00+09:00' }),
  googleReview('rv-5', 'あや', 3, '少し量が少なめに感じました。', '2026-09-27T13:10:00+09:00', 'pending_confirm', { replyDraft: 'ご意見ありがとうございます。量の見直しを検討いたします。' }),
]
const GOOGLE_CONNECTION_DATA = {
  success: true, store: GOOGLE_STORE, connection: GOOGLE_CONNECTION, candidates: [],
  summary: { unrepliedCount: 2, draftCount: 1, attentionCount: 1, newCount: 0, storedCount: 24, postsAttentionCount: 0, syncStale: false },
  writeEnabled: false, oauthConfigured: true, aiAvailable: true,
  permissions: { canManageConnection: true, canPublishReply: true },
}
const googlePost = (id, kind, summary, title, publishedAt, status) => ({
  id, kind, origin: 'admin', summary, title, schedule: null, cta: null, offer: null, media: [], publishMode: 'now', status,
  googleState: status === 'published' ? 'LIVE' : null, searchUrl: null, staffName: '中川 由美', error: null,
  createdAt: publishedAt, sentAt: publishedAt, publishedAt, updatedAt: publishedAt,
})
const GOOGLE_POSTS = [
  googlePost('gp-1', 'offer', '秋の鹿肉コース、10/31 まで乾杯ドリンク1杯サービス', '秋の鹿肉コース、10/31 まで乾杯ドリンク1杯サービス', '2026-10-01T11:00:00+09:00', 'published'),
  googlePost('gp-2', 'event', '10/12（月）ジビエの夕べ（予約制・12名）', '10/12（月）ジビエの夕べ（予約制・12名）', '2026-09-28T18:00:00+09:00', 'published'),
  { ...googlePost('gp-3', 'standard', 'ランチの営業時間が 11:30〜14:00 になりました', null, '2026-09-20T09:00:00+09:00', 'published'), googleState: 'EXPIRED' },
]
const GOOGLE_POST_LIST = {
  success: true, posts: GOOGLE_POSTS, page: 1, perPage: 20, total: GOOGLE_POSTS.length,
  counts: { all: 3, draft: 0, published: 3, attention: 0, scheduled: 0 }, writeEnabled: false, permissions: { canPublish: true },
}
const GOOGLE_PERFORMANCE = {
  success: true, days: 28, range: { startDate: '2026-09-05', endDate: '2026-10-02' }, previousRange: { startDate: '2026-08-08', endDate: '2026-09-04' },
  totals: { impressions: 1820, directionRequests: 214, callClicks: 38, websiteClicks: 156 },
  previousTotals: { impressions: 1625, directionRequests: 204, callClicks: 39, websiteClicks: 143 },
  daily: Array.from({ length: 28 }, (_, i) => ({ date: `2026-${i < 26 ? '09' : '10'}-${String(i < 26 ? 5 + i : i - 25).padStart(2, '0')}`, impressions: 50 + ((i * 17) % 30) })),
  food: { menuClicks: 310, bookings: 42, foodOrders: null }, lastMetricsSyncedAt: '2026-10-02T04:00:00+09:00',
}
const GOOGLE_WEEKLY = Object.fromEntries(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].map((d) => [d, d === 'TUESDAY' ? [] : [{ open: '17:00', close: '23:00' }]]))
const GOOGLE_PROFILE = {
  success: true, store: GOOGLE_STORE,
  profile: {
    name: 'locations/nen-shibuya', title: '然 渋谷店', address: { postalCode: null, administrativeArea: '東京都', locality: '渋谷区', addressLines: ['神南1-2-3'] },
    phone: '03-****-5678', websiteUri: 'https://nen-shop.jp', description: '信州のジビエを炭火で。', openStatus: 'OPEN',
    regularHours: GOOGLE_WEEKLY, specialHours: [], mapsUri: 'https://maps.google.com/?cid=nen-shibuya',
  },
  today: { date: '2026-10-02', weekday: 'FRIDAY', holidayName: null, periods: [{ open: '17:00', close: '23:00' }], closed: false, special: false },
  holidays: [{ date: '2026-10-12', name: 'スポーツの日', weekday: 'MONDAY', special: null }],
  timeZone: 'Asia/Tokyo', closed: false, photoCount: 12,
  googleUpdates: { fields: [{ mask: 'phoneNumbers', label: '電話番号' }], updated: { phone: '03-****-9999' } },
  fetchedAt: '2026-10-02T08:00:00+09:00', stale: false, refreshError: null, pendingChangeCount: 0, writeEnabled: false, aiAvailable: true,
  permissions: { canManageConnection: true, canPublishReply: true, canSendChange: true },
}
/*
 * 板 Y8SjT2（予約枠・在庫）の1日：17:00〜20:00 の7枠・総数26席（稼働8卓）。
 * 埋まっている卓と席数は予約台帳から出す形（occupiedTableIds・occupied_seats・freeSeats）。
 * 19:00 だけ配分を直してある（OTA 6・LINE 4・当日 4）。最後に保存したのは中川さん 14:02（競合 qf3ky の文言）。
 */
const RESTAURANT_INVENTORY_DAY = [
  [17, 0, ['tbl-8'], 8], [17, 30, ['tbl-8', 'tbl-3'], 12], [18, 0, ['tbl-8', 'tbl-3', 'tbl-4', 'tbl-6'], 17],
  [18, 30, ['tbl-8', 'tbl-1', 'tbl-3', 'tbl-4', 'tbl-6'], 19], [19, 0, ['tbl-8', 'tbl-1', 'tbl-2', 'tbl-3', 'tbl-4', 'tbl-6', 'tbl-7'], 22],
  [19, 30, ['tbl-8', 'tbl-3'], 12], [20, 0, ['tbl-8'], 8],
].map(([h, m, tables, seats]) => ({
  id: `inv-${h}${m}`, store_id: 'store-sby', starts_at: restaurantAt(h, m), slot_minutes: 30, total_capacity: 26,
  ota_capacity: h === 19 && m === 0 ? 6 : 8, line_capacity: h === 19 && m === 0 ? 4 : 6, walk_in_capacity: h === 19 && m === 0 ? 4 : 6,
  reserved_count: seats, occupied_seats: seats, occupiedTableIds: tables, freeSeats: 26 - seats,
  version: 3, updated_by: 'mem-2', updated_by_name: '中川 由美', updated_at: restaurantAt(14, 2),
}))
/* 開ける時間：月休み・火〜木 17:00〜22:00・金 〜23:00・土 昼夜・日 昼と 〜21:00（weekday は 0=日）。 */
const RESTAURANT_OPENING_HOURS = {
  storeId: 'store-sby', version: 4, updatedBy: 'mem-2', updatedAt: restaurantAt(14, 2),
  hours: [
    { weekday: 0, periods: [{ opensAt: '11:30', closesAt: '14:00' }, { opensAt: '17:00', closesAt: '21:00' }] },
    { weekday: 1, periods: [] },
    { weekday: 2, periods: [{ opensAt: '17:00', closesAt: '22:00' }] },
    { weekday: 3, periods: [{ opensAt: '17:00', closesAt: '22:00' }] },
    { weekday: 4, periods: [{ opensAt: '17:00', closesAt: '22:00' }] },
    { weekday: 5, periods: [{ opensAt: '17:00', closesAt: '23:00' }] },
    { weekday: 6, periods: [{ opensAt: '11:30', closesAt: '14:00' }, { opensAt: '17:00', closesAt: '23:00' }] },
  ],
}
/* 板 hQQlt（予約経路の連携）：媒体ごとの受け取り。サーバ（/api/restaurant-test/channels）と同じ形。 */
const RESTAURANT_CHANNELS = [
  { id: 'media-hp', code: 'hotpepper', name: 'Hot Pepper グルメ', todayCount: 9, lastReceivedAt: restaurantAt(18, 42), unreadableCount: 0, receiveMethod: 'email_forward', status: 'receiving', daysWithoutReceipt: 0 },
  { id: 'media-tb', code: 'tabelog', name: '食べログ', todayCount: 6, lastReceivedAt: restaurantAt(18, 20), unreadableCount: 1, receiveMethod: 'email_forward', status: 'receiving', daysWithoutReceipt: 0 },
  { id: 'media-gn', code: 'gurunavi', name: 'ぐるなび', todayCount: 3, lastReceivedAt: restaurantAt(16, 5), unreadableCount: 0, receiveMethod: 'email_forward', status: 'receiving', daysWithoutReceipt: 0 },
  { id: 'media-rt', code: 'retty', name: 'Retty', todayCount: 0, lastReceivedAt: restaurantAt(12, 10, -7), unreadableCount: 0, receiveMethod: 'email_forward', status: 'not_receiving', daysWithoutReceipt: 7 },
  { id: 'restaurant_board', code: 'restaurant_board', name: 'レストランボード', todayCount: 5, lastReceivedAt: restaurantAt(18, 51), unreadableCount: 0, receiveMethod: 'direct', status: 'receiving', daysWithoutReceipt: 0 },
  { id: 'media-gg', code: 'google', name: 'Google で予約', todayCount: 0, lastReceivedAt: null, unreadableCount: 0, receiveMethod: 'email_forward', status: 'preparing', daysWithoutReceipt: null },
  { id: 'media-ik', code: 'ikyu', name: '一休.com レストラン', todayCount: 0, lastReceivedAt: null, unreadableCount: 0, receiveMethod: 'email_forward', status: 'preparing', daysWithoutReceipt: null },
  { id: 'manual', code: 'manual', name: '電話・LINE・店頭', todayCount: 4, lastReceivedAt: restaurantAt(17, 30), unreadableCount: 0, receiveMethod: 'manual', status: 'receiving', daysWithoutReceipt: 0 },
]
const RESTAURANT_INBOUND_EMAILS = [
  { id: 'mail-1', storeId: 'store-sby', receivedAt: restaurantAt(18, 20), status: 'quarantined', reason: '人数の欄が読めませんでした', mediaCode: 'tabelog', mediaName: '食べログ' },
]
const RESTAURANT_INTAKE_ADDRESSES = [
  { id: 'ia-1', storeId: 'store-sby', localPart: 'r-sby01', address: 'r-sby01@intake.example.jp', status: 'active', createdAt: restaurantAt(9, 0, -30), revokedAt: null },
]

/**
 * パスごとの形。ここに無いものは `EMPTY_PAGE` になる。
 *
 * 画面が増えて足りなくなったら、ここに1行足す。**推測で埋めない。**
 * 実際に落ちた画面のコンソールを見て、必要な形だけを足す。
 */
/** 分析の指標1つ。`state` と `reason` を持つのが契約。 */
const METRIC = (value, state = 'available', reason = null) => ({ value, state, reason })

/*
  分析の後半3画面。空の器だけでは、行列・時系列ファネル・保存履歴を
  設計画像と比較できない。固定時刻と架空の集計結果だけを返し、保存や
  再集計そのものは行わない。
*/
/* クロス分析の結果（絵 u5CuB8：タグ（会員の段階）× 流入経路の4×4）。 */
const ANALYTICS_CROSS_RESULT = {
  lineAccountId: 'visual-qa-account',
  timeZone: 'Asia/Tokyo',
  rowValues: [
    { key: 'regular', label: '定期便' },
    { key: 'first', label: '初回購入' },
    { key: 'repeat', label: 'リピーター' },
    { key: 'dormant', label: '休眠' },
  ],
  columnValues: [
    { key: 'instagram', label: 'Instagram' },
    { key: 'google-ads', label: 'Google広告' },
    { key: 'store-qr', label: '店頭QR' },
    { key: 'referral', label: '紹介' },
  ],
  cells: [
    ['regular', '定期便', 'instagram', 'Instagram', 86, 83],
    ['regular', '定期便', 'google-ads', 'Google広告', 41, 38],
    ['regular', '定期便', 'store-qr', '店頭QR', 52, 49],
    ['regular', '定期便', 'referral', '紹介', 18, 15],
    ['first', '初回購入', 'instagram', 'Instagram', 64, 61],
    ['first', '初回購入', 'google-ads', 'Google広告', 38, 35],
    ['first', '初回購入', 'store-qr', '店頭QR', 47, 44],
    ['first', '初回購入', 'referral', '紹介', 9, 6],
    ['repeat', 'リピーター', 'instagram', 'Instagram', 42, 39],
    ['repeat', 'リピーター', 'google-ads', 'Google広告', 22, 19],
    ['repeat', 'リピーター', 'store-qr', '店頭QR', 61, 58],
    ['repeat', 'リピーター', 'referral', '紹介', 14, 11],
    ['dormant', '休眠', 'instagram', 'Instagram', 12, 9],
    ['dormant', '休眠', 'google-ads', 'Google広告', 6, 3],
    ['dormant', '休眠', 'store-qr', '店頭QR', 0, 0],
    ['dormant', '休眠', 'referral', '紹介', 0, 0],
  ].map(([rowKey, rowLabel, columnKey, columnLabel, value, previousValue]) => ({
    rowKey, rowLabel, columnKey, columnLabel, value, uniqueFriends: value,
    totalRatio: value / 512, previousValue, difference: value - previousValue,
  })),
  totalValue: 512,
  totalFriends: 553,
  previousTotalValue: 470,
  periodFrom: '2026-06-06T00:00:00.000Z',
  periodTo: '2026-09-03T00:00:00.000Z',
  previousPeriodFrom: '2026-03-08T00:00:00.000Z',
  previousPeriodTo: '2026-06-05T23:59:59.999Z',
  dataCutoffAt: '2026-09-03T02:40:00.000Z',
  state: 'available',
  stateReason: null,
}

const ANALYTICS_FUNNEL_RUN = {
  runId: 'visual-funnel-run-1',
  funnelId: 'visual-funnel-1',
  versionId: 'visual-funnel-version-1',
  versionNumber: 3,
  lineAccountId: 'visual-qa-account',
  cohortFrom: '2026-06-06T00:00:00.000Z',
  cohortTo: '2026-09-03T00:00:00.000Z',
  timeZone: 'Asia/Tokyo',
  dataCutoffAt: '2026-09-03T02:40:00.000Z',
  state: 'available',
  stateReason: null,
  // 比較する条件は流入経路（Instagram・店頭QR）の2群。
  groups: [{
    key: 'instagram', label: 'Instagram', entrants: 1284, completed: 23,
    steps: [
      { stepOrder: 1, label: '友だち追加', reached: 1284, conversionFromPrevious: null, droppedAfter: 644, inProgressAfter: 0, averageSecondsFromPrevious: null, medianSecondsFromPrevious: null },
      { stepOrder: 2, label: 'リンクを踏んだ', reached: 640, conversionFromPrevious: 0.498, droppedAfter: 428, inProgressAfter: 0, averageSecondsFromPrevious: 172800, medianSecondsFromPrevious: 144000 },
      { stepOrder: 3, label: 'フォームに答えた', reached: 212, conversionFromPrevious: 0.331, droppedAfter: 151, inProgressAfter: 0, averageSecondsFromPrevious: 259200, medianSecondsFromPrevious: 216000 },
      { stepOrder: 4, label: '予約が確定した', reached: 61, conversionFromPrevious: 0.288, droppedAfter: 38, inProgressAfter: 0, averageSecondsFromPrevious: 345600, medianSecondsFromPrevious: 288000 },
      { stepOrder: 5, label: '購入が確定した', reached: 23, conversionFromPrevious: 0.377, droppedAfter: 0, inProgressAfter: 0, averageSecondsFromPrevious: 432000, medianSecondsFromPrevious: 360000 },
    ],
  }, {
    key: 'store-qr', label: '店頭QR', entrants: 300, completed: 66,
    steps: [
      { stepOrder: 1, label: '友だち追加', reached: 300, conversionFromPrevious: null, droppedAfter: 120, inProgressAfter: 0, averageSecondsFromPrevious: null, medianSecondsFromPrevious: null },
      { stepOrder: 2, label: 'リンクを踏んだ', reached: 180, conversionFromPrevious: 0.6, droppedAfter: 80, inProgressAfter: 0, averageSecondsFromPrevious: 172800, medianSecondsFromPrevious: 144000 },
      { stepOrder: 3, label: 'フォームに答えた', reached: 100, conversionFromPrevious: 0.556, droppedAfter: 20, inProgressAfter: 0, averageSecondsFromPrevious: 259200, medianSecondsFromPrevious: 216000 },
      { stepOrder: 4, label: '予約が確定した', reached: 80, conversionFromPrevious: 0.8, droppedAfter: 14, inProgressAfter: 0, averageSecondsFromPrevious: 345600, medianSecondsFromPrevious: 288000 },
      { stepOrder: 5, label: '購入が確定した', reached: 66, conversionFromPrevious: 0.825, droppedAfter: 0, inProgressAfter: 0, averageSecondsFromPrevious: 432000, medianSecondsFromPrevious: 360000 },
    ],
  }],
}

/* 保存した分析（絵 bglah の3件）。3件目は定義を変えたあとまだ集計していない（更新後未集計）。 */
const ANALYTICS_SAVED = [
  ['saved-1', '定期便 × 流入経路', 'cross', '高田 誠', 8, '2026-09-30T10:12:00+09:00', 2, false],
  ['saved-2', '友だち追加から購入まで', 'funnel', '中川 由美', 4, '2026-09-28T18:40:00+09:00', 2, false],
  ['saved-3', 'タグ × 年代', 'cross', '高田 誠', 2, '2026-09-12T09:05:00+09:00', 3, true],
].map(([id, name, kind, createdByName, snapshotCount, updatedAt, version, stale], index) => ({
  id, name, kind, status: 'active', currentVersionNumber: version,
  createdBy: `visual-owner-${index + 1}`, createdByName,
  createdAt: '2026-06-01T09:00:00+09:00', updatedAt, snapshotCount,
  latestSnapshot: {
    id: `${id}-snapshot-latest`, state: 'available',
    periodFrom: '2026-09-01T00:00:00+09:00', periodTo: '2026-09-30T00:00:00+09:00',
    dataCutoffAt: '2026-09-30T21:00:00.000Z', createdAt: updatedAt,
    definitionStale: stale, sourceVersionNumber: stale ? version - 1 : version, sourceCurrentVersionNumber: version,
  },
}))

/*
 * 承認待ちは V8 の板（`nJlxX`・`OylSV`）の 5 件にそろえる。
 * 要確認の2件（3・5行目）は重複の疑いで札が出る。
 */
const PENDING_APPROVALS = [
  // 友だち, 紹介した人, 紹介人ID, アカウント, 案件, 成果地点, 成果額, 報酬, 成果日時, 要確認
  ['佐藤 美咲', '田中 明', 'af-1', '然 本店', '定期便の初回', '定期便が確定', 4980, 2000, '2026-09-30T14:12:00+09:00', false],
  ['鈴木 健', '合同会社ノース', 'af-2', '然 本店', '夏の紹介キャンペーン', '商品を買った', 12800, 1280, '2026-09-30T11:05:00+09:00', false],
  ['高橋 まい', '山口 商店', 'af-5', '然 渋谷店', '定期便の初回', '定期便が確定', 4980, 1000, '2026-09-29T18:40:00+09:00', true],
  ['伊藤 翔', '木村 亮', 'af-3', '然 本店', '定期便の初回', '定期便が確定', 4980, 1500, '2026-09-29T10:21:00+09:00', false],
  ['渡辺 ゆか', '田中 明', 'af-1', '然 本店', '夏の紹介キャンペーン', '商品を買った', 6400, 2000, '2026-09-28T20:02:00+09:00', true],
].map(([friendName, affiliateName, affiliateId, lineAccountName, offerName, conversionPointName, value, rewardAmount, createdAt, duplicateFlag], index) => ({
  eventId: `cv-p-${index + 1}`,
  createdAt,
  friendId: `friend-${index + 1}`,
  friendName,
  affiliateId,
  affiliateName,
  lineAccountName,
  offerId: 'ao-2',
  offerName,
  offerRewardMiles: 0,
  conversionPointName,
  value,
  rewardAmount,
  approvalStatus: 'pending',
  duplicateFlag,
}))

/* 今月認めた数は V8 の板（`OylSV`・`Eo56k`）の 33 件。報酬の合計 ¥70,400・注文の合計 ¥1,046,000。
 * アフィリエイターごとの件数は 田中 12・ノース 9・山口 7・中村 3・木村 2（多い順がレポートの並び）。
 * 起きた日は今月（10月）で持つ。今月より前だと帯の数に入らない。 */
const APPROVED_PLAN = [
  // 紹介人ID, 案件ID, 案件名, 件数, 1件の報酬（最後の件だけ別の額）, 最後の件の報酬, 1件の注文額, 最後の件の注文額
  ['af-1', 'ao-1', '定期便の初回', 12, 2000, 4500, 34000, 38000],
  ['af-2', 'ao-2', '夏の紹介キャンペーン', 9, 3400, 4200, 35000, 34000],
  ['af-5', 'ao-1', '定期便の初回', 7, 1000, 1000, 36000, 40000],
  ['af-4', 'ao-3', '資料請求', 3, 0, 0, 0, 0],
  ['af-3', 'ao-1', '定期便の初回', 2, 1500, 1500, 32000, 32000],
]
const APPROVED_APPROVALS = APPROVED_PLAN.flatMap(([affiliateId, offerId, offerName, count, reward, lastReward, value, lastValue]) =>
  Array.from({ length: count }, (_, i) => {
    /* 田中は最後の2件を 4,500（10×2,000＋2×4,500＝29,000）。ほかは最後の1件だけ別の額。 */
    const special = affiliateId === 'af-1' ? i >= count - 2 : i === count - 1
    return { affiliateId, offerId, offerName, rewardAmount: special ? lastReward : reward, value: i === count - 1 ? lastValue : value }
  }))
  .map((row, index) => ({
    eventId: `cv-a-${index + 1}`,
    createdAt: `2026-10-0${(index % 4) + 1}T10:00:00+09:00`,
    friendId: `approved-friend-${index + 1}`,
    friendName: `承認済みの友だち ${index + 1}`,
    affiliateId: row.affiliateId,
    affiliateName: AFFILIATES.find((a) => a.id === row.affiliateId)?.name ?? null,
    lineAccountName: '然 本店',
    offerId: row.offerId,
    offerName: row.offerName,
    offerRewardMiles: 0,
    conversionPointName: row.offerName,
    value: row.value,
    rewardAmount: row.rewardAmount,
    approvalStatus: 'approved',
    duplicateFlag: false,
  }))

/* 今月認めなかった数は V8 の板（`OylSV`）の 2 件にそろえる。 */
const REJECTED_APPROVALS = [
  ['テスト注文 花子', '田中 明', 'af-1', '2026-10-02T11:00:00+09:00'],
  ['テスト注文 太郎', '合同会社ノース', 'af-2', '2026-10-01T15:00:00+09:00'],
].map(([friendName, affiliateName, affiliateId, createdAt], index) => ({
  eventId: `cv-r-${index + 1}`,
  createdAt,
  friendId: `rejected-friend-${index + 1}`,
  friendName,
  affiliateId,
  affiliateName,
  lineAccountName: '然 本店',
  offerId: 'ao-2',
  offerName: '定期便の初回',
  offerRewardMiles: 0,
  conversionPointName: '定期便が確定',
  value: 4980,
  rewardAmount: 0,
  approvalStatus: 'rejected',
  duplicateFlag: false,
}))

const CONVERSION_APPROVALS = [...PENDING_APPROVALS, ...APPROVED_APPROVALS, ...REJECTED_APPROVALS]

const SHAPES = {
  '/api/public/brand': { name: '株式会社 然', iconUrl: null },
  /*
    マイルの履歴。**既定の器（`{items,total,page,limit}`）では形が違う。**

    契約は `MileageAdminHistory = { items, pagination: { total, limit, offset } }`。
    口が無いと既定の器が返り、`pagination` が無いので
    `mileage-history-tab.tsx` の `result?.pagination.total` が投げ、
    **機能17の4枚が「画面を表示できませんでした」で1枚も撮れない。**
    （`?.` が `result` にしか掛かっていないのは実装側の弱さでもある。台帳に別途書いた）
  */
  /*
    行動スコア。契約は `ActionScoreOverview = { summary, items, pagination }`。
    口が無いと既定の器が返り、`action-score-tab.tsx:124` の
    `overview?.pagination.total` が投げて `z3PB2` が撮れない。
  */
  /*
    成果承認。**契約は配列**（`ConversionApprovalItem[]`）。
    `api.ts` 側のURLがテンプレート文字列（`?${qs}` を後ろに足す形）なので
    `readArrayGetPaths()` が拾えず、既定の器 `{items,total,page,limit}` が返っていた。
    そのため `tabs.tsx` の `items.map` が投げ、**`n5VVTb` が撮れなかった。**
    行が無いと「表に無い種別が内部の記号のまま出ていないか」も見られないので、
    承認待ち・承認済み・重複ありの3行を置く。
  */
  '/api/conversions/approvals': CONVERSION_APPROVALS,
  /* 支払いの集計。V8 の板（aINnz）の「認めてから 3日保留」。 */
  '/api/affiliate-payments': [
    { affiliateId: 'af-1', affiliateName: '田中 明', code: 'tanaka-a', holdDays: 3, payoutCycle: '毎月末', approvedConversions: 14, approvedReward: 30000, heldConversions: 0, heldReward: 0, holdStatusUnknown: 0, unsettledConversions: 14, unsettledReward: 28000, settledConversions: 0, settledReward: 0 },
    { affiliateId: 'af-2', affiliateName: '合同会社ノース', code: 'north', holdDays: 3, payoutCycle: '月末締め翌月末払い', approvedConversions: 9, approvedReward: 31400, heldConversions: 0, heldReward: 0, holdStatusUnknown: 0, unsettledConversions: 9, unsettledReward: 31400, settledConversions: 0, settledReward: 0 },
    { affiliateId: 'af-3', affiliateName: '木村 亮', code: 'kimura', holdDays: 3, payoutCycle: '月末締め翌月末払い', approvedConversions: 2, approvedReward: 3000, heldConversions: 0, heldReward: 0, holdStatusUnknown: 0, unsettledConversions: 2, unsettledReward: 3000, settledConversions: 0, settledReward: 0 },
    { affiliateId: 'af-4', affiliateName: '中村 彩', code: 'nakamura', holdDays: null, payoutCycle: null, approvedConversions: 5, approvedReward: 0, heldConversions: 0, heldReward: 0, holdStatusUnknown: 0, unsettledConversions: 0, unsettledReward: 0, settledConversions: 0, settledReward: 0 },
    { affiliateId: 'af-5', affiliateName: '山口 商店', code: 'yamaguchi', holdDays: 3, payoutCycle: '四半期', approvedConversions: 8, approvedReward: 8000, heldConversions: 0, heldReward: 0, holdStatusUnknown: 0, unsettledConversions: 8, unsettledReward: 8000, settledConversions: 0, settledReward: 0 },
  ],

  '/api/action-scores/rules': ACTION_SCORE_RULES,
  '/api/action-scores/friends': {
    summary: {
      /* 帯ごとの人数は V8 行動スコア `IRPw8` の数の帯（312・540・432）。表に出す5人は見本の先頭だけ。 */
      scoredFriends: 1284, high: 312, normal: 540, low: 432, decreased30d: 0,
      /* `packages/db` の `DEFAULT_BANDS` と同じ 30 / 70。40 は根拠が無く、
         決めごとの画面と一覧で同じ人が別の帯に入って見えていた。 */
      highMin: 70, normalMin: 30,
    },
    items: [
      { friendId: 'friend-1', displayName: 'さかもとまさと', currentScore: 82, band: 'high', change30d: 4, lastReason: '配信URLクリック → 夏のご案内', lastChangedAt: '2026-08-24T20:53:00+09:00' },
      { friendId: 'friend-2', displayName: 'Kyohei Yamamoto', currentScore: 55, band: 'normal', change30d: 0, lastReason: '回答フォーム回答 → 食生活アンケート', lastChangedAt: '2026-08-19T09:12:00+09:00' },
      { friendId: 'friend-3', displayName: '菅野 亮', currentScore: 31, band: 'normal', change30d: -6, lastReason: 'ブロック', lastChangedAt: '2026-08-13T20:52:00+09:00' },
      { friendId: 'friend-4', displayName: '前田 さくら', currentScore: 47, band: 'normal', change30d: 3, lastReason: 'メッセージ返信 → 配送日のご相談', lastChangedAt: '2026-08-12T18:15:00+09:00' },
      { friendId: 'friend-5', displayName: '大西 健一', currentScore: 22, band: 'low', change30d: 0, lastReason: '30日間反応なし', lastChangedAt: '2026-08-10T09:00:00+09:00' },
    ],
    pagination: { total: 5, limit: 20, offset: 0 },
  },
  /*
    分析・友だちの増減。**既定の器では `data.data` が無く、画面ごと落ちる**
    （`overview.metrics` で Cannot read properties of undefined）。
    そのため機能20の9枚が1枚も撮れなかった。

    契約は `AnalyticsEnvelope<{ state, stateReason, metrics, days, campaigns, … }>` で、
    各指標が自分の `state` と `reason` を持つ。ここでは**実測できた状態**（`available`）を返す。
    集計待ち（`pending` で `value` に 0 が入る）ときに `—` へ落ちることは
    `analytics-pending-value-contract.test.ts` が見張っている。
  */
  '/api/analytics/friends': {
    lineAccountId: 'visual-qa-account',
    timeZone: 'Asia/Tokyo',
    period: { from: '2026-09-01', to: '2026-09-30' },
    dataCutoffAt: '2026-09-30T00:00:00+09:00',
    data: {
      state: 'available',
      stateReason: null,
      metrics: {
        added: METRIC(58), removed: METRIC(11), net: METRIC(47),
        currentFriends: METRIC(1284), firstTime: METRIC(52), returning: METRIC(6),
      },
      days: [
      { date: '2026-09-01', added: 3, removed: 0, net: 3 },
      { date: '2026-09-02', added: 1, removed: 1, net: 0 },
      { date: '2026-09-03', added: 0, removed: 0, net: 0 },
      { date: '2026-09-04', added: 2, removed: 0, net: 2 },
      { date: '2026-09-05', added: 5, removed: 1, net: 4 },
      { date: '2026-09-06', added: 4, removed: 0, net: 4 },
      { date: '2026-09-07', added: 0, removed: 0, net: 0 },
      { date: '2026-09-08', added: 1, removed: 0, net: 1 },
      { date: '2026-09-09', added: 2, removed: 1, net: 1 },
      { date: '2026-09-10', added: 0, removed: 0, net: 0 },
      { date: '2026-09-11', added: 6, removed: 2, net: 4 },
      { date: '2026-09-12', added: 3, removed: 0, net: 3 },
      { date: '2026-09-13', added: 1, removed: 0, net: 1 },
      { date: '2026-09-14', added: 0, removed: 1, net: -1 },
      { date: '2026-09-15', added: 2, removed: 0, net: 2 },
      { date: '2026-09-16', added: 4, removed: 1, net: 3 },
      { date: '2026-09-17', added: 0, removed: 0, net: 0 },
      { date: '2026-09-18', added: 1, removed: 0, net: 1 },
      { date: '2026-09-19', added: 3, removed: 1, net: 2 },
      { date: '2026-09-20', added: 2, removed: 0, net: 2 },
      { date: '2026-09-21', added: 0, removed: 0, net: 0 },
      { date: '2026-09-22', added: 5, removed: 1, net: 4 },
      { date: '2026-09-23', added: 1, removed: 0, net: 1 },
      { date: '2026-09-24', added: 0, removed: 0, net: 0 },
      { date: '2026-09-25', added: 2, removed: 0, net: 2 },
      { date: '2026-09-26', added: 3, removed: 1, net: 2 },
      { date: '2026-09-27', added: 1, removed: 0, net: 1 },
      { date: '2026-09-28', added: 0, removed: 0, net: 0 },
      { date: '2026-09-29', added: 4, removed: 1, net: 3 },
      { date: '2026-09-30', added: 2, removed: 0, net: 2 },
      ],
      campaigns: [
        { id: 'bc-1', name: '秋の新商品のお知らせ', kind: 'broadcast', occurredAt: '2026-09-21T10:00:00+09:00', date: '2026-09-21' },
        { id: 'sc-1', name: '新しいシナリオ 9/15', kind: 'scenario', occurredAt: '2026-09-15T18:30:00+09:00', date: '2026-09-15' },
      ],
      historyAvailableFrom: '2026-09-01',
    },
  },
  /* 分析・配信の反応。`AnalyticsReactionsOverview`。絵（yvOtn）の5配信・時間帯。 */
  '/api/analytics/reactions': {
    lineAccountId: 'visual-qa-account', timeZone: 'Asia/Tokyo',
    period: { from: '2026-09-02', to: '2026-10-01' }, dataCutoffAt: '2026-10-01T06:00:00+09:00',
    data: {
      metrics: {
        sent: METRIC(3986), delivered: METRIC(3912), opened: METRIC(2070),
        lineClicked: METRIC(305), trackedClicks: METRIC(305),
        unavailableCampaigns: METRIC(1),
      },
      campaigns: [
        {
          id: 'bc-1', name: '秋の新商品のご案内', kind: 'broadcast', sentAt: '2026-09-30T19:00:00+09:00',
          targetPeople: METRIC(1284), delivered: METRIC(1262), sentMessages: METRIC(null, 'unavailable', '一斉配信は送信通数を数えません'), opened: METRIC(702),
          lineClicked: METRIC(118), outcomes: METRIC(9), fetchedAt: '2026-10-01T06:00:00+09:00',
        },
        {
          id: 'bc-2', name: '定期便 10%オフ', kind: 'broadcast', sentAt: '2026-09-24T12:00:00+09:00',
          targetPeople: METRIC(1280), delivered: METRIC(1251), sentMessages: METRIC(null, 'unavailable', '一斉配信は送信通数を数えません'), opened: METRIC(655),
          lineClicked: METRIC(96), outcomes: METRIC(6), fetchedAt: '2026-10-01T06:00:00+09:00',
        },
        {
          id: 'sc-1', name: '初回購入のお礼 3通目', kind: 'scenario', sentAt: '2026-09-02T09:00:00+09:00',
          targetPeople: METRIC(612), delivered: METRIC(null, 'unavailable', 'シナリオは届いた人数を取得できません'), sentMessages: METRIC(598), opened: METRIC(412),
          lineClicked: METRIC(61), outcomes: METRIC(4), fetchedAt: '2026-10-01T06:00:00+09:00',
        },
        {
          id: 'sc-2', name: '誕生日クーポン', kind: 'scenario', sentAt: '2026-09-02T09:00:00+09:00',
          targetPeople: METRIC(14), delivered: METRIC(null, 'unavailable', 'シナリオは届いた人数を取得できません'), sentMessages: METRIC(14), opened: METRIC(null, 'insufficient', '20人未満のため取得できません'),
          lineClicked: METRIC(null, 'insufficient', '20人未満のため取得できません'), outcomes: METRIC(null, 'insufficient', '20人未満のため取得できません'), fetchedAt: '2026-10-01T06:00:00+09:00',
        },
        {
          id: 'bc-3', name: 'お盆休みのお知らせ', kind: 'broadcast', sentAt: '2026-09-10T10:00:00+09:00',
          targetPeople: METRIC(796), delivered: METRIC(787), sentMessages: METRIC(null, 'unavailable', '一斉配信は送信通数を数えません'), opened: METRIC(301),
          lineClicked: METRIC(30), outcomes: METRIC(0), fetchedAt: '2026-10-01T06:00:00+09:00',
        },
      ],
      campaignsTruncation: { limit: 50, broadcast: false, scenario: false },
      trackedClickHours: [{ hour: 0, clicks: 2 }, { hour: 1, clicks: 2 }, { hour: 2, clicks: 2 }, { hour: 3, clicks: 2 }, { hour: 4, clicks: 2 }, { hour: 5, clicks: 3 }, { hour: 6, clicks: 7 }, { hour: 7, clicks: 13 }, { hour: 8, clicks: 30 }, { hour: 9, clicks: 46 }, { hour: 10, clicks: 38 }, { hour: 11, clicks: 30 }, { hour: 12, clicks: 42 }, { hour: 13, clicks: 35 }, { hour: 14, clicks: 24 }, { hour: 15, clicks: 22 }, { hour: 16, clicks: 26 }, { hour: 17, clicks: 33 }, { hour: 18, clicks: 49 }, { hour: 19, clicks: 63 }, { hour: 20, clicks: 70 }, { hour: 21, clicks: 55 }, { hour: 22, clicks: 30 }, { hour: 23, clicks: 10 }],
      clickDefinition: 'クリック率は「そのURLを含む配信が届いた人数」に対する割合です。同じ人が複数回押しても、実人数は1として数えます。',
    },
  },
  /* 分析・経路と成果。`AnalyticsRoutesOverview`。 */
  '/api/analytics/routes': {
    lineAccountId: 'visual-qa-account', timeZone: 'Asia/Tokyo',
    period: { from: '2026-08-04', to: '2026-09-02' }, dataCutoffAt: '2026-09-02T00:00:00+09:00',
    data: {
      attributionModel: 'first_touch',
      attributionLabel: '最初に触れた経路',
      /* 経路と成果の絵（PFe9c）の6経路。友だちの増減（ws9wt）の右の列はこの上位5件。 */
      routes: [
        {
          id: 'rt-1', refCode: 'g-summer', name: 'Google広告 夏キャンペーン',
          clicks: METRIC(820), friendAdds: METRIC(42), currentFriends: METRIC(40), reactionPeople: METRIC(25),
          conversions: { approved: METRIC(9), pending: METRIC(2), rejected: METRIC(1), revenue: METRIC(96300) },
          adCost: METRIC(52000), costPerFriend: METRIC(1238), costPerConversion: METRIC(5778), profitAfterAdCost: METRIC(44300),
        },
        {
          id: 'rt-2', refCode: 'ig-summer', name: '夏のInstagram投稿',
          clicks: METRIC(610), friendAdds: METRIC(31), currentFriends: METRIC(30), reactionPeople: METRIC(19),
          conversions: { approved: METRIC(6), pending: METRIC(1), rejected: METRIC(0), revenue: METRIC(58800) },
          adCost: METRIC(34000), costPerFriend: METRIC(1097), costPerConversion: METRIC(5667), profitAfterAdCost: METRIC(24800),
        },
        {
          id: 'rt-3', refCode: 'pop-qr', name: '店頭POPのQRコード',
          clicks: METRIC(380), friendAdds: METRIC(27), currentFriends: METRIC(27), reactionPeople: METRIC(18),
          conversions: { approved: METRIC(5), pending: METRIC(1), rejected: METRIC(0), revenue: METRIC(49500) },
          adCost: METRIC(null, 'unavailable', '広告費を受け取る口がありません'), costPerFriend: METRIC(null, 'unavailable', '広告費を受け取る口がありません'), costPerConversion: METRIC(null, 'unavailable', '広告費を受け取る口がありません'), profitAfterAdCost: METRIC(null, 'unavailable', '広告費を受け取る口がありません'),
        },
        {
          id: 'rt-4', refCode: 'ref-tanaka', name: '紹介リンク 田中 明',
          clicks: METRIC(200), friendAdds: METRIC(12), currentFriends: METRIC(12), reactionPeople: METRIC(8),
          conversions: { approved: METRIC(3), pending: METRIC(0), rejected: METRIC(0), revenue: METRIC(33800) },
          adCost: METRIC(null, 'unavailable', '広告費を受け取る口がありません'), costPerFriend: METRIC(null, 'unavailable', '広告費を受け取る口がありません'), costPerConversion: METRIC(null, 'unavailable', '広告費を受け取る口がありません'), profitAfterAdCost: METRIC(null, 'unavailable', '広告費を受け取る口がありません'),
        },
        {
          id: 'rt-5', refCode: 'flyer-2026', name: 'チラシ計測リンク（2026春）',
          clicks: METRIC(40), friendAdds: METRIC(0), currentFriends: METRIC(0), reactionPeople: METRIC(0),
          conversions: { approved: METRIC(0), pending: METRIC(0), rejected: METRIC(0), revenue: METRIC(0) },
          adCost: METRIC(null, 'unavailable', '広告費を受け取る口がありません'), costPerFriend: METRIC(null, 'unavailable', '広告費を受け取る口がありません'), costPerConversion: METRIC(null, 'unavailable', '広告費を受け取る口がありません'), profitAfterAdCost: METRIC(null, 'unavailable', '広告費を受け取る口がありません'),
        },
        {
          id: 'rt-6', refCode: null, name: '参照コードなし',
          clicks: METRIC(90), friendAdds: METRIC(16), currentFriends: METRIC(15), reactionPeople: METRIC(4),
          conversions: { approved: METRIC(0), pending: METRIC(0), rejected: METRIC(0), revenue: METRIC(null, 'unavailable', '売上は未取得') },
          adCost: METRIC(null, 'unavailable', '広告費を受け取る口がありません'), costPerFriend: METRIC(null, 'unavailable', '広告費を受け取る口がありません'), costPerConversion: METRIC(null, 'unavailable', '広告費を受け取る口がありません'), profitAfterAdCost: METRIC(null, 'unavailable', '広告費を受け取る口がありません'),
        },
      ],
      searchConsoleHref: 'https://search.google.com/search-console',
    },
  },
  /* 分析・使われ方。`AnalyticsUsageOverview`。 */
  '/api/analytics/usage': {
    lineAccountId: 'visual-qa-account', timeZone: 'Asia/Tokyo',
    period: { from: '2026-09-02', to: '2026-10-01' }, dataCutoffAt: '2026-10-01T06:00:00+09:00',
    data: {
      state: 'available', stateReason: null,
      checkedAt: '2026-10-01T06:00:00+09:00', automaticDeletion: false,
      // 絵（N8ZrUl）の6機能。一斉配信は利用中・未使用が未取得（「—」と理由）の形を残す。
      summary: {
        unusedItems: METRIC(7), brokenReferences: METRIC(1), automaticRuns: METRIC(4812), manualSends: METRIC(312), estimatedHoursSaved: METRIC(40),
      },
      categories: [
        { key: 'scenarios', label: 'シナリオ配信', href: '/scenarios', created: METRIC(8), inUse: METRIC(6), unused: METRIC(2), brokenReferences: METRIC(0), lastUsedAt: METRIC('2026-09-30T21:00:00Z') },
        { key: 'broadcasts', label: '一斉配信', href: '/broadcasts', created: METRIC(24), inUse: METRIC(null, 'unavailable', '一斉配信は送ったら終わりのため数えません'), unused: METRIC(null, 'unavailable', '一斉配信は送ったら終わりのため数えません'), brokenReferences: METRIC(0), lastUsedAt: METRIC('2026-09-30T10:00:00Z') },
        { key: 'auto_replies', label: '自動応答', href: '/auto-replies', created: METRIC(12), inUse: METRIC(10), unused: METRIC(2), brokenReferences: METRIC(0), lastUsedAt: METRIC('2026-09-30T20:41:00Z') },
        { key: 'templates', label: 'テンプレート', href: '/templates', created: METRIC(31), inUse: METRIC(28), unused: METRIC(3), brokenReferences: METRIC(1), lastUsedAt: METRIC('2026-09-30T09:52:00Z') },
        { key: 'forms', label: '回答フォーム', href: '/form-submissions', created: METRIC(4, 'partial', '回答実績から確認できるフォームのみです'), inUse: METRIC(4, 'partial', '回答実績から確認できるフォームのみです'), unused: METRIC(0, 'partial', '回答実績から確認できるフォームのみです'), brokenReferences: METRIC(null, 'partial', '利用関係台帳で追加します'), lastUsedAt: METRIC('2026-09-29T12:10:00Z', 'partial', '回答実績から確認できるフォームのみです') },
        { key: 'automations', label: 'オートメーション', href: '/automations', created: METRIC(6), inUse: METRIC(6), unused: METRIC(0), brokenReferences: METRIC(null, 'partial', '利用関係台帳で追加します'), lastUsedAt: METRIC('2026-09-30T20:58:00Z') },
      ],
    },
  },
  /*
    分析・定期レポート作成。予約が0件でも、選択肢は本物と同じ器で返す。
    これが無いと保存済み分析と受信者を選べず、設計 `URqOA` を撮れない。
  */
  '/api/analytics/report-schedules': {
    // 保存した分析（bglah）の定期レポート2件：動いている・止めている。
    items: [
      {
        id: 'report-weekly-friends', lineAccountId: 'visual-qa-account', name: '毎週の友だちの増減', sections: ['friends', 'reactions', 'routes'], savedAnalysisIds: ['saved-1'],
        cadence: 'weekly', weekday: 1, monthDay: null, sendTime: '9:00', timeZone: 'Asia/Tokyo', periodDays: 7,
        recipients: [{ kind: 'staff', staffId: 'staff-owner' }], channels: ['email'], alertRules: [],
        status: 'active', isOneTime: false, nextRunAt: '2026-10-06T09:00:00+09:00', createdBy: 'staff-owner', createdAt: '2026-09-01T09:00:00+09:00', updatedAt: '2026-09-01T09:00:00+09:00',
      },
      {
        id: 'report-monthly-outcomes', lineAccountId: 'visual-qa-account', name: '月末の成果まとめ', sections: ['routes'], savedAnalysisIds: [],
        cadence: 'monthly', weekday: null, monthDay: 1, sendTime: '9:00', timeZone: 'Asia/Tokyo', periodDays: 30,
        recipients: [{ kind: 'staff', staffId: 'staff-owner' }], channels: ['email', 'line'], alertRules: [],
        status: 'paused', isOneTime: false, nextRunAt: '2026-11-01T09:00:00+09:00', createdBy: 'staff-owner', createdAt: '2026-08-01T09:00:00+09:00', updatedAt: '2026-09-15T09:00:00+09:00',
      },
    ],
    recentOneTime: [],
    options: {
      timeZone: 'Asia/Tokyo',
      savedAnalyses: [
        { id: 'saved-1', name: '定期便 × 流入経路', kind: 'cross' },
        { id: 'saved-route', name: '経路別の成果', kind: 'cross' },
      ],
      recipients: [
        {
          id: 'staff-owner', name: '佐々木 亮太', role: 'admin',
          email: 'sasaki@example.com', lineLinked: true,
        },
        {
          id: 'staff-operator', name: '山本 京子', role: 'staff',
          email: 'yamamoto@example.com', lineLinked: true,
        },
      ],
    },
  },
  '/api/mileage/rewards': MILEAGE_REWARDS,
  '/api/mileage/history': MILEAGE_HISTORY,
  '/api/settings/features': {
    features: FEATURES,
    sidebarOrder: null,
    sidebarItemOrder: null,
    parentChildMode: false,
    specializedFeatureKeys: ['nen_campaigns', 'photo_review', 'ec_commerce', 'line_notifications'],
    // 本物は版を返す。無いと画面の expectedVersion 付き保存の欠落に気づけない。
    version: 1,
  },
  // 左メニューの出し分け。無いと汎用の空一覧が返り「機能設定を読み込めませんでした」になり、
  // メニューが基本の9項目だけになる（2026-09-24 の点検で発覚）。
  // 設定の画面（★V8 設定の中のメニュー・プール管理 u3iab3）は「プール管理」が見える統括で描かれている。
  // 機能設定の既定（multi_store_hierarchy は既定オフ）はそのまま、表示の出し分けだけオンで返す。
  '/api/settings/features/visibility': { features: { ...FEATURES, multi_store_hierarchy: true } },
  '/api/inbox/unanswered/count': { total: 0, byAccount: [], oldestWaitMinutes: null },
  // 設計 `vUXKb` の「写真審査 1件 確認待ち」。0で返すとカードが空のまま撮れる。
  '/api/nen-members/overview': { pets: 6, healthLogs: 12, activeCare: 2, pendingPhotos: 3, members: 6, consultations: 1 },
  /*
   * 一斉配信の帯（設計 `q76C35`）。**型どおりに返す。**
   * ここが無かったせいで、一覧の帯が「予約中 undefined」「失敗 undefined」
   * のまま撮れていた。返事が無いと別の形（items/total）へ落ちて、
   * 画面はそれを数として読もうとする。`BroadcastStats` と同じ形にする。
   */
  '/api/broadcasts/stats': {
    thisMonth: 12,
    scheduled: 4,
    delivered: 1842,
    failed: 0,
    openRate: 69.4,
  },
  '/api/broadcasts/notification-settings': BROADCAST_NOTIFICATION_SETTINGS,
  '/api/friends/stats': FRIEND_STATS,
  '/api/friends': { items: FRIENDS, total: 231, page: 1, limit: 20 },
  '/api/users-grouped': USERS_GROUPED,
  '/api/duplicates/stats': DUPLICATE_STATS,
  '/api/operators': OPERATORS,
  '/api/scenarios': FRIEND_SCENARIOS,
  '/api/media': { items: MEDIA_ITEMS, total: MEDIA_ITEMS.length, limit: 20, offset: 0 },
  '/api/media/quota': MEDIA_QUOTA,

  /* EC の出荷予定（`EcShipmentList`）。`soon`/`later` は配列で要る。 */
  '/api/ec-commerce/shipments': {
    today: FIXED_TO,
    tomorrow: '2026-01-14',
    soon: [],
    later: [],
    soonCount: 0,
    laterCount: 0,
    scanned: 0,
    scanLimit: 0,
  },

  /*
   * ダッシュボード（`DashboardOverview`）。**入れ子の数まで置く。**
   * `friends` や `inbox` を欠くと `undefined.toLocaleString()` で
   * 画面ごと落ちる。日付は固定（毎回同じ画像にするため）。
   */
  '/api/dashboard/overview': DASHBOARD_OVERVIEW,
  '/api/dashboard/organization-overview': DASHBOARD_OVERVIEW,

  /* リッチメニュー。LINE側にある実物の一覧と、押された回数。 */
  '/api/rich-menu-groups/external': RICH_MENU_EXTERNAL,
  '/api/rich-menu-groups/tap-stats': RICH_MENU_TAP_STATS,

}

/**
 * 画面確認だけで完結する、保存を伴わない固定の返事。
 * 本番データは変更せず、毎回同じ結果を返す。ほかの更新は従来どおり405。
 */
const VISUAL_QA_API_TOKENS = [
  { id: 'apitok-1', name: '予約システム連携', tokenPrefix: 'lh_live_3Fa9', scopes: ['tags:read', 'tags:write'], createdBy: 'visual-qa-owner', lastUsedAt: '2026-09-30T01:02:00.000Z', rotatedFromId: null, createdAt: '2026-06-02T00:00:00.000Z', revokedAt: null },
  { id: 'apitok-2', name: '売上の集計', tokenPrefix: 'lh_live_8Kd2', scopes: ['tags:read'], createdBy: 'visual-qa-owner', lastUsedAt: '2026-09-29T14:00:00.000Z', rotatedFromId: null, createdAt: '2026-04-18T00:00:00.000Z', revokedAt: null },
]

/* ★V8 L48eY：本移行と照合が終わった UID 移行の履歴。 */
const UID_MIGRATION_DONE = {
  id: 'visual-uid-run-done', fromAccountId: 'visual-qa-account-old', toAccountId: 'visual-qa-account',
  purpose: '友だち情報と配信停止の状態を新しいLINEアカウントへ引き継ぐ', sourceKind: 'csv',
  sourceFilename: 'uid-map-2026-10-01.csv', status: 'completed', dryRunRevision: 2,
  counts: { total: 1856, auto: 1820, review: 24, unmatched: 9, conflict: 2, applied: 1844, failed: 0 },
  createdBy: 'visual-qa-admin', approvedBy: 'visual-qa-owner', createdAt: '2026-10-01T01:20:00.000Z',
  reviewedAt: '2026-10-01T01:40:00.000Z', executedAt: '2026-10-01T02:00:00.000Z', completedAt: '2026-10-01T02:05:00.000Z',
  rolledBackAt: null, failureReason: null, rollbackable: true,
}

function visualQaWriteBody(method, pathname, query = new URLSearchParams()) {
  /* 自動応答のかんたんに作る（板 G4GejG）：作った下書き。重なりは ar-quick の口が返す。 */
  if (method === 'POST' && pathname === '/api/auto-replies/drafts') {
    return { autoReplyId: 'ar-quick', versionId: 'arv-quick', versionNumber: 1, status: 'draft', settings: null, lastTestStatus: null, lastTestedAt: null, publishedAt: null }
  }
  /* 外部連携の API 接続：発行した直後の窓（板 UkZLi）。平文の鍵は発行の返事にだけ1回乗る。 */
  if (method === 'POST' && pathname === '/api/webhooks/api-tokens') {
    return { id: 'apitok-new', name: '在庫システム', tokenPrefix: 'lh_live_7Kq2', scopes: ['tags:read', 'tags:write'], createdBy: 'visual-qa-owner', lastUsedAt: null, rotatedFromId: null, createdAt: '2026-10-05T01:00:00.000Z', revokedAt: null, token: 'lh_live_7Kq2mZ9xW4pR8vN3tY6bH1cJ5dF3f9a' }
  }
  if (method === 'POST' && (pathname === '/api/notifications/operator-rules/recipients-preview' || pathname === '/api/line-notifications/operator-rules/recipients-preview')) {
    /*
     * 本物は両方の名で同じ候補を返す（`notifications.ts`）。
     * `line-notifications` 側が無いと、つくる画面の「受け取る人」が
     * 「読み込めませんでした」になっていた。
     */
    return OPERATOR_NOTIFICATION_RECIPIENTS
  }
  if (method === 'POST' && /^\/api\/notifications\/operator-rules\/[^/]+\/(publish|test)$/.test(pathname)) {
    return { accepted: 2, excluded: 0, failed: 0, duplicate: 0 }
  }
  const scenarioSimulation = /^\/api\/scenarios\/([^/]+)\/simulate$/.exec(pathname)
  if (method === 'POST' && scenarioSimulation) {
    return { ...SCENARIO_SIMULATION, scenarioId: scenarioSimulation[1] }
  }
  if (method === 'PUT' && /^\/api\/scenarios\/[^/]+\/draft$/.test(pathname)) return SCENARIO_DRAFT
  /*
   * リマインダの公開フロー（下書き保存・検査・予定・試し送り・公開）。
   * 読みの `/draft` と `/runs` は従来のGET側にある。ここは書き込み側で、
   * 本番と同じ器（`{success:true,data}`）で固定の返事を返す。
   */
  /*
   * 対象者ステップはどのIDで開いても描けるように、要求のIDをそのまま返す。
   * 固定の `reminder-3` を返すと、別ID（例 `reminder-1`）では画面の
   * 照合（`draft.reminderId === reminderId`）に落ち、いつまでも
   * 「下書きを読み込んでいます」になる。F-1 の撮影は ID を変えて行う。
   */
  if (method === 'PUT' && /^\/api\/reminders\/[^/]+\/draft$/.test(pathname)) {
    const draftId = decodeURIComponent(pathname.split('/')[3] ?? '')
    if (draftId === 'reminder-new') return { ...REMINDER_NEW_DRAFT }
    return { ...REMINDER_DRAFT, reminderId: draftId || REMINDER_DRAFT.reminderId }
  }
  if (method === 'POST' && pathname === '/api/reminders/drafts') {
    return { reminderId: 'reminder-new', versionId: 'reminder-new-draft-v1', versionNumber: 1 }
  }
  if (method === 'POST' && /^\/api\/reminders\/[^/]+\/validate$/.test(pathname)) {
    if (decodeURIComponent(pathname.split('/')[3] ?? '') === 'reminder-new') {
      return {
        ...REMINDER_VALIDATE,
        checks: REMINDER_VALIDATE.checks.map((check) => (
          check.key === 'steps' ? { ...check, message: '2件の通知があります' } : check
        )),
        audience: { matched: 172, excluded: 14 },
      }
    }
    return REMINDER_VALIDATE
  }
  if (method === 'POST' && /^\/api\/reminders\/[^/]+\/audience$/.test(pathname)) {
    if (decodeURIComponent(pathname.split('/')[3] ?? '') === 'reminder-new') {
      return { ...REMINDER_AUDIENCE, matched: 172, excluded: 14 }
    }
    return REMINDER_AUDIENCE
  }
  if (method === 'POST' && /^\/api\/reminders\/[^/]+\/preview$/.test(pathname)) {
    if (decodeURIComponent(pathname.split('/')[3] ?? '') === 'reminder-new') return REMINDER_NEW_PREVIEW
    return REMINDER_PREVIEW
  }
  if (method === 'POST' && /^\/api\/reminders\/[^/]+\/test-send$/.test(pathname)) return REMINDER_TEST_SEND
  if (method === 'POST' && /^\/api\/reminders\/[^/]+\/publish$/.test(pathname)) return REMINDER_PUBLISH
  if (method === 'POST' && /^\/api\/scenarios\/[^/]+\/test-send$/.test(pathname)) return { sent: 1 }
  if (method === 'POST' && /^\/api\/scenarios\/[^/]+\/steps\/[^/]+\/test-send$/.test(pathname)) return { sent: 1 }
  if (method === 'POST' && pathname === '/api/ec-commerce/test-send') return { sent: 1 }
  if (method === 'PUT' && /^\/api\/manual-links\/[^/]+$/.test(pathname)) {
    const key = decodeURIComponent(pathname.split('/').pop() ?? '')
    return MANUAL_LINKS.items.find((item) => item.key === key) ?? null
  }
  if (method === 'POST' && /^\/api\/recipes\/[^/]+\/clone$/.test(pathname)) {
    return { runId: 'visual-recipe-clone-run', status: 'succeeded', createdCount: 16, items: [] }
  }
  if (method === 'POST' && pathname === '/api/manual-links/check') {
    return { checked: 265, ok: 263, broken: 2, unset: 1 }
  }
  if (method === 'POST' && pathname === '/api/line-accounts/verify-connection') {
    return LINE_ACCOUNT_VERIFY_CONNECTION
  }
  if (method === 'POST' && /^\/api\/friend-add-rules\/[^/]+\/validate$/.test(pathname)) {
    // 失敗系は visualState=error で切り替える。固定成功だけだと公開不可の
    // 状態を確かめられない (#501-軽)。器は本物の失敗応答と同じ形。
    if (query.get('visualState') === 'error') {
      return {
        success: false,
        data: {
          stateChanged: false, ruleId: FRIEND_ADD_RULE.id, matched: false,
          reasons: ['送るシナリオが見つかりません。'],
          scenarioId: FRIEND_ADD_RULE.definition.scenarioId,
          message: FRIEND_ADD_RULE.definition.messageText,
          actions: FRIEND_ADD_RULE.definition.actions,
        },
        error: 'テスト条件を確認してください',
      }
    }
    return FRIEND_ADD_RULE_VALIDATE
  }
  if (method === 'PATCH' && pathname === '/api/friend-add-rules/reorder') {
    // 本物は受け皿以外の全ID一致しか受け付けない (409 ORDER_CHANGED)。
    // 画面確認では固定で成功を返す。失敗系は visualState=error。
    if (query.get('visualState') === 'error') {
      return { success: false, code: 'ORDER_CHANGED', error: 'ほかの画面で並び順が変わりました。' }
    }
    return { success: true }
  }
  if (method === 'POST' && /^\/api\/friend-add-rules\/[^/]+\/publish$/.test(pathname)) {
    if (query.get('visualState') === 'error') {
      return { success: false, error: '公開前にテストを成功させてください' }
    }
    return FRIEND_ADD_RULE_PUBLISH
  }
  if (method === 'POST' && /^\/api\/friend-fields\/[^/]+\/migration-preview$/.test(pathname)) {
    return FRIEND_FIELD_MIGRATION_PREVIEW
  }
  if (method === 'POST' && pathname === '/api/inbox/saved-views') {
    return {
      id: 'inbox-view-preview',
      name: '未割り当て・期限超過',
      createdBy: 'Kenta',
      isShared: false,
      matchCount: 1,
    }
  }
  if (method === 'POST' && pathname === '/api/broadcasts/saved-views') {
    return BROADCAST_SAVED_VIEWS[0]
  }
  if (method === 'POST' && pathname === '/api/analytics/cross/query') {
    return { id: 'visual-cross-result-1', state: 'pending' }
  }
  /*
   * 本番の口は `{success,data}` で包む。包むのは外側（このファイルの返し口）なので、
   * ここは素の値を返す（ここでも包むと二重になり、作る⑤が落ちていた・2026-10-06）。
   */
  if (method === 'POST' && /^\/api\/auto-replies\/[^/]+\/test$/.test(pathname)) {
    return AUTO_REPLY_PUBLISH_TEST
  }
  if (method === 'POST' && /^\/api\/auto-replies\/[^/]+\/validate$/.test(pathname)) {
    if (pathname === '/api/auto-replies/ar-new/validate') return { ...AUTO_REPLY_PUBLISH_VALIDATION, conflicts: AUTO_REPLY_NEW_CONFLICTS }
    return AUTO_REPLY_PUBLISH_VALIDATION
  }
  if (method === 'POST' && /^\/api\/auto-replies\/[^/]+\/publish$/.test(pathname)) {
    return AUTO_REPLY_PUBLISH_RESULT
  }
  if (method === 'POST' && /^\/api\/rich-menu-groups\/[^/]+\/preview-targets$/.test(pathname)) {
    return {
      matched: { value: 1020, state: 'available', reason: null },
      overlap: { value: 180, state: 'available', reason: null },
      effective: { value: 840, state: 'available', reason: null },
      higherMenus: ['夏キャンペーン'],
      priority: 2,
    }
  }
  if (method === 'POST' && pathname === '/api/friend-add-rules/test') {
    return {
      stateChanged: false, ruleId: FRIEND_ADD_RULE.id, matched: true,
      reasons: ['この設定が優先順位どおりに選ばれます。'],
      scenarioId: FRIEND_ADD_RULE.definition.scenarioId,
      message: FRIEND_ADD_RULE.definition.messageText,
      actions: FRIEND_ADD_RULE.definition.actions,
    }
  }
  if (method === 'POST' && pathname === '/api/broadcasts/preflight') {
    return BROADCAST_PREFLIGHT
  }
  if (method === 'PUT' && pathname === '/api/broadcasts/notification-settings') {
    return BROADCAST_NOTIFICATION_SETTINGS
  }
  /* 二者承認（m12a / 設計 A）。撮影で承認待ちの帯・承認する人の操作を出す。 */
  if (method === 'PUT' && pathname === '/api/broadcasts/approval-threshold') {
    return { success: true, data: { lineAccountId: query.get('lineAccountId') ?? 'visual-qa-account', threshold: 1000 } }
  }
  const broadcastApprovalAction = pathname.match(/^\/api\/broadcasts\/([^/]+)\/approval-(request|approve|reject|cancel|remind)$/)
  if (method === 'POST' && broadcastApprovalAction) {
    const action = broadcastApprovalAction[2]
    if (action === 'remind') return { success: true, data: { reminded: true } }
    const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'cancel' ? 'cancelled' : 'pending'
    return {
      success: true,
      data: {
        approval: {
          ...BROADCAST_APPROVAL_STATE.approval,
          status,
          decidedByStaffId: status === 'pending' ? null : 'staff-approver',
          decidedAt: status === 'pending' ? null : '2026-09-25T21:00:00+09:00',
          rejectReason: status === 'rejected' ? '金額が古い' : null,
        },
        ...(action === 'approve' ? { needsSend: true } : {}),
      },
    }
  }
  if (method === 'POST' && /^\/api\/tags\/[^/]+\/archive$/.test(pathname)) {
    return TAG_ARCHIVE_RESULT
  }
  if (method === 'POST' && /^\/api\/webhooks\/outgoing\/[^/]+\/test$/.test(pathname)) {
    return OUTGOING_WEBHOOK_TEST_RESULT
  }
  if (method === 'POST' && pathname === '/api/saved-searches/preview') {
    return FRIEND_ATTRIBUTE_SAVED_SEARCH_DETAIL
  }
  /* 機能29の操作系。承認・拒否・取消・枠の増減を目視できるよう固定の返事を返す(点検#520の中7)。 */
  if (method === 'POST' && /^\/api\/events\/admin\/events\/[^/]+\/bookings\/[^/]+\/decide$/.test(pathname)) {
    const bookingId = pathname.split('/').pop()
    const found = EVENT_BOOKINGS.find((booking) => booking.id === bookingId) ?? EVENT_BOOKINGS[0]
    return { ...found, status: 'confirmed', decided_at: '2026-09-08T00:00:00.000Z' }
  }
  if (method === 'POST' && /^\/api\/events\/admin\/events\/[^/]+\/bookings\/[^/]+\/cancel$/.test(pathname)) {
    return { ok: true }
  }
  if (method === 'PUT' && /^\/api\/events\/admin\/events\/[^/]+\/bookings\/[^/]+$/.test(pathname)) {
    const bookingId = pathname.split('/').pop()
    const found = EVENT_BOOKINGS.find((booking) => booking.id === bookingId) ?? EVENT_BOOKINGS[0]
    return { ...found, status: 'confirmed' }
  }
  if (method === 'POST' && /^\/api\/events\/admin\/events\/[^/]+\/slots$/.test(pathname)) {
    return { items: EVENT_SLOTS }
  }
  /* U: 変更の確認・状態・待ちの手動操作・LIFF開催回変更の見本（実APIと同じ器）。 */
  if (method === 'POST' && /^\/api\/events\/admin\/events\/[^/]+\/lifecycle$/.test(pathname)) {
    return EVENT_LIFECYCLE_RESULT
  }
  if (method === 'POST' && /^\/api\/events\/admin\/events\/[^/]+\/change-review$/.test(pathname)) {
    return EVENT_CHANGE_PREVIEW
  }
  if (method === 'POST' && /^\/api\/events\/admin\/events\/[^/]+\/change-review\/apply$/.test(pathname)) {
    return EVENT_CHANGE_APPLY_RESULT
  }
  if (method === 'POST' && /^\/api\/events\/admin\/occurrences\/[^/]+\/waitlist\/reorder$/.test(pathname)) {
    return EVENT_WAITLIST_REORDER_RESULT
  }
  if (method === 'POST' && /^\/api\/events\/admin\/occurrences\/[^/]+\/waitlist\/skip$/.test(pathname)) {
    return EVENT_WAITLIST_SKIP_RESULT
  }
  if (method === 'POST' && /^\/api\/events\/liff\/bookings\/[^/]+\/change$/.test(pathname)) {
    return EVENT_LIFF_CHANGE_RESULT
  }
  if (method === 'PUT' && /^\/api\/events\/admin\/events\/[^/]+\/slots\/[^/]+$/.test(pathname)) {
    return EVENT_SLOTS[0]
  }
  if (method === 'DELETE' && /^\/api\/events\/admin\/events\/[^/]+\/slots\/[^/]+$/.test(pathname)) {
    return {}
  }
  return null
}

/** `success` の器に入れず、そのまま返すもの。 */
const RAW = {
  // `0.0.0-dev` のときはバナー自体を出さない。manifest も見に行かない。
  //（update-banner.tsx の DEV_VERSION と同じ値でないと効かない）
  '/admin/version': { version: '2.6.4', worker_hash: '', admin_hash: '', liff_hash: '', git_commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', deploy_env: 'staging', released_at: '2026-09-27T04:05:00.000Z' },
  '/admin/manifest': { releases: [], versions: [] },

  /*
    **`{success, data}` で包まない口。**

    `api.ts` には `fetchApi<{ menus: BookingMenu[] }>` のように、
    器を通さずそのまま返る口がある。包んで返すと画面側は
    `res.menus` が `undefined` になり、`.filter` で丸ごと落ちる。

      /booking/menus  … Cannot read properties of undefined (reading 'filter')
      /events         … 同上

    どちらも「画面を表示できませんでした」になっていて、
    **実装の不具合に見えていた。**
  */
  /* 空いている時間。包むと `res.by_staff` が undefined になり、選ぶ口が0件になる。 */
  '/api/booking/admin/availability': BOOKING_AVAILABILITY,
  '/api/booking/admin/resources': { success: true, data: { resources: BOOKING_RESOURCES } },
  '/api/booking/admin/menus': { menus: BOOKING_MENUS },
  /* 予約経路の連携（V8 予約設定 ZyDd6）。口は `{success,data}` で包む。無いと設定の「予約経路」タブが落ちていた。 */
  '/api/booking/admin/channels': { success: true, data: BOOKING_CHANNELS },
  '/api/booking/admin/conflicts': { success: true, data: { conflicts: [] } },
  '/api/booking/admin/staff': { staff: BOOKING_STAFF },
  /*
    担当×メニューの一括表。実口（`booking.ts`）と同じ
    `{staff: [{staff_id, matrix}]}` の形。`success` で包む・`staff` を
    付けないと、設定画面の担当タブ・メニュー作成画面が
    `c.value.staff is not iterable` で落ちる（2026-10-03 点検）。
  */
  '/api/booking/admin/staff-menus': {
    staff: BOOKING_STAFF.map((staff) => ({
      staff_id: staff.id,
      matrix: BOOKING_STAFF_MENUS[staff.id] ?? [],
    })),
  },
  '/api/booking/admin/customer-context': { customer: BOOKING_CUSTOMER_CONTEXT },
  '/api/booking/admin/reminder-preview': BOOKING_REMINDER_PREVIEW,
  '/api/booking/admin/alternatives': BOOKING_CONFLICT_ALTERNATIVES,
  /* 一覧の数の帯（e2ekFu）は応答の全体集計 summary を読む。無いとページの行から数えて、過ぎた回だけだと 0 になる。 */
  '/api/events/admin/events': {
    items: ADMIN_EVENTS,
    total: ADMIN_EVENTS.length,
    summary: {
      upcoming_slots: 9, upcoming_active: 29, upcoming_capacity: 60, fill_rate: 48, nearly_full: 1, low_applications: 1,
      nearest_upcoming_starts_at: '2026-10-12T05:00:00.000Z', nearest_low_starts_at: '2026-10-05T02:00:00.000Z',
    },
  },
  // 予約メニューの帯は `requests` から件数を出す。包むと `.filter` で落ちる。
  // 撮影用は BOOKING_REQUESTS(実APIと同じ器。動的な絞り込みは下の分岐が受ける)。
  '/api/booking/admin/requests': { requests: BOOKING_REQUESTS, total: BOOKING_REQUESTS.length, limit: 50, offset: 0 },
  '/api/booking/admin/requests-summary': {
    total: BOOKING_REQUESTS.length,
    requested: BOOKING_REQUESTS.filter((item) => item.status === 'requested').length,
    monthTotal: BOOKING_REQUESTS.length,
    monthConfirmed: BOOKING_REQUESTS.filter((item) => item.status === 'confirmed').length,
    monthCancelled: BOOKING_REQUESTS.filter((item) => ['cancelled', 'rejected', 'no_show'].includes(item.status)).length,
    lastMonthTotal: 0,
    todayTotal: BOOKING_REQUESTS.length,
    weekTotal: BOOKING_REQUESTS.length,
    byMenu: BOOKING_MENUS.map((menu) => ({
      name: menu.name,
      total: BOOKING_REQUESTS.filter((item) => item.menu_name === menu.name).length,
    })),
  },
}

/**
 * 同じく包まない口のうち、**途中にIDが入るもの**。
 *
 * `RAW` は道が一致したときしか効かないので、
 * `/api/events/admin/events/ev-1/bookings` のように id が挟まる口は
 * 素通りして `{success,data:{items…}}` に包まれていた。
 * 画面は `listRes.items` を読むので `undefined` になり、
 * `29-1-B 申込者の一覧` が `.filter` で「画面を表示できませんでした」になっていた。
 */
const RAW_PATTERNS = [
  [/^\/api\/booking\/admin\/bookings\/[^/]+$/, BOOKING_ADMIN_DETAIL],
  [/^\/api\/booking\/admin\/menus\/[^/]+\/versions$/, { versions: BOOKING_MENU_VERSIONS }],
  [/^\/api\/booking\/admin\/menus\/[^/]+\/versions\/\d+$/, (url) => {
    const wanted = Number(url.pathname.split('/').pop())
    const version = BOOKING_MENU_VERSIONS.find((item) => item.version_number === wanted)
      ?? BOOKING_MENU_VERSIONS[0]
    return { version }
  }],
  [/^\/api\/booking\/admin\/staff\/[^/]+\/menus$/, (url) => ({
    matrix: BOOKING_STAFF_MENUS[url.pathname.split('/')[5]] ?? [],
  })],
  [/^\/api\/events\/admin\/events\/[^/]+$/, EVENT_DETAIL],
  [/^\/api\/events\/admin\/events\/[^/]+\/slots$/, { items: EVENT_SLOTS }],
  /* 申込者（Mu8qW）の開催回の選び口と、回ごとの一覧。包まない口と包む口が混ざる（実APIと同じ）。 */
  [/^\/api\/events\/admin\/events\/[^/]+\/occurrence-selector$/, { items: EVENT_SLOTS }],
  [/^\/api\/events\/admin\/occurrences\/[^/]+\/applicants$/, { success: true, data: EVENT_OCCURRENCE_APPLICANTS }],
  [/^\/api\/events\/admin\/events\/[^/]+\/waitlist$/, { waitlist: EVENT_WAITLIST }],
  [/^\/api\/events\/admin\/events\/notifications\/pending$/, { count: 2 }],
  [/^\/api\/events\/admin\/events\/[^/]+\/bookings$/, (url) => ({
    items: url.searchParams.get('status')
      ? EVENT_BOOKINGS.filter((booking) => booking.status === url.searchParams.get('status'))
      : EVENT_BOOKINGS,
  })],
  /* メニューに就ける担当。器は `{staff}`。包むと選ぶ口が0件になる。 */
  [/^\/api\/booking\/admin\/menus\/[^/]+\/staff$/, { staff: BOOKING_MENU_STAFF }],
  /* スタッフロール本人の予約スタッフ（本人勤務 E3YDK）。器は `{staff}`。包むと `.find` で落ちる。 */
  [/^\/api\/booking\/admin\/staff\/me$/, { staff: [BOOKING_STAFF[0]] }],
  /* `tksPc` の通常・読込中・失敗を分けるため、通常だけ本番と同じ器で返す。 */
  [/^\/api\/booking\/admin\/staff\/[^/]+\/shifts$/, { shifts: BOOKING_STAFF_SHIFTS }],
  [/^\/api\/booking\/admin\/staff\/[^/]+\/availability-rules$/, { rules: BOOKING_AVAILABILITY_RULES }],
  [/^\/api\/booking\/admin\/staff\/[^/]+\/breaks$/, BOOKING_BREAKS],
  [/^\/api\/booking\/admin\/staff\/[^/]+\/break-dates$/, BOOKING_BREAK_DATES],
  [/^\/api\/booking\/admin\/staff\/[^/]+\/google-calendar$/, BOOKING_GOOGLE_CALENDAR],
]

/** 参照が1つも無ければ消せる（`packages/db` の `canDelete` と同じ数え方）。 */
function tagDeleteImpact(tag) {
  const used = tag.usedIn ?? {}
  const references = {
    broadcasts: used.broadcasts ?? 0,
    forms: used.forms ?? 0,
    scenarios: used.scenarios ?? 0,
    autoReplies: used.autoReplies ?? 0,
    savedSearches: used.savedSearches ?? 0,
    automations: 0,
    commonActions: 0,
    richMenus: 0,
    templates: 0,
    webinars: 0,
    reminders: 0,
    entryRoutes: 0,
    trackedLinks: 0,
    bookingMenus: 0,
    affiliateOffers: 0,
    events: 0,
    analyticsFunnels: 0,
    friendAddSettings: 0,
  }
  const blockingReferenceCount = Object.values(references).reduce((sum, n) => sum + n, 0)
  return {
    tag: { id: tag.id, name: tag.name },
    friendCount: tag.friendCount ?? 0,
    references,
    blockingReferenceCount,
    canDelete: blockingReferenceCount === 0,
  }
}

/**
 * リマインダの通知ステップ。**一覧の既定の形（`{items,…}`）では返さない。**
 * 編集画面は `steps` を配列として回すので、通で返さないとそこで落ちる。
 */
function reminderStepsOf(reminder) {
  const count = Number(reminder.stepCount ?? 0)
  return Array.from({ length: count }, (_, i) => ({
    id: `${reminder.id}-step-${i + 1}`,
    reminderId: reminder.id,
    offsetMinutes: Number(reminder.triggerOffsetMinutes ?? 0) + i * 60,
    offsetDays: null,
    sendAtTime: reminder.sendAtTime,
    templateId: null,
    messageType: 'text',
    messageContent: i === 0 ? 'ご予約日時が近づいています。' : 'あわせてご確認ください。',
    createdAt: '2026-06-02T00:00:00.000Z',
  }))
}

const NEN_RANGE_END = Date.parse('2026-08-25T15:00:00.000Z')

function nenRangeFor(query) {
  const from = query.get('from')
  const to = query.get('to')
  if (from && to && Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(to))) {
    return {
      days: Math.max(1, Math.ceil((Date.parse(to) - Date.parse(from)) / 86_400_000)),
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    }
  }
  const requested = Number.parseInt(query.get('days') ?? '30', 10)
  const days = Number.isSafeInteger(requested) && requested >= 1 && requested <= 365 ? requested : 30
  return {
    days,
    from: new Date(NEN_RANGE_END - days * 86_400_000).toISOString(),
    to: new Date(NEN_RANGE_END).toISOString(),
  }
}

function nenMetricsBody(data, query) {
  return { ...data, range: nenRangeFor(query) }
}

function bodyFor(method, pathname, query = new URLSearchParams()) {
  if (method === 'GET' && pathname === '/api/hq/billing/summary') {
    return { success: true, data: BILLING_SUMMARY }
  }
  if (method === 'GET' && pathname === '/api/hq/billing/invoices') {
    return { success: true, data: BILLING_INVOICES }
  }
  if (method === 'GET' && pathname === '/api/hq/notices/line-registration') {
    /* 絵 `D6fh3`：運営（契約者専用）の LINE は設定済み・まだ紐づいていない・確認コード 482913。 */
    return { success: true, data: { available: true, accountName: 'musubo 運営（契約者専用）', basicId: '@musubo', addFriendUrl: 'https://line.me/R/ti/p/@musubo', linked: false, code: '482913', codeExpiresAt: '2026-10-07T18:00:00+09:00' } }
  }
  if (method === 'GET' && pathname === '/api/hq/support/requests') {
    return { success: true, data: HQ_SUPPORT_REQUESTS }
  }
  if (method === 'GET' && pathname === '/api/hq/support/context') {
    /*
     * 統括のお問い合わせ（`apps/worker/src/routes/hq-support.ts`）と同じ器。
     * 無いと既定の `{items,total,page,limit}` が返り、画面の `kinds.map` で
     * `/hq/support` が真っ白になった（2026-09-25）。
     */
    return {
      success: true,
      data: {
        kinds: [
          { key: 'usage', label: '使い方について' },
          { key: 'bug', label: '不具合の報告' },
          { key: 'billing', label: '料金・契約について' },
          { key: 'feature', label: '要望・提案' },
          { key: 'other', label: 'その他' },
        ],
        accounts: [{ id: 'visual-qa-account', name: '然 -NEN- 本店' }],
        /* 絵 `b8xBtZ`・`OhguS` の送信者（2026-10-06 絵に合わせた）。 */
        sender: {
          tenantName: '然 -NEN- 本部',
          name: '高田 誠',
          email: 'takada@example.jp',
          planLabel: 'スタンダード',
        },
      },
    }
  }
  {
    /*
     * 統括のお問い合わせの続き（`HqSupportDetail`）。
     * 無いと既定の `{items,total,page,limit}` が返り、日時の整形で落ちて
     * `/hq/support/detail?id=visual-ticket-1` が開けなかった（2026-09-25）。
     */
    const hqSupportDetail = /^\/api\/hq\/support\/requests\/([^/]+)$/.exec(pathname)
    if (method === 'GET' && hqSupportDetail) {
      const id = decodeURIComponent(hqSupportDetail[1])
      const found = HQ_SUPPORT_REQUESTS.find((row) => row.id === id) ?? HQ_SUPPORT_REQUESTS[0]
      return { success: true, data: { ...HQ_SUPPORT_DETAIL, ...found, messages: HQ_SUPPORT_DETAIL.messages } }
    }
  }
  /*
   * 飲食店向けテスト（`/restaurant-test/*`）。`restaurant-test-api.ts` の
   * 読み口だけを固定で返す。書き込み（発行・承認・保存）は従来どおり405。
   */
  if (method === 'GET' && pathname === '/api/restaurant-test/snapshot') {
    return { success: true, data: RESTAURANT_SNAPSHOT }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/stores') {
    return { success: true, data: { organization: RESTAURANT_SNAPSHOT.organization, stores: RESTAURANT_SNAPSHOT.stores } }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/store-context') {
    return { success: true, data: { selectedStore: { id: 'store-sby', name: '然 渋谷店' } } }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/reservations/day') {
    const storeId = query.get('storeId') || 'store-sby'
    const date = query.get('date') || ''
    const sameDay = (iso) => { const d = new Date(iso); const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${dd}` === date }
    return { success: true, data: { date, reservations: RESTAURANT_RESERVATIONS.filter((r) => r.store_id === storeId && sameDay(r.starts_at)) } }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/customers/search') {
    return { success: true, data: [{ name: '山田 花子', phone: '090-1111-2222', lineUid: 'U-demo-3' }] }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/customers/history') {
    return { success: true, data: { visitCount: 3, visits: [{ id: 'v-1', starts_at: '2026-08-14T10:00:00.000Z', guest_count: 4, table_label: '個室A', course_name: '秋の鹿肉コース', allergy_note: 'えび' }] } }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/inventory/day') {
    return { success: true, data: RESTAURANT_INVENTORY_DAY }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/opening-hours') {
    return { success: true, data: RESTAURANT_OPENING_HOURS }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/channels') {
    return { success: true, data: RESTAURANT_CHANNELS }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/inbound-emails') {
    return { success: true, data: RESTAURANT_INBOUND_EMAILS, total: RESTAURANT_INBOUND_EMAILS.length }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/intake-addresses') {
    return { success: true, data: RESTAURANT_INTAKE_ADDRESSES }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/google/connection') return GOOGLE_CONNECTION_DATA
  if (method === 'GET' && pathname === '/api/restaurant-test/google/reviews') {
    return { success: true, reviews: GOOGLE_REVIEWS, page: 1, perPage: 20, total: GOOGLE_REVIEWS.length, connection: GOOGLE_CONNECTION }
  }
  const googleReviewDetail = pathname.match(/^\/api\/restaurant-test\/google\/reviews\/([^/]+)$/)
  if (method === 'GET' && googleReviewDetail) {
    const review = GOOGLE_REVIEWS.find((row) => row.id === decodeURIComponent(googleReviewDetail[1])) ?? GOOGLE_REVIEWS[1]
    return { success: true, review, store: { id: GOOGLE_STORE.id, name: GOOGLE_STORE.name }, connection: GOOGLE_CONNECTION }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/google/posts') return GOOGLE_POST_LIST
  const googlePostDetail = pathname.match(/^\/api\/restaurant-test\/google\/posts\/([^/]+)$/)
  if (method === 'GET' && googlePostDetail) {
    const post = GOOGLE_POSTS.find((row) => row.id === decodeURIComponent(googlePostDetail[1])) ?? GOOGLE_POSTS[0]
    return { success: true, post, store: { id: GOOGLE_STORE.id, name: GOOGLE_STORE.name }, writeEnabled: false, canPublish: true }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/google/performance') return GOOGLE_PERFORMANCE
  if (method === 'GET' && pathname === '/api/restaurant-test/google/profile') return GOOGLE_PROFILE
  if (method === 'GET' && pathname === '/api/restaurant-test/terms-agreement') {
    return { success: true, data: { documentKey: 'musubo-terms', agreedVersion: null, agreedAt: null } }
  }

  if (pathname === '/api/auth/session') {
    /*
     * 運営コンソールの外枠（`OpsShell`）は `platformAdmin` を見る。
     * 本物（`apps/worker/src/routes/admin-auth.ts`）と同じ器で、
     * 運営メンバーとして返す。通常の `AuthGuard` は余分な鍵を無視するので、
     * 他の画面は変わらない。
     */
    return {
      success: true,
      data: { ...STAFF, platformAdmin: true, platformAdminState: null, impersonation: null },
      csrfToken: 'visual-qa-csrf',
    }
  }
  /*
   * 運営コンソール（`/ops/*`）。画面側は変えない。見本データは上の `OPS_*`。
   * 更新系は従来どおり405で、撮影では読みの画面だけを見る。
   */
  /*
   * 運営の入口（V8 の 2要素認証 qod6X・招待 tVaUh）。QR の用意と招待の確認だけ
   * 固定で返す。キーは作り物（RFC の見本の値）で、本物の秘密ではない。
   */
  if (method === 'POST' && /^\/api\/staff\/[^/]+\/two-factor\/setup$/.test(pathname)) {
    return {
      success: true,
      data: { provisioningUri: 'otpauth://totp/musubo:visual-qa?secret=JBSWY3DPEHPK3PXP&issuer=musubo', manualKey: 'JBSW Y3DP EHPK 3PXP' },
    }
  }
  if (method === 'GET' && pathname === '/api/auth/ops-invite/check') {
    return { success: true, data: { email: 'invited@example.com', name: '', needsPassword: true } }
  }
  if (method === 'GET' && pathname === '/api/ops/me') {
    return { success: true, data: OPS_ME }
  }
  if (method === 'GET' && pathname === '/api/ops/impersonation/current') {
    return { success: true, data: null }
  }
  if (method === 'GET' && pathname === '/api/ops/tenants') {
    return { success: true, data: OPS_TENANTS, summary: OPS_TENANT_SUMMARY }
  }
  {
    const tenantDetail = /^\/api\/ops\/tenants\/([^/]+)$/.exec(pathname)
    if (method === 'GET' && tenantDetail) {
      const id = decodeURIComponent(tenantDetail[1])
      const tenant = OPS_TENANTS.find((row) => row.id === id) ?? OPS_TENANTS[0]
      return {
        success: true,
        data: {
          tenant: { ...tenant, id: tenant.id },
          // 絵（Oub6x）の店舗の並び：4つつながっていて、1つはアーカイブ。
          accounts: [
            { id: 'visual-qa-account', name: '画面確認アカウント', is_active: 1, archived_at: null, updated_at: '2026-09-01T10:00:00+09:00', friend_count: 1284 },
            { id: 'visual-qa-account-2', name: '見本アカウント 2', is_active: 1, archived_at: null, updated_at: '2026-09-01T10:00:00+09:00', friend_count: 612 },
            { id: 'visual-qa-account-3', name: '見本アカウント 3', is_active: 1, archived_at: null, updated_at: '2026-09-01T10:00:00+09:00', friend_count: 14 },
            { id: 'visual-qa-account-4', name: '見本アカウント 4', is_active: 1, archived_at: null, updated_at: '2026-09-01T10:00:00+09:00', friend_count: 238 },
            { id: 'visual-qa-account-5', name: '見本アカウント 5', is_active: 0, archived_at: '2026-08-01T10:00:00+09:00', updated_at: '2026-08-01T10:00:00+09:00', friend_count: 0 },
          ],
          members: [
            {
              id: 'visual-staff-1', name: '検証 一郎', email: 'owner@example.com', role: 'owner',
              access_level: 'admin', is_active: 1, invite_status: 'accepted',
              last_login_at: '2026-09-07T08:00:00+09:00',
            },
          ],
          audit: OPS_AUDIT.filter((row) => row.tenant_id === tenant.id),
        },
      }
    }
  }
  if (method === 'GET' && pathname === '/api/ops/dashboard') {
    const period = query.get('period')
    const selected = period === 'prev_month' || period === 'year' ? period : 'month'
    return { success: true, data: { ...OPS_DASHBOARD, period: selected } }
  }
  if (method === 'GET' && pathname === '/api/ops/dashboard/line-unregistered') {
    return { success: true, data: OPS_LINE_UNREGISTERED }
  }
  if (method === 'GET' && pathname === '/api/ops/support/summary') {
    return { success: true, data: OPS_SUPPORT_SUMMARY }
  }
  if (method === 'GET' && pathname === '/api/ops/support/tickets') {
    return { success: true, data: OPS_SUPPORT_TICKETS, total: OPS_SUPPORT_TICKETS.length }
  }
  {
    const supportDetail = /^\/api\/ops\/support\/tickets\/([^/]+)$/.exec(pathname)
    if (method === 'GET' && supportDetail) {
      const id = decodeURIComponent(supportDetail[1])
      const ticket = OPS_SUPPORT_TICKETS.find((row) => row.id === id) ?? OPS_SUPPORT_TICKETS[0]
      return {
        success: true,
        data: { ...OPS_SUPPORT_DETAIL, ticket: { ...OPS_SUPPORT_DETAIL.ticket, ...ticket, replyCount: 1 } },
      }
    }
  }
  if (method === 'GET' && pathname === '/api/ops/knowledge') {
    return { success: true, data: OPS_KNOWLEDGE, total: OPS_KNOWLEDGE.length }
  }
  {
    const knowledgeDetail = /^\/api\/ops\/knowledge\/([^/]+)$/.exec(pathname)
    if (method === 'GET' && knowledgeDetail) {
      const id = decodeURIComponent(knowledgeDetail[1])
      const article = OPS_KNOWLEDGE.find((row) => row.id === id) ?? OPS_KNOWLEDGE[0]
      return { success: true, data: { ...article, sourceSubject: null } }
    }
  }
  if (method === 'GET' && pathname === '/api/ops/announcements') {
    return {
      success: true,
      data: OPS_ANNOUNCEMENTS,
      linked: OPS_NOTICE_LINE.linked,
      // 絵（tQ2MJ）は契約者専用LINE が未設定の形（作る欄に琥珀の帯が出る）。
      noticeLineConfigured: false,
    }
  }
  if (method === 'GET' && pathname === '/api/ops/notice-line-account') {
    return { success: true, data: OPS_NOTICE_LINE }
  }
  if (method === 'GET' && pathname === '/api/ops/audit') {
    return { success: true, data: OPS_AUDIT, total: OPS_AUDIT.length }
  }
  if (method === 'GET' && pathname === '/api/ops/members') {
    return { success: true, data: OPS_MEMBERS, summary: OPS_MEMBER_SUMMARY }
  }
  if (pathname === '/api/inbox/unanswered') {
    return {
      success: true,
      data: {
        total: 2,
        page: 1,
        pageSize: 2000,
        rows: [
          {
            friendId: 'friend-inbox-1',
            displayName: '佐藤 美咲',
            pictureUrl: null,
            accountId: 'visual-qa-account',
            accountName: '画面確認アカウント',
            lastIncomingAt: '2026-09-07T04:30:00.000Z',
            lastManualAt: null,
            lastMachineAt: '2026-09-07T04:31:00.000Z',
            lastIncomingType: 'text',
            lastIncomingContent: '予約について確認したいです',
          },
          {
            friendId: 'friend-inbox-2',
            displayName: '鈴木 健太',
            pictureUrl: null,
            accountId: 'visual-qa-account',
            accountName: '画面確認アカウント',
            lastIncomingAt: '2026-09-07T03:15:00.000Z',
            lastManualAt: null,
            lastMachineAt: null,
            lastIncomingType: 'text',
            lastIncomingContent: '商品の発送日はいつですか？',
          },
        ],
      },
    }
  }
  if (pathname === '/api/affiliate-settlements/preview') {
    /* 締めの期間は頼まれた期間を返す（本物と同じ）。無いときは見本の期間。 */
    return { success: true, data: { ...AFFILIATE_SETTLEMENT_PREVIEW, periodFrom: query.get('periodFrom') ?? AFFILIATE_SETTLEMENT_PREVIEW.periodFrom, periodTo: query.get('periodTo') ?? AFFILIATE_SETTLEMENT_PREVIEW.periodTo } }
  }
  if (pathname === '/api/ec-commerce/orders') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 20
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    const status = query.get('status')
    const search = (query.get('query') ?? '').trim().toLocaleLowerCase('ja')
    const filtered = EC_ORDERS.items.filter((order) => {
      if (status && order.status !== status) return false
      if (!search) return true
      return order.orderNumber.toLocaleLowerCase('ja').includes(search)
        || (order.customerName ?? '').toLocaleLowerCase('ja').includes(search)
    })
    const total = status || search ? filtered.length : EC_ORDERS.total
    return {
      success: true,
      data: { ...EC_ORDERS, items: filtered.slice(offset, offset + limit), total },
      pagination: { total, limit, offset },
    }
  }
  if (pathname === '/api/ec-commerce/action-executions') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 20
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    const status = query.get('status')
    const eventId = query.get('eventId')
    const statusGroup = query.get('statusGroup')
    const groupStatuses = { processing: ['pending', 'processing'], failed: ['retryable_failed', 'permanent_failed'] }
    const grouped = statusGroup ? (groupStatuses[statusGroup] ?? null) : null
    const filtered = EC_ACTION_EXECUTIONS.items.filter((execution) => (
      (!status || execution.status === status)
      && (!grouped || grouped.includes(execution.status))
      && (!eventId || execution.eventId === eventId)
    ))
    const total = status || grouped || eventId ? filtered.length : EC_ACTION_EXECUTIONS.total
    return {
      success: true,
      data: { ...EC_ACTION_EXECUTIONS, items: filtered.slice(offset, offset + limit), total },
      pagination: { total, limit, offset },
    }
  }
  if (pathname === '/api/ec-commerce/identity-candidates') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 20
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    const status = query.get('status') ?? 'pending'
    const filtered = EC_IDENTITY_CANDIDATES.items.filter((candidate) => candidate.status === status)
    const total = status === 'pending' ? EC_IDENTITY_CANDIDATES.total : filtered.length
    return {
      success: true,
      data: { ...EC_IDENTITY_CANDIDATES, items: filtered.slice(offset, offset + limit), total },
      pagination: { total, limit, offset },
    }
  }
  if (pathname === '/api/access/users') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 200) : 50
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    const status = query.get('status')
    const roleBundle = query.get('roleBundle')
    const search = (query.get('query') ?? '').trim().toLocaleLowerCase('ja')
    // いま入っている本人（visual-qa-owner）は「いま」入った形で返す（設計 nku0f の「いま」）。
    const now = new Date(Date.now() - 60_000).toISOString()
    const filtered = ACCESS_USERS.items.map((user) => (user.id === STAFF.id ? { ...user, lastLoginAt: now, lastActionAt: now } : user)).filter((user) => {
      if (status && user.status !== status) return false
      if (roleBundle && user.roleBundle !== roleBundle) return false
      if (!search) return true
      return user.name.toLocaleLowerCase('ja').includes(search)
        || (user.email ?? '').toLocaleLowerCase('ja').includes(search)
    })
    return {
      success: true,
      data: {
        ...ACCESS_USERS,
        items: filtered.slice(offset, offset + limit),
        pagination: { total: filtered.length, limit, offset },
      },
    }
  }
  if (pathname === '/api/access/roles') return { success: true, data: ACCESS_ROLES }
  if (pathname === '/api/audit/events') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 200) : 20
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    const category = query.get('category')
    const result = query.get('result')
    const actorId = query.get('actorId')
    const action = query.get('action')
    const search = (query.get('query') ?? '').trim().toLocaleLowerCase('ja')
    const from = query.get('from') ? Date.parse(query.get('from')) : null
    const to = query.get('to') ? Date.parse(query.get('to')) : null
    const filtered = ACCESS_AUDIT_EVENTS.items.filter((event) => {
      if (category && event.category !== category) return false
      if (result && event.result !== result) return false
      if (actorId && event.actor.id !== actorId) return false
      if (action && event.action !== action) return false
      const createdAt = Date.parse(event.createdAt)
      if (Number.isFinite(from) && createdAt < from) return false
      if (Number.isFinite(to) && createdAt > to) return false
      if (!search) return true
      return [event.actor.name, event.action, event.target?.kind, event.target?.id, event.reason]
        .some((value) => String(value ?? '').toLocaleLowerCase('ja').includes(search))
    })
    const hasFilter = Boolean(category || result || actorId || action || search || Number.isFinite(from) || Number.isFinite(to))
    const total = hasFilter ? filtered.length : ACCESS_AUDIT_EVENTS.pagination.total
    return {
      success: true,
      data: {
        ...ACCESS_AUDIT_EVENTS,
        items: filtered.slice(offset, offset + limit),
        pagination: { total, limit, offset },
      },
    }
  }
  if (pathname === '/api/getting-started') return { success: true, data: GETTING_STARTED }
  if (pathname === '/api/recipes') return { success: true, data: RECIPES }
  const recipeDetail = /^\/api\/recipes\/([^/]+)$/.exec(pathname)
  if (recipeDetail) {
    /*
     * 未知IDは本物と同じく失敗にする。成功＋null だと
     * 複製画面が `recipe.items.map` で落ちていた。
     */
    const found = RECIPES.find((recipe) => recipe.id === recipeDetail[1])
    if (!found) return { success: false, error: 'レシピが見つかりません' }
    return { success: true, data: found }
  }
  if (pathname === '/api/manual-links') return { success: true, data: MANUAL_LINKS }
  if (pathname === '/api/operations/control/preview') {
    return { success: true, data: OPERATION_CONTROL_PREVIEW }
  }
  if (pathname === '/api/operations/send-paths') {
    /*
     * 無いと既定の器が返り、`data.capabilities` が回せず
     * 「画面を表示できませんでした」になっていた（`?tab=control`）。
     * 本物は `{evaluatedAt,capabilities,problems,paths}`（`operations.ts`）。
     */
    return { success: true, data: OPERATION_SEND_PATHS }
  }
  if (pathname === '/api/hq/banners/presets') {
    /*
     * 無いと既定の器が返り、`stats.projects.active` で
     * 「画面を表示できませんでした」になっていた。本物の形で置く。
     */
    return {
      success: true,
      data: { presets: HQ_BANNER_PRESETS, maxCount: 4, usage: HQ_BANNER_USAGE, engineReady: true },
    }
  }
  if (pathname === '/api/hq/banners/stats') {
    return { success: true, data: HQ_BANNER_STATS }
  }
  if (pathname === '/api/hq/banners/projects') {
    const archived = query.get('archived') === '1'
    const items = archived ? HQ_BANNER_ARCHIVED_PROJECTS : HQ_BANNER_PROJECTS
    return { success: true, data: items }
  }
  if (method === 'GET' && pathname.startsWith('/api/hq/banners/projects/')) {
    // プロジェクトの中（絵 iMnph）。本物は `{project, images, generations}`。
    const id = decodeURIComponent(pathname.slice('/api/hq/banners/projects/'.length))
    const project = [...HQ_BANNER_PROJECTS, ...HQ_BANNER_ARCHIVED_PROJECTS].find((p) => p.id === id)
    if (!project) return { success: false, error: 'プロジェクトが見つかりません' }
    // 絵 iMnph の並び（秋の味覚がいちばん後ろ）。並びは本物でも新しい順とは限らない（取り込み・再生成）。
    const order = (i) => (i.id === 'banner-image-qa-12' ? 1 : 0)
    const images = HQ_BANNER_IMAGES.filter((i) => i.projectId === id).sort((a, b) => order(a) - order(b))
    const generations = [...new Map(images.filter((i) => i.generation).map((i) => [i.generation.id, i.generation])).values()]
    return { success: true, data: { project, images, generations } }
  }
  if (pathname === '/api/hq/banners/images') {
    // 画像ライブラリ（絵 W5Wxr）は 12 枚ずつ。数（withCounts）は全体の数。
    let items = HQ_BANNER_IMAGES
    if (query.get('projectId')) items = items.filter((i) => i.projectId === query.get('projectId'))
    if (query.get('favorite') === '1') items = items.filter((i) => i.isFavorite)
    if (query.get('delivered') === '1') items = items.filter((i) => i.deliveredAccountIds.length > 0)
    if (query.get('delivered') === '0') items = items.filter((i) => i.deliveredAccountIds.length === 0)
    const before = query.get('before')
    if (before) items = items.filter((i) => i.createdAt < before)
    const limit = Number(query.get('limit') ?? '') || items.length
    const page = items.slice(0, limit)
    const nextBefore = items.length > limit ? page[page.length - 1].createdAt : null
    return {
      success: true, data: page, nextBefore,
      ...(query.get('withCounts') === '1' ? { counts: HQ_BANNER_IMAGE_COUNTS } : {}),
    }
  }
  if (method === 'DELETE' && pathname === '/api/hq/templates/media') {
    return { success: true, data: { deleted: true } }
  }
  if (pathname === '/api/operations/health') {
    /* 確認の時刻は「いま」に寄せる（固定の日時だと全部が「古い確認」になり、★V8 Y4LkX1 の判定が撮れない）。 */
    const now = Date.now()
    const at = new Date(now - 60 * 1000).toISOString()
    return {
      success: true,
      data: {
        ...OPERATION_HEALTH,
        latestRun: OPERATION_HEALTH.latestRun && {
          ...OPERATION_HEALTH.latestRun,
          overallStatus: 'warning', startedAt: at, completedAt: at,
          results: OPERATION_HEALTH.latestRun.results.map((result) => ({ ...result, observedAt: at })),
        },
        overallStatus: 'warning',
        lastCheckedAt: at,
        nextCheckAt: new Date(now + 4 * 60 * 1000).toISOString(),
        serverNow: new Date(now).toISOString(),
      },
    }
  }
  if (pathname === '/api/operations/alerts') {
    return { success: true, data: OPERATION_ALERTS }
  }
  if (pathname === '/api/operations/history') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const limit = Number.isFinite(requestedLimit) && requestedLimit >= 0
      ? requestedLimit
      : OPERATION_HISTORY.length
    return { success: true, data: OPERATION_HISTORY.slice(0, limit) }
  }
  if (pathname === '/api/analytics/cross/results/visual-cross-result-1') {
    return {
      success: true,
      data: {
        id: 'visual-cross-result-1', state: 'available', errorCode: null,
        result: ANALYTICS_CROSS_RESULT, createdAt: '2026-09-03T02:40:00.000Z',
      },
    }
  }
  if (pathname === '/api/analytics/funnels') {
    return {
      success: true,
      data: [{
        // 絵（DkRDE）のファネル。status が無いと「使えるファネルがありません」になって撮れなかった。
        id: 'visual-funnel-1', name: '友だち追加から購入まで', windowDays: 30, status: 'active',
        createdAt: '2026-06-01T09:00:00+09:00',
        currentVersion: { id: 'visual-funnel-version-1', versionNumber: 3, createdAt: '2026-08-20T09:00:00+09:00' },
        migrationState: 'ready',
      }],
    }
  }
  if (pathname === '/api/analytics/funnels/visual-funnel-1/runs/latest') {
    return { success: true, data: ANALYTICS_FUNNEL_RUN }
  }
  if (pathname === '/api/analytics/saved') {
    return { success: true, data: ANALYTICS_SAVED }
  }
  /* R454: 1回送信の履歴と送り直し。型どおりの器で返す。 */
  const reportRuns = /^\/api\/analytics\/report-schedules\/([^/]+)\/runs$/.exec(pathname)
  if (method === 'GET' && reportRuns) {
    return {
      success: true,
      data: {
        schedule: {
          id: reportRuns[1], lineAccountId: 'visual-qa-account', name: '1回送信の見本',
          sections: ['friends'], savedAnalysisIds: [], cadence: 'weekly', weekday: 1,
          monthDay: null, sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 7,
          recipients: [{ kind: 'email', email: 'report@example.com', label: 'report@example.com' }],
          channels: ['email'], alertRules: [], status: 'archived', isOneTime: true,
          nextRunAt: '2026-09-07T00:00:00.000Z', createdBy: null,
          createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-07T01:00:00.000Z',
        },
        runs: [{
          id: 'visual-run-1', scheduleId: reportRuns[1], lineAccountId: 'visual-qa-account',
          scheduledFor: '2026-09-07T00:00:00.000Z', periodFrom: '2026-08-31', periodTo: '2026-09-06',
          timeZone: 'Asia/Tokyo', dataCutoffAt: '2026-09-07T00:00:00.000Z', state: 'failed',
          result: {}, deliveryResults: [{ channel: 'email', recipient: 'report@example.com', status: 'failed', reason: '見本の失敗' }],
          errorCode: 'synthetic_mail_failed', startedAt: '2026-09-07T00:00:00.000Z', completedAt: '2026-09-07T00:01:00.000Z',
        }],
      },
    }
  }
  if (method === 'POST' && /^\/api\/analytics\/report-schedules\/[^/]+\/retry$/.test(pathname)) {
    return { success: true, data: null }
  }
  const savedSnapshots = /^\/api\/analytics\/saved\/([^/]+)\/snapshots$/.exec(pathname)
  if (savedSnapshots) {
    const saved = ANALYTICS_SAVED.find((item) => item.id === savedSnapshots[1])
    return {
      success: true,
      data: saved ? [0, 1, 2].map((offset) => ({
        id: `${saved.id}-snapshot-${offset + 1}`, savedAnalysisId: saved.id,
        analysisVersionId: `${saved.id}-version-${saved.currentVersionNumber}`,
        sourceKind: saved.kind, sourceResultId: `visual-result-${offset + 1}`,
        // 絵（bglah）の履歴：9月・8月・7月の月ごと。締切は翌月1日 6:00。
        periodFrom: `2026-0${9 - offset}-01T00:00:00+09:00`,
        periodTo: `2026-0${9 - offset}-${offset === 1 ? 31 : 30}T00:00:00+09:00`.replace('-07-30', '-07-31'),
        timeZone: 'Asia/Tokyo', dataCutoffAt: `2026-${String(10 - offset).padStart(2, '0')}-01T06:00:00+09:00`,
        state: offset === 2 ? 'partial' : 'available', result: {},
        createdBy: saved.createdBy, createdAt: saved.updatedAt,
      })) : [],
    }
  }
  if (pathname === '/api/conversions/approvals') {
    const status = query.get('status')
    return {
      success: true,
      data: status ? CONVERSION_APPROVALS.filter((item) => item.approvalStatus === status) : CONVERSION_APPROVALS,
    }
  }
  /*
    プール管理（設計 `u3iab3`）。渋谷エリア（本店・渋谷店）とイベント用（2025年イベント）の2つ。
    表示の出し分けで multi_store_hierarchy をオンにしたので、口も中身を返す（空だと「まだプールがありません」で撮れる）。
  */
  if (pathname === '/api/traffic-pools') {
    return { success: true, data: TRAFFIC_POOLS }
  }
  if (/^\/api\/traffic-pools\/[^/]+\/accounts$/.test(pathname)) {
    return { success: true, data: TRAFFIC_POOL_ACCOUNTS.filter((member) => member.poolId === pathname.split('/')[3]) }
  }
  if (pathname === `/api/line-accounts/${ACCOUNT.id}/handovers`) {
    return { success: true, data: [ACCOUNT_HANDOVER] }
  }
  if (pathname === `/api/account-handovers/${ACCOUNT_HANDOVER.id}`) {
    return {
      success: true,
      data: { ...ACCOUNT_HANDOVER, decisions: ACCOUNT_HANDOVER_DECISIONS, unresolvedReviews: 20 },
    }
  }
  if (pathname.startsWith('/api/line-accounts/') && pathname.split('/').length === 4) {
    /*
      1件を返す口。**詳細（★V6 33-3）が読む。**
      資格情報は「入っているか」だけを返す（値そのものは返さない）。
      これが無いと、詳細の資格情報タブが全部「入っていません」になり、
      **実装の不具合に見えてしまう。**
    */
    return {
      success: true,
      data: {
        ...(LINE_ACCOUNTS.find((account) => account.id === pathname.split('/')[3]) ?? LINE_ACCOUNT_DETAIL),
        ...(pathname.split('/')[3] === LINE_ACCOUNT_DETAIL.id ? LINE_ACCOUNT_DETAIL : {}),
      },
    }
  }
  /* 統括ホーム（絵 `JKjsE`）の左のタグの列。 */
  if (method === 'GET' && pathname === '/api/line-account-tags') return { success: true, data: LINE_ACCOUNT_TAGS }
  /* 統括の名前（絵 `JKjsE` の説明・`K7HYu` の欄）。 */
  if (method === 'GET' && pathname === '/api/tenants/me') return { success: true, data: { name: '然 -NEN- 本部' } }
  if (pathname === '/api/line-accounts') {
    /*
      `webhook` を付ける。無いと接続状態カードが「確認中」のままで、
      設計の「正常」と並べたときに実装の差に見えてしまう。
    */
    return { success: true, data: LINE_ACCOUNTS }
  }
  if (pathname === '/api/friends/migrations') {
    return { success: true, data: [UID_MIGRATION_DONE, {
      id: 'visual-uid-run', fromAccountId: ACCOUNT.id, toAccountId: 'visual-qa-account-new',
      purpose: '友だち情報・タグ・配信停止状態を新アカウントへ引き継ぐ', sourceKind: 'csv',
      sourceFilename: 'uid-map-2026-09-06.csv', status: 'review', dryRunRevision: 1,
      counts: { total: 5214, auto: 4982, review: 34, unmatched: 195, conflict: 3, applied: 0, failed: 0 },
      createdBy: STAFF.id, approvedBy: null, createdAt: '2026-09-06T05:20:00.000Z',
      reviewedAt: null, executedAt: null, completedAt: null, rolledBackAt: null, failureReason: null,
    }] }
  }
  // ★V8 L48eY：本移行と照合が終わった履歴（/friends/migrations?tab=uid&run=visual-uid-run-done）。
  if (pathname === '/api/friends/migrations/visual-uid-run-done') {
    return { success: true, data: { ...UID_MIGRATION_DONE, items: [], itemTotal: 0, decisionCounts: { pending: 0, link: 1844, create: 0, exclude: 3 } } }
  }
  if (pathname === '/api/friends/migrations/visual-uid-run') {
    return { success: true, data: {
      id: 'visual-uid-run', fromAccountId: ACCOUNT.id, toAccountId: 'visual-qa-account-new',
      purpose: '友だち情報・タグ・配信停止状態を新アカウントへ引き継ぐ', sourceKind: 'csv',
      sourceFilename: 'uid-map-2026-09-06.csv', status: 'review', dryRunRevision: 1,
      counts: { total: 5214, auto: 4982, review: 34, unmatched: 195, conflict: 3, applied: 0, failed: 0 },
      createdBy: STAFF.id, approvedBy: null, createdAt: '2026-09-06T05:20:00.000Z',
      reviewedAt: null, executedAt: null, completedAt: null, rolledBackAt: null, failureReason: null,
      items: [
        { id: 'uid-item-1', oldUid: 'old_uid_00291', newUid: 'new_uid_00291', candidateName: 'Kyohei Yamamoto', evidenceType: 'operator_csv', classification: 'review', conflictReason: '2アカウントに候補があります', decision: 'pending', result: 'pending', errorMessage: null },
        { id: 'uid-item-2', oldUid: 'old_uid_00412', newUid: 'new_uid_00412', candidateName: '山田 太郎', evidenceType: 'operator_csv', classification: 'conflict', conflictReason: '新旧UIDが別の統合ユーザーに結び付いています', decision: 'pending', result: 'pending', errorMessage: null },
        { id: 'uid-item-3', oldUid: 'old_uid_01180', newUid: null, candidateName: null, evidenceType: 'operator_csv', classification: 'unmatched', conflictReason: '移行先に一致する友だちがいません', decision: 'pending', result: 'pending', errorMessage: null },
      ],
    } }
  }
  if (pathname === '/api/friends/migration-jobs') {
    // ★V8 T9gblG の履歴：確認までの取り込み・反映ずみの書き出し（期限切れでダウンロードの口は出ない）。
    return { success: true, data: [
      { id: 'import-2', kind: 'import', line_account_id: ACCOUNT.id, total_count: 1843, update_count: 48, conflict_count: 2, status: 'previewed', created_by_name: 'Kenta Kawano', created_at: '2026-10-01T01:20:00.000Z' },
      { id: 'export-1', kind: 'export', line_account_id: ACCOUNT.id, row_count: 1840, status: 'completed', created_by_name: 'Kenta Kawano', created_at: '2026-09-30T09:02:00.000Z', expires_at: '2026-10-01T09:02:00.000Z' },
    ] }
  }
  if (pathname === '/api/friend-add-rules') {
    // 検索とフォルダ絞りはサーバ側で全件に効かせる (本物と同じ契約)。
    const q = (query.get('q') ?? '').trim().toLocaleLowerCase('ja-JP')
    const folder = query.get('folder') ?? ''
    const status = query.get('status') ?? ''
    const items = FRIEND_ADD_RULES.items
      // 本物は設定名と流入リンク名の両方を検索する（V8 一覧の検索欄と同じ）。
      .filter((item) => !q
        || item.name.toLocaleLowerCase('ja-JP').includes(q)
        || (item.routeNames ?? []).some((name) => name.toLocaleLowerCase('ja-JP').includes(q)))
      .filter((item) => !folder
        || (folder === '__uncategorized' ? item.folderName == null : item.folderName === folder))
      .filter((item) => !status || item.status === status)
    const counts = new Map()
    for (const item of FRIEND_ADD_RULES.items) {
      counts.set(item.folderName ?? null, (counts.get(item.folderName ?? null) ?? 0) + 1)
    }
    return {
      success: true,
      data: {
        ...FRIEND_ADD_RULES,
        items,
        total: items.length,
        folderCounts: Array.from(counts.entries()).map(([name, count]) => ({ name, count })),
      },
    }
  }
  if (pathname === '/api/friend-add-rules/conflicts') {
    return {
      success: true,
      data: {
        conflicts: [],
        rules: FRIEND_ADD_RULES.items.map((rule) => ({
          id: rule.id,
          name: rule.name,
          priority: rule.priority,
          weekdays: rule.definition.weekdays ?? [],
          timeWindows: rule.definition.timeWindows ?? [],
          friendCondition: rule.definition.friendCondition || null,
          matchedLast28Days: FRIEND_ADD_RULE_MATCHES.get(rule.id) ?? 0,
        })),
      },
    }
  }
  if (/^\/api\/friend-add-rules\/[^/]+$/.test(pathname)) {
    // 未知IDは本物と同じく404にする。何を渡しても同一設定を返すと、
    // 存在しない設定の画面が空にならず実機差異に気づけない (#501-軽)。
    const ruleId = pathname.split('/').pop()
    const found = FRIEND_ADD_RULES.items.find((item) => item.id === ruleId)
    if (!found) return { success: false, error: 'Not found' }
    return {
      success: true,
      data: {
        rule: found,
        options: FRIEND_ADD_RULE_OPTIONS,
        staffNotification: { status: 'connected', reason: null },
      },
    }
  }
  if (pathname === '/api/identity-candidates/detect') {
    return {
      success: true,
      data: query.get('visualState') === 'empty'
        ? IDENTITY_CANDIDATE_DETECTION.empty
        : IDENTITY_CANDIDATE_DETECTION.normal,
    }
  }
  if (pathname === '/api/identity-candidates') {
    if (query.get('visualState') === 'error') return IDENTITY_CANDIDATE_ERROR
    if (query.get('visualState') === 'empty') {
      return { success: true, data: IDENTITY_CANDIDATE_LISTS.empty }
    }
    const kind = query.get('kind') === 'ec_member' ? 'ec_member' : 'friend_duplicate'
    return { success: true, data: IDENTITY_CANDIDATE_LISTS[kind] }
  }
  const identityCandidate = /^\/api\/identity-candidates\/([^/]+)$/.exec(pathname)
  if (identityCandidate) {
    if (query.get('visualState') === 'error') return IDENTITY_CANDIDATE_ERROR
    const candidate = identityCandidate[1] === IDENTITY_CANDIDATE_EC.id
      ? IDENTITY_CANDIDATE_EC
      : IDENTITY_CANDIDATE_FRIEND
    return { success: true, data: candidate }
  }
  const friendDuplicate = /^\/api\/friends\/duplicates\/([^/]+)$/.exec(pathname)
  if (friendDuplicate) {
    if (query.get('visualState') === 'error') return IDENTITY_CANDIDATE_ERROR
    return { success: true, data: FRIEND_DUPLICATE_DETAIL }
  }
  const mergedPerson = /^\/api\/friends\/people\/([^/]+)$/.exec(pathname)
  if (mergedPerson) {
    if (query.get('visualState') === 'error') return MERGED_PERSON_ERROR
    if (query.get('visualState') === 'empty') {
      return { success: true, data: MERGED_PERSON_EMPTY }
    }
    return { success: true, data: MERGED_PERSON_DETAIL }
  }
  if (pathname === '/api/dashboard/preferences') {
    /*
      設計 `vUXKb` の並び。**「友だちの状態」は既定では出ない**カードだが、
      設計の絵では出ている（運用者が出す設定にした状態）。ここでその設定を
      返して、設計と同じ並びで撮れるようにする。
      `null` を返すと組み込みの既定になり、絵が変わる。
    */
    return { success: true, data: DASHBOARD_PREFERENCES }
  }
  // M (今後の予定)・L (#824 数字の出どころ)の見本。型どおりの名前で返す。
  if (pathname === '/api/dashboard/upcoming') return { success: true, data: DASHBOARD_UPCOMING }
  if (pathname === '/api/dashboard/delivery-failure-origins') {
    return { success: true, data: DASHBOARD_DELIVERY_FAILURE_ORIGINS }
  }
  // 設計と画像で比べるための中身。空の表しか描けないと、
  // 「空の状態」だけを見て一致したと言えてしまう。
  // 受信箱（設計 `xGLVe`）。空で返すと一覧も吹き出しも出ない。
  const chat = pathname.match(/^\/api\/chats\/([^/]+)$/)
  if (chat) {
    // 一覧と同じ行を返す。`{items,total}` のままだと、開いた会話の名前が
    // `undefined` になり `friendName.charAt(0)` で落ちる。
    const row = CHATS.find((c) => c.id === chat[1])
    if (row) {
      const friend = FRIEND_DETAILS[row.friendId]
      return {
        success: true,
        data: {
          ...row,
          friendRealName: friend?.realName ?? null,
          isAttention: friend?.metadata?.__attention === '1',
          messages: FRIEND_MESSAGES[row.friendId] ?? [],
        },
      }
    }
  }
  const detail = pathname.match(/^\/api\/friends\/([^/]+)$/)
  if (detail && FRIEND_DETAILS[detail[1]]) return { success: true, data: FRIEND_DETAILS[detail[1]] }
  if (/^\/api\/friends\/[^/]+\/mileage$/.test(pathname)) return { success: true, data: FRIEND_MILEAGE }
  if (pathname === '/api/friends/friend-1/fields') {
    const values = ['1988-04-12', '2026-12-31', '2026-09-15', 'プレミアム']
    return {
      success: true,
      data: {
        items: FRIEND_FIELDS.map((field, index) => ({ ...field, value: values[index] })),
        hiddenPersonalCount: 0,
      },
    }
  }
  /*
   * 友だち詳細（★V8 Q5F2QE・JCDRm）の履歴・次の予定・回答。friend-1 だけ。
   * 絵の「最近の履歴」3行・「進行中」1行・回答カード2枚と同じ形にする（2026-10-07）。
   */
  if (pathname === '/api/friends/friend-1/timeline') {
    const item = (id, type, summary, occurredAt, source, account = { id: 'visual-qa-account', name: '然-NEN-TEST' }) => ({
      id, type, summary, status: null, source, occurredAt, lineAccount: account,
    })
    const message = (id) => ({ kind: 'message', id, parentId: null, url: null })
    const items = [
      item('tl-1', 'message_received', '『秋の新商品はいつ届きますか？』', '2026-10-01T10:12:00+09:00', message('msg-1')),
      item('tl-2', 'message_sent', '『10月5日に発送予定です』（Kenta）', '2026-10-01T10:20:00+09:00', message('msg-2')),
      item('tl-3', 'url_clicked', '一斉配信『秋の新商品のお知らせ』', '2026-09-30T18:02:00+09:00', null),
      item('tl-4', 'form_submitted', '『ご愛犬アンケート』に回答', '2026-09-30T14:30:00+09:00', { kind: 'form_submission', id: 'submission-1', parentId: 'form-1', url: null }),
      item('tl-5', 'scenario_started', '『新規登録7日間フォロー』', '2026-09-30T09:00:00+09:00', null),
      item('tl-6', 'tag_change', 'タグ『VIP』が付いた（購入3回で自動）', '2026-09-26T12:40:00+09:00', null),
      item('tl-7', 'ec_order', '定期便 ¥6,200', '2026-09-26T12:38:00+09:00', { kind: 'ec_order', id: 'NEN-12492', parentId: null, url: 'https://example.com/orders/NEN-12492' }, { id: 'ec', name: 'EC' }),
    ]
    return { success: true, data: { items: query.get('cursor') ? [] : items, nextCursor: query.get('cursor') ? null : 'tl-cursor-1' } }
  }
  if (pathname === '/api/friends/friend-1/upcoming') {
    return {
      success: true,
      data: {
        nextBooking: { kind: 'booking', id: 'bk-1', title: 'トリミング（小型犬）', startsAt: '2026-10-04T10:00:00+09:00', status: 'confirmed' },
        nextBookingError: false,
        nextAutoDelivery: { kind: 'scenario', id: 'scenario-1', name: '新規登録7日間フォロー', scheduledAt: '2026-10-01T10:00:00+09:00' },
        nextAutoDeliveryError: false,
      },
    }
  }
  if (pathname === '/api/friends/friend-1/form-submissions') {
    const items = [
      {
        id: 'fs-1', formId: 'form-1', formName: 'ご愛犬アンケート', createdAt: '2026-09-30T14:30:00+09:00',
        fields: [{ name: 'dog_name', label: '犬の名前' }, { name: 'age', label: '年齢' }, { name: 'concern', label: '気になること' }],
        data: { dog_name: 'こむぎ', age: '3歳', concern: '最近ごはんを残す' },
      },
      {
        id: 'fs-2', formId: 'form-2', formName: '定期便の申し込み', createdAt: '2026-09-12T10:05:00+09:00',
        fields: [{ name: 'interval', label: 'お届け間隔' }, { name: 'weekday', label: 'お届け曜日' }],
        data: { interval: '2週間', weekday: '土曜日', 配送メモ: '置き配希望' },
      },
    ]
    return { success: true, data: { items: query.get('cursor') ? [] : items, total: 2, nextCursor: query.get('cursor') ? null : 'fs-cursor-1' } }
  }
  if (pathname === '/api/friends/friend-1/rich-menu') {
    return { success: true, data: { id: 'rich-menu-main', name: '通常メニュー・予約', isDefault: false } }
  }
  const messages = pathname.match(/^\/api\/friends\/([^/]+)\/messages$/)
  if (messages) {
    // 設計 `xGLVe` のトーク欄。載っていない友だちは空で返す（実際に空の人もいる）。
    return { success: true, data: FRIEND_MESSAGES[messages[1]] ?? [] }
  }
  /*
   * テンプレート選択（設計 `NfgOs` / `NWbuF`）。空だと選ぶものが1つも出ない。
   *
   * 実Workerは口を2つに分けている。`page` か `limit` が付くとページ区切りの
   * `{ items, total, limit, sort }` を返し、無ければ配列のまま返す
   * （`apps/worker/src/routes/templates.ts`）。受信箱のテンプレート選択は
   * 区切り形だけを読むので、ここも同じ分け方にする。ずれていると
   * `items` が undefined になって画面ごと落ちる。
   */
  /* テンプレートの種類タブの件数（設計 v19Ivv：カルーセル4・リッチメッセージ3・クーポン2・リサーチ1）。無いとタブの幅が変わる。 */
  if (pathname === '/api/broadcast-message-assets/counts') {
    return { success: true, data: { card_message: 4, rich_message: 3, coupon: 2, research: 1 } }
  }
  /* テンプレートの使っている所（設計 Z0g3si：一斉配信・自動応答から先に並ぶ）。無いと削除できない窓が空になる。 */
  if (/^\/api\/templates\/[^/]+\/usages$/.test(pathname)) {
    return {
      success: true,
      data: {
        broadcasts: [{ broadcastId: 'bc-1', title: '9月の予約リマインド', status: 'scheduled', scheduledAt: '2026-09-30T09:00:00+09:00', templateVersionNumber: 2, referenceMode: 'fixed' }],
        autoReplies: [{ id: 'ar-2', keyword: '予約変更のお問い合わせ', lineAccountId: null, templateVersion: null }],
        scenarioSteps: [{ scenarioId: 'scenario-1', scenarioName: '予約フォロー', stepId: 'step-1', stepOrder: 1, templateVersion: null }],
        reminderSteps: [{ reminderId: 'reminder-1', reminderName: '来店前日（あおい）', stepId: 'rstep-1' }],
        reminderEnrollments: [],
        automations: [],
        richMenuAreas: [],
        trackedLinks: [],
      },
    }
  }
  if (pathname === '/api/templates') {
    if (query.has('page') || query.has('limit')) {
      const q = query.get('q')?.toLowerCase()
      const folderId = query.get('folder_id')
      const messageType = query.get('message_type')
      const filtered = TEMPLATES.filter((item) =>
        (messageType ? item.messageType === messageType : true)
        && (folderId ? (folderId === '__none__' ? !item.folderId : item.folderId === folderId) : true)
        && (q ? item.name.toLowerCase().includes(q) || item.messageContent.toLowerCase().includes(q) : true))
      const limit = Math.max(1, Number(query.get('limit') ?? 100) || 100)
      const page = Math.max(1, Number(query.get('page') ?? 1) || 1)
      const items = filtered.slice((page - 1) * limit, page * limit)
      const folderCounts = query.get('folder_counts') === '1'
        ? filtered.reduce((acc, item) => {
            const key = item.folderId ?? ''
            acc[key] = (acc[key] ?? 0) + 1
            return acc
          }, {})
        : undefined
      return {
        success: true,
        data: {
          items,
          total: filtered.length,
          limit,
          sort: [{ field: 'created_at', direction: 'desc' }, { field: 'id', direction: 'asc' }],
          ...(folderCounts ? { folderCounts } : {}),
        },
      }
    }
    return { success: true, data: TEMPLATES }
  }
  const templateDetail = /^\/api\/templates\/(template-\d+)$/.exec(pathname)
  if (templateDetail) {
    const template = TEMPLATES.find((item) => item.id === templateDetail[1])
    if (template) {
      /* 設計 UTbi1・Z0g3si：「予約前日のご案内」は 11 か所で使われている（版を決めた一斉配信と自動応答を含む）。 */
      const usedBy = template.id === 'template-1' ? {
        broadcasts: [{ broadcastId: 'bc-1', title: '9月の予約リマインド', status: 'scheduled', scheduledAt: '2026-09-30T09:00:00+09:00', templateVersionNumber: 2, referenceMode: 'fixed' }],
        autoReplies: [{ id: 'ar-2', keyword: '予約変更のお問い合わせ', matchType: 'contains', lineAccountId: 'visual-qa-account', templateVersion: 2 }],
        scenarioSteps: [{ scenarioId: 'scenario-1', scenarioName: '予約フォロー', stepId: 'step-booking-1', stepOrder: 1, templateVersion: null }],
        reminderSteps: [
          { reminderId: 'reminder-1', reminderName: '来店前日（あおい）', stepId: 'rstep-1' },
          ...Array.from({ length: 7 }, (_, i) => ({ reminderId: `reminder-${i + 2}`, reminderName: `来店前日（店舗${i + 2}）`, stepId: `rstep-${i + 2}` })),
        ],
        automations: [], richMenuAreas: [], trackedLinks: [],
      } : template.id === 'template-9' ? {
        scenarioSteps: [{ scenarioId: 'scenario-welcome', scenarioName: '新規登録7日間フォロー', stepId: 'step-1', stepOrder: 1, templateVersion: 3 }],
        autoReplies: [{ id: 'auto-reply-document', keyword: '資料請求', matchType: 'exact', lineAccountId: 'visual-qa-account', templateVersion: 3 }],
        automations: [{ id: 'automation-inbox-favorite', name: '受信箱の「よく使う」（担当3人が登録）', eventType: 'inbox_favorite' }],
        reminderSteps: [], richMenuAreas: [], trackedLinks: [],
        broadcasts: [
          { broadcastId: 'broadcast-autumn', title: '秋の会員向け案内', status: 'scheduled', scheduledAt: '2026-10-01T10:00:00+09:00', templateVersionNumber: 3, referenceMode: 'fixed' },
          { broadcastId: 'broadcast-august', title: '8月の案内', status: 'sent', scheduledAt: null, templateVersionNumber: 2, referenceMode: 'fixed' },
        ],
      } : {
        autoReplies: [], automations: [], scenarioSteps: [], reminderSteps: [], richMenuAreas: [], trackedLinks: [], broadcasts: [],
      }
      return {
        success: true,
        data: {
          ...template,
          accountId: 'visual-qa-account',
          question: null,
          questionStatus: 'draft',
          usedBy,
          hasDraft: false,
          publishedVersion: 3,
          publishedAt: '2026-09-10T11:02:00+09:00',
          draftRevision: 0,
        },
      }
    }
  }
  // #820: 版の履歴。新しい版から返す。status は in_use / reserved / past。
  const templateVersions = /^\/api\/templates\/(template-\d+)\/versions$/.exec(pathname)
  if (templateVersions) {
    return {
      success: true,
      data: [
        { versionNumber: 3, status: 'in_use', messageType: 'text', messageContent: 'いまの本文です。内容をご確認ください。', carouselActions: null, carouselTapLimitMode: null, carouselTapLimitText: null, question: null, questionStatus: null, effectiveFrom: null, createdAt: '2026-09-10T11:02:00+09:00' },
        { versionNumber: 2, status: 'past', messageType: 'text', messageContent: '前の本文です。内容をご確認ください。', carouselActions: null, carouselTapLimitMode: null, carouselTapLimitText: null, question: null, questionStatus: null, effectiveFrom: null, createdAt: '2026-08-01T10:00:00+09:00' },
      ],
    }
  }
  // #820: この版に戻す。過去の版は変えず、その中身で新しい版を作る。
  const templateRevert = method === 'POST' && /^\/api\/templates\/(template-\d+)\/revert$/.exec(pathname)
  if (templateRevert) {
    return { success: true, data: { id: templateRevert[1], publishedVersion: 4, hasDraft: false } }
  }
  if (pathname === '/api/account-settings/test-recipients') {
    return { success: true, data: TEMPLATE_TEST_RECIPIENTS }
  }
  if (pathname === '/api/account-settings/test-recipient-login-users') {
    /*
     * 無いと既定の器（`{items,total,page,limit}`）が返り、
     * `loginUsers.filter` で「画面を表示できませんでした」になっていた。
     * 本物は配列を返す（`account-settings.ts`）。
     */
    return { success: true, data: TEST_RECIPIENT_LOGIN_USERS }
  }
  // 管理画面の保存・保管・削除の流れ（#503 L5）。絵の検証用に成功だけ返す。
  /*
   * 配布URLの土台。無いと既定の器（`{items,total,page,limit}`）が返り、
   * 画面が器に `.replace` して白画面になっていた。
   * 本物は文字列か null を返す（`account-settings.ts`）。
   */
  if (pathname === '/api/account-settings/link-base-url') {
    return { success: true, data: null }
  }
  if (pathname === '/api/account-settings/tracked-link-base-url') {
    return { success: true, data: null }
  }
  // 管理画面の保存・保管・削除の流れ（#503 L5）。絵の検証用に成功だけ返す。
  if (method === 'POST' && pathname === '/api/forms/drafts') {
    return { success: true, data: { id: 'form-draft-qa', isActive: false } }
  }
  if (method === 'PUT' && pathname === `/api/forms/${FORM_DETAIL.id}`) {
    return { success: true, data: { id: FORM_DETAIL.id } }
  }
  if (method === 'POST' && pathname === `/api/forms/${FORM_DETAIL.id}/archive`) {
    return {
      success: true,
      data: {
        status: 'archived',
        archivedAt: '2026-08-26T00:00:00.000Z',
        retainedSubmissionCount: 0,
        retainedOpenCount: 0,
        retainedReferenceCount: 0,
        answerUrlUnavailable: true,
      },
    }
  }
  if (method === 'DELETE' && pathname === `/api/forms/${FORM_DETAIL.id}`) {
    return { success: true, data: null }
  }
  // P: 公開前の試し合言葉の発行。生の値はこの応答でしか返らない。
  const formTestToken = method === 'POST' && /^\/api\/forms\/([^/]+)\/test-token$/.exec(pathname)
  if (formTestToken) {
    return { success: true, data: { token: 'test-token-qa', expiresAt: '2026-09-28T15:00:00.000+09:00' } }
  }
  // R230: フォーム全体の複製。絵の検証用に新しい下書き（受付停止）を返す。
  const formDuplicate = method === 'POST' && /^\/api\/forms\/([^/]+)\/duplicate$/.exec(pathname)
  if (formDuplicate) {
    return { success: true, data: { id: 'form-duplicate-qa', isActive: false } }
  }
  /*
    管理者確認（担当未割り当て）の口。実口（`forms.ts`）と同じく配列で返す。
    既定の `{items,total,…}` に落ちると、画面が配列として読めず
    `e is not iterable` で落ちる（2026-10-03 点検）。
    見本のフォームはすべて担当付きなので空が正しい。
  */
  if (pathname === '/api/forms/unassigned') {
    return { success: true, data: [] }
  }
  if (pathname === '/api/forms') {
    return { success: true, data: query.get('with_list_summary') === '1' ? FORM_LIST : FORMS }
  }
  /* V8「集まった回答」の絵のフォーム（v0SbYR・MKQyJ）。form-1 とは別の ID。 */
  if (pathname === `/api/forms/${FORM_VISIT_DETAIL.id}`) return { success: true, data: FORM_VISIT_DETAIL }
  if (pathname === `/api/forms/${FORM_VISIT_DETAIL.id}/submissions`) return { success: true, data: FORM_VISIT_SUBMISSIONS }
  if (pathname === `/api/forms/${FORM_DETAIL.id}`) return { success: true, data: FORM_DETAIL }
  const formSubmissions = new RegExp(`^/api/forms/${FORM_DETAIL.id}/submissions$`).test(pathname)
  if (formSubmissions) {
    /*
     * 互換用の古い形（ページ分けなし）は配列だけを返す。**実口と同じく上限200件**
     * （`MAX_LIST_LIMIT`）。#722 の前はここが 500 で、実口は 200 で切っていた。
     * モックで確かめた人が「500件来る」と誤解する形だった。
     */
    if (query.get('page') === null && query.get('limit') === null) {
      return { success: true, data: FORM_SUBMISSIONS.items.slice(0, 200) }
    }
    const page = Number.parseInt(query.get('page') ?? '1', 10)
    const limit = Number.parseInt(query.get('limit') ?? '20', 10)
    const safePage = Number.isInteger(page) && page > 0 ? page : 1
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 20
    const start = (safePage - 1) * safeLimit
    return { success: true, data: { ...FORM_SUBMISSIONS, items: FORM_SUBMISSIONS.items.slice(start, start + safeLimit), page: safePage, limit: safeLimit } }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'form') {
    // R25: 作った箱も同じプロセス内では返す（webinar と同じ流儀）。
    // 板 `I3L41O`：未分類は3件（すべて18＝来店・予約6＋資料請求4＋アンケート5＋未分類3）。
    return { success: true, data: formFolders, unfiledCount: 3 }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'template') {
    // 本物の口はフォルダごとの件数（itemCount）と未分類の件数（unfiledCount）も返す。無いとフォルダの脇の数が出ない。
    return {
      success: true,
      data: TEMPLATE_FOLDERS.map((folder) => ({ ...folder, itemCount: folder.templateCount })),
      unfiledCount: TEMPLATES.filter((item) => item.folderId === null).length,
    }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'broadcast') {
    // 板 `NtCE3`：未分類は `folderId: null` の5件。
    return { success: true, data: BROADCAST_FOLDERS, unfiledCount: BROADCASTS.filter((broadcast) => !broadcast.folderId).length }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'scenario') {
    // 板 `axFrW`：未分類は `folderId: null` の1件（会員更新リマインド）。
    return { success: true, data: SCENARIO_FOLDERS, unfiledCount: FRIEND_SCENARIOS.filter((scenario) => !scenario.folderId).length }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'reminder') {
    // 板 `apLqS`：未分類は `folderId: null` の2件（お誕生日のお祝い・未返信3日後フォロー）。
    return { success: true, data: REMINDER_FOLDERS, unfiledCount: REMINDERS.filter((reminder) => !reminder.folderId).length }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'friend_field') {
    return { success: true, data: FRIEND_FIELD_FOLDERS }
  }
  if (pathname === '/api/friend-fields') {
    // 機能4は利用人数つきの一覧を要求する。他機能の選択肢は従来データを保つ。
    return { success: true, data: query.get('withUsage') === '1' ? FRIEND_ATTRIBUTE_FIELDS : FRIEND_FIELDS }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'rich_menu') {
    // 板 `rZEGN`：通常・会員向け・キャンペーン＋未分類（各1件）。
    return { success: true, data: RICH_MENU_FOLDERS, unfiledCount: RICH_MENU_GROUPS.filter((group) => !group.folderId).length }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'webhook') {
    // 板 `ZSbFY`：送り先の箱。送り先にフォルダの列がまだ無いので、件数（itemCount）は本物と同じく返さない（#730）。
    return {
      success: true,
      data: [
        { id: 'whf-member', kind: 'webhook', name: '顧客・会員', parentId: null, displayOrder: 1, color: '#2563eb' },
        { id: 'whf-order', kind: 'webhook', name: '注文・在庫', parentId: null, displayOrder: 2, color: '#059669' },
        { id: 'whf-notify', kind: 'webhook', name: '通知', parentId: null, displayOrder: 3, color: '#ea580c' },
      ],
    }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'automation') {
    // 板 `LWQXd`：ルールの箱。ルールにフォルダの列がまだ無いので、件数（itemCount）は本物と同じく返さない（#730）。
    return {
      success: true,
      data: [
        { id: 'auf-booking', kind: 'automation', name: '予約', parentId: null, displayOrder: 1, color: '#2563eb' },
        { id: 'auf-purchase', kind: 'automation', name: '購入・フォロー', parentId: null, displayOrder: 2, color: '#059669' },
        { id: 'auf-inquiry', kind: 'automation', name: '問い合わせ', parentId: null, displayOrder: 3, color: '#ea580c' },
      ],
    }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'common_action') {
    // 板 `LnGNw`：共通アクションの箱。共通アクションにフォルダの列がまだ無いので、件数（itemCount）は返さない（#730）。
    return {
      success: true,
      data: [
        { id: 'caf-purchase', kind: 'common_action', name: '購入', parentId: null, displayOrder: 1, color: '#2563eb' },
        { id: 'caf-booking', kind: 'common_action', name: '予約・申込', parentId: null, displayOrder: 2, color: '#059669' },
        { id: 'caf-follow', kind: 'common_action', name: 'フォロー', parentId: null, displayOrder: 3, color: '#ea580c' },
      ],
    }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'auto_reply') {
    // 板 `uE9gf`：未分類は `folderId: null` の1件（旧キーワードルール）。
    return { success: true, data: AUTO_REPLY_FOLDERS, unfiledCount: AUTO_REPLIES.filter((rule) => !rule.folderId).length }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'common_var') {
    // 板 `FM94M`：未分類は0件。
    return { success: true, data: commonVarFolders, unfiledCount: COMMON_VARS.filter((variable) => !variable.folderId).length }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'media') {
    const visibleMedia = MEDIA_ITEMS.filter((item) => item.archivedAt == null)
    return {
      success: true,
      data: mediaFolders.map((folder) => ({
        ...folder,
        itemCount: visibleMedia.filter((item) => item.folderId === folder.id).length,
      })),
      unfiledCount: visibleMedia.filter((item) => item.folderId == null).length,
    }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'event') {
    // 板 `e2ekFu`：教室・体験・相談会＋未分類（ADMIN_EVENTS の folderId から数える）。
    return { success: true, data: EVENT_FOLDERS, unfiledCount: ADMIN_EVENTS.filter((event) => !event.folderId).length }
  }
  if (pathname === '/api/folders' && query.get('kind') === 'webinar') {
    const accountId = query.get('account_id')
    return {
      success: true,
      data: webinarFolders.filter((folder) => !accountId || folder.accountId === accountId),
    }
  }
  if (pathname === '/api/booking/admin/settings') {
    return { success: true, data: BOOKING_SETTINGS }
  }
  /* この日だけの休み（板 `d5fmnM` の10/12 研修のため）。器は `{success,data:{items}}`。 */
  if (pathname === '/api/booking/admin/exceptions') {
    return { success: true, data: BOOKING_EXCEPTIONS }
  }
  if (pathname === '/api/auto-replies') return { success: true, data: AUTO_REPLIES }
  if (pathname === '/api/auto-replies/conflicts') {
    return { success: true, data: AUTO_REPLY_CONFLICT_SUMMARY }
  }
  if (pathname === '/api/auto-reply-runs') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 20
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    return {
      success: true,
      data: {
        ...AUTO_REPLY_RUNS,
        items: AUTO_REPLY_RUNS.items.slice(offset, offset + limit),
        /* 板 nWmLg の「214件中 1〜20件」とページ送り。見本の行は5件だけだが、件数は絵の数を返す。 */
        pagination: { total: Math.max(AUTO_REPLY_RUNS.items.length, AUTO_REPLY_RUNS.pagination.total), limit, offset },
      },
    }
  }
  if (pathname === '/api/auto-replies/ar-new/draft') return { success: true, data: AUTO_REPLY_NEW_DRAFT }
  if (pathname === '/api/auto-replies/ar-new/conflicts') return { success: true, data: { conflicts: AUTO_REPLY_NEW_CONFLICTS, source: 'draft' } }
  if (pathname === '/api/auto-replies/ar-new') return { success: true, data: AUTO_REPLY_NEW_LIVE }
  if (/^\/api\/auto-replies\/[^/]+\/draft$/.test(pathname)) {
    return { success: true, data: AUTO_REPLY_PUBLISH_DRAFT }
  }
  // かんたんに作る（G4GejG）の下書きは「営業時間外の自動返信」1件と重なる（絵の帯）。
  if (pathname === '/api/auto-replies/ar-quick/conflicts') return { success: true, data: { conflicts: AUTO_REPLY_NEW_CONFLICTS.filter((c) => c.autoReplyId === 'ar-1'), source: 'draft' } }
  if (/^\/api\/auto-replies\/[^/]+\/conflicts$/.test(pathname)) {
    return { success: true, data: { conflicts: AUTO_REPLY_PUBLISH_CONFLICTS } }
  }
  const autoReplyOne = /^\/api\/auto-replies\/([^/]+)$/.exec(pathname)
  if (autoReplyOne) {
    const found = AUTO_REPLIES.find((item) => item.id === autoReplyOne[1])
    return found ? { success: true, data: found } : { success: false, error: 'Not found' }
  }
  if (pathname === '/api/reminders') {
    const usesListContract = ['page', 'limit', 'q', 'folderId', 'status'].some((key) => query.has(key))
    if (!usesListContract) return { success: true, data: REMINDERS }
    const requestedPage = Number.parseInt(query.get('page') ?? '', 10)
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 200) : 20
    const q = (query.get('q') ?? '').trim().toLocaleLowerCase('ja-JP')
    const folderId = query.get('folderId') ?? ''
    const status = query.get('status') ?? ''
    const filtered = REMINDERS.filter((reminder) => {
      if (q && !`${reminder.name} ${reminder.description ?? ''}`.toLocaleLowerCase('ja-JP').includes(q)) return false
      if (folderId === '__unfiled__' && reminder.folderId) return false
      if (folderId && folderId !== '__unfiled__' && reminder.folderId !== folderId) return false
      if (status === 'failed' && !reminder.hasFailure) return false
      if (status === 'draft' && reminder.lifecycleStatus !== 'draft') return false
      if (status === 'active' && (reminder.lifecycleStatus === 'draft' || reminder.lifecycleStatus === 'stopped' || !reminder.isActive)) return false
      if (status === 'stopped' && reminder.lifecycleStatus !== 'stopped' && reminder.isActive) return false
      return true
    }).sort((left, right) => (
      (left.displayOrder ?? 0) - (right.displayOrder ?? 0)
      || right.createdAt.localeCompare(left.createdAt)
      || left.id.localeCompare(right.id)
    ))
    const offset = (page - 1) * limit
    return {
      success: true,
      data: {
        items: filtered.slice(offset, offset + limit),
        total: filtered.length,
        limit,
        sort: [
          { field: 'displayOrder', direction: 'asc' },
          { field: 'createdAt', direction: 'desc' },
          { field: 'id', direction: 'asc' },
        ],
      },
    }
  }
  /*
   * 対象者の画面が読む口（条件・人数・顔ぶれ・数え直し）の見本。
   * 下書きは要求のIDをそのまま返す。固定IDだと別IDの撮影が
   * 照合に落ち、F-1（条件を足す・変える・消す・人数がすぐ変わる・
   * 顔ぶれを見る）を確かめられない。人数・顔ぶれ・数え直しは
   * `REMINDER_VALIDATE` / `REMINDER_AUDIENCE` が固定で返す。
   */
  if (/^\/api\/reminders\/[^/]+\/draft$/.test(pathname)) {
    const draftId = decodeURIComponent(pathname.split('/')[3] ?? '')
    if (draftId === 'reminder-new') return { success: true, data: { ...REMINDER_NEW_DRAFT } }
    return { success: true, data: { ...REMINDER_DRAFT, reminderId: draftId || REMINDER_DRAFT.reminderId } }
  }
  const reminderOne = /^\/api\/reminders\/([^/]+)$/.exec(pathname)
  if (reminderOne) {
    const found = REMINDERS.find((item) => item.id === reminderOne[1])
    /*
      **`steps` を通で足す。** 編集画面は `api.reminders.get()` の返事を
      `Reminder & { steps: ReminderStep[] }` として読み、`steps.length` を
      すぐ見る。付けずに返すと画面ごと落ちる。
    */
    return found
      ? { success: true, data: { ...found, steps: reminderStepsOf(found) } }
      : { success: false, error: 'Not found' }
  }
  /*
    ステップは**通で返す**。一覧の既定（`{items,total,page,limit}`）を返すと
    編集画面が `steps` を回そうとして落ちる。機能5で2度やった。
  */
  const reminderSteps = /^\/api\/reminders\/([^/]+)\/steps$/.exec(pathname)
  if (reminderSteps) {
    const reminder = REMINDERS.find((item) => item.id === reminderSteps[1])
    return { success: true, data: reminder ? reminderStepsOf(reminder) : [] }
  }
  const reminderRegistrants = /^\/api\/reminders\/([^/]+)\/registrants$/.exec(pathname)
  if (reminderRegistrants) {
    /*
     * 無いと既定の器が返り、登録者の欄が
     * 「読み込めませんでした」になっていた。本物は配列（`reminders.ts`）。
     */
    return { success: true, data: REMINDER_REGISTRANTS }
  }
  if (pathname === '/api/friend-add-runs') {
    const status = query.get('status')
    const ruleId = query.get('rule_id')
    const kind = query.get('kind')
    const attribution = query.get('attribution')
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 20
    const items = FRIEND_ADD_RUNS.items
      .filter((item) => !status || item.status === status)
      .filter((item) => !ruleId || item.rule?.id === ruleId)
      .filter((item) => !kind || item.friendKind === kind)
      .filter((item) => !attribution || item.attribution?.status === attribution)
      .slice(0, limit)
    return { success: true, data: { ...FRIEND_ADD_RUNS, items } }
  }
  const friendAddRunDetail = /^\/api\/friend-add-runs\/([^/]+)$/.exec(pathname)
  if (friendAddRunDetail) {
    /*
     * 無いと既定の器が返り、`detail.actionRuns.filter` で
     * 「画面を表示できませんでした」になっていた。
     * 本物は `actionRuns` まで含めた1件（`friend-add-rules.ts`）。
     * 未知IDは本物と同じく失敗にする。
     */
    if (friendAddRunDetail[1] !== FRIEND_ADD_RUN_DETAIL.id) return { success: false, error: '実行結果が見つかりません' }
    return { success: true, data: FRIEND_ADD_RUN_DETAIL }
  }
  if (pathname === '/api/scenarios') {
    const requestedPage = Number.parseInt(query.get('page') ?? '', 10)
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 200) : 50
    const offset = (page - 1) * limit
    const nameQuery = (query.get('query') ?? '').trim().toLocaleLowerCase('ja-JP')
    const active = query.get('active')
    const createdFrom = query.get('createdFrom')
    const folderId = query.get('folderId')
    const filtered = FRIEND_SCENARIOS
      .filter((item) => !nameQuery || item.name.toLocaleLowerCase('ja-JP').includes(nameQuery))
      .filter((item) => active !== '0' || !item.isActive)
      .filter((item) => !createdFrom || item.createdAt >= createdFrom)
      .filter((item) => !folderId
        || (folderId === '__unfiled__' ? !item.folderId : item.folderId === folderId))
    return {
      success: true,
      data: {
        items: filtered.slice(offset, offset + limit),
        total: filtered.length,
        limit,
        sort: [
          { field: 'createdAt', direction: 'desc' },
          { field: 'id', direction: 'desc' },
        ],
      },
    }
  }
  /* 板 `ARuZ4`（停止中）：止めたシナリオは購読中 0 人。一覧に出ない ID（scenario-0-paused）でだけ返す。 */
  if (pathname === '/api/scenarios/scenario-0-paused/stats') return { success: true, data: { ...SCENARIO_STATS, activeNow: 0, paused: 116 } }
  if (/^\/api\/scenarios\/[^/]+\/stats$/.test(pathname)) return { success: true, data: SCENARIO_STATS }
  if (/^\/api\/scenarios\/[^/]+\/simulate$/.test(pathname)) return { success: true, data: SCENARIO_SIMULATION }
  if (/^\/api\/scenarios\/[^/]+\/runs$/.test(pathname)) return { success: true, data: SCENARIO_RUNS }
  // 板 `PMLkX`：開始のきっかけの箱と、通ごとの届く日時の例。
  if (/^\/api\/scenarios\/[^/]+\/triggers$/.test(pathname)) return { success: true, data: SCENARIO_TRIGGERS }
  if (/^\/api\/scenarios\/[^/]+\/preview$/.test(pathname)) return { success: true, data: SCENARIO_PREVIEW }
  if (/^\/api\/scenarios\/[^/]+\/draft$/.test(pathname)) return { success: true, data: SCENARIO_DRAFT }
  const scenarioActions = pathname.match(/^\/api\/scenarios\/([^/]+)\/actions$/)
  if (scenarioActions) {
    return {
      success: true,
      data: SCENARIO_ACTIONS
        .filter((action) => action.scenarioId === scenarioActions[1])
        .sort((left, right) => left.sortOrder - right.sortOrder),
    }
  }
  // R250: 終了後の移動先にしているシナリオの一覧。型どおり `{items,total}`。
  const scenarioMoveReferrers = pathname.match(/^\/api\/scenarios\/([^/]+)\/move-referrers$/)
  if (scenarioMoveReferrers) return { success: true, data: { items: [], total: 0 } }
  const scenario = pathname.match(/^\/api\/scenarios\/([^/]+)$/)
  if (scenario) {
    // 通を配列で返す。`{items,total}` のままだと `scenario.steps` で落ちる。
    /* 板 `ARuZ4`：「新規登録7日間フォロー」を止めた形（停止中・最後の1通の後は1つ前のシナリオを再開）。一覧には出さない。 */
    if (scenario[1] === 'scenario-0-paused') {
      const paused = { ...FRIEND_SCENARIOS[0], id: 'scenario-0-paused', isActive: false, onCompleteMode: 'resume_previous' }
      return { success: true, data: { ...paused, steps: SCENARIO_STEPS.map((step) => ({ ...step, scenarioId: paused.id })) } }
    }
    const row = FRIEND_SCENARIOS.find((r) => r.id === scenario[1]) ?? FRIEND_SCENARIOS[0]
    return { success: true, data: { ...row, steps: SCENARIO_STEPS.map((step) => ({ ...step, scenarioId: row.id })) } }
  }
  if (pathname === '/api/broadcasts/saved-views') {
    return { success: true, data: BROADCAST_SAVED_VIEWS }
  }
  if (pathname === '/api/broadcasts/notification-settings') {
    return { success: true, data: BROADCAST_NOTIFICATION_SETTINGS }
  }
  /* 二者承認（m12a）。固定名の口は :id より先に置く（本番と同じ順番）。 */
  if (pathname === '/api/broadcasts/approval-config') {
    return {
      success: true,
      data: { ...BROADCAST_APPROVAL_CONFIG, lineAccountId: query.get('lineAccountId') ?? 'visual-qa-account' },
    }
  }
  if (pathname === '/api/broadcasts/approvals/candidates') {
    return { success: true, data: BROADCAST_APPROVAL_CANDIDATES }
  }
  if (pathname === '/api/broadcasts/approval-threshold') {
    return { success: true, data: { lineAccountId: query.get('lineAccountId') ?? 'visual-qa-account', threshold: 1000 } }
  }
  const broadcastApproval = pathname.match(/^\/api\/broadcasts\/([^/]+)\/approval$/)
  if (broadcastApproval) {
    const approvalId = broadcastApproval[1]
    // 記録の見本と合わせる。2行目は承認を通って送信済み。
    // 承認の無い配信は 'none'（段に承認待ちを出さない）。
    if (approvalId === 'broadcast-2') {
      return {
        success: true,
        data: {
          ...BROADCAST_APPROVAL_STATE,
          approval: {
            ...BROADCAST_APPROVAL_STATE.approval,
            status: 'approved',
            approverStaffId: 'staff-sasaki-approver',
            decidedByStaffId: 'staff-sasaki-approver',
            decidedAt: '2026-08-19T10:00:00+09:00',
          },
        },
      }
    }
    if (approvalId !== 'broadcast-0' && approvalId !== 'broadcast-visual') {
      return {
        success: true,
        data: {
          ...BROADCAST_APPROVAL_STATE,
          approval: {
            ...BROADCAST_APPROVAL_STATE.approval,
            status: 'none',
            requestedByStaffId: null,
            requestedAt: null,
            approverStaffId: null,
            note: null,
          },
          gate: { ...BROADCAST_APPROVAL_STATE.gate, required: false, recipientCount: 0 },
        },
      }
    }
    return { success: true, data: BROADCAST_APPROVAL_STATE }
  }
  const broadcastInsight = pathname.match(/^\/api\/broadcasts\/([^/]+)\/insight$/)
  if (broadcastInsight) {
    return { success: true, data: BROADCAST_INSIGHTS[broadcastInsight[1]] ?? null }
  }
  const broadcastRecipients = pathname.match(/^\/api\/broadcasts\/([^/]+)\/recipients$/)
  if (broadcastRecipients) {
    const wanted = query.get('result') ?? 'all'
    const groupFor = { delivered: 'delivered', temporary: 'failed_temporary', permanent: 'failed_permanent', unknown: 'unknown', inflight: 'inflight' }[wanted]
    const rows = groupFor ? BROADCAST_RECIPIENTS.rows.filter((row) => row.group === groupFor) : BROADCAST_RECIPIENTS.rows
    return {
      success: true,
      data: { rows, summary: BROADCAST_RECIPIENTS.summary, aggregateOnly: false, aggregateReason: null, legacySuccessCount: null },
      pagination: { total: rows.length, limit: 50, cursor: 0, nextCursor: null },
    }
  }
  const broadcastActivity = pathname.match(/^\/api\/broadcasts\/([^/]+)\/activity$/)
  if (broadcastActivity) {
    return {
      success: true,
      data: BROADCAST_ACTIVITY,
      pagination: { limit: 50, cursor: 0, nextCursor: null },
    }
  }
  const broadcastOne = pathname.match(/^\/api\/broadcasts\/([^/]+)$/)
  if (broadcastOne) {
    const found = BROADCASTS.find((item) => item.id === broadcastOne[1])
    return found ? { success: true, data: found } : { success: false, error: 'Not found' }
  }
  if (pathname === '/api/broadcasts') {
    return { success: true, data: BROADCASTS, ...BROADCAST_LIST_META }
  }
  /* 予約結果（`/broadcasts/reserved?id=`）は上の1件取得で足りる。 */
  if (pathname === '/api/inbox/saved-views') return { success: true, data: INBOX_SAVED_VIEWS }
  if (pathname === '/api/friends/saved-views') {
    const id = query.get('id')
    if (id) {
      const item = FRIEND_SAVED_VIEWS.items.find((view) => view.id === id)
      return item
        ? { success: true, data: item }
        : { success: false, error: '保存した検索が見つかりません' }
    }
    return { success: true, data: FRIEND_SAVED_VIEWS }
  }
  if (pathname === '/api/chats') return { success: true, data: CHATS }
  if (pathname === '/api/chats/stats') return { success: true, data: INBOX_STATS }
  /*
    メールの会話の中身。実口（`support-inbox.ts`）と同じ
    `{thread, messages, …}` の形。無いと既定の `{items,total,…}` に落ち、
    受信箱でメールを開くと `reading 'id'`（`detail.thread.id`）で落ちる
    （2026-10-03 点検）。載っていない ID は実口と同じく失敗にする。
  */
  const emailThread = /^\/api\/support\/email\/threads\/([^/]+)$/.exec(pathname)
  if (emailThread) {
    const item = SUPPORT_EMAIL_ITEMS.find((mail) => mail.threadId === emailThread[1])
    if (!item) return { success: false, error: 'Thread not found' }
    const thread = {
      id: item.threadId,
      customer_email: item.customerIdentifier,
      customer_name: item.customerName,
      subject: item.subject,
      status: item.status,
      assigned_staff_id: item.assignedStaffId,
      notes: null,
      last_message_at: item.lastIncomingAt,
      last_incoming_at: item.lastIncomingAt,
      last_outgoing_at: null,
      resolved_at: null,
      revision: item.revision,
    }
    const messages = [
      {
        id: `${item.threadId}-msg-1`,
        direction: 'incoming',
        sender_email: item.customerIdentifier,
        sender_name: item.customerName,
        recipient_email: 'support@example.com',
        subject: item.subject,
        body_text: item.preview,
        sent_by_staff_id: null,
        sent_by_staff_name: null,
        created_at: item.lastIncomingAt,
      },
      {
        id: `${item.threadId}-msg-2`,
        direction: 'outgoing',
        sender_email: 'support@example.com',
        sender_name: null,
        recipient_email: item.customerIdentifier,
        subject: `Re: ${item.subject}`,
        body_text: 'ご連絡ありがとうございます。確認してご案内します。',
        sent_by_staff_id: 'operator-kenta',
        sent_by_staff_name: 'Kenta',
        created_at: item.lastIncomingAt,
      },
    ]
    return {
      success: true,
      data: {
        thread,
        messages,
        total: messages.length,
        hasMoreOlder: false,
        oldestCursor: null,
        newestCursor: null,
      },
    }
  }
  if (pathname === '/api/support/inbox') {
    /*
      **同じ口を2つの画面が読む。返す形が違う。**

      - ダッシュボード（`pending-inbox-card.tsx`）… `channel` を付けずに呼び、
        `{ items, summary }` を読む
      - 受信箱（`/chats`）… `channel=email` で呼び、`{ items }` の1件ずつに
        `status` `threadId` `subject` `revision` `isUnread` まで要る

      ダッシュボードの形だけで返していたとき、受信箱は
      `statusConfig[item.status].className` で落ちて**画面ごと真っ白**に
      なった。片方の画面のために形を変えると、もう片方が黙って壊れる。

      行は設計 `vUXKb` の表そのまま。**総数は5件**にしてページ送りを出す。
      1ページに収まる数で返すと、ページ送りが描かれず、そこを見張れない。
    */
    if (query.get('channel') === 'email') {
      return { success: true, data: { items: SUPPORT_EMAIL_ITEMS } }
    }
    return {
      success: true,
      data: {
        items: SUPPORT_INBOX_ITEMS,
        summary: { total: 5, line: 1, email: 4, emailUnread: 4, oldestWaitMinutes: 9110 },
      },
    }
  }
  /* リマインダの実行結果（設計 `GC4St` 7-1-H）。絞り込みと検索もここで効かせる。 */
  if (/^\/api\/reminders\/[^/]+\/runs$/.test(pathname)) {
    const status = query.get('status')
    const search = (query.get('search') ?? '').trim()
    let items = REMINDER_RUNS.items
    if (status) items = items.filter((run) => run.domainStatus === status)
    if (search) items = items.filter((run) => (run.friendName ?? '').includes(search))
    return {
      success: true,
      data: { ...REMINDER_RUNS, items, pagination: { ...REMINDER_RUNS.pagination, total: items.length } },
    }
  }
  if (pathname === '/api/tags') return { success: true, data: TAGS }
  const tagDependencies = /^\/api\/tags\/([^/]+)\/dependencies$/.exec(pathname)
  if (tagDependencies) {
    return {
      success: true,
      data: {
        ...TAG_DEPENDENCIES_NEN_SUBSCRIPTION,
        tag: { ...TAG_DEPENDENCIES_NEN_SUBSCRIPTION.tag, id: tagDependencies[1] },
      },
    }
  }
  const tagDefinition = /^\/api\/tags\/([^/]+)$/.exec(pathname)
  if (tagDefinition) {
    const tag = { ...TAG_DEFINITION_NEN_SUBSCRIPTION.tag, id: tagDefinition[1] }
    return query.get('withActions') === '1'
      ? { success: true, data: { ...TAG_DEFINITION_NEN_SUBSCRIPTION, ...tag, tag } }
      : { success: true, data: tag }
  }
  if (pathname === '/api/support-marks') return { success: true, data: SUPPORT_MARKS }
  if (/^\/api\/support-marks\/[^/]+\/archive-impact$/.test(pathname)) {
    return { success: true, data: SUPPORT_MARK_ARCHIVE_IMPACT }
  }
  if (pathname === '/api/saved-searches' && query.get('format') !== 'segment_v1') {
    return FRIEND_ATTRIBUTE_SAVED_SEARCH_RESPONSE
  }
  const savedSearchDetail = /^\/api\/saved-searches\/([^/]+)$/.exec(pathname)
  if (savedSearchDetail) {
    return {
      success: true,
      data: { ...FRIEND_ATTRIBUTE_SAVED_SEARCH_DETAIL, id: savedSearchDetail[1] },
    }
  }
  /* 自動変更ルール（設計 `GMvBd` 4-3-A）。マークごとに返す。 */
  if (/^\/api\/support-marks\/[^/]+\/automation-rules$/.test(pathname)) {
    return { success: true, data: SUPPORT_MARK_AUTOMATION_RULES }
  }
  /* `/api/staff/me` は下の1か所だけ(STAFFの固定データ)。ここに書くと下が死にコードになる。 */
  const formDeleteImpact = /^\/api\/forms\/([^/]+)\/delete-impact$/.exec(pathname)
  if (formDeleteImpact) {
    const data = formDeleteImpact[1] === 'form-empty'
      ? FORM_DELETE_IMPACT_FIXTURES.delete
      : formDeleteImpact[1] === 'form-3'
        ? FORM_DELETE_IMPACT_FIXTURES.archiveSurvey
        : FORM_DELETE_IMPACT_FIXTURES.archive
    return { success: true, data }
  }
  if (pathname === '/api/friends/bulk-runs/friend-bulk-run-1') {
    return { success: true, data: FRIEND_BULK_RUN.detail }
  }
  /*
   * 削除する前の影響（PR #381）。**一覧の `usedIn` から組み立てる。**
   * 別々に持つと、一覧が「配信3」なのに削除画面は「なし」という
   * ありえない絵になり、どちらが本当か分からなくなる。
   */
  const deleteImpact = /^\/api\/tags\/([^/]+)\/delete-impact$/.exec(pathname)
  if (deleteImpact) {
    const tag = TAGS.find((item) => item.id === deleteImpact[1])
    if (!tag) return { success: false, error: 'Not found' }
    return { success: true, data: tagDeleteImpact(tag) }
  }
  /*
    外部連携・流入経路・ログインユーザー。**空だと一覧の中身を設計と比べられない。**
    `readArrayGetPaths()` はこれらを配列の口として拾うが、返す中身が無かったので
    どの画面も「まだありません」の絵しか撮れず、34画面が空のままだった。
  */
  /*
    いま入っている人。**これが無いと「管理者かどうか」が false になる。**
    `staff/page.tsx` の `canEdit` は `administrator` を見ていて、
    行の「範囲を編集」も「ユーザーを追加」も出なくなる。
    既定の器が返っていたので、固定データを足しても押し口が出なかった。
  */
  if (pathname === '/api/staff/me') {
    return { success: true, data: { id: STAFF.id, name: STAFF.name, role: STAFF.role, email: null } }
  }
  if (pathname === '/api/webhooks/outgoing') return { success: true, data: OUTGOING_WEBHOOKS }
  // 外部連携の API 接続（板 ralAc・UkZLi）。止めた鍵は一覧に出ないので、使っている2本だけ。
  if (pathname === '/api/webhooks/api-tokens') return { success: true, data: VISUAL_QA_API_TOKENS }
  const incomingUnmatched = /^\/api\/webhooks\/incoming\/([^/]+)\/unmatched$/.exec(pathname)
  if (incomingUnmatched) {
    // 人が見つからなかった届物（絵 gW0F2）。詳細のある口だけ2件。口は配列と total を返す。
    const items = INCOMING_WEBHOOK_DETAILS[incomingUnmatched[1]] ? INCOMING_WEBHOOK_UNMATCHED : []
    return { success: true, data: items, total: items.length }
  }
  const incomingWebhookDetail = /^\/api\/webhooks\/incoming\/([^/]+)$/.exec(pathname)
  if (incomingWebhookDetail) {
    const detail = INCOMING_WEBHOOK_DETAILS[incomingWebhookDetail[1]]
    return detail
      ? { success: true, data: detail }
      : { success: false, error: 'Not found' }
  }
  if (pathname === '/api/webhooks/incoming') return { success: true, data: INCOMING_WEBHOOKS }
  if (pathname === '/api/entry-routes') return { success: true, data: ENTRY_ROUTES }
  if (pathname === '/api/entry-route-genres') {
    // 板 xbHxg のフォルダの列（広告・SNS・店頭）の順。紹介・メール・紙の分類は絵に無い。
    return { success: true, data: ['広告', 'SNS', '店頭'].map((name, index) => ({ id: `erg-${index + 1}`, name, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z' })) }
  }
  if (pathname === '/api/site/summary') return { success: true, data: SITE_TRACKING_SUMMARY }
  if (pathname === '/api/site/pages') return { success: true, data: SITE_TRACKING_PAGES }
  if (pathname === '/api/site/tracking-key') {
    // アカウントごとに違う鍵を返す。乱数は使わない(毎回同じ絵にする)。
    // 画面は account_id で送る（旧 accountId も受ける）。
    const accountId = query.get('account_id') ?? query.get('accountId') ?? 'visual-qa-account'
    const trackingKey = `hk_${createHash('sha256').update(`site-tracking:${accountId}`).digest('hex').slice(0, 32)}`
    return { success: true, data: { accountId, trackingKey } }
  }
  // Google Sheets 連携の見本。名前は packages/shared の型どおり（data 包み）。
  if (pathname === '/api/integrations/google-sheets/connection') {
    // V8 の絵 `DxAAA`：接続しています・k***@gmail.com・musubo 友だち台帳・前回 9/30 03:00 定期・完了。
    return {
      success: true,
      data: {
        connection: {
          status: 'connected',
          googleAccountEmail: 'k***@gmail.com',
          spreadsheetId: 'sheet-123',
          spreadsheetTitle: 'musubo 友だち台帳',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-123',
          lastSyncedAt: '2026-09-29T18:00:00.000Z',
          lastSyncStatus: 'ok',
          lastSyncError: null,
          consecutiveFailures: 0,
          connectedAt: '2026-09-20T00:00:00.000Z',
        },
        oauthConfigured: true,
        syncRunning: false,
        canManage: true,
      },
    }
  }
  if (pathname === '/api/integrations/google-sheets/runs') {
    // 同期の記録（絵 `DxAAA` の4行）。同じ開始時刻の行は画面で1行に束ねる。
    const run = (id, kind, dataType, status, rowsWritten, startedAt) => ({
      id, kind, dataType, status, rowsWritten, error: status === 'error' ? '書き出し先に書き込めませんでした' : null,
      startedAt, finishedAt: startedAt,
    })
    return {
      success: true,
      data: {
        runs: [
          run('run-1', 'scheduled', 'friends', 'ok', 1284, '2026-09-29T18:00:00.000Z'),
          run('run-2', 'scheduled', 'form_answers', 'ok', 312, '2026-09-29T18:00:00.000Z'),
          run('run-3', 'manual', 'friends', 'ok', 1280, '2026-09-29T06:42:00.000Z'),
          run('run-4', 'scheduled', 'friends', 'ok', 1280, '2026-09-28T18:00:00.000Z'),
          run('run-5', 'scheduled', 'form_answers', 'partial', 0, '2026-09-28T18:00:00.000Z'),
          run('run-6', 'scheduled', 'friends', 'error', 0, '2026-09-27T18:00:00.000Z'),
        ],
      },
    }
  }
  if (pathname === '/api/ad-platforms') return { success: true, data: AD_PLATFORMS }
  /*
   * #818 流入元ごとの広告費の台帳。数は V8 の板（`qSTVR`・`ZxKL5`）にそろえる。
   * この30日の広告費 ¥86,000・友だち追加 73 人・つないだ広告 2 件。
   * 手入力の記録は無い（板にも無い）ので空で返す。
   */
  if (pathname === '/api/ad-costs') {
    return {
      success: true,
      data: { rows: AD_COST_ROWS, platforms: AD_COST_PLATFORMS, manualEntries: [] },
    }
  }
  if (pathname === '/api/ad-platforms/logs') {
    const page = Math.max(1, Number(query.get('page')) || 1)
    const limit = Math.min(200, Math.max(1, Number(query.get('limit')) || 20))
    const status = query.get('status')
    const search = (query.get('query') ?? '').trim().toLocaleLowerCase('ja')
    const filtered = AD_CONVERSION_LOGS.filter((log) => {
      const statusMatches = !status || status === 'all'
        || (status === 'sent' ? ['sent', 'success'].includes(log.status) : log.status === status)
      const queryMatches = !search
        || [log.eventName, log.clickIdType ?? ''].some((value) => value.toLocaleLowerCase('ja').includes(search))
      return statusMatches && queryMatches
    })
    return {
      success: true,
      data: {
        items: filtered.slice((page - 1) * limit, page * limit),
        total: filtered.length,
        page,
        limit,
        sort: [{ field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'desc' }],
      },
    }
  }
  const adPlatformLogs = /^\/api\/ad-platforms\/([^/]+)\/logs$/.exec(pathname)
  if (adPlatformLogs) {
    return { success: true, data: AD_CONVERSION_LOGS.filter((log) => log.adPlatformId === adPlatformLogs[1]) }
  }
  /*
    流入元の詳細。可変部分を配列の既定値へ落とすと、1件取得まで `[]` になり、
    `route.createdAt.slice(...)` で詳細画面全体が落ちる。画面確認用の同じ1件から
    詳細・段階・参照元を組み立て、一覧と右側で別のリンクを見せない。
  */
  const entryRouteFunnel = /^\/api\/entry-routes\/([^/]+)\/funnel$/.exec(pathname)
  if (entryRouteFunnel) {
    return {
      success: true,
      data: { click_count: 1240, friend_add_count: 86, form_submission_count: 36, cv_count: 12 },
    }
  }
  const entryRouteSources = /^\/api\/entry-routes\/([^/]+)\/sources$/.exec(pathname)
  if (entryRouteSources) {
    return {
      success: true,
      data: [
        { label: 'instagram.com', count: 312 },
        { label: 'lin.ee', count: 96 },
        { label: '直接アクセス', count: 78 },
      ],
    }
  }
  const entryRouteDetail = /^\/api\/entry-routes\/([^/]+)$/.exec(pathname)
  if (entryRouteDetail) {
    const entryRoute = ENTRY_ROUTES.find((item) => item.id === entryRouteDetail[1])
    return entryRoute
      ? { success: true, data: entryRoute }
      : { success: false, error: 'Not found' }
  }
  if (pathname === '/api/analytics/ref-summary') {
    return { success: true, data: INFLOW_SUMMARY }
  }
  // #514-9: 計測リンクの一覧。本番の GET /api/tracked-links と同じ形で返す。
  if (pathname === '/api/tracked-links') {
    return { success: true, data: TRACKED_LINKS }
  }
  if (/^\/api\/analytics\/ref\/[^/]+$/.test(pathname)) {
    /*
      #514-8・9: 本番の GET /api/analytics/ref/:refCode と同じ形
      (refCode・name・friends[id・displayName・trackedAt・currentStatus])で返す。
      firstPage・conversion・miles の豊富な形は本番に無いので持たせない。
    */
    const refCode = decodeURIComponent(pathname.split('/').pop())
    return {
      success: true,
      data: {
        refCode,
        name: (ENTRY_ROUTES.find((item) => item.refCode === refCode) ?? {}).name ?? null,
        friends: [
          { id: 'friend-inflow-1', displayName: '石田 未来', trackedAt: '2026-08-25T09:12:00.000Z', currentStatus: '友だち中' },
          { id: 'friend-inflow-2', displayName: '新田 遥', trackedAt: '2026-08-24T21:40:00.000Z', currentStatus: '友だち中' },
          { id: 'friend-inflow-3', displayName: '松本 圭', trackedAt: '2026-08-22T12:05:00.000Z', currentStatus: '友だち中' },
          { id: 'friend-inflow-4', displayName: '林 里佳', trackedAt: '2026-08-20T18:22:00.000Z', currentStatus: 'ブロック済み' },
          { id: 'friend-inflow-5', displayName: '大村 真', trackedAt: '2026-08-18T10:44:00.000Z', currentStatus: '友だち中' },
        ],
      },
    }
  }
  // 実物は { sessions: [...] }。既定の空ページ（items）で返すと、担当者一覧が丸ごと落ちる。
  if (pathname === '/api/auth/sessions') return { success: true, data: { sessions: [
    { id: 'sess-current', current: true, createdAt: '2026-08-25T00:00:00.000Z', expiresAt: '2026-09-24T00:00:00.000Z', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0', ipPrefix: '203.0.113.*' },
  ] } }
  if (pathname === '/api/staff') return { success: true, data: STAFF_MEMBERS }
  if (pathname === '/api/login-audit') return { success: true, data: LOGIN_AUDIT }

  /*
    紹介者・案件・マイル・成果地点。**空だと一覧の中身を設計と比べられない。**

    `/api/mileage/overview` は器の形まで要る。画面の `isMileageAdminOverview` は
    `summary` の5つの数と `pagination` を見ていて、1つでも欠けると
    「友だちのマイルを表示できませんでした」に落ちる。
  */
  if (pathname === '/api/affiliates') return { success: true, data: AFFILIATES }
  if (pathname === '/api/affiliate-offers') return { success: true, data: AFFILIATE_OFFERS }
  // #823 案件の決まりの版・上限の残り・成果の付け方の記録。
  const offerVersions = /^\/api\/affiliate-offers\/([^/]+)\/versions$/.exec(pathname)
  if (offerVersions) return { success: true, data: OFFER_VERSIONS }
  const offerCapStatus = /^\/api\/affiliate-offers\/([^/]+)\/cap-status$/.exec(pathname)
  if (offerCapStatus) return { success: true, data: OFFER_CAP_STATUS }
  const conversionAttribution = /^\/api\/conversions\/events\/([^/]+)\/attribution$/.exec(pathname)
  if (conversionAttribution) return { success: true, data: ATTRIBUTION_DECISION }
  if (pathname === '/api/common-actions') {
    const status = query.get('status')
    const search = (query.get('query') ?? '').trim().toLocaleLowerCase('ja')
    const filtered = COMMON_ACTIONS
      .filter((item) => status === 'old_version'
        ? item.oldVersionBindingCount > 0
        : status === 'unused'
          ? item.status === 'published' && item.bindingCount === 0
          // 監査 R480: 通常一覧から保管済みを外す（本番口と同じ）。
          : status ? item.status === status : item.status !== 'archived')
      .filter((item) => !search || `${item.name} ${item.description ?? ''}`.toLocaleLowerCase('ja').includes(search))
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : null
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    // 本番と同じく、数の帯の集計（保管を除いた母集団）も返す。
    const live = COMMON_ACTIONS.filter((item) => item.status !== 'archived')
    const summary = {
      total: live.length,
      published: live.filter((item) => item.status === 'published').length,
      draft: live.filter((item) => item.status === 'draft').length,
      oldVersion: live.filter((item) => item.oldVersionBindingCount > 0).length,
      unused: live.filter((item) => item.status === 'published' && item.bindingCount === 0).length,
      archived: COMMON_ACTIONS.length - live.length,
      actions: live.reduce((sum, item) => sum + item.actionCount, 0),
      bindings: live.reduce((sum, item) => sum + item.bindingCount, 0),
      outdated: live.reduce((sum, item) => sum + item.oldVersionBindingCount, 0),
      outdatedItems: live.filter((item) => item.oldVersionBindingCount > 0).length,
      executions: live.reduce((sum, item) => sum + item.executionCountThisMonth, 0),
      failures: live.reduce((sum, item) => sum + item.failureCountThisMonth, 0),
    }
    return {
      success: true,
      data: limit === null ? filtered : filtered.slice(offset, offset + limit),
      pagination: { total: filtered.length, limit, offset },
      summary,
      freshness: 'available',
    }
  }
  if (pathname === '/api/automations') return {
    success: true,
    data: AUTOMATIONS,
    summary: {
      active: AUTOMATIONS.filter((item) => item.status === 'active').length,
      stopped: AUTOMATIONS.filter((item) => item.status === 'stopped').length,
      executionCount30d: AUTOMATIONS.reduce((sum, item) => sum + item.executionCount30d, 0),
      failureCount30d: AUTOMATIONS.reduce((sum, item) => sum + item.failureCount30d, 0),
    },
    freshness: 'available',
  }
  if (pathname === '/api/automation-draft-resources') return {
    success: true,
    data: {
      tags: [{ id: 'tag-trial', name: '体験申込' }, { id: 'tag-member', name: '会員' }],
      scenarios: [{ id: 'scenario-trial', name: '体験前フォロー' }],
    },
  }
  if (pathname === '/api/automation-runs') {
    // #519 軽: 本番口と同じく search・status・limit で絞る（固定7件を返さない）。
    // R24: offset にも連動させ、ページ送りの撮影ができるようにする。
    const runStatus = query.get('status')
    const runSearch = (query.get('search') ?? '').trim().toLocaleLowerCase('ja')
    const runLimit = Math.max(1, Number.parseInt(query.get('limit') ?? '', 10) || 20)
    const runOffset = Math.max(0, Number.parseInt(query.get('offset') ?? '', 10) || 0)
    const statusDomains = runStatus === 'executed'
      ? ['success', 'partial', 'failed']
      : runStatus === 'problems'
        ? ['partial', 'failed']
        : runStatus === 'skipped'
          ? ['skipped_condition']
          : null
    const runItems = AUTOMATION_RUNS.items.filter((item) => {
      if (statusDomains && !statusDomains.includes(item.domainStatus)) return false
      if (!runSearch) return true
      return [item.subject, item.automationName].some((value) =>
        String(value ?? '').toLocaleLowerCase('ja').includes(runSearch))
    })
    return {
      success: true,
      data: {
        ...AUTOMATION_RUNS,
        items: runItems.slice(runOffset, runOffset + runLimit),
        pagination: { total: runItems.length, limit: runLimit, offset: runOffset },
      },
    }
  }
  if (pathname === '/api/automation-templates') return { success: true, data: AUTOMATION_TEMPLATES }
  {
    const automationDraftDetail = /^\/api\/automation-drafts\/([^/]+)$/.exec(pathname)
    if (method === 'GET' && automationDraftDetail) {
      /*
       * 一覧の「編集する」「複製する」の行き先。`<id>-draft` は一覧の見本
       * から写す（保存はしない）。無いと編集画面が開けず、直前のPOST追加
       * だけでは赤い帯が別の画面へ移るだけになる（1920px見直し③）。
       */
      const id = decodeURIComponent(automationDraftDetail[1])
      /*
       * ★V8 ルールを作る（M4torY・tJqST）の撮影用の下書き。絵と同じ形（メッセージを受け取ったとき・
       * 含まれる言葉「予約」・することが3つ）。一覧には出ない番号で持つ（ar-new と同じ扱い）。
       */
      if (id === 'automation-v8-new') {
        return {
          success: true,
          data: {
            id,
            draftVersionId: `${id}-version`,
            name: '「予約」と送られたら担当へ知らせる',
            description: null,
            eventType: 'message_received',
            triggerConfig: { keyword: '予約' },
            conditions: {},
            actions: [
              { id: `${id}-action-1`, type: 'add_tag', params: { tagId: 'tag-trial' }, onFailure: 'stop' },
              { id: `${id}-action-2`, type: 'send_message', params: { messageType: 'text', content: '予約の受付をはじめます。ご希望の日時を送ってください。' }, onFailure: 'stop' },
              { id: `${id}-action-3`, type: 'start_scenario', params: { scenarioId: 'scenario-trial' }, onFailure: 'stop' },
            ],
            commonActionRefs: [],
            commonActionVersions: {},
          },
        }
      }
      const source = AUTOMATIONS.find((item) => `${item.id}-draft` === id || `${item.id}-copy-draft` === id)
        ?? (id === 'automation-visual-draft' ? AUTOMATIONS[0] : null)
      if (!source) return { success: false, error: '下書きが見つかりません' }
      return {
        success: true,
        data: {
          id,
          draftVersionId: `${id}-version`,
          name: source.name,
          description: source.description ?? null,
          eventType: source.eventType,
          triggerConfig: source.triggerConfig ?? source.conditions ?? {},
          conditions: source.conditions ?? {},
          actions: (source.actions ?? []).map((action, index) => ({
            id: `${id}-action-${index + 1}`,
            type: action.type,
            params: action.params ?? {},
            onFailure: 'stop',
          })),
        },
      }
    }
  }
  if (pathname === '/api/ec-commerce/settings') return { success: true, data: EC_NOTIFICATION_SETTINGS }
  if (pathname === '/api/line-notifications/customer-definitions') {
    return { success: true, data: LINE_NOTIFICATION_DEFINITIONS }
  }
  if (pathname === '/api/line-notifications/metrics') {
    return { success: true, data: LINE_NOTIFICATION_METRICS }
  }
  if (pathname === '/api/line-notifications/send-counts') {
    return { success: true, data: LINE_NOTIFICATION_SEND_COUNTS }
  }
  if (pathname === '/api/line-notifications/deliveries') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 20
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    // 本番の view=failures は excluded / retry_wait / failed の3状態。failed だけにすると件数が合わない。
    // 本番口は retry_wait を failed に寄せて返す（publicDeliveryStatus）ので、見本も同じ寄せ方をする。
    const toPublic = (item) => item.status === 'retry_wait' ? { ...item, status: 'failed' } : item
    const items = (query.get('view') === 'failures'
      ? LINE_NOTIFICATION_DELIVERIES.items.filter((item) => item.status === 'failed' || item.status === 'excluded' || item.status === 'retry_wait')
      : LINE_NOTIFICATION_DELIVERIES.items
    ).map(toPublic)
    return { success: true, data: { ...LINE_NOTIFICATION_DELIVERIES, items: items.slice(offset, offset + limit) }, pagination: { total: items.length, limit, offset } }
  }
  if (pathname === '/api/notifications/operator-rules' || pathname === '/api/line-notifications/operator-rules') {
    /*
     * 本物は両方の名で同じ一覧を返す（`notifications.ts`）。
     * `line-notifications` 側が無いと、運用者タブの件数が
     * 「読み込めませんでした」になっていた。
     */
    return { success: true, data: { items: OPERATOR_NOTIFICATION_RULES, summary: { total: 11, published: 9, stopped: 2, missingRecipients: 1, recipients: 6, acceptedToday: 42, excludedToday: 1 } } }
  }
  const lineOperatorRuleDetail = /^\/api\/line-notifications\/operator-rules\/([^/]+)$/.exec(pathname)
  if (lineOperatorRuleDetail && lineOperatorRuleDetail[1] !== 'recipients-preview') {
    const rule = OPERATOR_NOTIFICATION_RULES.find((item) => item.id === lineOperatorRuleDetail[1])
    if (!rule) return { success: false, error: 'ルールが見つかりません' }
    return { success: true, data: rule }
  }
  if (pathname === '/api/nen/rank-settings') {
    /*
     * 無いと既定の器が返り、`settings.kpis.members` で
     * 「画面を表示できませんでした」になっていた。
     * 本物は `settingsResponse` の形（`nen-ranks.ts`）。
     */
    return { success: true, data: NEN_RANK_SETTINGS }
  }
  if (pathname === '/api/nen/members') {
    return { success: true, data: NEN_MEMBER_LIST }
  }
  if (pathname === '/api/nen/pets') {
    /*
     * 無いと既定の器が返り、`kpis.total` が取れず
     * 「ペットを読み込めませんでした」になっていた。
     */
    return { success: true, data: NEN_PET_LIST }
  }
  if (pathname === '/api/nen/health') {
    return { success: true, data: NEN_HEALTH_LIST }
  }
  const nenHealthSummary = /^\/api\/nen\/health\/([^/]+)\/summary$/.exec(pathname)
  if (method === 'GET' && nenHealthSummary) {
    /*
     * 本物は `GET /api/nen/health/:petId/summary` の形（apps/worker/src/routes/nen-pets.ts）。
     * 無いと既定の器が返り、まとめ窓の `summary.pet.callName` で `/nen/health` が落ちていた。
     */
    const item = NEN_HEALTH_LIST.items.find((entry) => entry.pet.id === decodeURIComponent(nenHealthSummary[1]))
    if (!item) return { success: false, error: 'Pet not found' }
    const weights = (item.weightSeries ?? []).filter((value) => value != null)
    const stoolCounts = item.latestStool ? { [item.latestStool]: item.count30d } : {}
    const appetiteCounts = item.latestAppetite ? { [item.latestAppetite]: item.count30d } : {}
    return {
      success: true,
      data: {
        pet: { ...item.pet, weightKg: item.latestWeightKg },
        owner: item.owner,
        generatedAt: '2026-10-02T10:00:00+09:00',
        summary: {
          days: 30,
          records: item.count30d,
          weight: weights.length ? { first: weights[0], last: weights[weights.length - 1], min: Math.min(...weights), max: Math.max(...weights) } : null,
          heartRateAvg: null,
          respiratoryRateAvg: null,
          stool: stoolCounts,
          appetite: appetiteCounts,
          skin: {},
          tearStain: {},
          notes: [],
          logs: [],
        },
        labels: {
          stool: { normal: '正常', soft: 'やわらかい', hard: 'かたい', diarrhea: '下痢', bloody: '血が混じる', other: 'その他' },
          appetite: { good: '良好', normal: '普通', poor: '不良' },
        },
      },
    }
  }
  if (pathname === '/api/ec-commerce/notification-runs') {
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 20
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    return {
      success: true,
      data: {
        ...EC_NOTIFICATION_RUNS,
        items: EC_NOTIFICATION_RUNS.items.slice(offset, offset + limit),
      },
      pagination: { total: EC_NOTIFICATION_RUNS.items.length, limit, offset },
    }
  }
  if (pathname === '/api/nen-members/photos') return { success: true, data: NEN_PHOTOS }
  if (pathname === '/api/nen-members/photos/review-metrics') {
    return { success: true, data: NEN_PHOTO_REVIEW_METRICS }
  }
  if (pathname === '/api/nen-members/photos/publications') return { success: true, data: NEN_PHOTO_PUBLICATIONS }
  const photoAssetStatus = /^\/api\/nen-members\/photos\/([^/]+)\/assets\/status$/.exec(pathname)
  if (photoAssetStatus) {
    return {
      success: true,
      data: {
        ...NEN_PHOTO_ASSET_STATUS,
        jobs: NEN_PHOTO_ASSET_STATUS.jobs.map((job) => ({ ...job, photoId: photoAssetStatus[1] })),
      },
    }
  }
  if (/^\/api\/nen-members\/photos\/[^/]+\/assets\/derivatives$/.test(pathname)) {
    return { success: true, data: NEN_PHOTO_DERIVATIVES }
  }
  if (/^\/api\/nen-members\/photos\/[^/]+$/.test(pathname)) return { success: true, data: NEN_PHOTO_DETAIL }
  // #817: 報酬の決まりの版。新しい版から返す。
  if (pathname === '/api/nen-members/photo-reward-policy/versions') {
    return { success: true, data: NEN_PHOTO_REWARD_POLICY_VERSIONS }
  }
  // #817: 新しい版を作る・この版に戻す。過去の版は変えず、新しい版を作る。
  if (method === 'POST' && pathname === '/api/nen-members/photo-reward-policy/versions') {
    return {
      success: true,
      data: {
        created: true,
        version: {
          versionNumber: 5, policyKey: 'v5', points: 10,
          summary: '報酬を5pt→10ptに', effectiveFrom: null,
          createdAt: '2026-09-27T10:00:00+09:00',
        },
      },
    }
  }
  if (method === 'POST' && pathname === '/api/nen-members/photo-reward-policy/revert') {
    return {
      success: true,
      data: {
        created: true,
        version: {
          versionNumber: 5, policyKey: 'v5', points: 5,
          summary: '最初の報酬の決まり', effectiveFrom: null,
          createdAt: '2026-09-27T10:00:00+09:00',
        },
      },
    }
  }
  if (pathname === '/api/ec-commerce/overview') return { success: true, data: EC_OVERVIEW }
  /* 取り込みの記録。`?view=actions` は処理1件ずつの形（`ec-commerce.ts`）。 */
  if (pathname === '/api/ec-commerce/events') {
    if (query.get('view') === 'actions') {
      /*
       * 前は出来事の配列をそのまま返していて、画面の
       * `data.items` が取れず「読み込めませんでした」になっていた。
       * 本物と同じ処理1件ずつの器で返す。
       */
      const items = EC_ACTION_EXECUTIONS.items.map((execution) => ({
        ...execution,
        eventLabel: '',
        friendId: null,
        failureKind: null,
        order: null,
      }))
      return {
        success: true,
        data: { items, total: items.length, summary: EC_ACTION_EXECUTIONS.summary },
      }
    }
    return { success: true, data: EC_EVENTS, pagination: { total: EC_EVENTS.length, limit: 20, offset: 0 } }
  }
  if (pathname === '/api/ec-commerce/subscriptions') {
    return { success: true, data: EC_SUBSCRIPTIONS, pagination: { total: EC_SUBSCRIPTIONS.summary.total, limit: 100, offset: 0 } }
  }
  if (pathname === '/api/ec-commerce/connector') return { success: true, data: EC_CONNECTOR }
  if (pathname === '/api/affiliates-report') return { success: true, data: AFFILIATE_REPORT }
  const affiliateArchiveImpact = /^\/api\/affiliates\/([^/]+)\/archive-impact$/.exec(pathname)
  if (affiliateArchiveImpact) {
    const affiliate = AFFILIATES.find((item) => item.id === affiliateArchiveImpact[1]) ?? AFFILIATES[0]
    return {
      success: true,
      data: {
        affiliateId: affiliate.id,
        affiliateName: affiliate.name,
        lifecycle: affiliate.isActive ? 'active' : 'paused',
        activeLinks: 3,
        unsettledConversions: 9,
        unsettledReward: 24000,
        pendingConversions: 2,
        checkedAt: '2026-09-06T00:00:00.000Z',
      },
    }
  }
  const affiliatePaymentPreview = /^\/api\/affiliate-payments\/([^/]+)\/preview$/.exec(pathname)
  if (affiliatePaymentPreview) {
    const affiliate = AFFILIATES.find((item) => item.id === affiliatePaymentPreview[1]) ?? AFFILIATES[1]
    return {
      success: true,
      data: {
        affiliateId: affiliate.id,
        affiliateName: affiliate.name,
        code: affiliate.code,
        amount: 72000,
        conversionCount: 18,
        periodFrom: '2026-08-01T00:00:00+09:00',
        periodTo: '2026-08-31T23:59:59+09:00',
        closeDate: null,
        paymentDate: '2026-09-30T00:00:00+09:00',
        bankDestination: null,
        breakdown: [
          { offerName: '定期便のはじめて購入', conversions: 8, unitReward: 5000, subtotal: 40000 },
          { offerName: '無料体験の申込', conversions: 9, unitReward: 3000, subtotal: 27000 },
          { offerName: '友だち追加だけ', conversions: 50, unitReward: 100, subtotal: 5000 },
        ],
      },
    }
  }
  /* 紹介者ひとりぶん。`/api/affiliates/:id/report` と `/links`。器の形が要る。 */
  if (/^\/api\/affiliates\/[^/]+\/report$/.test(pathname)) return { success: true, data: AFFILIATE_REPORT_DETAIL }
  if (/^\/api\/affiliates\/[^/]+\/links$/.test(pathname)) return { success: true, data: AFFILIATE_LINKS }
  /*
   * 紹介者の内訳（来た人の一覧）。無いと既定の器（`{items,total,page,limit}`）が
   * 返り、画面が器に `.filter` して白画面になっていた。
   * 本物は配列と次の印を返す（`affiliates.ts` の journeys）。
   */
  if (/^\/api\/affiliates\/[^/]+\/journeys$/.test(pathname)) {
    return {
      success: true,
      data: [
        { friendId: 'friend-4', displayName: 'さくら', addedAt: '2026-09-20T10:02:00.000+09:00', refCode: 'tanaka01', touchCount: 3, formCount: 1, conversionCount: 1, lastEventAt: '2026-09-21T09:00:00.000+09:00' },
        { friendId: 'friend-9', displayName: null, addedAt: '2026-09-18T21:40:00.000+09:00', refCode: null, touchCount: 1, formCount: 0, conversionCount: 0, lastEventAt: '2026-09-18T21:40:00.000+09:00' },
      ],
      nextCursor: null,
    }
  }
  /*
   * 要対応の交換の一覧。型どおりの名前（items/pagination）で返す。
   * 失敗中と送ったか分からない配送中（照合待ち）を混ぜ、21件以上でも
   * limit/offset で残りを出せる見本にする（R364・R365）。
   */
  if (pathname === '/api/mileage/redemptions') {
    const limit = Math.min(100, Math.max(1, Number(query.get('limit') || 20)))
    const offset = Math.max(0, Number(query.get('offset') || 0))
    const items = [
      {
        id: 'mock-redemption-1', rewardName: '500円ぶんのクーポン', status: 'delivery_failed',
        attemptCount: 2, failureCode: 'reward_delivery_failed',
        failureMessage: '特典を渡せませんでした。時間をおいてもう一度お試しください。',
        updatedAt: '2026-09-09T01:02:03.000Z',
      },
      {
        id: 'mock-redemption-2', rewardName: '送料無料', status: 'delivering',
        attemptCount: 1, failureCode: null, failureMessage: null,
        updatedAt: '2026-09-09T02:03:04.000Z',
      },
    ]
    return {
      success: true,
      data: {
        items: items.slice(offset, offset + limit),
        pagination: { total: items.length, limit, offset },
      },
    }
  }
  if (method === 'POST' && /^\/api\/mileage\/redemptions\/[^/]+\/retry-fulfillment$/.test(pathname)) {
    return {
      success: true,
      data: {
        status: 'succeeded', rewardName: '500円ぶんのクーポン', customerMessage: '交換できました',
        rewardCode: null, retryAt: null, failurePolicy: 'retry', message: null,
        redemption: { id: pathname.split('/')[4], status: 'succeeded' },
      },
    }
  }
  if (pathname === '/api/mileage/overview') return { success: true, data: MILEAGE_OVERVIEW }
  if (pathname === '/api/mileage/friends') return { success: true, data: MILEAGE_FRIENDS }
  if (pathname === '/api/mileage/earning-rules') return { success: true, data: MILEAGE_EARNING_RULES }
  if (pathname === '/api/mileage/rules') return { success: true, data: MILEAGE_RULES }
  /*
    承認待ちのマイル変更（V8 友だちの残高 `CJlf4` の黄の板）。境界（5,000）以上の手での変更が1件。
    承認済み・差し戻しを聞かれたときは空を返す。
  */
  if (pathname === '/api/mileage/adjustment-approvals') {
    if (query.get('status') !== 'pending') return { success: true, data: [] }
    return {
      success: true,
      data: [{
        id: 'maa-1', line_account_id: 'visual-qa-account', friend_id: 'friend-1', friend_display_name: 'Kenta Kawano',
        direction: 'increase', amount: 5000, reason_category: 'campaign', reason: 'イベント運営のお礼',
        status: 'pending', requested_by_staff_id: 'staff-2', requested_by_staff_name: '佐藤 直人',
        decided_by_staff_name: null, decided_at: null, decision_reason: null, created_at: '2026-10-02T06:20:00.000Z',
      }],
    }
  }
  if (pathname === '/api/mileage/adjustment-policy') {
    return { success: true, data: { configured: true, approvalThreshold: 10_000 } }
  }
  if (/^\/api\/mileage\/rewards\/[^/]+$/.test(pathname)) {
    const rewardId = pathname.split('/').pop()
    const reward = MILEAGE_REWARDS.rewards.find((item) => item.id === rewardId)
    return reward
      ? { success: true, data: reward }
      : { success: false, error: '使い道が見つかりません' }
  }
  if (pathname === '/api/conversions/definitions') return { success: true, data: CONVERSION_DEFINITIONS }
  if (/^\/api\/conversions\/definitions\/[^/]+\/delete-impact$/.test(pathname)) {
    return { success: true, data: CONVERSION_DEFINITION_DELETE_IMPACT }
  }
  if (pathname === '/api/conversions/points') return { success: true, data: CONVERSION_POINTS }
  if (pathname === '/api/conversions/report') {
    if (query.has('from') || query.has('to')) {
      return { success: true, data: CONVERSION_DEFINITION_REPORT }
    }
    const startDate = query.get('startDate') ?? ''
    const data = startDate >= '2026-08-01'
      ? CONVERSION_REPORT_CURRENT
      : CONVERSION_REPORT_PREVIOUS
    return { success: true, data }
  }
  if (pathname === '/api/common-vars') return { success: true, data: COMMON_VARS }
  if (pathname === `/api/common-vars/${COMMON_VAR_DETAIL.id}`) return { success: true, data: COMMON_VAR_DETAIL }
  /* 板 `AYc6O`・`C67dE`・`piWhz`：営業時間の編集（使っている8か所・予定1件・履歴2件）。 */
  if (pathname === `/api/common-vars/${COMMON_VAR_HOURS_DETAIL.id}`) return { success: true, data: COMMON_VAR_HOURS_DETAIL }
  const commonVarDeleteImpact = /^\/api\/common-vars\/([^/]+)\/delete-impact$/.exec(pathname)
  if (commonVarDeleteImpact) {
    const impact = commonVarDeleteImpact[1] === COMMON_VAR_DELETE_IMPACT_EMPTY.variable.id
      ? COMMON_VAR_DELETE_IMPACT_EMPTY
      : commonVarDeleteImpact[1] === COMMON_VAR_HOURS_DETAIL.id
        ? COMMON_VAR_HOURS_DELETE_IMPACT
        : commonVarDeleteImpact[1] === COMMON_VAR_DELETE_IMPACT_PHONE.variable.id
          ? COMMON_VAR_DELETE_IMPACT_PHONE
          : commonVarDeleteImpact[1] === COMMON_VAR_DELETE_IMPACT_CAMPAIGN.variable.id
            ? COMMON_VAR_DELETE_IMPACT_CAMPAIGN
            : COMMON_VAR_DELETE_IMPACT
    return { success: true, data: impact }
  }
  /*
    共通情報の切り替え予約の一覧。予約表が常に空だと、予約ありの
    見た目・契約が検証されない。固定の予約を1件だけ返す。
  */
  const commonVarSchedules = /^\/api\/common-vars\/([^/]+)\/schedules$/.exec(pathname)
  if (commonVarSchedules) {
    return {
      success: true,
      data: commonVarSchedules[1] === COMMON_VAR_DETAIL.id
        ? COMMON_VAR_SCHEDULES
        : commonVarSchedules[1] === COMMON_VAR_HOURS_DETAIL.id ? COMMON_VAR_HOURS_SCHEDULES : [],
    }
  }
  const mediaDeleteImpact = /^\/api\/media\/([^/]+)\/delete-impact$/.exec(pathname)
  if (mediaDeleteImpact) {
    const impact = mediaDeleteImpact[1] === MEDIA_DELETE_IMPACT_EMPTY.media.id
      ? MEDIA_DELETE_IMPACT_EMPTY
      : MEDIA_DELETE_IMPACT
    return { success: true, data: impact }
  }
  const mediaReplacementImpact = /^\/api\/media\/([^/]+)\/replacement-impact$/.exec(pathname)
  if (mediaReplacementImpact) {
    if (query.get('replacementId') === 'media-delete-target') {
      return { success: true, data: MEDIA_REPLACEMENT_IMPACT_BLOCKED }
    }
    const impact = mediaReplacementImpact[1] === MEDIA_REPLACEMENT_IMPACT_EMPTY.source.id
      ? MEDIA_REPLACEMENT_IMPACT_EMPTY
      : MEDIA_REPLACEMENT_IMPACT
    return { success: true, data: impact }
  }
  const richMenuDeleteImpact = /^\/api\/rich-menu-groups\/([^/]+)\/delete-impact$/.exec(pathname)
  if (richMenuDeleteImpact) {
    const impact = richMenuDeleteImpact[1] === RICH_MENU_DELETE_IMPACT_EMPTY.group.id
      ? RICH_MENU_DELETE_IMPACT_EMPTY
      : RICH_MENU_DELETE_IMPACT
    // 一覧のどの行の「削除」から開いても、その行の影響として返す（板 `yOyCg` は一覧の先頭行で開く）。
    const asked = RICH_MENU_GROUPS.find((group) => group.id === richMenuDeleteImpact[1])
    if (asked && impact === RICH_MENU_DELETE_IMPACT && asked.id !== impact.group.id) {
      // 既定（全員）でない行に「既定になっている」は付けない。
      const blockers = impact.blockers.filter((key) => key !== 'default_for_all' || asked.isDefaultForAll)
      return {
        success: true,
        data: {
          ...impact,
          group: { ...impact.group, id: asked.id, name: asked.name, status: asked.status },
          lineResources: { ...impact.lineResources, isDefaultForAll: Boolean(asked.isDefaultForAll) },
          blockers,
        },
      }
    }
    return { success: true, data: impact }
  }
  if (pathname === '/api/rich-menu-groups') {
    if (query.has('page') || query.has('limit')) {
      const page = Math.max(1, Number(query.get('page')) || 1)
      const limit = Math.max(1, Math.min(200, Number(query.get('limit')) || 50))
      const search = (query.get('query') ?? '').trim().toLocaleLowerCase('ja')
      const folderId = query.get('folderId')
      const filter = query.get('filter')
      const sort = query.get('sort') ?? 'priority'
      const narrowed = RICH_MENU_GROUPS.filter((group) => {
        if (search && !group.name.toLocaleLowerCase('ja').includes(search)) return false
        if (folderId === '__unfiled__' && group.folderId !== null) return false
        if (folderId && folderId !== '__unfiled__' && group.folderId !== folderId) return false
        if (filter === 'published' && group.status !== 'published') return false
        if (filter === 'scheduled' && !group.publishingAt) return false
        if (filter === 'draft' && group.status !== 'draft') return false
        if (filter === 'targeting' && !group.targetingEnabled) return false
        return true
      }).sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name, 'ja') || a.id.localeCompare(b.id)
        if (sort === 'updated') return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
        if (sort === 'taps') {
          return (b.monthlyStats?.taps ?? -1) - (a.monthlyStats?.taps ?? -1) || a.id.localeCompare(b.id)
        }
        return a.targetingPriority - b.targetingPriority || a.id.localeCompare(b.id)
      })
      const total = narrowed.length
      const offset = (page - 1) * limit
      const appliedSort = sort === 'taps'
        ? [{ field: 'monthlyStats.taps', direction: 'desc' }, { field: 'id', direction: 'asc' }]
        : sort === 'updated'
          ? [{ field: 'updatedAt', direction: 'desc' }, { field: 'id', direction: 'asc' }]
          : sort === 'name'
            ? [{ field: 'name', direction: 'asc' }, { field: 'id', direction: 'asc' }]
            : [
                { field: 'targetingPriority', direction: 'asc' },
                { field: 'createdAt', direction: 'asc' },
                { field: 'id', direction: 'asc' },
              ]
      return {
        success: true,
        data: {
          items: narrowed.slice(offset, offset + limit),
          total,
          limit,
          sort: appliedSort,
          facets: {
            total: RICH_MENU_GROUPS.length,
            published: RICH_MENU_GROUPS.filter((group) => group.status === 'published').length,
            targeting: RICH_MENU_GROUPS.filter((group) => group.targetingEnabled).length,
            folderCounts: Object.fromEntries(
              RICH_MENU_GROUPS.reduce((counts, group) => {
                const key = group.folderId ?? '__unfiled__'
                counts.set(key, (counts.get(key) ?? 0) + 1)
                return counts
              }, new Map()),
            ),
          },
        },
      }
    }
    return { success: true, data: RICH_MENU_GROUPS }
  }
  if (pathname === '/api/rich-menu-groups/external') {
    return { success: true, data: RICH_MENU_EXTERNAL }
  }
  if (pathname === '/api/rich-menu-groups/tap-stats') {
    return { success: true, data: RICH_MENU_TAP_STATS }
  }
  const richMenuGroup = /^\/api\/rich-menu-groups\/([^/]+)$/.exec(pathname)
  if (richMenuGroup) {
    const group = RICH_MENU_GROUP_DETAILS[richMenuGroup[1]]
    return group
      ? { success: true, data: group }
      : { success: false, error: 'リッチメニューが見つかりません' }
  }
  if (pathname === '/api/tag-groups') return { success: true, data: TAG_GROUPS }
  if (pathname === '/api/list-stats') return { success: true, data: LIST_STATS }
  if (/^\/api\/accounts\/[^/]+\/health$/.test(pathname)) {
    /*
      `{status,checks}` ではない。ダッシュボードは `logs` を数える。

      **`'ok'` ではなく `'normal'`。** 画面の `HealthRisk` は
      `'normal' | 'warning' | 'danger'` で、`'ok'` はどれにも当たらない。
      当たらないと「状態確認中」のままになり、設計の「正常稼働」と
      並べたときに**実装の差に見えてしまう**（実際はこちらの返事が違うだけ）。
    */
    const accountId = pathname.split('/')[3]
    const logs = ACCOUNT_HEALTH_LOGS[accountId] ?? []
    return { success: true, data: { riskLevel: logs[0]?.riskLevel ?? 'normal', logs } }
  }
  if (pathname === '/api/notifications/center') {
    /*
      ダッシュボードの通知パネル。**器の形が合わないと画面が落ちる。**
      `isDashboardNotificationData` が `items` と `counts.{all,error,update,unread}`
      と `unreadCount` を見ていて、既定の器（空配列）だと通らず
      「通知を読み込めませんでした」になっていた。

      通知の画面（y8QQV）の6件。種類（eventType）は行の右の「〇〇を開く」が絵どおりに出る形。
      未読は3件（ベルの数「3」も全部の板でこの数）。
    */
    const item = (id, eventType, category, title, body, isRead, createdAt) => ({
      id, eventType, category, title, body,
      metadata: null, isRead, createdAt,
    })
    const items = [
      item('nc-3', 'ec.import_failed', 'error', 'EC連携の取り込みが 3 件失敗しています', 'EC連携を開く', false, '2026-08-21T00:15:00.000Z'),
      item('nc-2', 'account_health_webhook_delay', 'error', 'LINE Webhook の応答遅延を検知しました', '運用状態を開く', false, '2026-08-21T09:32:00.000Z'),
      item('nc-1', 'broadcast.send_failed', 'error', '一斉配信「8月号のご案内」で 12 件が送信失敗', '配信結果を開く', false, '2026-08-20T11:05:00.000Z'),
      item('nc-4', 'visual_qa.update', 'update', 'v0.25 の更新が利用できます', '更新履歴を見る', true, '2026-08-20T00:00:00.000Z'),
      item('nc-5', 'visual_qa.update', 'update', 'v0.24.1 を適用しました', '更新履歴を見る', true, '2026-08-14T00:00:00.000Z'),
      item('nc-6', 'maintenance.scheduled', 'update', 'メンテナンス予定 8/30 2:00〜4:00', '詳細を見る', true, '2026-08-12T00:00:00.000Z'),
    ]
    const category = query.get('category')
    const shown = category && category !== 'all' ? items.filter((x) => x.category === category) : items
    return {
      success: true,
      data: {
        items: shown,
        counts: {
          all: items.length,
          error: items.filter((x) => x.category === 'error').length,
          update: items.filter((x) => x.category === 'update').length,
          unread: items.filter((x) => !x.isRead).length,
        },
        unreadCount: items.filter((x) => !x.isRead).length,
      },
    }
  }
  /* Search Console（絵 h1G4d）。つないだ状態の検索の数字。 */
  if (pathname === '/api/search-console/performance') {
    return {
      success: true,
      data: {
        status: 'connected', siteUrl: 'sc-domain:nen.example', startDate: '2026-09-02', endDate: '2026-10-01', rangeDays: Number(query.get('days') ?? 28),
        summary: { clicks: 1846, impressions: 48210, ctr: 0.038, position: 12.4 },
        previousSummary: { clicks: 1634, impressions: 44310, ctr: 0.037, position: 12.9 },
        daily: [
        { key: '2026-09-02', clicks: 55, impressions: 1430, ctr: 0.038, position: 12.4 },
        { key: '2026-09-03', clicks: 50, impressions: 1300, ctr: 0.038, position: 12.4 },
        { key: '2026-09-04', clicks: 64, impressions: 1664, ctr: 0.038, position: 12.4 },
        { key: '2026-09-05', clicks: 58, impressions: 1508, ctr: 0.038, position: 12.4 },
        { key: '2026-09-06', clicks: 73, impressions: 1898, ctr: 0.038, position: 12.4 },
        { key: '2026-09-07', clicks: 69, impressions: 1794, ctr: 0.038, position: 12.4 },
        { key: '2026-09-08', clicks: 42, impressions: 1092, ctr: 0.038, position: 12.4 },
        { key: '2026-09-09', clicks: 40, impressions: 1040, ctr: 0.038, position: 12.4 },
        { key: '2026-09-10', clicks: 61, impressions: 1586, ctr: 0.038, position: 12.4 },
        { key: '2026-09-11', clicks: 66, impressions: 1716, ctr: 0.038, position: 12.4 },
        { key: '2026-09-12', clicks: 74, impressions: 1924, ctr: 0.038, position: 12.4 },
        { key: '2026-09-13', clicks: 72, impressions: 1872, ctr: 0.038, position: 12.4 },
        { key: '2026-09-14', clicks: 78, impressions: 2028, ctr: 0.038, position: 12.4 },
        { key: '2026-09-15', clicks: 47, impressions: 1222, ctr: 0.038, position: 12.4 },
        { key: '2026-09-16', clicks: 43, impressions: 1118, ctr: 0.038, position: 12.4 },
        { key: '2026-09-17', clicks: 63, impressions: 1638, ctr: 0.038, position: 12.4 },
        { key: '2026-09-18', clicks: 69, impressions: 1794, ctr: 0.038, position: 12.4 },
        { key: '2026-09-19', clicks: 76, impressions: 1976, ctr: 0.038, position: 12.4 },
        { key: '2026-09-20', clicks: 71, impressions: 1846, ctr: 0.038, position: 12.4 },
        { key: '2026-09-21', clicks: 83, impressions: 2158, ctr: 0.038, position: 12.4 },
        { key: '2026-09-22', clicks: 53, impressions: 1378, ctr: 0.038, position: 12.4 },
        { key: '2026-09-23', clicks: 49, impressions: 1274, ctr: 0.038, position: 12.4 },
        { key: '2026-09-24', clicks: 67, impressions: 1742, ctr: 0.038, position: 12.4 },
        { key: '2026-09-25', clicks: 73, impressions: 1898, ctr: 0.038, position: 12.4 },
        { key: '2026-09-26', clicks: 79, impressions: 2054, ctr: 0.038, position: 12.4 },
        { key: '2026-09-27', clicks: 77, impressions: 2002, ctr: 0.038, position: 12.4 },
        { key: '2026-09-28', clicks: 86, impressions: 2236, ctr: 0.038, position: 12.4 },
        { key: '2026-09-29', clicks: 59, impressions: 1534, ctr: 0.038, position: 12.4 },
        { key: '2026-09-30', clicks: 51, impressions: 1326, ctr: 0.038, position: 12.4 },
        { key: '2026-10-01', clicks: 0, impressions: 0, ctr: 0, position: 12.4 },
        ],
        queries: [
        { key: '鹿肉 ドッグフード', clicks: 412, impressions: 6120, ctr: 0.0673, position: 3.2 },
        { key: '犬 手作りごはん', clicks: 238, impressions: 9800, ctr: 0.0243, position: 8.9 },
        { key: '然 nen', clicks: 201, impressions: 640, ctr: 0.3141, position: 1.0 },
        { key: 'ペット 定期便', clicks: 96, impressions: 4210, ctr: 0.0228, position: 11.6 },
        { key: '鹿肉ふりかけ', clicks: 88, impressions: 1020, ctr: 0.0863, position: 4.1 },
        ],
        pages: [
        { key: 'https://nen.example/', clicks: 522, impressions: 12400, ctr: 0.0421, position: 6.1 },
        { key: 'https://nen.example/products/venison', clicks: 388, impressions: 8950, ctr: 0.0434, position: 4.8 },
        { key: 'https://nen.example/guide/homemade', clicks: 241, impressions: 10300, ctr: 0.0234, position: 9.2 },
        { key: 'https://nen.example/teiki', clicks: 119, impressions: 5020, ctr: 0.0237, position: 10.4 },
        { key: 'https://nen.example/column/autumn', clicks: 74, impressions: 3880, ctr: 0.0191, position: 14.0 },
        ],
        devices: [
          { key: 'MOBILE', clicks: 1420, impressions: 36000, ctr: 0.039, position: 12.1 },
          { key: 'DESKTOP', clicks: 371, impressions: 10500, ctr: 0.035, position: 13.0 },
          { key: 'TABLET', clicks: 55, impressions: 1710, ctr: 0.032, position: 13.4 },
        ],
        fetchedAt: '2026-10-01T06:00:00+09:00',
      },
    }
  }
  if (pathname === '/api/analytics/url-clicks') {
    /*
      分析のURLクリック。**入れ子の器で返す。**
      画面は `state.data.data` と読む（`period` は外側にある）。
      ほかの分析タブと同じ形。既定の器だと `overview.stateReason` で落ちて、
      画面が丸ごと「画面を表示できませんでした」になっていた。
    */
    return {
      success: true,
      data: {
        lineAccountId: 'visual-qa-account',
        timeZone: 'Asia/Tokyo',
        period: { from: '2026-09-02', to: '2026-10-01' },
        dataCutoffAt: '2026-10-01T06:00:00+09:00',
        data: {
          state: 'available',
          stateReason: null,
          clickRateDefinition: 'クリック率は「実人数 ÷ 届いた人数」で出しています。',
          // 点検#508軽5: 初回・最終日時とタグ由来がないと、その表示を壊しても撮影で気づけない。
          // 絵（iK4cQ）の5件。初回・最終日時とタグ由来は1件目・3件目に入れて、行の補足を撮影で見られるようにする。
          hasMore: false,
          links: [
            {
              trackedLinkId: 'tl-1', name: '秋の新商品ページ', originalUrl: 'https://nen.example/autumn',
              isActive: true, clicks: METRIC(412), knownClickPeople: METRIC(118),
              deliveredPeople: METRIC(1262), clickRate: METRIC(9.4),
              firstClickedAt: METRIC('2026-09-30T19:05:00+09:00'),
              lastClickedAt: METRIC('2026-10-01T05:40:00+09:00'),
              actions: { tagName: '秋の新商品に興味', scenarioName: null },
              usageLocations: ['一斉配信「秋の新商品のご案内」'],
            },
            {
              trackedLinkId: 'tl-2', name: '定期便の申し込み', originalUrl: 'https://nen.example/teiki',
              isActive: true, clicks: METRIC(301), knownClickPeople: METRIC(96),
              deliveredPeople: METRIC(1251), clickRate: METRIC(7.7),
              usageLocations: ['一斉配信「定期便 10%オフ」'],
            },
            {
              trackedLinkId: 'tl-3', name: 'はじめてガイド', originalUrl: 'https://nen.example/guide',
              isActive: true, clicks: METRIC(188), knownClickPeople: METRIC(61),
              deliveredPeople: METRIC(598), clickRate: METRIC(10.2),
              actions: { tagName: null, scenarioName: '初回購入フォロー' },
              usageLocations: ['シナリオ「初回購入のお礼 3通目」'],
            },
            {
              trackedLinkId: 'tl-4', name: 'お盆の営業日', originalUrl: 'https://nen.example/obon',
              isActive: false, clicks: METRIC(97), knownClickPeople: METRIC(30),
              deliveredPeople: METRIC(787), clickRate: METRIC(3.8),
              usageLocations: ['一斉配信「お盆休みのお知らせ」'],
            },
            {
              trackedLinkId: 'tl-5', name: '誕生日クーポン', originalUrl: 'https://nen.example/birthday',
              isActive: true, clicks: METRIC(0), knownClickPeople: METRIC(0),
              deliveredPeople: METRIC(14), clickRate: METRIC(null, 'insufficient', 'まだ押されていません'),
              usageLocations: ['シナリオ「誕生日クーポン」'],
            },
          ],
        },
      },
    }
  }
  if (pathname === '/api/nen-campaigns/settings') return { success: true, data: NEN_CAMPAIGN_SETTINGS }
  if (pathname === '/api/nen-campaigns/columns') return { success: true, data: NEN_COLUMNS }
  if (pathname === '/api/nen-campaigns/columns-preview') {
    const targetMode = query.get('targetMode') === 'tag' ? 'tag' : 'all'
    return {
      success: true,
      data: targetMode === 'tag'
        ? NEN_COLUMN_OPERATIONS.audience
        : { count: 1_284, targetMode: 'all', targetTagId: null },
    }
  }
  if (pathname === '/api/nen-campaigns/pets') return { success: true, data: NEN_PETS }
  if (pathname === '/api/nen-campaigns/jobs') return { success: true, data: NEN_JOBS }
  if (pathname === '/api/nen-campaigns/metrics/flows') return { success: true, data: nenMetricsBody(NEN_FLOW_METRICS, query) }
  if (pathname === '/api/nen-campaigns/metrics/columns') return { success: true, data: nenMetricsBody(NEN_COLUMN_METRICS, query) }
  if (pathname === '/api/nen-campaigns/metrics/pets') return { success: true, data: nenMetricsBody(NEN_PET_METRICS, query) }
  if (pathname === '/api/nen-campaigns/deliveries') {
    const status = query.get('status')
    const cursor = Math.max(0, Number.parseInt(query.get('cursor') ?? '0', 10) || 0)
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.get('limit') ?? '20', 10) || 20))
    const filtered = status
      ? NEN_DELIVERIES.deliveries.filter((delivery) => delivery.status === status)
      : NEN_DELIVERIES.deliveries
    return {
      success: true,
      data: {
        ...nenMetricsBody(NEN_DELIVERIES, query),
        deliveries: filtered.slice(cursor, cursor + limit),
        pagination: {
          total: status ? filtered.length : NEN_DELIVERIES.pagination.total,
          limit,
          cursor: String(cursor),
          nextCursor: cursor + limit < (status ? filtered.length : NEN_DELIVERIES.pagination.total)
            ? String(cursor + limit)
            : null,
        },
      },
    }
  }
  const nenDeliveryDetail = /^\/api\/nen-campaigns\/deliveries\/([^/]+)$/.exec(pathname)
  if (nenDeliveryDetail) {
    const detail = NEN_DELIVERY_DETAILS[decodeURIComponent(nenDeliveryDetail[1])]
    return detail
      ? { success: true, data: detail }
      : { status: 404, body: { success: false, error: '配信記録が見つかりません' } }
  }
  if (pathname === '/api/nen-campaigns/birthday-coupon') return { success: true, data: NEN_BIRTHDAY_COUPON }
  if (pathname === '/api/nen-campaigns/overview') {
    // `jobs` が入っていないと `overview.jobs.pending` で落ちる。
    return { success: true, data: { activeCampaigns: 6, jobs: { total: 2640, pending: 148, sent: 2486, failed: 6 }, columns: 24, pets: 864, coupons: 28 } }
  }
  if (pathname === '/api/webhooks/interactions') {
    /*
      やり取りの記録。**`summary` が丸ごと要る。**
      既定の器だと `data.summary.total` で落ち、画面が
      「画面を表示できませんでした」になっていた。
      数と行は V8 の絵 `Uv9AA` に合わせる（この30日 2,146回・送った 1,734・
      受け取った 412・失敗 2）。帯は送るタブ `ZSbFY` も同じ数を読む。
    */
    return {
      success: true,
      data: {
        total: 2_146,
        page: 1,
        limit: 20,
        summary: {
          total: 2_146, outgoing: 1_734, incoming: 412, succeeded: 2_144, failed: 2,
          resultUnknown: 0, outgoingFailed: 2, retryable: 2, averageDurationMs: 400,
        },
        items: [
          {
            id: 'wi-1', direction: 'outgoing', webhookName: '顧客台帳（CRM）',
            eventType: 'friend.added', triggerSummary: 'タグが付いた・Kenta Kawano',
            status: 'succeeded', responseLabel: '200 OK', responseStatus: 200,
            attemptCount: 1, durationMs: 400, failureReason: null, failureReasonCode: null, canRetry: false,
            retryBlockReason: null, autoRetryNextAt: null,
            startedAt: '2026-09-30T01:12:00.000Z', completedAt: '2026-09-30T01:12:00.400Z', retryOfId: null,
          },
          {
            id: 'wi-2', direction: 'outgoing', webhookName: '予約台帳',
            eventType: 'incoming_webhook.reservation', triggerSummary: '予約が入った・Masato S.',
            status: 'failed', responseLabel: '500 エラー', responseStatus: 500,
            attemptCount: 3, durationMs: 30_000, failureReason: '3回やり直して失敗', failureReasonCode: 'response_5xx', canRetry: true,
            retryBlockReason: null, autoRetryNextAt: null,
            startedAt: '2026-09-30T00:58:00.000Z', completedAt: '2026-09-30T00:58:30.000Z', retryOfId: null,
          },
          {
            id: 'wi-3', direction: 'outgoing', webhookName: '在庫システム',
            eventType: 'order.created', triggerSummary: '注文が確定・菅野 亮',
            status: 'succeeded', responseLabel: '200 OK', responseStatus: 200,
            attemptCount: 1, durationMs: 600, failureReason: null, failureReasonCode: null, canRetry: false,
            retryBlockReason: null, autoRetryNextAt: null,
            startedAt: '2026-09-30T00:40:00.000Z', completedAt: '2026-09-30T00:40:00.600Z', retryOfId: null,
          },
          {
            id: 'wi-4', direction: 'incoming', webhookName: 'フォームの受け口',
            eventType: 'incoming_webhook.survey', triggerSummary: '申込・山田 太郎',
            status: 'succeeded', responseLabel: '受け取った', responseStatus: 200,
            attemptCount: 1, durationMs: 200, failureReason: null, failureReasonCode: null, canRetry: false,
            retryBlockReason: null, autoRetryNextAt: null,
            startedAt: '2026-09-30T00:31:00.000Z', completedAt: '2026-09-30T00:31:00.200Z', retryOfId: null,
          },
          {
            id: 'wi-5', direction: 'outgoing', webhookName: 'Slack への通知',
            eventType: 'message_received', triggerSummary: '問い合わせ・坂本 真人',
            status: 'succeeded', responseLabel: '200 OK', responseStatus: 200,
            attemptCount: 1, durationMs: 300, failureReason: null, failureReasonCode: null, canRetry: false,
            retryBlockReason: null, autoRetryNextAt: null,
            startedAt: '2026-09-29T23:02:00.000Z', completedAt: '2026-09-29T23:02:00.300Z', retryOfId: null,
          },
        ],
      },
    }
  }
  if (pathname === '/api/common-actions/resources') {
    /*
      共通アクションを作るときの選択肢。**器が6つとも要る。**

      `api.ts` の `CommonActionResources` は6つの配列を持つが、
      `readArrayGetPaths()` は「返りが配列そのもの」の口しか拾えないので、
      ここが既定の `{items,total,page,limit}` に落ちていた。
      画面は `resources.tags.map(...)` を読むので
      `Cannot read properties of undefined (reading 'map')` で
      `/common-actions/new` が「画面を表示できませんでした」になっていた。
    */
    return {
      success: true,
      data: {
        tags: [
          { id: 'tag-vip', name: 'VIP' },
          { id: 'tag-trial', name: '体験申込' },
        ],
        scenarios: [{ id: 'scenario-0', name: '来店後シナリオ' }],
        templates: [{ id: 'template-usage-1', name: '来店後のご案内' }],
        webhooks: [{ id: 'wh-1', name: '予約サービスへ知らせる' }],
        richMenus: [{ id: 'rmg-1', name: '通常メニュー' }],
        commonActions: [
          // 機能6。XQfMD/FpgxHの設計状態「配信済みタグを追加」。
          { id: 'ca-broadcast-delivered-tag', name: 'タグ「8月キャンペーン配信済み」を追加', version: 1 },
          { id: 'ca-1', name: '来店後のご案内', version: 3 },
          { id: 'ca-subscription-guide', name: '定期便スタートガイド', version: 1 },
        ],
      },
    }
  }
  // 板 `ziSgL`：「購入のお礼」の版と使われている場所。ほかの ID は今までどおり COMMON_ACTION_DETAIL。
  if (pathname === '/api/common-actions/ca-2' && method === 'GET') {
    return { success: true, data: COMMON_ACTION_DETAIL_PURCHASE }
  }
  if (pathname === '/api/common-actions/ca-broadcast-delivered-tag') {
    return {
      success: true,
      data: {
        ...COMMON_ACTION_DETAIL,
        id: 'ca-broadcast-delivered-tag',
        name: 'タグ「8月キャンペーン配信済み」を追加',
        currentDraftVersionId: null,
        currentPublishedVersionId: 'cav-broadcast-delivered-tag-1',
        versions: [{
          id: 'cav-broadcast-delivered-tag-1', versionNumber: 1, status: 'published', draftRevision: 1,
          actions: [{ id: 'broadcast-delivered-tag-step', type: 'add_tag', params: { tagId: 'tag-broadcast-delivered' }, onFailure: 'stop' }],
          createdBy: 'Kenta Kawano', createdAt: '2026-08-20T00:00:00.000Z', publishedAt: '2026-08-20T00:00:00.000Z',
        }],
        bindings: [],
      },
    }
  }
  if (pathname.startsWith('/api/common-actions/') && !pathname.includes('/resources')) {
    // 監査 R480: 保管・復元の見本（型どおりの名前で）。
    if (pathname.endsWith('/archive') && method === 'POST') {
      return { success: true, data: { archived: true } }
    }
    if (pathname.endsWith('/unarchive') && method === 'POST') {
      return { success: true, data: { unarchived: true } }
    }
    // `versions` `bindings` が入っていないと `.find` で落ちる。
    return { success: true, data: COMMON_ACTION_DETAIL }
  }
  if (pathname === '/api/saved-searches' && query.get('format') === 'segment_v1') {
    /*
      配信の「保存した条件から選ぶ」。
      空だと「この条件を使う」の行が描かれず、設計 `sqFXf`（対象条件を編集）が
      撮れなかった。設計と同じ2件を返す。
    */
    return {
      success: true,
      data: [
        {
          id: 'sp-1', name: 'VIPかつ未契約', scope: 'friends', conditionFormat: 'segment_v1',
          conditions: { version: 1, condition: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-vip' }, { type: 'tag_not_exists', value: 'tag-trial' }], groups: [] } },
          createdBy: '河野 健太', lineAccountId: 'visual-qa-account', isShared: true,
          displayOrder: 1, createdAt: '2026-08-10T00:00:00.000Z',
          usedIn: [{ kind: 'broadcast', count: 2 }, { kind: 'automation', count: 1 }],
        },
        {
          id: 'sp-2', name: '誕生日30日前', scope: 'friends', conditionFormat: 'segment_v1',
          conditions: { version: 1, condition: { operator: 'AND', rules: [{ type: 'registered_at', value: { from: '2026-07-25', to: '' } }], groups: [] } },
          createdBy: '河野 健太', lineAccountId: 'visual-qa-account', isShared: false,
          displayOrder: 2, createdAt: '2026-08-18T00:00:00.000Z',
          usedIn: [{ kind: 'other', count: 1 }],
        },
      ],
    }
  }
  if (pathname === '/api/webinars') {
    /*
      本物と同じ offset 方式(page/limit・total・sort)。全件配列を返すと、
      頁ごと取得の新コードが撮影で壊れる。絞り無しの既定は従来どおり
      全件が1頁に入る(5件・total 5)で、既定の撮影は変わらない。
    */
    const rawPage = Number(query.get('page') ?? '')
    const rawLimit = Number(query.get('limit') ?? '')
    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50
    const sort = query.get('sort') === 'created' ? 'created' : query.get('sort') === 'name' ? 'name' : 'updated'
    const status = query.get('status') === 'active' || query.get('status') === 'draft' ? query.get('status') : ''
    const folder = query.get('folder') ?? ''
    const needle = (query.get('q') ?? '').trim().toLowerCase()
    let rows = WEBINARS.filter((webinar) => webinar.status !== 'archived')
    if (status) rows = rows.filter((webinar) => webinar.status === status)
    if (folder === '__unfiled__') rows = rows.filter((webinar) => !webinar.folderId)
    else if (folder) rows = rows.filter((webinar) => webinar.folderId === folder)
    if (needle) {
      rows = rows.filter((webinar) => webinar.title.toLowerCase().includes(needle) || webinar.slug.toLowerCase().includes(needle))
    }
    rows = [...rows].sort((left, right) => {
      if (sort === 'name') return left.title < right.title ? -1 : left.title > right.title ? 1 : 0
      const key = sort === 'created' ? 'createdAt' : 'updatedAt'
      return left[key] > right[key] ? -1 : left[key] < right[key] ? 1 : 0
    })
    const sorts = {
      updated: { field: 'updatedAt', direction: 'desc' },
      created: { field: 'createdAt', direction: 'desc' },
      name: { field: 'title', direction: 'asc' },
    }
    return {
      success: true,
      data: {
        items: rows.slice((page - 1) * limit, page * limit),
        total: rows.length,
        limit,
        sort: [sorts[sort]],
      },
    }
  }
  if (pathname === '/api/webinars/overview') return { success: true, data: WEBINAR_OVERVIEW }
  /*
    日時指定のウェビナー（板 LPOe7）。一覧には出さない ID で、開催回3つ・動画は準備の途中（配信の形）。
    撮影は /webinars/edit?id=webinar-scheduled&pane=video。
  */
  if (pathname === '/api/webinars/webinar-scheduled/editor') return { success: true, data: { ...WEBINAR_EDITOR, deliveryKind: 'scheduled' } }
  if (/^\/api\/webinars\/[^/]+\/editor$/.test(pathname)) return { success: true, data: WEBINAR_EDITOR }
  if (/^\/api\/webinars\/[^/]+\/publish-validation$/.test(pathname)) return { success: true, data: WEBINAR_PUBLISH_VALIDATION }
  if (/^\/api\/webinars\/[^/]+\/participants$/.test(pathname)) return { success: true, data: WEBINAR_PARTICIPANTS }
  if (/^\/api\/webinars\/[^/]+\/notifications$/.test(pathname)) return { success: true, data: WEBINAR_NOTIFICATIONS }
  if (/^\/api\/webinars\/[^/]+\/ctas$/.test(pathname)) return { success: true, data: WEBINAR_CTAS }
  if (/^\/api\/webinars\/[^/]+\/actions$/.test(pathname)) return { success: true, data: WEBINAR_ACTIONS }
  if (/^\/api\/webinars\/[^/]+\/comments$/.test(pathname)) return { success: true, data: WEBINAR_COMMENTS }
  if (/^\/api\/webinars\/[^/]+\/user-comments$/.test(pathname)) return { success: true, data: [] }
  if (/^\/api\/webinars\/[^/]+\/analytics$/.test(pathname)) return { success: true, data: WEBINAR_ANALYTICS }
  if (/^\/api\/webinars\/[^/]+\/video-asset$/.test(pathname)) {
    /* 準備の途中を見せるのは日時指定の見本（LPOe7）だけ。ほかは準備が済んだ動画（VWNaA は段を出さない）。 */
    if (pathname.split('/')[3] === 'webinar-scheduled') return { success: true, data: { asset: mockVideoAsset } }
    return { success: true, data: { asset: mockVideoAsset ? { ...WEBINAR_VIDEO_ASSET, stage: 'ready', stageLabel: '準備完了' } : null } }
  }
  if (/^\/api\/webinars\/[^/]+\/sessions\/[^/]+$/.test(pathname)) {
    const startAt = Number(pathname.split('/').pop())
    const scheduledIndex = pathname.split('/')[3] === 'webinar-scheduled'
      ? SCHEDULED_SESSIONS.findIndex(([at]) => Math.floor(Date.parse(at) / 1000) === startAt)
      : -1
    if (scheduledIndex >= 0) {
      const [, capacity, reservedCount] = SCHEDULED_SESSIONS[scheduledIndex]
      return {
        success: true,
        data: {
          session: {
            sessionStartAt: startAt, capacity, reservedCount,
            state: capacity !== null && reservedCount >= capacity ? 'full' : 'open',
            remaining: capacity === null ? null : Math.max(0, capacity - reservedCount),
          },
        },
      }
    }
    const capacity = mockSessionCapacity
    const reservedCount = 3
    return {
      success: true,
      data: {
        session: {
          sessionStartAt: startAt, capacity, reservedCount,
          state: capacity !== null && reservedCount >= capacity ? 'full' : 'open',
          remaining: capacity === null ? null : Math.max(0, capacity - reservedCount),
        },
      },
    }
  }
  if (/^\/api\/webinars\/[^/]+$/.test(pathname)) {
    /*
      ウェビナー1件。**器を通さない**（`fetchApi<{ data: Webinar }>`）。
      既定の器だと `analytics.participants.length` の手前で落ちて、
      `/webinars/edit` が丸ごと「画面を表示できませんでした」になっていた。
    */
    const webinarId = pathname.split('/').pop()
    if (webinarId === 'webinar-scheduled') {
      return {
        data: {
          ...WEBINARS[0], id: webinarId,
          schedule: SCHEDULED_SESSIONS.map(([at]) => ({ type: 'once', at })),
          publicationState: 'scheduled', publicationStartsAt: SCHEDULED_SESSIONS[0][0], publicationEndsAt: null,
        },
      }
    }
    /* 板 VWNaA の配信枠3件（毎日・毎週・単発）。毎日を先に置き、公開完了の面が読む時刻は今までどおり。 */
    return {
      data: {
        ...WEBINARS[0], id: webinarId,
        schedule: webinarId === 'webinar-1'
          ? [...WEBINARS[0].schedule, { type: 'weekly', days: [6], time: '14:00' }, { type: 'once', at: '2026-10-08T20:00:00+09:00' }]
          : WEBINARS[0].schedule,
      },
    }
  }
  if (pathname === '/api/friend-fields-stats') {
    /*
      友だち情報欄の帯。**口が無いと既定の器（`{items,total,page,limit}`）が返り、
      `summary.inUse` が `undefined` になって画面に「使用中 undefined件」と出ていた。**
      設計 `HBTk0` と文字を並べて初めて分かった。
      画面側も `undefined` を出さないよう直したが、正しい返事もここに置く。
    */
    return { success: true, data: { total: 12, inUse: 9, registeredFriends: 187, formLinks: 6, updatedThisMonth: 3 } }
  }
  if (pathname === '/api/friends') {
    /*
     * 点検 #496-23：絞り・検索・ページ送りを無視した固定231件だと、
     * 画面確認で絞りが効いて見えて実機差異に気づけない。
     * クエリに連動させる。絞り無しの既定は従来どおり（全件・total 231）で、
     * 既定の撮影が変わらないようにする。
     */
    const search = (query.get('search') ?? '').trim().toLocaleLowerCase('ja')
    const tagId = query.get('tagId') ?? ''
    const requestedLimit = Number.parseInt(query.get('limit') ?? '', 10)
    const requestedOffset = Number.parseInt(query.get('offset') ?? '', 10)
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : FRIENDS.length
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    let items = FRIENDS
    if (search) {
      items = items.filter((friend) => (friend.displayName ?? '').toLocaleLowerCase('ja').includes(search))
    }
    if (tagId) {
      items = items.filter((friend) => (friend.tags ?? []).some((tag) => tag.id === tagId))
    }
    const narrowed = search !== '' || tagId !== ''
    return {
      success: true,
      data: { items: items.slice(offset, offset + limit), total: narrowed ? items.length : 231, page: 1, limit },
    }
  }
  if (pathname in SHAPES) {
    return { success: true, data: SHAPES[pathname] }
  }
  if (ARRAY_PATHS.has(pathname)) {
    return { success: true, data: [] }
  }
  if (ARRAY_PREFIXES.some((p) => pathname.startsWith(p))) {
    return { success: true, data: [] }
  }
  return { success: true, data: EMPTY_PAGE }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`)
  const origin = req.headers.origin ?? '*'
  const method = (req.method ?? 'GET').toUpperCase()

  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-CSRF-Token, X-Admin-Session, Idempotency-Key, X-Confirm-Irreversible',
  )
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'ETag')

  if (method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  /*
    **いま動いているモックが、いまのファイルかを言う。**

    直したはずの返事が反映されず、しかもどこにも出ない、というのを
    何度かやった。直近では `/api/friend-fields-stats` を足したのに
    古いモックが動いたままで、画面に `undefined` が出続けた。
    さらに前には、口が足りない古いモックのせいで7画面が
    「画面を表示できませんでした」で落ち、実装の不具合に見えていた。

    ここが自分の中身の指紋を返し、`capture-screens.mjs` が
    ディスク上のファイルと突き合わせて、違えば撮影に入る前に止まる。
  */
  if (url.pathname === '/__mock-fingerprint') {
    res.writeHead(200).end(JSON.stringify({ fingerprint: FINGERPRINT }))
    return
  }

  if (method === 'GET' && url.pathname === '/api/file-scans') {
    const status = url.searchParams.get('status')
    const filtered = FILE_SCAN_ITEMS.filter((item) => !status || item.status === status)
    res.writeHead(200).end(JSON.stringify({ success: true, data: { items: filtered, total: filtered.length, limit: 50, offset: 0 } }))
    return
  }
  if (method === 'GET' && url.pathname === '/api/file-scans/by-subject') {
    const id = url.searchParams.get('id')
    const scan = FILE_SCAN_ITEMS.find((item) => item.subjectId === id) ?? null
    res.writeHead(200).end(JSON.stringify({ success: true, data: { scan } }))
    return
  }
  if (method === 'GET' && url.pathname === '/api/file-scans/for-media') {
    const mediaId = url.searchParams.get('mediaId')
    const scan = FILE_SCAN_ITEMS.find((item) => item.mediaId === mediaId) ?? null
    res.writeHead(200).end(JSON.stringify({ success: true, data: { scan } }))
    return
  }
  if (method === 'GET' && url.pathname === '/api/file-scans/health') {
    res.writeHead(200).end(JSON.stringify({ success: true, data: { stopped: false, pendingCount: 1, oldestPendingAt: null } }))
    return
  }
  if (method === 'GET' && url.pathname === '/api/file-scans/config') {
    res.writeHead(200).end(JSON.stringify({ success: true, data: { config: FILE_SCAN_CONFIG } }))
    return
  }
  if (method === 'GET' && url.pathname === '/api/media') {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20)))
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0))
    const kind = url.searchParams.get('kind')
    const query = (url.searchParams.get('query') || '').toLowerCase()
    const folderId = url.searchParams.get('folderId')
    const excludeId = url.searchParams.get('excludeId')
    const sort = url.searchParams.get('sort') || 'newest'
    const archived = url.searchParams.get('archived')
    const filtered = MEDIA_ITEMS.filter((item) =>
      (archived === 'only' ? item.archivedAt != null : archived === 'all' ? true : item.archivedAt == null)
      && (!kind || item.kind === kind)
      && (!excludeId || item.id !== excludeId)
      && (!query || item.filename.toLowerCase().includes(query))
      && (!folderId || (folderId === '__ungrouped__' ? item.folderId == null : item.folderId === folderId))
      && (url.searchParams.get('unusedOnly') !== '1' || item.usageCount === 0)
      && (url.searchParams.get('nearLimitOnly') !== '1' || item.sizeBytes >= (item.kind === 'image' ? 8 : item.kind === 'file' ? 16 : 160) * 1024 * 1024),
    ).toSorted((left, right) => {
      if (sort === 'oldest') return left.createdAt.localeCompare(right.createdAt)
      if (sort === 'name') return left.filename.localeCompare(right.filename, 'ja')
      if (sort === 'size') return right.sizeBytes - left.sizeBytes
      if (sort === 'usage') return (right.usageCount ?? -1) - (left.usageCount ?? -1)
      return right.createdAt.localeCompare(left.createdAt)
    })
    res.writeHead(200).end(JSON.stringify({
      success: true,
      data: { items: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset },
    }))
    return
  }

  if (method === 'GET' && url.pathname === '/api/booking/admin/requests') {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)))
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0))
    const status = url.searchParams.get('status') || 'requested'
    const query = url.searchParams.get('query') || ''
    const menuName = url.searchParams.get('menu_name')
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const filtered = BOOKING_REQUESTS.filter((item) =>
      (status === 'all' || item.status === status)
      && (!query || (item.friend_name || '').includes(query))
      && (!menuName || item.menu_name === menuName)
      && (!from || item.starts_at >= from)
      && (!to || item.starts_at < to),
    )
    res.writeHead(200).end(JSON.stringify({
      requests: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset,
    }))
    return
  }

  if (method === 'GET' && url.pathname === '/api/conversions/export') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="conversion-definitions-2026-08-25.csv"')
    res.setHeader('Cache-Control', 'no-store')
    res.writeHead(200).end(CONVERSION_EXPORT_CSV)
    return
  }

  if (method === 'GET' && url.pathname === '/api/nen-members/photos/original-download/visual-qa-once') {
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==', 'base64')
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'no-store')
    res.writeHead(200).end(jpeg)
    return
  }

  if (method === 'GET' && url.pathname.startsWith('/api/rich-menu-images/')) {
    // 6面が見分けられる撮影専用画像。1px画像ではキャンバスが黒く見え、
    // 画像本体を取得できたか判定できないため、実際の比率に近いPNGを返す。
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAlgAAAGQCAYAAAByNR6YAAAKXklEQVR42u3WMRGAMBAAwYhAASJQgQYkMPjABJLoqejSkaGgDQbyCrLFarhLwzpXoG3cFyAwHRsQSCIKBgsMFhgsMFhgsMBggcECgwUGCzBYYLDAYIHBAoMFBgsMFhgsMFhgsACDBQYLDBYYLDBYYLDAYIHBAoMFBgswWGCwwGCBwQKDBQYLDBYYLDBYYLAAgwUGCwwWGCwwWGCwwGCBwQKDBQYLMFhgsMBggcECgwUGCwwWGCwwWIDBAoMFBgsMFhgsMFhgsMBggcECgwUYLDBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBAoMFGCwwWGCwwGCBwQKDBQYLDBYYLDBYgMECgwUGCwwWGCwwWGCwwGCBwQJEFAwWGCwwWGCwwGCBwQKDBQYLDBZgsMBggcECgwUGCwwWGCwwWGCwwGABBgsMFhgsMFhgsMBggcECgwUGCwwWYLDAYIHBAoMFBgsMFhgsMFhgsMBgAQYLDBYYLDBYYLDAYIHBAoMFBgsQUTBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBAoMFGCwwWGCwwGCBwQKDBQYLDBYYLDBYgMECgwUGCwwWGCwwWGCwwGCBwQKDBRgsMFhgsMBggcECgwUGCwwWGCzAYIHBAoMFBgsMFhgsMFhgsMBggcECDBYYLDBYYLDAYIHBAoMFBgsMFhgswGCBwQKDBQYLDBYYLDBYYLDAYIHBAgwWGCwwWGCwwGCBwQKDBQYLDBYYLCEFgwUGCwwWGCwwWGCwwGCBwQKDBRgsMFhgsMBggcECgwUGCwwWGCwwWIDBAoMFBgsMFhgsMFhgsMBggcECgwUYLDBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBAoMFGCwwWGCwwGCBwQKDBQYLDBYYLMBggcECgwUGCwwWGCwwWGCwwGCBwQIMFhgsMFhgsMBggcECgwUGCwwWGCzAYIHBAoMFBgsMFhgsMFhgsMBggcECDBYYLDBYYLDAYIHBAoMFBgsMFhgswGCBwQKDBQYLDBYYLDBYYLDAYAEGCwwWGCwwWGCwwGCBwQKDBQYLDBZgsMBggcECgwUGCwwWGCwwWGCwwGABBgsMFhgsMFhgsMBggcECgwUGCwwWYLDAYIHBAoMFBgsMFhgsMFhgsMBgiSgYLDBYYLDAYIHBAoMFBgsMFhgswGCBwQKDBQYLDBYYLDBYYLDAYIHBAgwWGCwwWGCwwGCBwQKDBQYLDBYYLMBggcECgwUGCwwWGCwwGCBwQIMFhgsMFhgsMBggcECgwUGCwwWGCwRBYMFBgsMFhgsMFhgsMBggcECgwUYLDBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBAoMFGCwwWGCwwGCBwQKDBQYLDBYYLDBYgMECgwUGCwwWGCwwWGCwwGCBwQKDJaJgsMBggcECgwUGCwwWGCwwWGCwAIMFBgsMFhgsMFhgsMBggcECgwXdDdbzvRVou0sGAme+gIDBAoMFBgsMFhgsMFhgsMBggcECgwUYLDBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBAoMFGCwwWGCwwGCBwQKDBQYLDBYYLDBYgMECgwUGCwwWGCwwWGCwwGCBwQJEFAwWGCwwWGCwwGCBwQKDBQYLDBZgsMBggcECgwUGCwwWGCwwWGCwwGABBgsMFhgsMFhgsMBggcECgwUGCwwWYLDAYIHBAoMFBgsMFhgsMFhgsMBgAQYLDBYYLDBYYLDAYIHBAoMFBgsQUTBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBAoMFGCwwWGCwwGCBwQKDBQYLDBYYLDBYgMECgwUGCwwWGCwwWGCwwGCBwQKDBRgsMFhgsMBggcECgwUGCwwWGCzAYIHBAoMFBgsMFhgsMFhgsMBggcECDBYYLDBYYLDAYIHBAoMFBgsMFhgswGCBwQKDBQYLDBYYLDBYYLDAYIHBAgwWGCwwWGCwwGCBwQKDBQYLDBYYLCEFgwUGCwwWGCwwWGCwwGCBwQKDBRgsMFhgsMBggcECgwUGCwwWGCwwWIDBAoMFBgsMFhgsMFhgsMBggcECgwUYLDBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBAoMFGCwwWGCwwGCBwQKDBQYLDBYYLMBggcECgwUGCwwWGCwwWGCwwGCBwQIMFhgsMFhgsMBggcECgwUGCwwWGCzAYIHBAoMFBgsMFhgsMFhgsMBggcECDBYYLDBYYLDAYIHBAoMFBgsMFhgswGCBwQKDBQYLDBYYLDBYYLDAYAEGCwwWGCwwWGCwwGCBwQKDBQYLDBZgsMBggcECgwUGCwwWGCwwWGCwwGABBgsMFhgsMFhgsMBggcECgwUGCwwWYLDAYIHBAoMFBgsMFhgsMFhgsMBgiSgYLDBYYLDAYIHBAoMFBgsMFhgswGCBwQKDBQYLDBYYLDBYYLDAYIHBAgwWGCwwWGCwwGCBwQKDBQYLDBYYLMBggcECgwUGCwwWGCwwGCBwQIMFhgsMFhgsMBggcECgwUGCwwWGCwRBYMFBgsMFhgsMFhgsMBggcECgwUYLDBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBAoMFGCwwWGCwwGCBwQKDBQYLDBYYLDBYgMECgwUGCwwWGCwwWGCwwGCBwQKDJaJgsMBggcECgwUGCwwWGCwwWGCwAIMFBgsMFhgsMFhgsMBggcECgwUGCzBYYLDAYIHBAoMFBgsMFhgsMFhgsACDBQYLDBYYLDBYYLDAYIHBAoMFBgswWGCwwGCBwQKDBQYLDBYYLDBYYLBEFAwWGCwwWGCwwGCBwQKDBQYLDBZgsMBggcECgwUGCwwWGCwwWGCwwGABBgsMFhgsMFhgsMBggcECgwUGCwwWYLDAYIHBAoMFBgsMFhgsMFhgsMBgAQYLDBYYLDBYYLDAYIHBAoMFBgsMloiCwQKDBQYLDBYYLDBYYLDAYIHBAgwWGCwwWGCwwGCBwQKDBQYLDBYYLMBggcECgwUGCwwWGCwwWGCwwGCBwQIMFhgsMFhgsMBggcECgwUGCwwWGCzAYIHBAoMFBgsMFhgsMFhgsMBggcESUTBYYLDAYIHBAoMFBgsMFhgsMFiAwQKDBQYLDBYYLDBYYLDAYIHBgu780r18zIsQvWAAAAAASUVORK5CYII=', 'base64')
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'no-store')
    res.writeHead(200).end(png)
    return
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  // 更新は原則通さない。固定結果を返す3口も保存・配信は一切行わない。
  // それ以外を通すと「保存できたつもり」の画像が撮れてしまい、
  // 動いていない画面を動いていると読み違える。
  //
  // ただし画面側のエラー報告だけは 204 で受ける。405 を返すと、
  // 報告が失敗したこと自体が新しいエラーになって際限なく増える。
  // M (止めた経路のQR): 印刷用PDFの見本。止めた経路は409で出さない。
  const qrPdf = /^\/api\/entry-routes\/([^/]+)\/qr-pdf$/.exec(url.pathname)
  if (method === 'POST' && qrPdf) {
    const route = ENTRY_ROUTES.find((item) => item.id === qrPdf[1])
    if (!route) {
      res.writeHead(404).end(JSON.stringify({ success: false, error: 'Not found' }))
      return
    }
    if (!route.isActive) {
      res.writeHead(409).end(JSON.stringify({ success: false, error: 'この経路は停止しています' }))
      return
    }
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="qr-${route.refCode}.pdf"`)
    res.setHeader('Cache-Control', 'no-store')
    res.writeHead(200).end(QR_PRINT_PDF_SAMPLE)
    return
  }

  if (method !== 'GET') {
    const formWriteRequest = (
      (method === 'POST' && (url.pathname === '/api/forms/drafts'
        || url.pathname === `/api/forms/${FORM_DETAIL.id}/archive`))
      || (method === 'PUT' && url.pathname === `/api/forms/${FORM_DETAIL.id}`)
      || (method === 'DELETE' && url.pathname === `/api/forms/${FORM_DETAIL.id}`)
    )
    if (formWriteRequest) {
      res.writeHead(200).end(JSON.stringify(bodyFor(method, url.pathname, url.searchParams)))
      return
    }
    // 運営のお知らせ（V8 tQ2MJ・TJUUl）の宛先の見込み。数えるだけで何も変えない。
    if (method === 'POST' && url.pathname === '/api/ops/announcements/preview') {
      res.writeHead(200).end(JSON.stringify({ success: true, data: { tenants: 18, staff: 18, lineLinked: 11, withEmail: 18 } }))
      return
    }
    // 運営の 2要素認証（V8 qod6X）の QR の用意。読みだけの見本を返す。
    if (method === 'POST' && /^\/api\/staff\/[^/]+\/two-factor\/setup$/.test(url.pathname)) {
      res.writeHead(200).end(JSON.stringify(bodyFor(method, url.pathname, url.searchParams)))
      return
    }
    // J-1・N 撮影用。動画の準備の段と開催回の定員の保存を見本で返す。
    if (
      (method === 'POST' && /^\/api\/webinars\/[^/]+\/video-asset\/advance$/.test(url.pathname)) ||
      (method === 'PUT' && /^\/api\/webinars\/[^/]+\/sessions\/[^/]+$/.test(url.pathname))
    ) {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        if (/video-asset\/advance$/.test(url.pathname)) {
          const stage = typeof body.stage === 'string' ? body.stage : mockVideoAsset?.stage ?? 'uploaded'
          const labels = {
            uploaded: '受け付け', inspecting: '検査', converting: '変換',
            packaging: '配信の形', thumbnail: '表紙', ready: '準備完了', failed: '失敗',
          }
          mockVideoAsset = mockVideoAsset
            ? { ...mockVideoAsset, stage, stageLabel: labels[stage] ?? stage }
            : {
              id: 'video-asset-1', stage, stageLabel: labels[stage] ?? stage, provider: 'r2_hls',
              durationSeconds: 0, errorCode: null, expiresAt: null, purgedAt: null,
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            }
          res.writeHead(200).end(JSON.stringify({ success: true, data: { asset: mockVideoAsset } }))
          return
        }
        const capacity = body.capacity === undefined || body.capacity === null
          ? null
          : Math.floor(Number(body.capacity))
        mockSessionCapacity = Number.isInteger(capacity) && capacity >= 1 ? capacity : null
        const startAt = Number(url.pathname.split('/').pop())
        const reservedCount = 3
        res.writeHead(200).end(JSON.stringify({
          success: true,
          data: {
            session: {
              sessionStartAt: startAt, capacity: mockSessionCapacity, reservedCount,
              state: mockSessionCapacity !== null && reservedCount >= mockSessionCapacity ? 'full' : 'open',
              remaining: mockSessionCapacity === null ? null : Math.max(0, mockSessionCapacity - reservedCount),
            },
          },
        }))
      })
      return
    }
    if (/^\/api\/(mileage\/(rules|rewards|adjustments)|action-scores\/rules)/.test(url.pathname)) {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let requestBody = {}
        try { requestBody = JSON.parse(raw || '{}') } catch { requestBody = {} }
        const fixed = mileageWriteResponse(method, url.pathname, requestBody, req.headers)
        if (fixed) {
          res.writeHead(fixed.status).end(JSON.stringify(fixed.body))
          return
        }
        res.writeHead(405).end(JSON.stringify({ success: false, error: '画面確認用のため、更新はできません' }))
      })
      return
    }
    if (method === 'POST' && url.pathname === '/api/folders') {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        // R25: 回答フォームの箱も見本で作れるようにする（本物と同じ器）。
        if (body.kind === 'form') {
          if (!body.accountId || !String(body.name ?? '').trim()) {
            res.writeHead(400).end(JSON.stringify({ success: false, error: 'フォルダの内容を確認してください' }))
            return
          }
          const folder = {
            id: `form-folder-${formFolders.length + 1}`,
            kind: 'form',
            accountId: body.accountId,
            name: String(body.name).trim(),
            parentId: null,
            displayOrder: formFolders.length,
            color: body.color ?? null,
            createdAt: '2026-09-27T00:00:00.000Z',
            updatedAt: '2026-09-27T00:00:00.000Z',
          }
          formFolders = [...formFolders, folder]
          res.writeHead(201).end(JSON.stringify({ success: true, data: folder }))
          return
        }
        if (body.kind !== 'webinar') {
          res.writeHead(405).end(JSON.stringify({ success: false, error: '画面確認用のため、更新はできません' }))
          return
        }
        if (body.accountId !== 'visual-qa-account' || !String(body.name ?? '').trim()) {
          res.writeHead(400).end(JSON.stringify({ success: false, error: 'フォルダの内容を確認してください' }))
          return
        }
        const folder = {
          id: `webinar-folder-${webinarFolders.length + 1}`,
          kind: 'webinar',
          accountId: body.accountId,
          name: String(body.name).trim(),
          parentId: null,
          displayOrder: webinarFolders.length,
          count: 0,
          color: body.color ?? null,
          createdAt: '2026-09-07T15:00:00.000Z',
          updatedAt: '2026-09-07T15:00:00.000Z',
        }
        webinarFolders = [...webinarFolders, folder]
        res.writeHead(201).end(JSON.stringify({ success: true, data: folder }))
      })
      return
    }
    const webinarFolderPath = /^\/api\/folders\/([^/]+)$/.exec(url.pathname)
    // R25: webinar の箱と回答フォームの箱で見本を分ける。IDだけでは
    // 種類が分からないため、先にどちら側の箱かを見てから振り分ける。
    // R37 撮影用。登録メディア・共通情報のフォルダ名変更・削除もここで受け、
    // 本番口と同じ形（PATCH は更新後、DELETE は data: null）で返す。
    // ウェビナー・回答フォームの箱は後の口へ通す。
    const webinarFolderId = webinarFolderPath ? decodeURIComponent(webinarFolderPath[1]) : null
    const isWebinarFolder = webinarFolderId !== null && webinarFolders.some((folder) => folder.id === webinarFolderId)
    // R25: 回答フォームの箱は後の口（formFolderPath）へ通す。
    const isFormFolder = webinarFolderId !== null && formFolders.some((folder) => folder.id === webinarFolderId)
    if ((method === 'PATCH' || method === 'DELETE') && webinarFolderPath && !isWebinarFolder && !isFormFolder) {
      const mediaCommonId = decodeURIComponent(webinarFolderPath[1])
      const target = mediaFolders.find((item) => item.id === mediaCommonId)
        ?? commonVarFolders.find((item) => item.id === mediaCommonId)
      if (!target) {
        res.writeHead(404).end(JSON.stringify({ success: false, error: 'Not found' }))
        return
      }
      if (method === 'DELETE') {
        mediaFolders = mediaFolders.filter((item) => item.id !== mediaCommonId)
        commonVarFolders = commonVarFolders.filter((item) => item.id !== mediaCommonId)
        res.writeHead(200).end(JSON.stringify({ success: true, data: null }))
        return
      }
      let mediaCommonRaw = ''
      req.on('data', (chunk) => { mediaCommonRaw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(mediaCommonRaw || '{}') } catch { body = {} }
        const name = String(body.name ?? '').trim()
        if (!name) {
          res.writeHead(400).end(JSON.stringify({ success: false, error: 'フォルダ名を入力してください' }))
          return
        }
        target.name = name
        target.updatedAt = '2026-09-27T10:00:00.000Z'
        res.writeHead(200).end(JSON.stringify({ success: true, data: { ...target } }))
      })
      return
    }
    // R25: ウェビナーの箱だけここで直す。回答フォームの箱は後の口へ通す。
    if (method === 'PATCH' && webinarFolderPath && isWebinarFolder) {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        const id = decodeURIComponent(webinarFolderPath[1])
        const index = webinarFolders.findIndex((folder) => folder.id === id && folder.accountId === body.accountId)
        if (index < 0) {
          res.writeHead(404).end(JSON.stringify({ success: false, error: 'Not found' }))
          return
        }
        const folder = {
          ...webinarFolders[index],
          ...(typeof body.name === 'string' ? { name: body.name.trim() } : {}),
          ...(Number.isFinite(body.displayOrder) ? { displayOrder: body.displayOrder } : {}),
          updatedAt: '2026-09-07T15:01:00.000Z',
        }
        webinarFolders = webinarFolders.map((item, itemIndex) => itemIndex === index ? folder : item)
        webinarFolders.sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, 'ja'))
        res.writeHead(200).end(JSON.stringify({ success: true, data: folder }))
      })
      return
    }
    if (method === 'DELETE' && webinarFolderPath && isWebinarFolder) {
      const id = decodeURIComponent(webinarFolderPath[1])
      const accountId = url.searchParams.get('account_id')
      const folder = webinarFolders.find((item) => item.id === id && item.accountId === accountId)
      if (!folder) {
        res.writeHead(404).end(JSON.stringify({ success: false, error: 'Not found' }))
        return
      }
      webinarFolders = webinarFolders.filter((item) => item.id !== id)
      res.writeHead(200).end(JSON.stringify({ success: true, data: null }))
      return
    }
    // R25: 回答フォームの箱の直し・消し・並べ替えの見本（本物と同じ器）。
    const formFolderPath = /^\/api\/folders\/([^/]+)(\/swap-order)?$/.exec(url.pathname)
    if (method === 'PATCH' && formFolderPath && !formFolderPath[2]) {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        const id = decodeURIComponent(formFolderPath[1])
        const index = formFolders.findIndex((folder) => folder.id === id)
        if (index < 0) {
          res.writeHead(404).end(JSON.stringify({ success: false, error: 'Not found' }))
          return
        }
        const folder = {
          ...formFolders[index],
          ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim() } : {}),
          ...('color' in body ? { color: body.color ?? null } : {}),
          updatedAt: '2026-09-27T00:01:00.000Z',
        }
        formFolders = formFolders.map((item, itemIndex) => itemIndex === index ? folder : item)
        res.writeHead(200).end(JSON.stringify({ success: true, data: folder }))
      })
      return
    }
    if (method === 'DELETE' && formFolderPath && !formFolderPath[2]) {
      const id = decodeURIComponent(formFolderPath[1])
      // 中身（フォーム）は消さず、箱だけ消す。本物と同じく未分類に戻る。
      formFolders = formFolders.filter((item) => item.id !== id)
      res.writeHead(200).end(JSON.stringify({ success: true, data: null }))
      return
    }
    if (method === 'POST' && formFolderPath && formFolderPath[2] === '/swap-order') {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        res.writeHead(200).end(JSON.stringify({ success: true, data: { swapped: [decodeURIComponent(formFolderPath[1]), body.withId ?? null] } }))
      })
      return
    }
    if (method === 'POST' && url.pathname === '/api/conversions/definitions/preview') {
      res.writeHead(200).end(JSON.stringify({ success: true, data: CONVERSION_DEFINITION_PREVIEW }))
      return
    }
    if (method === 'POST' && url.pathname === '/api/conversions/definitions') {
      res.writeHead(201).end(JSON.stringify({ success: true, data: CONVERSION_DEFINITION_DELETE_IMPACT.definition }))
      return
    }
    if (method === 'POST' && /^\/api\/conversions\/definitions\/[^/]+\/stop$/.test(url.pathname)) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: { id: 'cp-2', status: 'stopped', version: 2, stoppedAt: '2026-09-07T14:00:00+09:00' } }))
      return
    }
    if (method === 'POST' && /^\/api\/conversions\/definitions\/[^/]+\/replace$/.test(url.pathname)) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: { id: 'cp-2', replacementId: 'cp-1', replacedUsageCount: 3, status: 'stopped', version: 2 } }))
      return
    }
    if (method === 'DELETE' && /^\/api\/conversions\/definitions\/[^/]+$/.test(url.pathname)) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: { id: 'cp-6', deleted: true } }))
      return
    }
    if (method === 'POST' && /^\/api\/webinars\/[^/]+\/public-page\/test$/.test(url.pathname)) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: WEBINAR_EDITOR }))
      return
    }
    /*
      本物の公開応答は `{ webinar, validation }`（`apps/worker/src/routes/webinars.ts`
      の publish）。単体を返すと、公開結果を読む新コードがモックで動いて
      本番で壊れる契約の穴になる。停止・複製は単体のまま。
    */
    if (method === 'POST' && /^\/api\/webinars\/[^/]+\/publish$/.test(url.pathname)) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: { webinar: WEBINARS[0], validation: WEBINAR_PUBLISH_VALIDATION } }))
      return
    }
    if (method === 'POST' && /^\/api\/webinars\/[^/]+\/(pause|duplicate)$/.test(url.pathname)) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: WEBINARS[0] }))
      return
    }
    if (method === 'POST' && /^\/api\/webinars\/[^/]+\/notifications\/test$/.test(url.pathname)) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: { sent: 1, failed: 0 } }))
      return
    }
    if (method === 'POST' && /^\/api\/automation-runs\/[^/]+\/retry$/.test(url.pathname)) {
      res.writeHead(202).end(JSON.stringify({
        success: true,
        data: { runId: url.pathname.split('/')[3], retryStepCount: 1, status: 'succeeded' },
      }))
      return
    }
    if (method === 'POST' && /^\/api\/automation-templates\/[^/]+\/drafts$/.test(url.pathname)) {
      res.writeHead(201).end(JSON.stringify({
        success: true,
        data: { id: 'automation-visual-draft', draftVersionId: 'automation-visual-version' },
      }))
      return
    }
    /*
     * 一覧の「編集する」「複製する」・稼働切替・保管（#942 N-352）。
     * 本番（`apps/worker/src/routes/automations.ts`）と同じ器で返す。
     * 無いと一覧で405になり、赤い帯「編集用の下書きを作れませんでした」
     * が出ていた（1920px見直し③）。DBへは書かない。
     */
    if (method === 'POST' && /^\/api\/automations\/[^/]+\/draft$/.test(url.pathname)) {
      const automationId = decodeURIComponent(url.pathname.split('/')[3] ?? '')
      res.writeHead(201).end(JSON.stringify({
        success: true,
        data: { id: `${automationId}-draft`, draftVersionId: `${automationId}-draft-version` },
      }))
      return
    }
    if (method === 'POST' && /^\/api\/automations\/[^/]+\/duplicate$/.test(url.pathname)) {
      const automationId = decodeURIComponent(url.pathname.split('/')[3] ?? '')
      res.writeHead(201).end(JSON.stringify({
        success: true,
        data: { id: `${automationId}-copy-draft`, draftVersionId: `${automationId}-copy-draft-version` },
      }))
      return
    }
    if (method === 'POST' && /^\/api\/automations\/[^/]+\/status$/.test(url.pathname)) {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let status = ''
        try { status = JSON.parse(raw || '{}').status ?? '' } catch { status = '' }
        if (status !== 'active' && status !== 'stopped' && status !== 'archived') {
          res.writeHead(400).end(JSON.stringify({ success: false, error: 'status は active / stopped / archived のどれかで送ってください' }))
          return
        }
        res.writeHead(200).end(JSON.stringify({
          success: true,
          data: { id: decodeURIComponent(url.pathname.split('/')[3] ?? ''), status },
        }))
      })
      return
    }
    if (method === 'PUT' && url.pathname === '/api/automation-drafts/automation-visual-draft') {
      res.writeHead(200).end(JSON.stringify({ success: true, data: { updated: true } }))
      return
    }
    if (method === 'POST' && url.pathname === '/api/automations/automation-visual-draft/audience-preview') {
      res.writeHead(200).end(JSON.stringify({
        success: true,
        data: {
          automationId: 'automation-visual-draft',
          versionId: 'automation-visual-version',
          matched: 286,
          total: 842,
          freshness: 'available',
          calculatedAt: '2026-09-07T03:00:00.000Z',
        },
      }))
      return
    }
    if (method === 'POST' && url.pathname === '/api/automations/automation-visual-draft/test') {
      res.writeHead(200).end(JSON.stringify({
        success: true,
        data: { runId: 'automation-visual-test', versionId: 'automation-visual-version', status: 'succeeded' },
      }))
      return
    }
    if (method === 'POST' && url.pathname === '/api/automation-drafts/automation-visual-draft/publish') {
      res.writeHead(200).end(JSON.stringify({
        success: true,
        data: { id: 'automation-visual-draft', versionId: 'automation-visual-version', versionNumber: 1, status: 'active' },
      }))
      return
    }
    if (method === 'PATCH' && /^\/api\/mileage\/earning-rules\/[^/]+\/draft$/.test(url.pathname)) {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        const ruleId = url.pathname.split('/')[4]
        const version = Number.isInteger(body.expectedVersion) ? body.expectedVersion + 1 : 1
        res.writeHead(200).end(JSON.stringify({
          success: true,
          data: {
            ruleId,
            lineAccountId: body.accountId ?? 'visual-qa-account',
            version,
            draft: body.draft ?? {},
            updatedAt: '2026-09-07T03:31:00.000Z',
          },
        }))
      })
      return
    }
    if (method === 'POST' && url.pathname === '/api/media/upload-sessions') {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        const files = Array.isArray(body.files) ? body.files : []
        const sessions = files.map((file, index) => ({
          id: `visual-upload-${index + 1}`,
          filename: String(file.filename ?? `upload-${index + 1}`),
          sizeBytes: Number(file.sizeBytes ?? 1),
          targetMediaId: file.targetMediaId ?? null,
          method: 'PUT',
          uploadUrl: `http://${HOST}:${PORT}/api/media/upload-sessions/visual-upload-${index + 1}/blob`,
          requiredHeaders: { 'Content-Type': String(file.mimeType ?? 'application/octet-stream') },
          expiresAt: '2026-09-07T15:15:00.000Z',
        }))
        for (const session of sessions) {
          // IDは申告順の連番で再利用されるため、最新の申告で上書きする。
          if (session.targetMediaId) mediaUploadSessionTargets.set(session.id, session.targetMediaId)
          else mediaUploadSessionTargets.delete(session.id)
        }
        res.writeHead(201).end(JSON.stringify({ success: true, data: { sessions } }))
      })
      return
    }
    if (method === 'PUT' && /^\/api\/media\/upload-sessions\/[^/]+\/blob$/.test(url.pathname)) {
      res.setHeader('ETag', '"visual-qa-etag"')
      res.writeHead(200).end()
      return
    }
    if (method === 'POST' && /^\/api\/media\/upload-sessions\/[^/]+\/complete$/.test(url.pathname)) {
      const uploadSessionId = url.pathname.split('/')[4]
      const targetMediaId = mediaUploadSessionTargets.get(uploadSessionId) ?? null
      // 差し替え用（版追加）の確定は、本番口と同じ `verified` を返す。
      // 新規登録形のまま `completed` を返すと、詳細の版追加フローが検証不能になる。
      if (targetMediaId) {
        res.writeHead(200).end(JSON.stringify({ success: true, data: { uploadSessionId, status: 'verified', targetMediaId } }))
        return
      }
      res.writeHead(200).end(JSON.stringify({ success: true, data: { uploadSessionId, status: 'completed', mediaId: 'media-uploaded-1', targetMediaId: null } }))
      return
    }
    if (url.pathname === '/api/client-errors') {
      res.writeHead(204).end()
      return
    }
    // `ymXJK` の下書き保存だけは、契約どおりの固定201を返す。
    // DB更新はせず、ほかのPOSTは従来どおり405にする。
    if (method === 'POST' && url.pathname === '/api/nen-campaigns/columns') {
      res.writeHead(NEN_COLUMN_CREATE.success.status).end(JSON.stringify(NEN_COLUMN_CREATE.success.body))
      return
    }
    if (method === 'POST' && url.pathname === '/api/nen-campaigns/columns/import') {
      res.writeHead(200).end(JSON.stringify({ success: true, data: { imported: 0 } }))
      return
    }
    const nenDuplicate = /^\/api\/nen-campaigns\/columns\/[^/]+\/duplicate$/.test(url.pathname)
    if (method === 'POST' && nenDuplicate) {
      res.writeHead(201).end(JSON.stringify({ success: true, data: NEN_COLUMN_OPERATIONS.duplicate }))
      return
    }
    const nenTestSend = /^\/api\/nen-campaigns\/columns\/[^/]+\/test-send$/.test(url.pathname)
    if (method === 'POST' && nenTestSend) {
      res.writeHead(200).end(JSON.stringify({ success: true }))
      return
    }
    const nenReadEvent = /^\/api\/nen-campaigns\/columns\/[^/]+\/read-events$/.test(url.pathname)
    if (method === 'POST' && nenReadEvent) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: NEN_COLUMN_OPERATIONS.readEvent }))
      return
    }
    if (method === 'POST' && url.pathname === '/api/nen-campaigns/deliveries/pending-now') {
      res.writeHead(200).end(JSON.stringify({ success: true, data: NEN_COLUMN_OPERATIONS.pendingNow }))
      return
    }
    /*
      タグCSVの下見と結果。保存はせず、受け取った行を固定規則で判定する。
      空欄・長すぎる名前・制御文字・既存名・不明フォルダを同じ入力なら
      毎回同じ結果にし、成功と一部失敗の両方を撮れるようにする。
    */
    if (method === 'POST' && (url.pathname === '/api/tags/import/preview' || url.pathname === '/api/tags/import')) {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let rows = TAG_IMPORT_SAMPLE_ROWS
        try {
          const parsed = JSON.parse(raw || '{}')
          if (Array.isArray(parsed.rows) && parsed.rows.length > 0) rows = parsed.rows
        } catch {
          rows = TAG_IMPORT_SAMPLE_ROWS
        }
        const data = url.pathname.endsWith('/preview') ? tagImportPreview(rows) : tagImportResult(rows)
        res.writeHead(200).end(JSON.stringify({ success: true, data }))
      })
      return
    }
    /*
      共通情報を**変える前**の確認（`uNBlA`）。**POST だが保存はしない。**
      長い本文を投げるために `POST` なので、ここで 405 を返すと
      「口はあるのに画面が壊れている」ように見える絵が撮れてしまう。
    */
    if (method === 'POST' && /^\/api\/common-vars\/[^/]+\/impact-preview$/.test(url.pathname)) {
      // 板 `AYc6O`：営業時間は8か所の専用データを返す（会社名15か所と別）。
      const impactVarId = /^\/api\/common-vars\/([^/]+)\/impact-preview$/.exec(url.pathname)[1]
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let nextValue = ''
        try { nextValue = JSON.parse(raw || '{}').nextValue ?? '' } catch { nextValue = '' }
        const value = typeof nextValue === 'string' ? nextValue : ''
        res.writeHead(200).end(JSON.stringify({
          success: true,
          data: impactVarId === 'common-var-hours'
            ? commonVarChangeImpactHours(value)
            : commonVarChangeImpact(value),
        }))
      })
      return
    }
    /*
      共通情報の切り替え予約の登録と削除。モックは保存せず、
      受け取った値をそのまま返して成功の絵が撮れるようにする。
    */
    if (method === 'POST' && /^\/api\/common-vars\/[^/]+\/schedules$/.test(url.pathname)) {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        const varId = decodeURIComponent(url.pathname.split('/')[3] ?? '')
        res.writeHead(201).end(JSON.stringify({
          success: true,
          data: {
            id: 'common-var-schedule-new',
            varId,
            effectiveFrom: typeof body.effectiveFrom === 'string' ? body.effectiveFrom : '2026-10-01T10:00',
            value: typeof body.value === 'string' ? body.value : '',
            appliedAt: null,
          },
        }))
      })
      return
    }
    if (method === 'DELETE' && /^\/api\/common-vars\/[^/]+\/schedules\/[^/]+$/.test(url.pathname)) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: null }))
      return
    }
    /*
      共通情報の差し替え（PR #1131）。候補取得・影響確認・実行完了を
      同じPOSTの入力で分けるが、モックは保存せず固定結果だけ返す。
    */
    /* 板 `xxKtW`：「電話番号」の差し替え候補（問い合わせ先が先頭）と、差し替えたときの影響。 */
    if (method === 'POST' && url.pathname === `/api/common-vars/${COMMON_VAR_DELETE_IMPACT_PHONE.variable.id}/replace`) {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        const data = !body.replacementId ? COMMON_VAR_REPLACEMENT_CANDIDATES_PHONE : COMMON_VAR_REPLACEMENT_PREVIEW_PHONE
        res.writeHead(200).end(JSON.stringify({ success: true, data }))
      })
      return
    }
    if (method === 'POST' && url.pathname === `/api/common-vars/${COMMON_VAR_DETAIL.id}/replace`) {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        const data = !body.replacementId
          ? COMMON_VAR_REPLACEMENT_CANDIDATES
          : body.apply === true
            ? COMMON_VAR_REPLACEMENT_RESULT
            : COMMON_VAR_REPLACEMENT_PREVIEW
        res.writeHead(200).end(JSON.stringify({ success: true, data }))
      })
      return
    }
    /*
      代理予約の登録完了と予約枠競合。**POSTだが保存も通知も起こさない。**
      撮影手順の10:00だけ成功、14:00だけ競合にし、ほかの時刻を誤って
      登録済みに見せない。本番と同じく成功は201、競合は409で返す。
    */
    if (method === 'POST' && url.pathname === '/api/booking/admin/bookings') {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let startsAt = ''
        try {
          const parsed = JSON.parse(raw || '{}')
          startsAt = typeof parsed.starts_at === 'string' ? parsed.starts_at : ''
        } catch {
          startsAt = ''
        }
        const fixed = startsAt === '2026-09-03T01:00:00.000Z'
          ? BOOKING_PROXY_CREATE.success
          : startsAt === '2026-09-03T05:00:00.000Z'
            ? BOOKING_PROXY_CREATE.conflict
            : BOOKING_PROXY_CREATE.unavailable
        res.writeHead(fixed.status).end(JSON.stringify(fixed.body))
      })
      return
    }
    /*
      成果の締め・振込データ・明細（機能16）。本番と同じHTTP状態と器を返すが、
      DB更新、ファイル生成、紹介者への通知は一切行わない。
    */
    if (method === 'POST' && url.pathname === '/api/affiliate-settlements') {
      res.writeHead(201).end(JSON.stringify({ success: true, data: AFFILIATE_SETTLEMENT_CREATED }))
      return
    }
    if (method === 'POST' && url.pathname === '/api/affiliate-payout-batches') {
      res.writeHead(201).end(JSON.stringify({ success: true, data: AFFILIATE_PAYOUT_BATCH }))
      return
    }
    if (method === 'POST' && url.pathname === '/api/affiliate-statements') {
      res.writeHead(201).end(JSON.stringify({
        success: true, data: AFFILIATE_STATEMENT, notificationAttempted: true,
      }))
      return
    }
    /*
      写真審査の一括判断と派生画像処理。撮影用に本番と同じ受付結果を返すだけで、
      審査・ポイント付与・画像生成・通知は一切実行しない。
    */
    if (method === 'POST' && url.pathname === '/api/nen-members/photos/decisions/bulk') {
      res.writeHead(201).end(JSON.stringify({
        success: true, duplicate: false, data: NEN_PHOTO_BULK_DECISION_RESULT,
      }))
      return
    }
    /*
      機能22の原本保存。実物や秘密値は返さず、再認証と一回限りURLの
      画面遷移だけを固定応答で確認する。000000 は失敗確認専用。
    */
    if (method === 'POST' && url.pathname === '/api/auth/step-up') {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        if (body.purpose !== 'photo.original.download' || body.code === '000000') {
          res.writeHead(400).end(JSON.stringify({ success: false, error: '再認証コードを確認してください。' }))
          return
        }
        res.writeHead(201).end(JSON.stringify({
          success: true,
          data: {
            token: 'visual-qa-photo-original-step-up',
            purpose: 'photo.original.download',
            expiresAt: '2026-09-07T03:10:00.000Z',
          },
        }))
      })
      return
    }
    const photoOriginalIssue = /^\/api\/nen-members\/photos\/([^/]+)\/original-download$/.exec(url.pathname)
    if (method === 'POST' && photoOriginalIssue) {
      if (req.headers['x-step-up-token'] !== 'visual-qa-photo-original-step-up') {
        res.writeHead(428).end(JSON.stringify({ success: false, error: '原本の保存には再認証が必要です。' }))
        return
      }
      res.writeHead(201).end(JSON.stringify({
        success: true,
        data: {
          downloadUrl: '/api/nen-members/photos/original-download/visual-qa-once',
          expiresAt: '2026-09-07T03:05:00.000Z',
          oneTime: true,
        },
      }))
      return
    }
    const photoAssetProcess = /^\/api\/nen-members\/photos\/([^/]+)\/assets\/process$/.exec(url.pathname)
    if (method === 'POST' && photoAssetProcess) {
      res.writeHead(202).end(JSON.stringify({
        success: true,
        duplicate: false,
        data: { ...NEN_PHOTO_ASSET_PROCESS_RESULT, photoId: photoAssetProcess[1] },
      }))
      return
    }
    // 機能3の保存した検索。DBへは書かず、本番契約と同じ201と保存済みの器を返す。
    if (method === 'POST' && url.pathname === '/api/friends/saved-views') {
      res.writeHead(201).end(JSON.stringify({ success: true, data: FRIEND_SAVED_VIEWS.items[0] }))
      return
    }
    // #518 中5: 目視 QA で確認窓・復旧フローが検証できるよう、停止・復旧・
    // 手動チェックの POST に本物と同じ形の成功応答を返す(DBへは書かない)。
    if (method === 'POST' && url.pathname === '/api/operations/health/runs') {
      res.writeHead(200).end(JSON.stringify({ success: true, duplicate: false, data: OPERATION_HEALTH }))
      return
    }
    if (method === 'POST' && url.pathname === '/api/operations/incidents') {
      const incident = {
        ...OPERATION_HISTORY[0],
        id: 'operation-incident-manual',
        status: 'resolved',
        stoppedAt: '2026-08-25T12:00:00+09:00',
        resolvedAt: null,
        createdAt: '2026-08-25T12:00:00+09:00',
        updatedAt: '2026-08-25T12:00:00+09:00',
      }
      res.writeHead(200).end(JSON.stringify({
        success: true,
        data: {
          status: 'changed',
          control: {
            ...OPERATION_CONTROL_PREVIEW.control,
            version: OPERATION_CONTROL_PREVIEW.control.version + 1,
            activeIncidentId: incident.id,
            reason: '障害対応',
            actorId: '目視確認',
            stoppedAt: incident.stoppedAt,
            updatedAt: incident.stoppedAt,
          },
          incident,
        },
      }))
      return
    }
    const operationRestore = /^\/api\/operations\/incidents\/([^/]+)\/restore$/.exec(url.pathname)
    if (method === 'POST' && operationRestore) {
      res.writeHead(200).end(JSON.stringify({
        success: true,
        data: {
          status: 'changed',
          control: OPERATION_CONTROL_PREVIEW.control,
          incident: {
            ...OPERATION_HISTORY[0],
            id: operationRestore[1],
            status: 'resolved',
            resolvedAt: '2026-08-25T12:30:00+09:00',
          },
        },
      }))
      return
    }
    /*
      リッチメニューの書き込み系 (#502中)。DBへは書かず、本番契約と同じ
      HTTP状態と器を返す。編集・公開・予約・適用・削除の画面検証用。
      409/400 の代表例つき (削除ブロック・冪等キーなし・順序の形違い)。
    */
    if (method === 'POST' && url.pathname === '/api/rich-menu-groups') {
      res.writeHead(201).end(JSON.stringify({
        success: true, data: { id: 'rmg-new', pages: [{ id: 'rmg-new-top' }] },
      }))
      return
    }
    if (method === 'POST' && url.pathname === '/api/rich-menu-groups/reorder-priorities') {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        if (!Array.isArray(body.orderedIds)) {
          res.writeHead(400).end(JSON.stringify({ success: false, error: 'orderedIds must be string array' }))
          return
        }
        res.writeHead(200).end(JSON.stringify({ success: true, data: { updated: body.orderedIds.length } }))
      })
      return
    }
    const richMenuWriteGroup = /^\/api\/rich-menu-groups\/([^/]+)$/.exec(url.pathname)
    if (method === 'PATCH' && richMenuWriteGroup) {
      if (!RICH_MENU_GROUP_DETAILS[richMenuWriteGroup[1]]) {
        res.writeHead(404).end(JSON.stringify({ success: false, error: 'not found' }))
        return
      }
      res.writeHead(200).end(JSON.stringify({ success: true, data: { id: richMenuWriteGroup[1] } }))
      return
    }
    if (method === 'DELETE' && richMenuWriteGroup) {
      if (!RICH_MENU_GROUP_DETAILS[richMenuWriteGroup[1]]
        && richMenuWriteGroup[1] !== 'rich-menu-target') {
        res.writeHead(404).end(JSON.stringify({ success: false, error: 'not found' }))
        return
      }
      if (richMenuWriteGroup[1] === 'rich-menu-target') {
        res.writeHead(409).end(JSON.stringify({
          success: false,
          code: 'rich_menu_delete_blocked',
          error: '削除する前に、公開状態と使われている場所を確認してください',
          data: RICH_MENU_DELETE_IMPACT,
        }))
        return
      }
      res.writeHead(200).end(JSON.stringify({ success: true }))
      return
    }
    // K-1・O-1: 公開の進みと公開前の確認の見本（本物と同じ器）。
    const richMenuProgress = /^\/api\/rich-menu-groups\/([^/]+)\/publish-progress$/.exec(url.pathname)
    if (method === 'GET' && richMenuProgress) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: {
        run: { id: 'visual-qa-run', mode: 'publish', status: 'failed', startedAt: '2026-09-27T10:00:00+09:00', completedAt: '2026-09-27T10:01:00+09:00' },
        steps: [
          { key: 'image', label: '画像をLINEに上げる', status: 'done' },
          { key: 'menu', label: 'メニューを作る', status: 'done' },
          { key: 'assign', label: '友だちに割り当てる', status: 'failed' },
          { key: 'cleanup', label: '前のメニューを片付ける', status: 'pending' },
        ],
        message: '割り当てに失敗したので、作ったメニューをLINEから消し、前のメニューのままにしました。もう一度公開できます。',
      } }))
      return
    }
    const richMenuPrecheck = /^\/api\/rich-menu-groups\/([^/]+)\/prepublish-check$/.exec(url.pathname)
    if (method === 'GET' && richMenuPrecheck) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: {
        fingerprint: 'visual-qa-fp',
        pageCount: 2,
        maxPages: 10,
        selfCheck: { ok: true, message: '自前の検査を通りました。' },
        deviceConfirmed: false,
        deviceConfirmedAt: null,
        versionNumber: null,
      } }))
      return
    }
    const richMenuValidate = /^\/api\/rich-menu-groups\/([^/]+)\/validate$/.exec(url.pathname)
    if (method === 'POST' && richMenuValidate) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: {
        checks: [
          { key: 'self', ok: true, message: '自前の検査を通りました。' },
          { key: 'line', ok: true, message: 'LINEの検査を通りました。' },
        ],
      } }))
      return
    }
    const richMenuDevice = /^\/api\/rich-menu-groups\/([^/]+)\/device-confirm$/.exec(url.pathname)
    if (method === 'POST' && richMenuDevice) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: {
        confirmedAt: '2026-09-27T10:00:00+09:00', fingerprint: 'visual-qa-fp',
      } }))
      return
    }
    // K-2: 照合の見本。ずれの種類ごとの直し方（fix）つき。
    const richMenuReconcile = /^\/api\/rich-menu-groups\/([^/]+)\/reconcile$/.exec(url.pathname)
    if (method === 'POST' && richMenuReconcile) {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let dryRun = true
        try { dryRun = JSON.parse(raw || '{}').dryRun !== false } catch { dryRun = true }
        const diffs = [
          { kind: 'external_only', detail: 'LINEにだけあるメニュー「別で作ったメニュー」（rm-external-1）があります', richMenuId: 'rm-external-1', fix: { label: 'こちらに取り込む', action: 'import-external' } },
          { kind: 'default_mismatch', detail: 'LINEの全員既定がこのメニューを指していません（現在: rm-other-9）', richMenuId: 'rm-other-9', fix: { label: 'こちらに合わせる', action: 'relink-default' } },
        ]
        res.writeHead(200).end(JSON.stringify({ success: true, data: dryRun
          ? { dryRun: true, diffs }
          : { dryRun: false, diffs, applied: 1, failed: [], unapplied: [{ diff: diffs[0], reason: '取り込みは「外部メニューの取り込み」画面で運用者が行います' }], runId: 'visual-qa-reconcile-run' } }))
      })
      return
    }
    const richMenuWriteAction = /^\/api\/rich-menu-groups\/([^/]+)\/(publish|unpublish|schedule|apply-to-tag)$/.exec(url.pathname)
    if (method === 'POST' && richMenuWriteAction) {
      const action = richMenuWriteAction[2]
      if (action === 'schedule' || action === 'apply-to-tag') {
        if (!req.headers['idempotency-key']) {
          res.writeHead(400).end(JSON.stringify({ success: false, error: 'Idempotency-Key header required' }))
          return
        }
      }
      const payloads = {
        publish: { pages: [] },
        unpublish: { pages: [], warnings: [] },
        schedule: { id: 'rms-visual-qa', status: 'scheduled' },
        'apply-to-tag': { chunks: 1, total: 2, runId: 'visual-qa-run' },
      }
      res.writeHead(action === 'schedule' ? 201 : 200).end(
        JSON.stringify({ success: true, data: payloads[action] }),
      )
      return
    }
    /* 変更の確認（hmr2P・qUdNh）の口は実APIが器で包まずに返す。包むと人数が読めず「確定 0 人」になる。 */
    if (method === 'POST' && /^\/api\/events\/admin\/events\/[^/]+\/change-review(\/apply)?$/.test(url.pathname)) {
      res.writeHead(200).end(JSON.stringify(url.pathname.endsWith('/apply') ? EVENT_CHANGE_APPLY_RESULT : EVENT_CHANGE_PREVIEW))
      return
    }
    const fixedResult = visualQaWriteBody(method, url.pathname, url.searchParams)
    if (fixedResult) {
      res.writeHead(200).end(JSON.stringify({ success: true, data: fixedResult }))
      return
    }
    // 対象確認は書き込みを起こさない。IAf7j の確認窓を通常データで撮るため、
    // この1本だけ本物と同じPOSTの器で返す。実行・再試行・取り消しは405のまま。
    if (method === 'POST' && url.pathname === '/api/friends/bulk-runs/preview') {
      res.writeHead(200).end(JSON.stringify({ success: true, data: FRIEND_BULK_RUN.preview }))
      return
    }
    res.writeHead(405).end(
      JSON.stringify({ success: false, error: '画面確認用のため、更新はできません' }),
    )
    return
  }

  if (url.pathname in RAW) {
    res.writeHead(200).end(JSON.stringify(RAW[url.pathname]))
    return
  }
  const rawPattern = RAW_PATTERNS.find(([re]) => re.test(url.pathname))
  if (rawPattern) {
    const fixed = typeof rawPattern[1] === 'function' ? rawPattern[1](url) : rawPattern[1]
    res.writeHead(200).end(JSON.stringify(fixed))
    return
  }
  res.writeHead(200).end(JSON.stringify(bodyFor(method, url.pathname, url.searchParams)))
})

/*
 * 落ちないようにする。
 *
 * 画像比較は24件を並べて走らせるので、途中で1回でも落ちると、そこから先の
 * 画面が全部ログインへ飛ぶ。そして「ログイン画面を撮って通過」になる。
 * 実際に一度そうなった（2026-08-26）。
 */
server.on('clientError', (_error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})
server.on('error', (error) => {
  /*
   * **ポートが埋まっているときは止まる。**
   *
   * ここで握ると、古いモックが動いたまま新しいほうが「起動した」顔をする。
   * 直したはずの中身が反映されず、しかもどこにも出ない。一度そうなった。
   */
  if (error.code === 'EADDRINUSE') {
    console.error(`[visual-qa] ${HOST}:${PORT} は使用中。先に動いているモックを止める。`)
    process.exit(1)
  }
  console.error('[visual-qa] サーバーの取りこぼし:', error.message)
})
process.on('uncaughtException', (error) => {
  console.error('[visual-qa] 落ちずに続ける:', error.message)
})

server.listen(PORT, HOST, () => {
  console.log(`[visual-qa] mock API on http://${HOST}:${PORT}（固定の画面確認結果以外の更新は405）`)
})
