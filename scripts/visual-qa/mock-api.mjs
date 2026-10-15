import {seatBoardEntry} from '../../packages/shared/dist/reservation-board.js'
import {DEFAULT_CUSTOMER_LOOK} from '../../packages/shared/dist/customer-look.js'
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
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
// Web と同じ QR 生成器を使う。画像の口を JSON で返すと小窓が壊れる。
const QRCode = createRequire(new URL('../../apps/web/package.json', import.meta.url))('qrcode')

import { QA_CLOCK, storeAt, storeYmd } from './qa-clock.mjs'
import { mockFingerprint } from './mock-fingerprint.mjs'
/** fixtures・補助処理・API形の入力も含む、起動時の指紋。 */
const FINGERPRINT = mockFingerprint()
import { readArrayGetPaths } from './api-shapes.mjs'
import { LARGE_ENABLED, largeBody } from './large-mode.mjs'
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
  FRIEND_ATTRIBUTE_SAVED_SEARCH_DETAIL, FRIEND_ATTRIBUTE_SAVED_SEARCH_RESPONSE, FRIEND_FIELD_MIGRATION_PREVIEW, FRIEND_FIELD_MIGRATION_PREVIEW_DOG,
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
  SITE_TRACKING_SUMMARY, SITE_TRACKING_PAGES, MEASUREMENT_SITES, AD_PLATFORMS, AD_CONVERSION_LOGS, AD_CONVERSION_LOG_SUMMARY, AD_EVENT_MAPPINGS, TRACKED_LINKS,
  AD_COST_ROWS, AD_COST_PLATFORMS, AD_COST_MANUAL_ENTRIES, AD_CONVERSION_COST,
  STAFF_MEMBERS, LOGIN_AUDIT,
  AFFILIATES, AFFILIATE_OFFERS, AFFILIATE_REPORT, AFFILIATE_REPORT_DETAIL, AFFILIATE_LINKS,
  AFFILIATE_SETTLEMENT_PREVIEW, AFFILIATE_SETTLEMENT_CREATED, AFFILIATE_PAYOUT_BATCH, AFFILIATE_STATEMENT,
  OFFER_VERSIONS, OFFER_CAP_STATUS, ATTRIBUTION_DECISION,
  MILEAGE_EARNING_RULES, MILEAGE_FRIENDS, MILEAGE_HISTORY, MILEAGE_OVERVIEW,
  COMMON_ACTIONS, COMMON_ACTION_DETAIL, COMMON_ACTION_DETAIL_PURCHASE, AUTOMATIONS, AUTOMATION_RUNS, AUTOMATION_TEMPLATES,
  BOOKING_MENUS, BOOKING_CHANNELS, BOOKING_MENU_VERSIONS, BOOKING_SETTINGS, BOOKING_STAFF, BOOKING_STAFF_MENUS, BOOKING_MENU_STAFF, BOOKING_AVAILABILITY, BOOKING_AVAILABILITY_STORE_VIEW, BOOKING_AVAILABILITY_OCT, BOOKING_RESOURCES,
  BOOKING_AVAILABILITY_RULES, BOOKING_BREAKS, BOOKING_BREAK_DATES, BOOKING_STAFF_SHIFTS, BOOKING_EXCEPTIONS, BOOKING_GOOGLE_CALENDAR,
  BOOKING_PROXY_CREATE, BOOKING_REQUESTS,
  BOOKING_ADMIN_DETAIL, BOOKING_CUSTOMER_CONTEXT, BOOKING_REMINDER_PREVIEW, BOOKING_CONFLICT_ALTERNATIVES,
  EC_NOTIFICATION_SETTINGS, EC_NOTIFICATION_RUNS, LINE_NOTIFICATION_DEFINITIONS, LINE_NOTIFICATION_METRICS, LINE_NOTIFICATION_SEND_COUNTS, LINE_NOTIFICATION_DELIVERIES,
  OPERATOR_NOTIFICATION_RECIPIENTS, OPERATOR_NOTIFICATION_RULES, OPERATOR_NOTIFICATION_TEAMS, ADMIN_EVENTS, EVENT_FOLDERS, EVENT_DETAIL, EVENT_SLOTS, EVENT_OCCURRENCE_APPLICANTS, EVENT_WAITLIST, EVENT_BOOKINGS, EVENT_CHANGE_PREVIEW, EVENT_CHANGE_APPLY_RESULT, EVENT_LIFECYCLE_RESULT, EVENT_WAITLIST_REORDER_RESULT, EVENT_WAITLIST_SKIP_RESULT, EVENT_LIFF_CHANGE_RESULT, NEN_PHOTOS, NEN_PHOTO_DETAIL,
  NEN_PHOTO_REVIEW_METRICS, NEN_PHOTO_ASSET_STATUS, NEN_PHOTO_DERIVATIVES,
  NEN_PHOTO_ASSET_PROCESS_RESULT, NEN_PHOTO_BULK_DECISION_RESULT,
  NEN_PHOTO_REWARD_POLICY_VERSIONS,
  NEN_PHOTO_PUBLICATIONS, EC_EVENTS, EC_OVERVIEW, EC_ORDERS, EC_ACTION_EXECUTIONS, EC_IDENTITY_CANDIDATES, MILEAGE_RULES,
  FORM_FOLDERS, FORMS, FORM_LIST, FORM_DETAIL, FORM_DETAIL_PUBLISHED, FORM_SUBMISSIONS, FORM_VISIT_DETAIL, FORM_VISIT_SUBMISSIONS,
  LINE_ACCOUNTS, LINE_ACCOUNT_TAGS, LINE_ACCOUNT_DETAIL, LINE_ACCOUNT_DETAIL_STOPPED, LINE_ACCOUNT_VERIFY_CONNECTION, ACCOUNT_HANDOVER, ACCOUNT_HANDOVER_DECISIONS,
  ACCOUNT_HEALTH_LOGS,
  CONVERSION_POINTS, CONVERSION_FOLDERS, CONVERSION_REPORT_CURRENT, CONVERSION_REPORT_PREVIOUS,
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
  NEN_RANK_SETTINGS, NEN_MEMBER_LIST, NEN_PET_LIST, NEN_HEALTH_LIST, NEN_FEEDING_PRODUCTS, NEN_HEALTH_SUMMARY_KOMUGI,
  FRIEND_ADD_RUN_DETAIL, FRIEND_ADD_RUN_DETAIL_FAILED, OPERATION_SEND_PATHS, REMINDER_REGISTRANTS,
} from './fixtures.mjs'

/* リッチメニューの公開の進み（K-1）。default は今までの見本（割り当てで失敗）。 */
const RICH_MENU_PUBLISH_PROGRESS = {
  default: {
    run: { id: 'visual-qa-run', mode: 'publish', status: 'failed', startedAt: '2026-09-27T10:00:00+09:00', completedAt: '2026-09-27T10:01:00+09:00' },
    steps: [
      { key: 'image', label: '画像をLINEに上げる', status: 'done' },
      { key: 'menu', label: 'メニューを作る', status: 'done' },
      { key: 'assign', label: '友だちに割り当てる', status: 'failed' },
      { key: 'cleanup', label: '前のメニューを片付ける', status: 'pending' },
    ],
    message: '割り当てに失敗したので、作ったメニューをLINEから消し、前のメニューのままにしました。もう一度公開できます。',
  },
}
/* 公開済みの詳細（hKr8f）：4つの段がすべて済み。 */
RICH_MENU_PUBLISH_PROGRESS['rich-menu-target'] = {
  run: { id: 'run-target-3', mode: 'publish', status: 'succeeded', startedAt: '2026-10-01T10:44:00+09:00', completedAt: '2026-10-01T10:45:00+09:00' },
  steps: [
    { key: 'image', label: '画像をLINEへ登録', status: 'done' },
    { key: 'menu', label: 'ボタンの動きをLINEへ登録', status: 'done' },
    { key: 'assign', label: 'すべての友だちの既定に設定', status: 'done' },
    { key: 'cleanup', label: '旧メニュー「通常メニュー（旧）」を既定から外す', status: 'done' },
  ],
  message: null,
}
const RICH_MENU_RUN = (id, status, at, lastErrorCode = null) => ({
  id, status, lastErrorCode, idempotencyKey: `visual-${id}`, requestedByStaffId: 'visual-qa-owner', createdAt: at, updatedAt: at,
  version: { name: '通常メニュー（会員向け）', chatBarText: 'メニューを開く', pageCount: 3, isDefaultForAll: true, targetingEnabled: false },
  pages: [],
})
const RICH_MENU_PUBLISH_RUNS = {
  'rich-menu-target': {
    runs: [
      RICH_MENU_RUN('run-target-3', 'succeeded', '2026-10-01T10:45:00+09:00'),
      RICH_MENU_RUN('run-target-2b', 'succeeded', '2026-09-20T18:02:00+09:00'),
      RICH_MENU_RUN('run-target-2a', 'failed', '2026-09-20T17:55:00+09:00', 'line_api_timeout'),
    ],
    published: null,
    draftDiffersFromPublished: false,
  },
}


/* タグの編集の絵（Qat9s）の「EC顧客連携済み」。一覧の行（TAGS の先頭）と同じ値に、保存済みの連動の動きを足した形。 */
const TAG_EC_CUSTOMER_ACTIONS = [
  { id: 'tag-ec-action-scenario', type: 'start_scenario', params: { scenarioId: 'scenario-subscription-follow' }, onFailure: 'continue' },
  { id: 'tag-ec-action-tag', type: 'add_tag', params: { tagId: 'tag-2' }, onFailure: 'stop' },
  { id: 'tag-ec-action-mark', type: 'set_support_mark', params: { markId: 'mark-masato' }, onFailure: 'continue' },
]
const TAG_EC_CUSTOMER_DEFINITION_TAG = {
  ...TAG_DEFINITION_NEN_SUBSCRIPTION.tag,
  id: 'tag-ec-customer',
  name: 'EC顧客連携済み',
  groupId: 'g-purchase',
  friendCount: 64,
  mileageReward: 10,
  referralMileageReward: 0,
  mileageMultiplierBps: 12000,
  mileageMultiplierPriority: 3,
  isStarred: true,
  createdAt: '2026-01-11T00:00:00.000Z',
  usedIn: { broadcasts: 3, forms: 1 },
  otherActionCount: 3,
  description: 'ECの会員と連携できた友だち',
  linkedActions: [
    { id: 'tag-ec-action-scenario', type: 'シナリオ開始', label: 'シナリオ「定期便フォロー」を始める', timing: 'すぐに' },
    { id: 'tag-ec-action-tag', type: 'タグ追加', label: 'タグ「NEN会員」を付ける', timing: 'すぐに' },
    { id: 'tag-ec-action-mark', type: '対応マーク変更', label: '担当を「Masato」にする', timing: 'すぐに' },
  ],
}
const TAG_EC_CUSTOMER_AUTOMATION = {
  ...TAG_DEFINITION_NEN_SUBSCRIPTION.automation,
  id: 'common-action-tag-ec-customer',
  name: 'EC顧客連携済みが付いたとき',
  publishedVersion: { ...TAG_DEFINITION_NEN_SUBSCRIPTION.automation.publishedVersion, actions: TAG_EC_CUSTOMER_ACTIONS },
  draftVersion: { ...TAG_DEFINITION_NEN_SUBSCRIPTION.automation.draftVersion, actions: TAG_EC_CUSTOMER_ACTIONS },
  actions: TAG_EC_CUSTOMER_ACTIONS,
}


/* 詳細の絵（UTbi1）の template-1。一覧の行（TEMPLATES）は変えず、詳細と版の口だけこの形を返す。 */
const TEMPLATE_1_CONTENT = '{名前}さん、こんにちは。\n明日 {予約日時} にご予約をいただいています。\n変更・キャンセルは下のリンクからお願いします。\nhttps://nen.example/booking'
const TEMPLATE_1_DETAIL = (template) => ({
  ...template,
  folderId: 'tf-booking',
  category: '予約',
  messageContent: TEMPLATE_1_CONTENT,
  updatedAt: '2026-08-21T18:02:00+09:00',
  accountId: 'visual-qa-account',
  question: null,
  questionStatus: 'draft',
  hasDraft: true,
  publishedVersion: 2,
  publishedAt: '2026-08-02T10:15:00+09:00',
  draftRevision: 1,
  usedBy: {
    broadcasts: [
      { broadcastId: 'broadcast-sep-remind', title: '9月の予約リマインド（予約済み）', status: 'scheduled', scheduledAt: '2026-09-30T18:00:00+09:00', templateVersionNumber: 2, referenceMode: 'fixed' },
    ],
    autoReplies: [{ id: 'auto-reply-booking-change', keyword: '予約変更のお問い合わせ', matchType: 'contains', lineAccountId: 'visual-qa-account', templateVersion: null }],
    scenarioSteps: [{ scenarioId: 'scenario-booking-follow', scenarioName: '予約フォロー', stepId: 'step-booking-follow-1', stepOrder: 1, templateVersion: null }],
    reminderSteps: [
      { reminderId: 'reminder-visit-aoi', reminderName: '来店前日（あおい）', stepId: 'rstep-aoi-1' },
      { reminderId: 'reminder-visit-umeda', reminderName: '来店前日（梅田）', stepId: 'rstep-umeda-1' },
      { reminderId: 'reminder-visit-namba', reminderName: '来店前日（なんば）', stepId: 'rstep-namba-1' },
    ],
    reminderEnrollments: [
      { enrollmentId: 'enroll-aoi-0921', reminderId: 'reminder-visit-aoi', reminderName: '来店前日（あおい）9月21日分', versionNumber: 2, enrollmentStatus: 'active', targetDate: '2026-09-21' },
    ],
    richMenuAreas: [
      { groupId: 'rmg-1', groupName: '会員メニュー', pageName: '1ページ目', areaId: 'area-booking', label: '予約の確認' },
      { groupId: 'rmg-1', groupName: '会員メニュー', pageName: '2ページ目', areaId: 'area-booking-2', label: '予約の変更' },
    ],
    trackedLinks: [{ id: 'link-booking-lp', name: '予約ページの案内' }],
    automations: [{ id: 'automation-booking-day-before', name: '予約前日の自動送信', eventType: 'booking_reminder' }],
  },
})
const TEMPLATE_1_VERSIONS = [
  { versionNumber: 2, status: 'in_use', messageType: 'text', messageContent: '{名前}さん、こんにちは。\n明日 {予約日時} のご予約です。\nhttps://nen.example/booking', carouselActions: null, carouselTapLimitMode: null, carouselTapLimitText: null, question: null, questionStatus: null, effectiveFrom: null, createdAt: '2026-08-02T10:15:00+09:00' },
  { versionNumber: 1, status: 'past', messageType: 'text', messageContent: '{名前}さん、こんにちは。\n明日のご予約をお待ちしています。', carouselActions: null, carouselTapLimitMode: null, carouselTapLimitText: null, question: null, questionStatus: null, effectiveFrom: null, createdAt: '2026-07-14T09:40:00+09:00' },
]


if (process.env.NODE_ENV === 'production') {
  console.error('[visual-qa] 本番では起動しない。画面確認専用のため。')
  process.exit(1)
}

const PORT = Number(process.env.PORT ?? 8788)
const HOST = '127.0.0.1'

// 機能10専用。フォルダ操作後の再取得でも、同じプロセス内では保存結果を返す。
let webinarFolders = WEBINAR_FOLDERS.map((folder) => ({ ...folder }))
/** シナリオの下書きの口（API-9）の見本の行。キーは「アカウント＋改行＋下書きのキー」。 */
const scenarioDraftRows = new Map()

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

/** 統括の友だち情報欄・対応マーク（#1657）の返事。店の使用先集計は混ぜない。 */
const HQ_ATTRIBUTE_ROWS = [
  ...FRIEND_ATTRIBUTE_FIELDS.map((field) => ({
    template: { id: `visual-hq-attr-${field.id}`, name: field.name, description: null, template_type: 'friend_field', folder_id: field.folderId ? ({ 'friend-field-folder-pets': 'visual-hq-folder-inquiry', 'friend-field-folder-contact': 'visual-hq-folder-booking', 'friend-field-folder-purchase': 'visual-hq-folder-ec' }[field.folderId] ?? null) : null, revision: 1, updated_at: field.updatedAt, friend_count: field.usageCount, distributed_account_count: 1, distributed_account_names: ['本店'], distributed_account_more: 0, outdated_account_count: 0, current_version: 1 },
    definition: { schemaVersion: 1, field: { name: field.name, fieldKey: field.fieldKey, type: field.type, options: field.options, defaultValue: field.defaultValue, source: field.source, isPersonal: field.isPersonal, isStarred: field.isStarred, ecIsMaster: field.ecIsMaster, ecFieldPath: field.ecFieldPath, displayOrder: field.displayOrder, folderId: field.folderId }, folders: field.folderId ? FRIEND_FIELD_FOLDERS.filter((folder) => folder.id === field.folderId).map(({id, name, color}) => ({id, name, color, parentId: null})) : [] },
  })),
  ...SUPPORT_MARKS.map((mark) => ({
    template: { id: `visual-hq-attr-${mark.id}`, name: mark.name, description: null, template_type: 'mark', folder_id: null, revision: 1, updated_at: '2026-10-08T00:00:00.000Z', friend_count: mark.friendCount, distributed_account_count: 1, distributed_account_names: ['本店'], distributed_account_more: 0, outdated_account_count: 0, current_version: 1 },
    definition: { schemaVersion: 1, mark: { name: mark.name, color: mark.color, isDefault: mark.isDefault, autoOnInbound: mark.autoOnInbound, displayOrder: mark.displayOrder } },
  })),
]

/** 統括のテンプレートの見本（★V8-B LRc93・X4JcOf・meBRB）。 */
const HQ_TEMPLATES_HTN = [
  /* API-18：今月送った数（this_month_sent_count）・古い版のままの配り先（outdated_account_count）・いまの版（current_version）。 */
  { id: 'visual-hq-tpl-autumn', name: '秋の新商品のお知らせ', description: '本文・画像 1', template_type: 'template', folder_id: null, revision: 2, updated_at: '2026-09-30T01:12:00.000Z', reference_summary: '', distributed_account_count: 3, distributed_account_names: ['本店', '渋谷店', 'イベント'], distributed_account_more: 0, content_summary: '本文・画像 1', this_month_sent_count: 1240, outdated_account_count: 0, current_version: 2 },
  { id: 'visual-hq-tpl-thanks', name: '来店のお礼', description: '本文', template_type: 'template', folder_id: 'visual-hq-folder-inquiry', revision: 3, updated_at: '2026-09-22T09:40:00.000Z', reference_summary: '', distributed_account_count: 3, distributed_account_names: ['本店', '渋谷店', 'イベント'], distributed_account_more: 0, content_summary: '本文', this_month_sent_count: 1860, outdated_account_count: 1, current_version: 3 },
  { id: 'visual-hq-tpl-booking', name: '予約の受付', description: '本文・ボタン', template_type: 'template', folder_id: 'visual-hq-folder-booking', revision: 1, updated_at: '2026-09-12T00:00:00.000Z', reference_summary: '回答フォーム「予約」', distributed_account_count: 1, distributed_account_names: ['本店'], distributed_account_more: 0, content_summary: '本文・ボタン', this_month_sent_count: 480, outdated_account_count: 0, current_version: 1 },
  { id: 'visual-hq-tpl-carousel', name: '定期便 初回のご案内', description: 'カード 3枚', template_type: 'template', kind: 'carousel', folder_id: 'visual-hq-folder-ec', revision: 1, updated_at: '2026-01-13T00:00:00.000Z', reference_summary: '', distributed_account_count: 0, distributed_account_names: [], distributed_account_more: 0, content_summary: 'カード 3枚', this_month_sent_count: 210, outdated_account_count: 0, current_version: 1 },
  { id: 'visual-hq-tpl-question', name: '好みのコース', description: '選択肢 4', template_type: 'template', kind: 'question', folder_id: null, revision: 1, updated_at: '2026-01-13T00:00:00.000Z', reference_summary: '', distributed_account_count: 1, distributed_account_names: ['本店'], distributed_account_more: 0, content_summary: '選択肢 4', this_month_sent_count: 640, outdated_account_count: 0, current_version: 1 },
  { id: 'visual-hq-tpl-holiday', name: '定休日のご案内', description: '本文', template_type: 'template', folder_id: null, revision: 1, updated_at: '2026-08-30T06:20:00.000Z', reference_summary: '', distributed_account_count: 0, distributed_account_names: [], distributed_account_more: 0, content_summary: '本文', this_month_sent_count: null, outdated_account_count: 0, current_version: 1 },
  { id: 'visual-hq-tpl-menu', name: '基本のメニュー', description: null, template_type: 'rich_menu', folder_id: null, revision: 1, updated_at: '2026-09-01T00:00:00.000Z', reference_summary: '', distributed_account_count: 2, distributed_account_names: ['本店', '渋谷店'], distributed_account_more: 0, content_summary: '6分割・画像あり', display_order: 1, display_audience: '全員', tap_count: 3210 },
  /* 回答フォームの編集（u5MM7・scJcP・xRPdo・N4T9mO）の中身は店の来店アンケートと同じ。配った先は絵の3アカウント。 */
  { id: 'visual-hq-tpl-form', name: '来店アンケート', description: null, template_type: 'form', folder_id: null, revision: 3, updated_at: '2026-09-01T00:00:00.000Z', reference_summary: '', distributed_account_count: 3, distributed_account_names: ['本店', '渋谷店', 'イベント'], distributed_account_more: 0, content_summary: '質問 3' },
  { id: 'visual-hq-tpl-tag-vip', name: 'VIP', description: null, template_type: 'tag', folder_id: null, revision: 1, updated_at: '2026-09-01T00:00:00.000Z', reference_summary: '', distributed_account_count: 2, distributed_account_names: ['本店', '渋谷店'], distributed_account_more: 0, content_summary: 'タグ 1', friend_count: 64, manual_assignment_allowed: true, assignment_method: '手動・自動' },
  { id: 'visual-hq-tpl-tag-new', name: '新規', description: null, template_type: 'tag', folder_id: null, revision: 1, updated_at: '2026-09-01T00:00:00.000Z', reference_summary: '', distributed_account_count: 0, distributed_account_names: [], distributed_account_more: 0, content_summary: 'タグ 1', friend_count: 0, manual_assignment_allowed: false, assignment_method: '自動' },
]
/** 配信設定は別の受け口の種類。画面確認で空一覧に落とさない。 */
const HQ_DELIVERY_FIXTURES = ['auto_reply', 'friend_add_rule', 'reminder'].map((type, index) => ({
  template: { id: `visual-hq-delivery-${type}`, template_type: type, name: ['営業時間のご案内','友だち追加のお礼','イベント前日のお知らせ'][index], description: null, revision: 2, folder_id: null, distributed_account_count: 2, distributed_account_names: ['本店','渋谷店'], distributed_account_more: 0, content_summary: ['キーワード・本文','初めての友だち・本文','予定日の前日'][index] },
  definition: { schemaVersion: 1, references: [], settings: type === 'auto_reply' ? { name:'営業時間のご案内', keyword:'営業時間', matchType:'contains', responseType:'text', responseContent:'営業時間は10時から18時です。' } : type === 'friend_add_rule' ? { name:'友だち追加のお礼', friendKind:'first_time', priority:0, definition:{ routeIds:[],scenarioId:null,messageType:'text',messageText:'友だち追加ありがとうございます。',timing:'immediate',friendCondition:'',actions:[],activeFrom:null,activeUntil:null } } : { name:'イベント前日のお知らせ', description:'前日のご案内', triggerType:'event', deliveryMode:'time',triggerOffsetMinutes:-1440,sendAtTime:'10:00',stopConditions:{},steps:[] } },
}))
const HQ_TEMPLATE_FOLDERS_HTN = [
  { id: 'visual-hq-folder-inquiry', name: 'お問い合わせ', revision: 1 },
  { id: 'visual-hq-folder-booking', name: '予約', revision: 1 },
  { id: 'visual-hq-folder-ec', name: 'EC', revision: 1 },
]
const HQ_TEMPLATE_ACCOUNTS_HTN = [
  { id: 'visual-qa-account-prod', name: '然 -NEN- 本店' },
  { id: 'visual-qa-account-store', name: '然 -NEN- 渋谷店' },
  { id: 'visual-qa-account-event-2025', name: '2025年イベント' },
  { id: 'visual-qa-account', name: '然-NEN-TEST' },
]
function hqTemplateDefinitionHtn(row) {
  /* 統括のリッチメニュー（作る①〜④ gobhu・egdGx・K0gu1・gQabc）：大きい・6面（予約する・お知らせ・クーポン・会員証・よくある質問・お問い合わせ）。 */
  if (row.template_type === 'rich_menu') {
    const labels = ['予約する', 'お知らせ', 'クーポン', '会員証', 'よくある質問', 'お問い合わせ']
    const areas = labels.map((label, i) => ({
      id: `visual-area-${i + 1}`, bounds: { x: Math.round((i % 3) * 2500 / 3), y: Math.floor(i / 3) * 843, width: Math.round(2500 / 3), height: 843 },
      ...(i === 0 ? { actionType: 'uri', actionData: { uri: 'https://nen.example/booking' }, intent: 'url' } : i < 3 ? { actionType: 'uri', actionData: { uri: 'https://nen.example/news' }, intent: 'url' } : { actionType: 'message', actionData: { text: label }, intent: 'text' }),
      label,
    }))
    return { schemaVersion: 1, richMenu: { id: 'visual-menu-1', name: '通常メニュー（会員向け）', chatBarText: 'メニュー', size: 'large', defaultPageId: 'visual-page-1', displayOrder: 1, displayAudience: 'all', pages: [{ id: 'visual-page-1', name: 'トップ', imageR2Key: 'hq-templates/visual-tenant-1/menu-member.png', areas }] } }
  }
  if (row.template_type === 'form') {
    return {
      schemaVersion: 1,
      form: {
        name: row.name, description: null, fields: FORM_DETAIL.fields, layout: FORM_DETAIL.layout,
        on_submit_tag_id: null, on_submit_scenario_id: null, save_to_metadata: true,
      },
    }
  }
  const media = row.id === 'visual-hq-tpl-autumn' ? [{
    id: 'visual-hq-media-autumn', kind: 'image', filename: 'autumn-venison.jpg', mimeType: 'image/jpeg', sizeBytes: 182000, width: 1040, height: 1040, durationMs: null,
    r2Key: 'hq-templates/visual-tenant-1/autumn-venison.jpg', publicUrl: null, versionId: 'v1', versionNo: 1, contentHash: 'visual',
  }] : []
  const card = { format: 'flex', title: '秋の新商品、はじまりました', body: '鹿肉の旨みをぎゅっと閉じ込めた秋限定のコースです。10/31 まで送料無料でお届けします。', buttons: [{ id: 'visual-btn-1', label: '詳しく見る', action: 'url', value: 'https://nen-shop.jp/autumn' }], ...(media.length ? { imageMediaId: media[0].id } : {}) }
  return {
    schemaVersion: 1, card,
    template: { id: 'hq-authored-message', name: row.name, category: '季節のお知らせ', messageType: 'flex', messageContent: card.body, carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null, questionStatus: 'draft' },
    media,
  }
}
/** 配る前の確認（本店・渋谷店は配布済みで重複、2025年イベントは未配布）。 */
const HQ_TEMPLATE_PREFLIGHT_HTN = {
  preflightId: 'visual-hq-run-1', expiresAt: '2099-01-01T00:00:00.000Z',
  stores: [
    { accountId: 'visual-qa-account-prod', accountName: '然 -NEN- 本店', items: [{ sourceId: 'hq-authored-message', itemKind: 'template', name: '秋の新商品のお知らせ', expectedRevision: 2, duplicate: true, allowedModes: ['overwrite', 'alias'] }] },
    { accountId: 'visual-qa-account-store', accountName: '然 -NEN- 渋谷店', items: [{ sourceId: 'hq-authored-message', itemKind: 'template', name: '秋の新商品のお知らせ', expectedRevision: 1, duplicate: true, allowedModes: ['overwrite', 'alias'] }] },
    { accountId: 'visual-qa-account-event-2025', accountName: '2025年イベント', items: [{ sourceId: 'hq-authored-message', itemKind: 'template', name: '秋の新商品のお知らせ', expectedRevision: null, duplicate: false, allowedModes: ['create'] }] },
  ],
}

/** 統括のテンプレート（★V8-B dEvJM）：配った結果。成功2（新規・同じ名前で別名）・失敗1。 */
const HQ_TEMPLATE_RESULT_HTN = {
  runId: 'visual-hq-run-1', status: 'partial',
  stores: [
    { accountId: 'visual-qa-account-prod', accountName: '然-NEN-本店', status: 'succeeded', reason: null, counts: { created: 1, overwritten: 0, aliased: 0 }, createdName: '秋の新商品のお知らせ' },
    { accountId: 'visual-qa-account-store', accountName: '然-NEN-渋谷店', status: 'succeeded', reason: null, counts: { created: 0, overwritten: 0, aliased: 1 }, createdName: '秋の新商品のお知らせ（2）' },
    { accountId: 'visual-qa-account-event-2025', accountName: '2025年イベント', status: 'failed', reason: 'タグ「秋の新商品」がこのアカウントにありません', counts: { created: 0, overwritten: 0, aliased: 0 }, createdName: null },
  ],
}

/** 統括 LINEアカウントを登録の見本（★V8-B GwKE2 のタグ・qw80E の5段）。 */
const LINE_ACCOUNT_CONNECT_HTN = {
  steps: [
    { order: 1, state: 'passed', message: 'チャネルIDとシークレットでアクセストークンを発行' },
    { order: 2, state: 'passed', message: '公式アカウントの名前とアイコンを取得' },
    { order: 3, state: 'passed', message: 'Webhook URLを登録して、実際に届くかテスト' },
    { order: 4, state: 'passed', message: 'LINE Loginチャネルを確認して、LIFFアプリを作成' },
    { order: 5, state: 'passed', message: '認証済みアカウントかを判定' },
  ],
  verification: {
    tokenOk: true, loginOk: true, sameProvider: true,
    webhook: { expectedUrl: 'https://api.example/webhook', registeredUrl: 'https://api.example/webhook', active: true, testPassed: true },
    followerTotal: 1284,
  },
  displayName: '然 NEN',
  pictureUrl: null,
  basicId: '@nen-kichijoji',
  followerImport: { capability: 'available', phase: 'not_started' },
  remainingActions: [],
}

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
    id: 'visual-audit-1', staff_id: 'visual-qa-ops', staff_name: '河野',
    tenant_id: 'visual-tenant-1', tenant_name: '検証商事',
    action: 'impersonation.start', reason: '問い合わせの確認', detail: null,
    ip: null, visible_to_tenant: 1, created_at: '2026-10-01T15:20:00+09:00',
  },
  {
    id: 'visual-audit-2', staff_id: 'visual-qa-ops', staff_name: '河野',
    tenant_id: 'visual-tenant-3', tenant_name: 'サンプル商店',
    action: 'tenant.status.change', reason: '検証用の記録', detail: '{"from":"active","to":"suspended"}',
    ip: null, visible_to_tenant: 1, created_at: '2026-09-30T09:12:00+09:00',
  },
  {
    id: 'visual-audit-3', staff_id: 'visual-ops-member', staff_name: '河野',
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
    staffId: 'visual-ops-invited', name: '山田 花子', email: null, isActive: true,
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
    { id: 'friend-add-folder-store', name: '店頭', color: '#2563EB' },
    { id: 'friend-add-folder-ads', name: '広告', color: '#16A34A' },
    { id: 'friend-add-folder-referral', name: '紹介', color: '#D97706' },
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
    preview: '🚚💐',
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
  webinars: true, events: true, booking: true, visit_stamps: true, affiliates: false, mileage: true,
  ec_commerce: true, line_notifications: true, nen_campaigns: true,
  restaurant_test: true,
}

/** 設計 `bfB50` / `oHAN4` を確認するための固定ECデータ。秘密値そのものは置かない。 */
const EC_SUBSCRIPTIONS = {
  items: [
    { id: 'sub-1', friendId: 'friend-1', ownerName: '高橋 直人', petName: 'ももちゃん', contractNumber: 'SUB-12492', status: 'active', statusLabel: 'よく続いています', riskReason: null, nextShippingAt: '2026-09-08', cycle: 'フード定期便（毎月）', items: '鹿肉フード × 2', amount: 12800, continuedCount: 8, startedAt: '2025-11-01', cancelledAt: null, cancellationReason: null, syncedAt: '2026-09-06T09:58:00+09:00' },
    { id: 'sub-3', friendId: 'friend-3', ownerName: '木村 亮', petName: 'こむぎちゃん', contractNumber: 'SUB-12511', status: 'at_risk', statusLabel: '決済の確認が必要です', riskReason: null, nextShippingAt: '2026-09-12', cycle: 'フード定期便（2か月に1回）', items: '鹿肉フード × 1', amount: 8600, continuedCount: 7, startedAt: '2025-08-01', cancelledAt: null, cancellationReason: null, syncedAt: '2026-09-06T09:58:00+09:00' },
    { id: 'sub-4', friendId: 'friend-4', ownerName: '中村 彩', petName: 'ぷりんちゃん', contractNumber: 'SUB-12528', status: 'paused', statusLabel: '休止中です', riskReason: null, nextShippingAt: null, cycle: 'おやつ定期便（毎月）', items: '鹿肉クッキー × 2', amount: 3600, continuedCount: 4, startedAt: '2026-05-01', cancelledAt: null, cancellationReason: null, syncedAt: '2026-09-06T09:58:00+09:00' },
    { id: 'sub-2', friendId: 'friend-2', ownerName: '前田 さくら', petName: 'そらくん', contractNumber: 'SUB-12503', status: 'active', statusLabel: 'よく続いています', riskReason: null, nextShippingAt: '2026-09-09', cycle: 'おやつ定期便（毎月）', items: '鹿肉ジャーキー × 1', amount: 4200, continuedCount: 8, startedAt: '2026-01-01', cancelledAt: null, cancellationReason: null, syncedAt: '2026-09-06T09:58:00+09:00' },
    { id: 'sub-5', friendId: 'friend-5', ownerName: '大西 健一', petName: 'レオくん', contractNumber: 'SUB-12532', status: 'cancelled', statusLabel: '止まりました', riskReason: null, nextShippingAt: null, cycle: 'フード定期便（毎月）', items: '鹿肉フード × 1', amount: 9800, continuedCount: 3, startedAt: '2026-05-01', cancelledAt: '2026-09-01', cancellationReason: '使いきれない', syncedAt: '2026-09-06T09:58:00+09:00' },
  ],
  summary: { total: 186, active: 172, paused: 5, atRisk: 14, cancelled: 8, monthlyAmount: 1482000, startedThisMonth: 12, cancelledThisMonth: 3, cancellationTopReason: '使いきれない', monthlyStats: [
    { month: '2026-06', count: 158, amount: 1248000 }, { month: '2026-07', count: 169, amount: 1324000 }, { month: '2026-08', count: 172, amount: 1482000 },
  ] },
  risk: { source: 'payment_status', ruleVersion: 'subscription-payment-status-v1', calculatedAt: '2026-09-06T09:58:00+09:00', predictiveScoreAvailable: false },
  // 本物の口（GET /api/ec-commerce/subscriptions）は形が読めなかった件数を必ず返す。無いと定期便のタブが落ちる（wqC8x）
  skipped: { malformedSnapshots: 0 },
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
 * 日時は店舗の timezone と qa-clock の固定時計から組み立てる。
 */
const restaurantAt = (hour, minute = 0, dayOffset = 0) => storeAt(hour, minute, dayOffset, RESTAURANT_STORES[0].timezone)
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
const RESTAURANT_FLOORS=[{id:'floor-store-sby',storeId:'store-sby',name:'1階',width:660,height:420,version:1,
 outline:[{x:1,y:1},{x:659,y:1},{x:659,y:419},{x:1,y:419}],
 fixtures:[{id:'toilet',kind:'toilet',x:16,y:16,width:80,height:60},{id:'kitchen',kind:'kitchen',x:470,y:16,width:170,height:90},{id:'window',kind:'window',x:160,y:1,width:260,height:8},{id:'entrance',kind:'entrance',x:280,y:390,width:90,height:24}],
 tables:RESTAURANT_TABLES.map((t,i)=>{const boxes=[[130,110,64,64],[214,110,64,64],[300,110,84,64],[130,200,84,64],[500,140,36,36],[500,190,36,36],[250,200,120,90],[390,240,90,80],[130,300,84,64]];const [x,y,width,height]=boxes[i];return {id:t.id,x,y,width,height,rotation:0,shape:t.seat_type==='counter'?'circle':'rectangle',joinGroup:t.join_group}})}]
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
/* 提案 E-1・E-5（枠を閉じる知らせ）：枠×媒体で1件。サーバ（/api/restaurant-test/channel-close-tasks）と同じ形。 */
const RESTAURANT_CLOSE_TASKS = [
  /* 絵 YMVFD の並び：19:00（2媒体・未対応）・19:30（3媒体・未対応）・翌日 18:00（1つ閉じた・残り1つ）・20:00（もう開けてよい）。閉じたタブ用に 18:00 を1件。 */
  { id: 'cct-1', storeId: 'store-sby', slotId: 'slot-1900', startsAt: restaurantAt(19, 0), channel: 'hotpepper', status: 'close', reason: 'limited', remainingSeats: 2, recipientIds: [], createdAt: restaurantAt(17, 40), updatedAt: restaurantAt(17, 40) },
  { id: 'cct-2', storeId: 'store-sby', slotId: 'slot-1900', startsAt: restaurantAt(19, 0), channel: 'tabelog', status: 'close', reason: 'limited', remainingSeats: 2, recipientIds: [], createdAt: restaurantAt(17, 40), updatedAt: restaurantAt(17, 40) },
  { id: 'cct-3', storeId: 'store-sby', slotId: 'slot-1930', startsAt: restaurantAt(19, 30), channel: 'hotpepper', status: 'close', reason: 'full', remainingSeats: 0, recipientIds: [], createdAt: restaurantAt(17, 50), updatedAt: restaurantAt(17, 50) },
  { id: 'cct-4', storeId: 'store-sby', slotId: 'slot-1930', startsAt: restaurantAt(19, 30), channel: 'tabelog', status: 'close', reason: 'full', remainingSeats: 0, recipientIds: [], createdAt: restaurantAt(17, 50), updatedAt: restaurantAt(17, 50) },
  { id: 'cct-7', storeId: 'store-sby', slotId: 'slot-1930', startsAt: restaurantAt(19, 30), channel: 'ikyu', status: 'close', reason: 'full', remainingSeats: 0, recipientIds: [], createdAt: restaurantAt(17, 50), updatedAt: restaurantAt(17, 50) },
  { id: 'cct-8', storeId: 'store-sby', slotId: 'slot-1800-next', startsAt: restaurantAt(18, 0, 1), channel: 'tabelog', status: 'done', reason: 'limited', remainingSeats: 1, recipientIds: [], createdAt: restaurantAt(17, 30), updatedAt: restaurantAt(17, 35) },
  { id: 'cct-9', storeId: 'store-sby', slotId: 'slot-1800-next', startsAt: restaurantAt(18, 0, 1), channel: 'hotpepper', status: 'close', reason: 'limited', remainingSeats: 1, recipientIds: [], createdAt: restaurantAt(17, 30), updatedAt: restaurantAt(17, 30) },
  { id: 'cct-5', storeId: 'store-sby', slotId: 'slot-2000', startsAt: restaurantAt(20, 0), channel: 'hotpepper', status: 'reopen', reason: 'limited', remainingSeats: 4, recipientIds: [], createdAt: restaurantAt(16, 10), updatedAt: restaurantAt(17, 20) },
  { id: 'cct-10', storeId: 'store-sby', slotId: 'slot-2000', startsAt: restaurantAt(20, 0), channel: 'tabelog', status: 'reopen', reason: 'limited', remainingSeats: 4, recipientIds: [], createdAt: restaurantAt(16, 10), updatedAt: restaurantAt(17, 20) },
  { id: 'cct-6', storeId: 'store-sby', slotId: 'slot-1800', startsAt: restaurantAt(18, 0), channel: 'hotpepper', status: 'done', reason: 'full', remainingSeats: 0, recipientIds: [], createdAt: restaurantAt(15, 0), updatedAt: restaurantAt(15, 10) },
]
/*
 * 提案 E-10（臨時休業・貸切 UVnvR・足す窓 nVvXy）：今月の 20日（臨時休業・終日全卓）・24日（貸切・18〜22時・個室A と T1）・月末（貸切・終日）。
 * サーバ（/api/restaurant-test/closures）と同じ形。月は撮る日の今月にする（カレンダーに出るように）。
 */
const RESTAURANT_CLOSURE_MONTH = storeYmd(QA_CLOCK, RESTAURANT_STORES[0].timezone).slice(0, 7)
const [closureYear, closureMonth] = RESTAURANT_CLOSURE_MONTH.split('-').map(Number)
const RESTAURANT_CLOSURE_LAST = String(new Date(Date.UTC(closureYear, closureMonth, 0)).getUTCDate())
const restaurantClosure = (id, day, over) => ({
  id, storeId: 'store-sby', startDate: `${RESTAURANT_CLOSURE_MONTH}-${day}`, endDate: `${RESTAURANT_CLOSURE_MONTH}-${day}`, allDay: true, startTime: null, endTime: null,
  kind: 'temporary_closed', memo: null, tableIds: [], createdBy: 'mem-2', createdByName: '中川 由美', createdAt: restaurantAt(10, 0, -3), updatedAt: restaurantAt(10, 0, -3), version: 1, ...over,
})
const RESTAURANT_CLOSURES = [
  restaurantClosure('cl-1', '20', { memo: '設備点検のため' }),
  restaurantClosure('cl-2', '24', { kind: 'private_event', allDay: false, startTime: '18:00', endTime: '22:00', tableIds: ['tbl-8', 'tbl-1'], memo: '会社の宴会（30名）' }),
  restaurantClosure('cl-3', RESTAURANT_CLOSURE_LAST, { kind: 'private_event', memo: 'ハロウィン貸切' }),
]
/* 臨時休業・貸切の窓の preview：この日の予約2件（LINE の友だち1件・ホットペッパー1件）。保存・送信はしない。 */
const RESTAURANT_CLOSURE_PREVIEW = {
  reservations: [
    { id: 'cl-r1', startsAt: restaurantAt(12, 0, 13), endsAt: restaurantAt(14, 0, 13), guestCount: 2, customerName: '山田 花子', customerPhone: null, contacted: false, source: 'line', tableId: 'tbl-1', friendId: 'friend-1', isLineFriend: true },
    { id: 'cl-r2', startsAt: restaurantAt(19, 0, 13), endsAt: restaurantAt(21, 0, 13), guestCount: 4, customerName: '佐藤 美咲', customerPhone: '03-…', contacted: false, source: 'hotpepper', tableId: 'tbl-4', friendId: null, isLineFriend: false },
  ],
  contactedCount: 0,
  waitlistCount: 0,
  conflicts: [],
}
/* 右の列の「連絡済み」（contact-status）：20日の臨時休業は予約2件のうち1件に LINE で連絡済み。ほかは予約なし。 */
const restaurantClosureContact = (id) => id === 'cl-1'
  ? { ...RESTAURANT_CLOSURE_PREVIEW, contactedCount: 1, reservations: RESTAURANT_CLOSURE_PREVIEW.reservations.map((r, i) => ({ ...r, contacted: i === 0 })) }
  : { contactedCount: 0, reservations: [], waitlistCount: 0, conflicts: [] }
/* E-4 の「もう開けてよい」の知らせと知らせる相手（店長・ホール担当の2人を選んだ形）。 */
const RESTAURANT_CLOSE_NOTIFICATION = { storeId: 'store-sby', notifyReopen: true, recipientMode: 'selected', membershipIds: ['mem-2', 'mem-4'], version: 1 }
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

/*
 * 飲食店向け デリバリー受注（`restaurantDeliveryApi`・`/api/restaurant-test/delivery/*`）。
 * ★V8 の板 `kDQHr`（注文一覧）・`OzHLO`（注文履歴）・`h7OeT`（品切れ一括）と
 * 窓 `hjdqV`・`dgeTy`・`XCVGd`。
 *
 * 無いと既定の器（`EMPTY_PAGE`）が返り、`success` が真なので画面は例外を捕まえられず、
 * `data.store.id`・`data.services`・`data.orders` が回せずに
 * 「画面を表示できませんでした」になっていた（`/restaurant-test/delivery`）。
 * 返事の形は本物（`apps/worker/src/routes/restaurant-delivery.ts`）と同じく
 * `data` で包まない平らな形にする（`apps/web/src/lib/restaurant-delivery-api.ts` の型）。
 *
 * 測定専用の `scripts/visual-qa/delivery-fixtures.mjs`（絵との画素比べ用）とは
 * 別に持つ。あちらは絵に合わせて件数や文字を動かすので、ここから読み込むと
 * 184画面の共通の仮サーバーが絵の調整につられて壊れる。
 */
const DELIVERY_STORE = { id: 'store-sby', name: '然 渋谷店' }
const DELIVERY_SERVICE_LABELS = { ubereats: 'Uber Eats', demaecan: '出前館', rocketnow: 'ロケットナウ' }
const DELIVERY_SERVICES = [
  { service: 'ubereats', label: 'Uber Eats', connectionStatus: 'connected', intakeStatus: 'open', stopUntil: null, todayCount: 14, todayAmount: 39600 },
  { service: 'demaecan', label: '出前館', connectionStatus: 'connected', intakeStatus: 'open', stopUntil: null, todayCount: 11, todayAmount: 28800 },
  { service: 'rocketnow', label: 'ロケットナウ', connectionStatus: 'connected', intakeStatus: 'stopped', stopUntil: restaurantAt(13, 0), todayCount: 7, todayAmount: 18000 },
]
const deliveryOrder = (id, service, orderNumber, status, statusLabel, totalAmount, itemCount, itemSummary, urgency, urgencyReason, receivedAt, wantedAt) => ({
  id, service, serviceLabel: DELIVERY_SERVICE_LABELS[service], orderNumber, status, statusLabel,
  totalAmount, itemCount, itemSummary, urgency, urgencyReason, receivedAt, wantedAt,
})
const DELIVERY_ORDERS = [
  deliveryOrder('ord-ue-1042', 'ubereats', 'UE-1042', 'new', '新着', 3480, 4, '唐揚げ弁当×2 ほか3点', 'urgent', '受け取り希望まで13分・品数4点のため、先に調理を始めるのがおすすめです', restaurantAt(12, 2), restaurantAt(12, 15)),
  deliveryOrder('ord-dm-8821', 'demaecan', 'DM-8821', 'new', '新着', 1180, 1, '天丼セット×1', 'normal', null, restaurantAt(12, 4), restaurantAt(12, 25)),
  deliveryOrder('ord-rn-310', 'rocketnow', 'RN-310', 'cooking', '調理中', 2560, 4, 'バターチキンカレー×2 ナン×2', 'urgent', '受け取り希望まで8分です', restaurantAt(12, 6), restaurantAt(12, 16)),
  deliveryOrder('ord-ue-1041', 'ubereats', 'UE-1041', 'cooking', '調理中', 2180, 2, '海鮮丼×1 みそ汁×1', 'normal', null, restaurantAt(12, 9), restaurantAt(12, 30)),
  deliveryOrder('ord-dm-8820', 'demaecan', 'DM-8820', 'cooking', '調理中', 4140, 3, 'ハンバーグ定食×3', 'watch', '品数が多く調理に時間がかかります', restaurantAt(12, 12), restaurantAt(12, 35)),
  deliveryOrder('ord-ue-1039', 'ubereats', 'UE-1039', 'handed_over', '受け渡し済み', 1160, 1, '唐揚げ弁当×1', 'normal', null, restaurantAt(11, 48), restaurantAt(12, 5)),
  deliveryOrder('ord-rn-309', 'rocketnow', 'RN-309', 'canceled', 'キャンセル', 980, 1, 'チキンカレー×1', 'normal', null, restaurantAt(11, 40), restaurantAt(12, 0)),
]
/* 表の選び取り（`tab`）は本物と同じく Worker 側で絞る。`all` は全部。 */
const deliveryOrdersByTab = (tab) => (tab === 'all' ? DELIVERY_ORDERS : DELIVERY_ORDERS.filter((row) => row.status === tab))
const DELIVERY_ORDER_ITEMS = {
  'ord-ue-1042': [
    { name: '唐揚げ弁当', note: '特製タレ増量（無料）', quantity: 2, amount: 2160 },
    { name: 'ポテトサラダ', note: null, quantity: 1, amount: 380 },
    { name: '緑茶（500ml）', note: null, quantity: 2, amount: 440 },
  ],
}
const DELIVERY_HISTORY = DELIVERY_ORDERS.map((row) => ({
  id: row.id, service: row.service, serviceLabel: row.serviceLabel, orderNumber: row.orderNumber,
  status: row.status, statusLabel: row.statusLabel, totalAmount: row.totalAmount, itemCount: row.itemCount,
  itemSummary: row.itemSummary, receivedAt: row.receivedAt,
  handedOverAt: row.status === 'handed_over' ? restaurantAt(12, 0) : null,
  canceledAt: row.status === 'canceled' ? restaurantAt(11, 44) : null,
}))
const DELIVERY_MENU_SERVICE_TAGS = DELIVERY_SERVICES.map(({ service, label }) => ({ service, label }))
const DELIVERY_MENU_ITEMS = [
  { id: 'dm-1', name: '唐揚げ弁当', category: '弁当', price: 1080, soldOut: false, soldOutAt: null, services: DELIVERY_MENU_SERVICE_TAGS },
  { id: 'dm-2', name: '日替わり弁当', category: '弁当', price: 980, soldOut: false, soldOutAt: null, services: DELIVERY_MENU_SERVICE_TAGS },
  { id: 'dm-3', name: '親子丼セット', category: '丼もの', price: 1180, soldOut: false, soldOutAt: null, services: DELIVERY_MENU_SERVICE_TAGS },
  { id: 'dm-4', name: '焼き魚定食', category: '定食', price: 1180, soldOut: true, soldOutAt: restaurantAt(11, 10), services: DELIVERY_MENU_SERVICE_TAGS },
  { id: 'dm-5', name: 'ポテトサラダ', category: '副菜', price: 380, soldOut: false, soldOutAt: null, services: DELIVERY_MENU_SERVICE_TAGS },
  { id: 'dm-6', name: '緑茶（500ml）', category: 'ドリンク', price: 220, soldOut: false, soldOutAt: null, services: DELIVERY_MENU_SERVICE_TAGS },
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

/* 成果承認は選んだアカウントの分だけ出す（lineAccountId で絞る）。見本は撮影のアカウントに付ける。 */
const CONVERSION_APPROVALS = [...PENDING_APPROVALS, ...APPROVED_APPROVALS, ...REJECTED_APPROVALS]
  .map((item) => ({ lineAccountId: ACCOUNT.id, ...item }))

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
        cadence: 'weekly', weekday: 1, monthDay: null, sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 7,
        recipients: [{ kind: 'staff', staffId: 'staff-owner' }], channels: ['email'], alertRules: [],
        status: 'active', isOneTime: false, nextRunAt: '2026-10-06T09:00:00+09:00', createdBy: 'staff-owner', createdAt: '2026-09-01T09:00:00+09:00', updatedAt: '2026-09-01T09:00:00+09:00',
      },
      {
        id: 'report-monthly-outcomes', lineAccountId: 'visual-qa-account', name: '月末の成果まとめ', sections: ['routes'], savedAnalysisIds: [],
        cadence: 'monthly', weekday: null, monthDay: 1, sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 30,
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
  // 成果とアフィリエイト（affiliates）も絵は機能がある前提で描かれている（Eo56k ほか。2026-10-15 司令塔）。
  // 本物の既定値（affiliates は既定オフ）は変えず、表示の出し分けだけオンで返す。
  '/api/settings/features/visibility': { features: { ...FEATURES, multi_store_hierarchy: true, affiliates: true } },
  '/api/inbox/unanswered/count': { total: 5, byAccount: [{ accountId: 'visual-qa-account', accountName: '然-NEN-TEST', count: 5 }], oldestWaitMinutes: 9110 },
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
  /*
   * B-6 受信箱の添付（API-15・M0393「7. 添付」）：画像以外の準備（アップロード）は保存しないで同じ形を返す。
   * B-26 右の欄でその場で直す：対応状況・担当・メモの更新は、送った値を当てた会話を返す（保存はしない）。
   */
  if (method === 'POST' && /^\/api\/chats\/[^/]+\/attachments\/upload$/.test(pathname)) {
    return {
      id: '9b2f6c1e-3a4d-4e5f-8a7b-1c2d3e4f5a6b', key: 'private/chat-attachments/9b2f6c1e-3a4d-4e5f-8a7b-1c2d3e4f5a6b',
      url: 'https://example.com/api/chat-attachments/9b2f6c1e-3a4d-4e5f-8a7b-1c2d3e4f5a6b',
      filename: '定期便のご案内.pdf', mimeType: 'application/pdf', size: 482133, kind: 'file',
      expiresAt: '2026-11-07T03:00:00.000Z',
    }
  }
  if (method === 'PUT' && /^\/api\/chats\/[^/]+$/.test(pathname)) {
    const id = pathname.split('/').pop()
    const chat = CHATS.find((row) => row.id === id || row.friendId === id) ?? CHATS[0]
    return { id: chat.friendId ?? chat.id, friendId: chat.friendId ?? chat.id, operatorId: chat.operatorId ?? null, status: chat.status, notes: chat.notes ?? null, revision: (chat.revision ?? 0) + 1 }
  }
  /* 提案 E-4・E-9：媒体リンクの保存・グルメ媒体・予約ページの URL、統括の一括配信の作る・確かめる・外す・送る・止める・やり直す。 */
  if (method === 'POST' && pathname === '/api/restaurant-test/media') return { code: 'gourmet_new', name: 'グルメ媒体', acceptsReservations: false }
  if (method === 'PUT' && pathname.startsWith('/api/restaurant-test/media-links/')) {
    const row = RESTAURANT_MEDIA_LINKS.find((m) => m.code === pathname.split('/').pop()) ?? RESTAURANT_MEDIA_LINKS[0]
    return { ...row, storeId: 'store-sby', closeOnBooking: !!row.closeOnBooking, version: row.version + 1 }
  }
  if (method === 'POST' && pathname === '/api/restaurant-test/reservation-link') return RESTAURANT_RESERVATION_LINK
  if (method === 'POST' && pathname === '/api/hq/broadcasts') return { ...HQ_RUN_DRAFT, id: 'hq-run-new', version: 1 }
  /* 下書きを直す（PATCH・版つき）。依頼番号と ID はそのまま、版を1つ上げる。 */
  if (method === 'PATCH' && /^\/api\/hq\/broadcasts\/[^/]+$/.test(pathname)) return { ...HQ_RUN_DRAFT, id: pathname.split('/')[4], version: HQ_RUN_DRAFT.version + 1 }
  if (method === 'POST' && /^\/api\/hq\/broadcasts\/[^/]+\/preflight$/.test(pathname)) return HQ_PREFLIGHT.map((c) => ({ ...c, excluded: false }))
  if (method === 'PUT' && /^\/api\/hq\/broadcasts\/[^/]+\/exclusions$/.test(pathname)) return { ...HQ_RUN_DRAFT, id: pathname.split('/')[4], version: 3 }
  if (method === 'POST' && /^\/api\/hq\/broadcasts\/[^/]+\/(send|stop|cancel)$/.test(pathname)) return { ...HQ_RUN_SENT, id: pathname.split('/')[4] }
  if (method === 'POST' && /^\/api\/hq\/broadcasts\/[^/]+\/targets\/[^/]+\/retry$/.test(pathname)) return HQ_RUN_SENT
  /* 来店スタンプ（w4SBbv）：保存・押印・承認・取り消し・暗証番号は、本物と同じ形の返事だけ返す（中身は変えない）。 */
  if (pathname.startsWith('/api/visit-stamps/')) {
    if (/^\/api\/visit-stamps\/cards(\/[^/]+)?$/.test(pathname)) return { ...VISIT_STAMP_CARD, version: VISIT_STAMP_CARD.version + 1 }
    if (/\/grants$/.test(pathname) || /\/reverse$/.test(pathname)) return { cardId: 'vs-card-1', friendId: 'vs-f-5', balance: 1, earnedTotal: 12, expiresAt: null }
    const review = /^\/api\/visit-stamps\/paper-requests\/([^/]+)\/review$/.exec(pathname)
    if (review) return { id: review[1], status: 'approved' }
    const pin = /^\/api\/visit-stamps\/pins\/([^/]+)$/.exec(pathname)
    if (pin) return { staffId: pin[1], accountId: 'visual-qa-account', configured: true }
  }
  /* 自動応答のかんたんに作る（板 G4GejG）：作った下書き。重なりは ar-quick の口が返す。 */
  if (method === 'POST' && pathname === '/api/auto-replies/drafts') {
    return { autoReplyId: 'ar-quick', versionId: 'arv-quick', versionNumber: 1, status: 'draft', settings: null, lastTestStatus: null, lastTestedAt: null, publishedAt: null }
  }
  /* 外部連携の API 接続：発行した直後の窓（板 UkZLi）。平文の鍵は発行の返事にだけ1回乗る。 */
  if (method === 'POST' && pathname === '/api/webhooks/api-tokens') {
    return { id: 'apitok-new', name: '在庫システム', tokenPrefix: 'lh_live_7Kq2', scopes: ['tags:read', 'tags:write'], createdBy: 'visual-qa-owner', lastUsedAt: null, rotatedFromId: null, createdAt: '2026-10-05T01:00:00.000Z', revokedAt: null, token: 'lh_live_7Kq2mZ9xW4pR8vN3tY6bH1cJ5dF3f9a' }
  }
  // 統括のテンプレート（★V8-B meBRB）：配る前の確認。
  const deliveryFixture = HQ_DELIVERY_FIXTURES.find(row=>pathname.startsWith(`/api/hq/templates/${row.template.id}/`))
  if (deliveryFixture && method==='POST' && pathname.endsWith('/preflight')) return {...HQ_TEMPLATE_PREFLIGHT_HTN, stores: HQ_TEMPLATE_PREFLIGHT_HTN.stores.map(store=>({...store,items:store.items.map(item=>({...item,sourceId:deliveryFixture.template.id,itemKind:deliveryFixture.template.template_type,name:deliveryFixture.template.name}))}))}
  if (deliveryFixture && method==='POST' && pathname.endsWith('/distribute')) return HQ_TEMPLATE_RESULT_HTN
  if (method === 'POST' && /^\/api\/hq\/templates\/visual-hq-tpl-[^/]+\/preflight$/.test(pathname)) return HQ_TEMPLATE_PREFLIGHT_HTN
  // 統括のテンプレート（★V8-B dEvJM）：配る。結果の窓に出す成功2・失敗1を返す。
  if (method === 'POST' && /^\/api\/hq\/templates\/visual-hq-tpl-[^/]+\/distribute$/.test(pathname)) return HQ_TEMPLATE_RESULT_HTN
  // 統括 LINEアカウントを登録（★V8-B v2KMj・qw80E・TvXII）。接続確認は5段すべて通った返事、登録は取り込み中。
  if (method === 'POST' && pathname === '/api/line-accounts/connect/check') return LINE_ACCOUNT_CONNECT_HTN
  if (method === 'POST' && pathname === '/api/line-accounts/connect') {
    return { ...LINE_ACCOUNT_CONNECT_HTN, id: 'visual-qa-account-new', followerImport: { capability: 'available', phase: 'importing_ids' } }
  }
  if (method === 'POST' && (pathname === '/api/notifications/operator-rules/recipients-preview' || pathname === '/api/line-notifications/operator-rules/recipients-preview')) {
    /*
     * 本物は両方の名で同じ候補を返す（`notifications.ts`）。
     * `line-notifications` 側が無いと、つくる画面の「受け取る人」が
     * 「読み込めませんでした」になっていた。
     */
    return OPERATOR_NOTIFICATION_RECIPIENTS
  }
  if (method === 'POST' && pathname === '/api/line-notifications/operator-rules') {
    /*
     * 運用者へのお知らせを作る（V8-B sDXNy）：公開の前に下書きを保存してから確認の窓を出す。
     * ここに無いと 405 で下書きの保存が失敗に見え、窓が撮れなかった。作った1件を返す。
     */
    return { ...OPERATOR_NOTIFICATION_RULES[0], id: 'op-rule-new-draft', status: 'draft', isActive: false, version: 1 }
  }
  if (method === 'POST' && /^\/api\/(line-)?notifications\/operator-rules\/[^/]+\/(publish|test)$/.test(pathname)) {
    return { accepted: 2, excluded: 0, failed: 0, duplicate: 0 }
  }
  /*
   * 運用者へのお知らせを作る（板 gjUz3）→ 公開前の確認（板 sDXNy）。公開を押すと先に下書きを保存し、
   * 保存できたときだけ確認の窓が出る。405 だと窓が出ず「下書きを保存できませんでした」で撮られていた。
   */
  if ((method === 'POST' && pathname === '/api/line-notifications/operator-rules')
    || (method === 'PUT' && /^\/api\/line-notifications\/operator-rules\/[^/]+\/draft$/.test(pathname))) {
    return { ...OPERATOR_NOTIFICATION_RULES[0], id: 'operator-rule-new', status: 'draft', isActive: false, version: 1 }
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
    // 板 GobMd：愛犬のお名前は種類だけの見本（移行先なし・確認番号なし）を返す。ほかは今までどおり。
    if (pathname.includes('/field-dog-name/')) return FRIEND_FIELD_MIGRATION_PREVIEW_DOG
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
  '/api/booking/admin/sales-summary': { success: true, data: {
    from: '2026-10-01', to: '2026-10-31',
    total: { bookings: 0, confirmed: 0, revenue: 0, cancelRate: 0, noshowRate: 0, cancelled: 0, noshow: 0 },
    menus: [], weekdays: [], previous: { revenue: 0, bookings: 0, cancelRate: 0, noshowRate: 0 }, revenueSource: 'menu',
  } },
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

/* 提案 E-4 予約サイト・グルメ媒体（aSmph）：店ごとの媒体リンク。口（restaurant-test/media-links）と同じ形。 */
const RESTAURANT_MEDIA_LINKS = [
  { code: 'hotpepper', name: 'ホットペッパー', acceptsReservations: 1, pageUrl: 'https://hotpepper.jp/strJ001234567/', loginUrl: 'https://manager.hotpepper.jp/', closeOnBooking: 1, version: 3 },
  { code: 'tabelog', name: '食べログ', acceptsReservations: 1, pageUrl: 'https://tabelog.com/tokyo/A1301/A130101/13250000/', loginUrl: 'https://owner.tabelog.com/', closeOnBooking: 1, version: 2 },
  { code: 'gurunavi', name: 'ぐるなび', acceptsReservations: 1, pageUrl: 'https://r.gnavi.co.jp/abc1234/', loginUrl: 'https://pro.gnavi.co.jp/', closeOnBooking: 1, version: 1 },
  { code: 'retty', name: 'Retty', acceptsReservations: 0, pageUrl: 'https://retty.me/area/PRE13/ARE1/SUB101/100001234567/', loginUrl: null, closeOnBooking: 0, version: 1 },
  { code: 'ikyu', name: '一休', acceptsReservations: 1, pageUrl: 'https://restaurant.ikyu.com/123456/', loginUrl: 'https://admin.restaurant.ikyu.com/', closeOnBooking: 0, version: 1 },
  { code: 'google', name: 'Google', acceptsReservations: 1, pageUrl: 'https://g.page/nen-ginza', loginUrl: 'https://business.google.com/', closeOnBooking: 0, version: 1 },
]
const RESTAURANT_RESERVATION_LINK = {
  url: 'https://liff.line.me/2001234567-AbCdEf/booking',
  html: '<a href="https://liff.line.me/2001234567-AbCdEf/booking" target="_blank" rel="noopener noreferrer">LINE で予約する</a>',
  available: false,
}
/* 提案 E-9 統括の一括配信（p17Qku・xOXuY）：口（/api/hq/broadcasts）と同じ形。店の名前・数は絵のとおり。 */
const hqCheck = (accountId, accountName, audienceCount, remaining, blockedReasons = [], extra = {}) => ({
  accountId, accountName, audienceCount, remaining, connected: !blockedReasons.some((r) => r.includes('LINE')), paused: blockedReasons.some((r) => r.includes('停止')),
  blockedReasons, excluded: blockedReasons.length > 0, broadcastId: null, ...extra,
})
const HQ_PREFLIGHT = [
  hqCheck('hq-ginza', '銀座店', 6120, 18400),
  hqCheck('hq-shinjuku', '新宿店', 5880, 2100, ['今月の送信枠が足りません']),
  hqCheck('hq-yokohama', '横浜店', 4300, 9000, ['LINEに接続されていません']),
  hqCheck('hq-umeda', '梅田店', 3950, 12000, ['店舗または配信が停止中']),
  ...[['hq-ikebukuro', '池袋店', 4050], ['hq-nagoya', '名古屋店', 460], ['hq-shibuya', '渋谷店', 3900], ['hq-ueno', '上野店', 3600], ['hq-kyoto', '京都店', 3500], ['hq-kobe', '神戸店', 3450], ['hq-sendai', '仙台店', 3500], ['hq-hakata', '博多店', 5500]]
    .map(([id, name, count]) => hqCheck(id, name, count, 20000)),
]
const hqTarget = (check, status, totalCount, successCount, extra = {}) => ({ ...check, status, totalCount, successCount, version: 2, retryableCount: 0, stopped: false, ...extra })
/* 下書きの中身（API-10：GET で input を返す。画面はここから本文・宛先・時刻を戻す）。 */
const HQ_RUN_INPUT = {
  requestId: 'hq-req-draft', title: '1月の限定メニュー「寒ぶりのしゃぶしゃぶ」を始めました', messageType: 'text',
  messageContent: '{{account.name}}より：1月の限定メニュー「寒ぶりのしゃぶしゃぶ」を始めました。ご予約は LINE から → {{var.reservation_url}}',
  accountIds: [], accountTagIds: ['tag-shibuya'], excludedAccountIds: [], audience: { kind: 'all' }, scheduledAt: '2027-01-15T02:00:00.000Z',
}
const HQ_RUN_DRAFT = { id: 'hq-run-draft', title: '1月の限定メニュー「寒ぶりのしゃぶしゃぶ」を始めました', status: 'prepared', version: 2, scheduledAt: '2027-01-15T02:00:00.000Z', input: HQ_RUN_INPUT, targets: HQ_PREFLIGHT.map((c) => hqTarget(c, c.excluded ? 'excluded' : 'prepared', 0, 0)) }
const HQ_RUN_SENT = {
  id: 'hq-run-sent', title: '1月の限定メニュー「寒ぶりのしゃぶしゃぶ」を始めました', status: 'scheduled', version: 4, scheduledAt: '2026-01-15T02:00:00.000Z', input: { ...HQ_RUN_INPUT, requestId: 'hq-req-sent', folderId: 'hqbf-campaign' },
  targets: [
    hqTarget(hqCheck('hq-ginza', '銀座店', 6120, 18400), 'sent', 6120, 6118, { broadcastId: 'b-ginza', openedCount: 4210, clickedCount: 820, reactionCount: 96 }),
    hqTarget(hqCheck('hq-ikebukuro', '池袋店', 4050, 20000), 'sent', 4050, 4050, { broadcastId: 'b-ikebukuro', openedCount: 2890, clickedCount: 512, reactionCount: 41 }),
    hqTarget(hqCheck('hq-nagoya', '名古屋店', 460, 20000), 'failed', 460, 0, { broadcastId: 'b-nagoya', retryableCount: 460, openedCount: 0, clickedCount: 0, reactionCount: 0, failureReasons: [{ code: 'line_busy', label: 'LINEが混雑しています', count: 460, retryable: true }] }),
    hqTarget(hqCheck('hq-shinjuku', '新宿店', 5880, 2100, ['今月の送信枠が足りません']), 'excluded', 0, 0),
    hqTarget(hqCheck('hq-others', 'ほか 6店', 23450, 120000), 'sent', 23450, 23450, { broadcastId: 'b-others', openedCount: 16410, clickedCount: 3520, reactionCount: 380 }),
  ],
}

/* 作成③の撮影状態。既存APIから5つの吹き出しを戻す。未選択の素材は下書きのまま。 */
const VISUAL_COMPOSE_BUBBLES = [
  { id: 'visual-text', type: 'text', content: { text: '{{name}}さん、いつもありがとうございます。\n定期便のお客さま限定で、秋の新商品を先行でご案内します🍂' } },
  { id: 'visual-sticker', type: 'sticker', content: { state: {
    location: { title: '', address: '', latitude: '', longitude: '' },
    video: { originalContentUrl: '', previewImageUrl: '' },
    audio: { originalContentUrl: '', duration: '' },
    sticker: { packageId: '11537', stickerId: '52002734' },
  } } },
  { id: 'visual-carousel', type: 'carousel', content: { templateName: '秋の新商品 3種', inline: true,
    columnsJson: JSON.stringify(['秋の新商品', '定期便', 'お試しセット'].map((title, index) => ({
      title, text: '秋のおすすめ商品をご案内します',
      actions: [{ type: 'uri', label: index === 1 ? '申し込む' : '商品を見る', uri: `https://example.com/products/autumn-${index + 1}` }],
    }))),
  } },
  { id: 'visual-audio', type: 'audio', content: { fileName: '秋のごあいさつ.m4a', state: {
    location: { title: '', address: '', latitude: '', longitude: '' },
    video: { originalContentUrl: '', previewImageUrl: '' },
    audio: { originalContentUrl: 'https://example.com/autumn-greeting.m4a', duration: '42' },
    sticker: { packageId: '', stickerId: '' },
  } } },
  { id: 'visual-rich', type: 'rich_message', content: {} },
]
const HQ_VISUAL_COMPOSE_DRAFT = { ...HQ_RUN_DRAFT, id: 'hq-visual-compose', input: { ...HQ_RUN_INPUT, messageBubblesJson: JSON.stringify(VISUAL_COMPOSE_BUBBLES) } }
const HQ_VISUAL_SENT = { ...HQ_RUN_SENT, id: 'hq-visual-sent', title: '新商品発売のお知らせ', status: 'sent' }
const VISUAL_COMPOSE_DRAFT = { ...BROADCASTS[1], id: 'visual-compose', targetType: 'all', messageBubbles: VISUAL_COMPOSE_BUBBLES }

const HQ_BROADCAST_FOLDERS = [
  { id: 'hqbf-reserve', name: '予約配信', revision: 1, item_count: 0 },
  { id: 'hqbf-campaign', name: 'キャンペーン', revision: 1, item_count: 1 },
]
const HQ_APPROVAL_NONE = {
  approval: { status: 'none', requestedByStaffId: null, requestedAt: null, approverStaffId: null, note: null, decidedByStaffId: null, decidedAt: null, rejectReason: null, confirmedCount: null },
  gate: { required: false, recipientCount: 0, threshold: 1000000, singleOperator: false, operatorCount: 2 },
  viewer: { isApprover: false, canApprove: false, isRequester: false },
}

/* 来店スタンプ（提案 E-7 w4SBbv）。カード1枚・紙の申請4件・佐藤 健二さん（vs-f-5）の台帳。日時は UTC（画面は日本時間で出す）。 */
const VISIT_STAMP_CARD = {
  id: 'vs-card-1', name: '然 来店スタンプカード', accountIds: ['visual-qa-account'], active: true, version: 3, expectedVersion: 3,
  settings: {
    mode: 'amount', amountUnit: 1000, maxPerVisit: 3, firstVisitBonus: 1, expiryMonths: 6, timezone: 'Asia/Tokyo',
    expiryBasis: 'last_visit', expiryReminder: 'week_before', completion: 'next_card', nextCardId: 'vs-card-gold',
    backgroundColor: '#7b4a2e', receiptBonus: 1, stampInterval: { mode: 'same_day' },
    instructions: '1回のご来店で1個たまります。10個で デザート1品プレゼント。',
    /* API-10：マスの数・重ねる順番・重ねたときの上限は別に持つ。 */
    slotCount: 10, stackingOrder: 'bonus_then_multipliers', maxStackedStamps: 5,
    multipliers: [{ multiplier: 2, weekdays: [2], startMinute: 1020, endMinute: 1140, from: '2025-12-31T15:00:00.000Z', to: '2026-03-31T15:00:00.000Z' }],
    rankMultipliers: [],
    rewards: [{ id: 'reward-drink', name: 'ドリンク 1杯', stamps: 5 }, { id: 'reward-dessert', name: 'デザート 1品', stamps: 10 }],
  },
}
const VISIT_STAMP_FRIENDS = {
  'vs-f-1': { id: 'vs-f-1', displayName: 'みさき', metadata: { name: '鈴木 美咲' } },
  'vs-f-2': { id: 'vs-f-2', displayName: 'けん', metadata: { name: '小林 健' } },
  'vs-f-3': { id: 'vs-f-3', displayName: 'めぐ', metadata: { name: '加藤 恵' } },
  'vs-f-4': { id: 'vs-f-4', displayName: 'つばさ', metadata: { name: '中村 翼' } },
  'vs-f-5': { id: 'vs-f-5', displayName: 'けんじ', metadata: { name: '佐藤 健二' } },
  'vs-f-6': { id: 'vs-f-6', displayName: 'さくら', metadata: { name: '高橋 さくら' } },
  'vs-f-7': { id: 'vs-f-7', displayName: 'あや', metadata: { name: '山本 彩' } },
  'vs-f-8': { id: 'vs-f-8', displayName: 'ゆき', metadata: { name: '伊藤 由紀' } },
}
const VISIT_STAMP_PAPER = [
  { id: 'vsp-1', card_id: 'vs-card-1', friend_id: 'vs-f-1', line_account_id: 'visual-qa-account', photo_url: '', stamps: 7, status: 'pending', created_at: '2026-01-12 11:14:00' },
  { id: 'vsp-2', card_id: 'vs-card-1', friend_id: 'vs-f-2', line_account_id: 'visual-qa-account', photo_url: '', stamps: 4, status: 'pending', created_at: '2026-01-12 04:02:00' },
  { id: 'vsp-3', card_id: 'vs-card-1', friend_id: 'vs-f-3', line_account_id: 'visual-qa-account', photo_url: '', stamps: 9, status: 'pending', created_at: '2026-01-11 10:45:00' },
  { id: 'vsp-4', card_id: 'vs-card-1', friend_id: 'vs-f-4', line_account_id: 'visual-qa-account', photo_url: '', stamps: 3, status: 'approved', created_at: '2026-01-10 09:20:00' },
]
const vsEntry = (id, kind, delta, actorId, reason, createdAt, originalId = null, friendId = 'vs-f-5') => ({ id, cardId: 'vs-card-1', friendId, accountId: 'visual-qa-account', kind, delta, actorId, reason, createdAt, originalId })
/* ④ 店全体の記録（API-10 の entries）。絵のとおり、いろいろな友だちの記録が新しい順に並ぶ。 */
const VISIT_STAMP_ENTRIES = [
  vsEntry('vse-1', 'visit', 2, 'stf-3', '来店・会計 2,400円', '2026-01-13T09:40:00.000Z'),
  vsEntry('vse-2', 'redeem', -10, 'stf-3', 'デザート 1品', '2026-01-13T09:10:00.000Z', null, 'vs-f-6'),
  vsEntry('vse-3', 'paper', 7, 'stf-1', '紙のカードの写真を確認しました', '2026-01-12T11:30:00.000Z', null, 'vs-f-1'),
  vsEntry('vse-4', 'visit', 1, null, '来店（予約の来店）', '2026-01-12T03:05:00.000Z', null, 'vs-f-7'),
  vsEntry('vse-5', 'manual', 1, 'stf-1', '押し忘れ', '2026-01-11T10:02:00.000Z', null, 'vs-f-8'),
  vsEntry('vse-6', 'reverse', -1, 'stf-1', 'まちがい', '2026-01-11T10:30:00.000Z', 'vse-5', 'vs-f-8'),
  vsEntry('vse-7', 'visit', 1, null, '来店', '2026-01-08T10:00:00.000Z'),
]
function visitStampRead(pathname, query) {
  if (pathname === '/api/visit-stamps/cards') return { success: true, data: [VISIT_STAMP_CARD, { ...VISIT_STAMP_CARD, id: 'vs-card-gold', name: 'ゴールドカード', settings: { ...VISIT_STAMP_CARD.settings, completion: 'repeat', nextCardId: null } }] }
  if (pathname === '/api/visit-stamps/paper-requests') return { success: true, data: VISIT_STAMP_PAPER }
  if (pathname === '/api/visit-stamps/entries') {
    const page = Math.max(1, Number(query.get('page') ?? 1)), pageSize = Math.min(200, Math.max(1, Number(query.get('pageSize') ?? 50)))
    const friendId = query.get('friendId'), kind = query.get('kind')
    const list = VISIT_STAMP_ENTRIES.filter((e) => (!friendId || e.friendId === friendId) && (!kind || e.kind === kind))
    return { success: true, data: { items: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize } }
  }
  if (/^\/api\/visit-stamps\/cards\/[^/]+\/wallet$/.test(pathname)) {
    const friendId = query.get('friendId') ?? ''
    const entries = VISIT_STAMP_ENTRIES.filter((e) => e.friendId === friendId)
    return { success: true, data: { wallet: { cardId: 'vs-card-1', friendId, balance: entries.reduce((n, e) => n + e.delta, 0), earnedTotal: 12, expiresAt: '2026-07-13T09:40:00.000Z' }, entries } }
  }
  const friend = /^\/api\/friends\/(vs-f-\d)$/.exec(pathname)
  if (friend && VISIT_STAMP_FRIENDS[friend[1]]) return { success: true, data: VISIT_STAMP_FRIENDS[friend[1]] }
  return null
}

function bodyFor(method, pathname, query = new URLSearchParams()) {
  { const stamps = method === 'GET' ? visitStampRead(pathname, query) : null; if (stamps) return stamps }
  if (method === 'GET' && pathname === '/api/restaurant-test/media-links') return { success: true, data: RESTAURANT_MEDIA_LINKS }
  if (method === 'GET' && pathname === '/api/restaurant-test/media') return { success: true, data: RESTAURANT_MEDIA_LINKS.map(({ code, name, acceptsReservations }) => ({ code, name, acceptsReservations })) }
  if (method === 'GET' && pathname === '/api/hq/broadcasts') return { success: true, data: [HQ_RUN_SENT, HQ_RUN_DRAFT] }
  /* API-18：統括の一括配信のフォルダ・承認・宛先・記録。 */
  if (method === 'GET' && pathname === '/api/hq/broadcasts/folders') return { success: true, data: HQ_BROADCAST_FOLDERS }
  if (method === 'GET' && pathname === '/api/hq/broadcasts/approvals/candidates') return { success: true, data: [{ id: 'stf-1', name: 'Kenta Kawano', role: 'owner', canApprove: true }, { id: 'stf-2', name: '佐々木 亮太', role: 'admin', canApprove: true }] }
  if (method === 'GET' && /^\/api\/hq\/broadcasts\/[^/]+\/approval$/.test(pathname)) return { success: true, data: HQ_APPROVAL_NONE }
  if (method === 'GET' && /^\/api\/hq\/broadcasts\/[^/]+\/activity$/.test(pathname)) return { success: true, data: { rows: [{ id: 'act-2', accountId: '', actorId: 'stf-1', action: 'scheduled', createdAt: '2026-01-14T09:00:00.000Z' }, { id: 'act-1', accountId: '', actorId: 'stf-1', action: 'target_fixed', createdAt: '2026-01-14T08:40:00.000Z' }], nextCursor: null } }
  if (method === 'GET' && /^\/api\/hq\/broadcasts\/[^/]+\/targets\/[^/]+\/recipients$/.test(pathname)) return { success: true, data: { rows: [{ friendId: 'f-1', displayName: '山田 花子', state: 'sent', attemptNo: 1, sentAt: '2026-01-15T02:00:10.000Z', claimedAt: '2026-01-15T02:00:00.000Z', errorCode: null }, { friendId: 'f-2', displayName: '佐藤 健二', state: 'sent', attemptNo: 1, sentAt: '2026-01-15T02:00:11.000Z', claimedAt: '2026-01-15T02:00:00.000Z', errorCode: null }], total: 2, nextCursor: null } }
  if (method === 'GET' && /^\/api\/hq\/broadcasts\/[^/]+$/.test(pathname)) return { success: true, data: pathname.endsWith('/hq-visual-compose') ? HQ_VISUAL_COMPOSE_DRAFT : pathname.endsWith('/hq-visual-sent') ? HQ_VISUAL_SENT : pathname.endsWith('/hq-run-sent') ? HQ_RUN_SENT : HQ_RUN_DRAFT }
  /*
    友だちのマイル詳細（V8 R6kIG・手で増やす・減らす M8zhjL）は1人に絞って読む。
    絞ったときだけ絵の数（残高 1,240・確定待ち 120・期限が近い 200）と5行の明細を返す。
    絞らない一覧（友だちの残高・履歴のタブ）は今までの見本のまま。
  */
  if (method === 'GET' && pathname === '/api/mileage/friends' && query.get('friendId') === 'friend-1') {
    const base = MILEAGE_FRIENDS.items[0]
    return { success: true, data: { ...MILEAGE_FRIENDS, items: [{
      ...base, displayName: 'Kenta Kawano', available: 1240, pending: 120, monthChange: 180,
      expiringMiles30d: 200, nextExpiringAt: '2026-10-31T00:00:00+09:00',
    }], pagination: { total: 1, limit: 1, offset: 0 } } }
  }
  if (method === 'GET' && pathname === '/api/mileage/history' && query.get('friendId') === 'friend-1') {
    const row = (id, entryType, status, amount, reason, ruleName, mode, executedByStaffName, occurredAt, balanceAfter) => ({
      id, primaryFriendId: 'friend-1', displayName: 'Kenta Kawano', pictureUrl: null, entryType, status, amount, reason,
      source: mode === 'manual' ? 'manual' : 'rule', hasSourceEvent: false, sourceReferenceId: null, ruleName, mode,
      executedByStaffName, occurredAt, lineAccountName: '然 本店', balanceAfter,
    })
    return { success: true, data: { ...MILEAGE_HISTORY, items: [
      row('mf-1', 'grant', 'available', 10, 'リンクをクリック', '秋の新商品のお知らせ', 'automatic', null, '2026-09-30T10:32:00+09:00', 1240),
      row('mf-2', 'spend', 'available', -500, '送料無料クーポンと交換', '使い道：送料無料クーポン', 'automatic', null, '2026-09-29T18:05:00+09:00', 1230),
      row('mf-3', 'grant', 'available', 48, '商品を買った', '購入 ¥4,800', 'automatic', null, '2026-09-28T21:40:00+09:00', 1730),
      row('mf-4', 'adjustment', 'available', 100, 'おわびで付けた', '手で増やす', 'manual', '河野', '2026-09-27T12:10:00+09:00', 1682),
      row('mf-5', 'reversal', 'available', -10, '付けすぎを取り消し', 'リンクをクリック（重複）', 'manual', '河野', '2026-09-20T09:00:00+09:00', 1582),
    ], pagination: { total: 5, limit: 100, offset: 0 } } }
  }
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
  if(method==='GET'&&pathname==='/api/restaurant-test/floors')return {success:true,data:RESTAURANT_FLOORS.filter(f=>f.storeId===(query.get('storeId')??'store-sby'))}
  if(method==='GET'&&pathname==='/api/restaurant-test/board'){
   const from=Date.parse(query.get('from')),to=Date.parse(query.get('to')),offset=Number(query.get('offset')??0),limit=Number(query.get('limit')??500);
   const entries=RESTAURANT_RESERVATIONS.filter(r=>Date.parse(r.starts_at)>=from&&Date.parse(r.starts_at)<to).map(r=>seatBoardEntry({...r,customer_version:1,dining_snapshot_json:JSON.stringify({allergy:r.allergy_note,anniversary:null,seatPreference:null,courseId:r.course_id,capturedAt:QA_CLOCK})}));
   return {success:true,data:{entries:entries.slice(offset,offset+limit),total:entries.length,offset,limit}}
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/snapshot') {
    return { success: true, data: RESTAURANT_SNAPSHOT }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/store-groups') return { success: true, data: [] }
  if (method === 'GET' && pathname === '/api/restaurant-test/stores') {
    return { success: true, data: { organization: RESTAURANT_SNAPSHOT.organization, stores: RESTAURANT_SNAPSHOT.stores } }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/store-context') {
    return { success: true, data: { selectedStore: { id: 'store-sby', name: '然 渋谷店' } } }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/reservations/day') {
    const storeId = query.get('storeId') || 'store-sby'
    const date = query.get('date') || ''
    const timezone = RESTAURANT_STORES.find((store) => store.id === storeId)?.timezone ?? RESTAURANT_STORES[0].timezone
    const sameDay = (iso) => storeYmd(iso, timezone) === date
    return { success: true, data: { date, reservations: RESTAURANT_RESERVATIONS.filter((r) => r.store_id === storeId && sameDay(r.starts_at)), closures: RESTAURANT_CLOSURES.filter((c) => c.storeId === storeId && c.startDate <= date && c.endDate >= date) } }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/customers/search') {
    return { success: true, data: [{ name: '山田 花子', phone: '090-1111-2222', lineUid: 'U-demo-3' }] }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/customers/history') {
    return { success: true, data: { visitCount: 3, visits: [{ id: 'v-1', starts_at: '2026-08-14T10:00:00.000Z', guest_count: 4, table_label: '個室A', course_name: '秋の鹿肉コース', allergy_note: 'えび' }] } }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/inventory/day') {
    const date = query.get('date') || ''
    return { success: true, data: RESTAURANT_INVENTORY_DAY, closures: RESTAURANT_CLOSURES.filter((c) => c.startDate <= date && c.endDate >= date) }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/closures') {
    const month = query.get('month')
    return { success: true, data: RESTAURANT_CLOSURES.filter((c) => !month || (c.startDate.slice(0, 7) <= month && c.endDate.slice(0, 7) >= month)) }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/opening-hours') {
    return { success: true, data: RESTAURANT_OPENING_HOURS }
  }
  {
    const contact = method === 'GET' ? /^\/api\/restaurant-test\/closures\/([^/]+)\/contact-status$/.exec(pathname) : null
    if (contact) return { success: true, data: restaurantClosureContact(contact[1]) }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/close-notification-settings') {
    return { success: true, data: { ...RESTAURANT_CLOSE_NOTIFICATION, storeId: query.get('storeId') || 'store-sby' } }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/channels') {
    return { success: true, data: RESTAURANT_CHANNELS }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/channel-close-tasks') {
    return { success: true, data: RESTAURANT_CLOSE_TASKS }
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
  /*
   * デリバリー受注の読み口。`data` で包まない（`DELIVERY_*` の注記のとおり）。
   * 状態の進み・品切れの一括・受付の停止は書き込みなので従来どおり405。
   */
  if (method === 'GET' && pathname === '/api/restaurant-test/delivery/orders') {
    const tab = ['all', 'new', 'cooking', 'handed_over'].includes(query.get('tab')) ? query.get('tab') : 'new'
    const service = query.get('service')
    const rows = deliveryOrdersByTab(tab).filter((row) => !service || row.service === service)
    return {
      success: true,
      store: DELIVERY_STORE,
      services: DELIVERY_SERVICES,
      kpis: {
        todayCount: 32, todayCountDelta: 4, handedOverCount: 24, todaySales: 86400,
        todaySalesDeltaPercent: 8, averageAmount: 2700, urgentCount: 2,
        averagePrepMinutes: 12, averagePrepMinutesDelta: -2,
      },
      tab,
      tabCounts: {
        all: DELIVERY_ORDERS.length,
        new: deliveryOrdersByTab('new').length,
        cooking: deliveryOrdersByTab('cooking').length,
        handed_over: deliveryOrdersByTab('handed_over').length,
      },
      orders: rows,
    }
  }
  const deliveryOrderDetail = method === 'GET' ? /^\/api\/restaurant-test\/delivery\/orders\/([^/]+)$/.exec(pathname) : null
  if (deliveryOrderDetail) {
    const id = decodeURIComponent(deliveryOrderDetail[1])
    const row = DELIVERY_ORDERS.find((item) => item.id === id) ?? DELIVERY_ORDERS[0]
    return {
      success: true,
      order: {
        ...row,
        currency: 'JPY',
        pickupMethod: `配達（${row.serviceLabel} 配達員）`,
        customerNote: row.urgency === 'urgent' ? 'タレ多めでお願いします' : null,
        cancelReasonCode: row.status === 'canceled' ? 'store_closed' : null,
        canceledBy: row.status === 'canceled' ? 'store' : null,
        acceptedAt: row.status === 'new' ? null : restaurantAt(12, 7),
        readyAt: row.status === 'handed_over' ? restaurantAt(11, 58) : null,
        handedOverAt: row.status === 'handed_over' ? restaurantAt(12, 0) : null,
        canceledAt: row.status === 'canceled' ? restaurantAt(11, 44) : null,
      },
      items: DELIVERY_ORDER_ITEMS[row.id] ?? [{ name: row.itemSummary, note: null, quantity: row.itemCount, amount: row.totalAmount }],
    }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/delivery/history') {
    const service = query.get('service')
    const status = query.get('status')
    const rows = DELIVERY_HISTORY.filter((row) => (!service || row.service === service) && (!status || row.status === status))
    const date = storeYmd(QA_CLOCK, RESTAURANT_STORES[0].timezone)
    return {
      success: true,
      range: { from: query.get('from') || date, to: query.get('to') || date },
      filter: { service: service || null, status: status || null },
      totals: {
        count: 32,
        amount: 86400,
        canceledCount: 2,
        byService: DELIVERY_SERVICES.map(({ service: key, label, todayCount, todayAmount }) => ({ service: key, label, count: todayCount, amount: todayAmount })),
      },
      orders: rows,
    }
  }
  if (method === 'GET' && pathname === '/api/restaurant-test/delivery/menu-items') {
    return { success: true, store: DELIVERY_STORE, items: DELIVERY_MENU_ITEMS }
  }

  if (method === 'GET' && pathname === '/api/auth/two-factor/policy') return { success: true, data: { required: true, canEdit: true, configured: true, notice: null, registered: 4, total: 6 } }
  if (method === 'GET' && pathname === '/api/auth/two-factor/self') return { success: true, data: { staffId: 'visual-qa-owner', enabledAt: '2026-10-12T03:00:00Z', remaining: 8, total: 8, canEdit: true, configured: true, notice: null } }
  if (pathname === '/api/auth/session') {
    /*
     * 運営コンソールの外枠（`OpsShell`）は `platformAdmin` を見る。
     * 本物（`apps/worker/src/routes/admin-auth.ts`）と同じ器で、
     * 運営メンバーとして返す。通常の `AuthGuard` は余分な鍵を無視するので、
     * 他の画面は変わらない。
     */
    return {
      success: true,
      // 再確認の聞き方は認証アプリの6桁（★V8 WOfBN アーカイブの窓は6マスで描かれている）。
      data: { ...STAFF, platformAdmin: true, platformAdminState: null, impersonation: null, stepUpMethod: 'totp' },
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
  /* ★V8-B nAesv：注文1件の状況（引き出し）。出来事2件・成果とマイルとスコア・発送後の案内2件。 */
  {
    const orderDetail = /^\/api\/ec-commerce\/orders\/([^/]+)$/.exec(pathname)
    if (method === 'GET' && orderDetail) {
      const id = decodeURIComponent(orderDetail[1])
      const order = EC_ORDERS.items.find((item) => item.id === id) ?? EC_ORDERS.items[0]
      const action = (eventId, eventType, receivedAt) => ({
        id: `${eventId}-action`, eventId, eventType, actionType: 'line_notification', ruleVersion: 'ec-rule-v4', status: 'succeeded',
        attemptCount: 1, maxAttempts: 3, errorCode: null, errorMessage: null, lastAttemptedAt: receivedAt, nextRetryAt: null, version: 1,
        receivedAt, orderNumber: order.orderNumber, customerName: order.customerName, retryAvailable: false, attempts: [],
      })
      return {
        success: true,
        data: {
          order,
          events: [
            { id: 'ece-detail-1', externalEventId: 'ext-ece-1', eventType: 'ec.order.confirmed', status: 'processed', failureKind: null, receivedAt: '2026-10-01T12:02:00.000Z', processedAt: '2026-10-01T12:02:30.000Z', actions: [action('ece-detail-1', 'ec.order.confirmed', '2026-10-01T12:02:00.000Z')], dispatches: [], deliveries: [] },
            { id: 'ece-detail-2', externalEventId: 'ext-ece-2', eventType: 'ec.order.shipped', status: 'processed', failureKind: null, receivedAt: '2026-10-02T00:40:00.000Z', processedAt: '2026-10-02T00:40:30.000Z', actions: [action('ece-detail-2', 'ec.order.shipped', '2026-10-02T00:40:00.000Z')], dispatches: [], deliveries: [] },
          ],
          followUps: [
            { id: 'fu-1', campaignKey: 'delivered_check', campaignLabel: 'お荷物は届きましたか（NEN配信）', scheduledAt: '2026-10-04T01:00:00.000Z', status: 'pending', attempts: 0, sentAt: null, reason: null, failureKind: null },
            { id: 'fu-2', campaignKey: 'review_request', campaignLabel: '口コミのお願い（NEN配信）', scheduledAt: '2026-10-12T01:00:00.000Z', status: 'pending', attempts: 0, sentAt: null, reason: null, failureKind: null },
          ],
          outcomes: {
            conversions: [{ id: 'cv-detail-1', pointName: '商品を買った', approvalStatus: 'approved', value: 7540, createdAt: '2026-10-01T12:03:00.000Z', orderNumber: order.orderNumber, ecEventId: 'ece-detail-1', affiliateName: null, rewardAmount: null, rewardEntryStatus: null, reversedAmount: null, settlementState: null, payoutBatchState: null, payoutResult: null, duplicateCandidate: false }],
            mileage: [{ id: 'ml-detail-1', entryType: 'earn', amount: 75, status: 'confirmed', reason: '商品を買った', occurredAt: '2026-10-01T12:03:00.000Z' }],
            scores: [{ id: 'sc-detail-1', scoreChange: 30, reason: '商品を買った', occurredAt: '2026-10-01T12:03:00.000Z' }],
          },
        },
      }
    }
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
  /*
   * 統括 LINEアカウントを登録（★V8-B xj3zz〜TvXII・結果の窓 qw80E）。
   * 接続確認は5段すべて通った返事。登録の返事は取り込み中（820人 / 前日の友だち 1,240人）。
   * 止まった段を撮る板（v2KMj）は対応表の api で Webhook だけ止めた返事に差し替える。
   * アカウントのタグ（GET /api/line-account-tags）は一覧と同じ LINE_ACCOUNT_TAGS を下の口で返す（同じ口を2つ置かない）。
   */
  if (pathname === '/api/line-accounts/visual-qa-account-new/follower-import') {
    return { success: true, data: { version: 1, capability: 'available', phase: 'importing_ids', eligibilityCheckedAt: null, startedAt: '2026-10-07T01:00:00.000Z', completedAt: null, updatedAt: '2026-10-07T01:02:00.000Z', received: 820, imported: 820, reactivated: 0, claimedUnassigned: 0, alreadyPresent: 0, conflicts: 0, invalid: 0, profilesProcessed: 0, profilesUpdated: 0, profileErrors: 0, lastError: null } }
  }
  if (pathname === '/api/line-accounts/visual-qa-account-new/follower-insight') {
    return { success: true, data: { lineAccountId: 'visual-qa-account-new', date: query.get('date') ?? '', status: 'ready', followers: 1240, targetedReaches: null, blocks: null } }
  }
  /*
   * 統括のテンプレート（★V8-B LRc93・X4JcOf・meBRB）。一覧4件・種類ごとの数（リッチメニュー1・回答フォーム1・タグ2）・
   * 配り先4アカウント・1件目の中身（カード型・画像1・ボタン1）。配る前の確認は書き込み側（visualQaWriteBody）。
   */
  if (pathname === '/api/hq/templates' && method === 'GET') {
    const type = query.get('type')
    const kind = query.get('kind')
    const deliveries = HQ_DELIVERY_FIXTURES.filter(row=>row.template.template_type===type)
    if (deliveries.length) return {success:true,data:deliveries.map(row=>row.template)}
    if (type === 'friend_field' || type === 'mark') {
      const rows = HQ_ATTRIBUTE_ROWS.filter((item) => item.template.template_type === type).map((item) => item.template)
      return { success: true, data: rows, stats: { totalTemplates: rows.length, distributedAccountCount: 1, undistributedTemplateCount: 0, thisMonthSentCount: null, outdatedTemplateCount: 0 } }
    }
    /* API-17：テンプレートは店と同じ6種類（?kind=）。種類の無い古い行はメッセージ。 */
    const rows = (type ? HQ_TEMPLATES_HTN.filter((row) => row.template_type === type) : HQ_TEMPLATES_HTN)
      .map((row) => (row.template_type === 'template' ? { ...row, kind: row.kind ?? 'message' } : row))
    /* API-18：一覧の集計（今月送った数・新しい版を未配布）。 */
    const stats = { thisMonthSentCount: rows.some((row) => row.this_month_sent_count === null) ? null : rows.reduce((n, row) => n + (row.this_month_sent_count ?? 0), 0), outdatedTemplateCount: rows.filter((row) => (row.outdated_account_count ?? 0) > 0).length }
    return { success: true, data: kind ? rows.filter((row) => row.kind === kind) : rows, stats }
  }
  /* API-18：版の履歴・比べる・配った先ごとの版（詳細 pQ4fH：版3 は下書き・版2 がいま使っている版・版1 は前の版）。 */
  const hqTemplateVersions = /^\/api\/hq\/templates\/(visual-hq-tpl-[^/]+)\/(versions|received-versions|versions\/compare)$/.exec(pathname)
  if (hqTemplateVersions && method === 'GET') {
    const row = HQ_TEMPLATES_HTN.find((item) => item.id === hqTemplateVersions[1])
    const current = row?.current_version ?? row?.revision ?? 1
    const versions = Array.from({ length: current }, (_, i) => current - i).map((version) => ({
      id: `${hqTemplateVersions[1]}-v${version}`, version, created_by: 'stf-1', creator_name: version === current - 1 ? 'Masato' : 'Kenta Kawano',
      created_at: version === current ? '2026-08-21T09:02:00.000Z' : version === current - 1 ? '2026-08-02T01:15:00.000Z' : '2026-07-14T00:40:00.000Z',
      is_draft: version === current && (row?.outdated_account_count ?? 0) > 0, is_current: version === current,
    }))
    if (hqTemplateVersions[2] === 'versions') return { success: true, data: versions }
    if (hqTemplateVersions[2] === 'versions/compare') {
      const definition = row ? hqTemplateDefinitionHtn(row) : null
      const from = Number(query.get('from')), to = Number(query.get('to'))
      return { success: true, data: { from: { version: versions.find((v) => v.version === from), definition }, to: { version: versions.find((v) => v.version === to), definition: definition ? { ...definition, template: { ...definition.template, messageContent: `${definition.template.messageContent}\n変更・キャンセルは下のリンクからお願いします。` } } : null }, changed: true } }
    }
    const latest = row?.outdated_account_count ? current - 1 : current
    return { success: true, data: (row?.distributed_account_names ?? []).map((name, index) => {
      const account = HQ_TEMPLATE_ACCOUNTS_HTN[index] ?? { id: `visual-acc-${index}`, name }
      const older = index === 2 && (row?.outdated_account_count ?? 0) > 0
      const version = older ? Math.max(1, latest - 1) : latest
      return { accountId: account.id, accountName: account.name, receivedAt: '2026-08-21T09:10:00.000Z', targetVersion: { version, latestVersion: current, status: older ? 'older' : 'latest', label: `版${version}` } }
    }) }
  }
  if (pathname === '/api/hq/templates/kind-counts' && method === 'GET') {
    const counts = { message: 0, carousel: 0, rich_message: 0, question: 0, coupon: 0, research: 0 }
    for (const row of HQ_TEMPLATES_HTN) if (row.template_type === 'template') counts[row.kind ?? 'message'] += 1
    return { success: true, data: counts }
  }
  /* 統括のひな形のフォルダ（絵 i0Ao0R：お問い合わせ・予約・EC）。 */
  if (pathname === '/api/hq/templates/folders' && method === 'GET') return { success: true, data: HQ_TEMPLATE_FOLDERS_HTN }
  if (pathname === '/api/hq/templates/accounts' && method === 'GET') return { success: true, data: HQ_TEMPLATE_ACCOUNTS_HTN }
  if (pathname === '/api/hq/templates/message-references' && method === 'GET') return { success: true, data: [] }
  const attribute = HQ_ATTRIBUTE_ROWS.find((item) => pathname === `/api/hq/templates/${item.template.id}`)
  if (attribute && method === 'GET') return { success: true, data: attribute }
  if (/^\/api\/hq\/templates\/visual-hq-attr-[^/]+\/received-versions$/.test(pathname)) return { success: true, data: [] }
  const deliveryDetail = HQ_DELIVERY_FIXTURES.find(row=>pathname===`/api/hq/templates/${row.template.id}`)
  if (deliveryDetail && method==='GET') return {success:true,data:deliveryDetail}
  const hqTemplateDetail = /^\/api\/hq\/templates\/(visual-hq-tpl-[^/]+)$/.exec(pathname)
  if (hqTemplateDetail && method === 'GET') {
    const row = HQ_TEMPLATES_HTN.find((item) => item.id === hqTemplateDetail[1])
    return row ? { success: true, data: { template: row, definition: hqTemplateDefinitionHtn(row) } } : { success: false, error: 'Not found' }
  }
  if (method === 'GET' && /^\/api\/hq\/templates\/visual-hq-tpl-[^/]+\/distributions\/[^/]+$/.test(pathname)) return { success: true, data: HQ_TEMPLATE_RESULT_HTN }
  if (method === 'DELETE' && pathname === '/api/hq/templates/media') {
    return { success: true, data: { deleted: true } }
  }
  if (pathname === '/api/line-webhook-events') return { success: true, data: [] }
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
      data: { ...ACCOUNT_HANDOVER, decisions: ACCOUNT_HANDOVER_DECISIONS, unresolvedReviews: 1 },
    }
  }
  // 止めている間に送らなかった配信（★V8 WOfBN の窓の後ろ）。本物は配列を返す。
  if (/^\/api\/line-accounts\/[^/]+\/skipped-deliveries$/.test(pathname)) {
    return { success: true, data: [] }
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
        ...(pathname.split('/')[3] === LINE_ACCOUNT_DETAIL_STOPPED.id ? LINE_ACCOUNT_DETAIL_STOPPED : {}),
      },
    }
  }
  /* 統括ホーム（絵 `JKjsE`）の左のタグの列。 */
  if (method === 'GET' && pathname === '/api/line-account-tags') return { success: true, data: LINE_ACCOUNT_TAGS }
  /* 統括のアカウントのフォルダ（API-17・絵 `JKjsE`：渋谷エリア・イベント・テスト・未分類）。所属はタグの先頭1件と同じ。 */
  if (method === 'GET' && pathname === '/api/line-account-folders') {
    const live = LINE_ACCOUNTS.filter((account) => !account.archivedAt)
    const folders = LINE_ACCOUNT_TAGS.map((tag) => ({
      id: tag.id, kind: 'line_account', name: tag.name, parentId: null, color: tag.color, displayOrder: tag.displayOrder,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
      itemCount: LINE_ACCOUNTS.filter((account) => (account.tags ?? [])[0]?.id === tag.id).length,
    }))
    return { success: true, data: { folders, total: LINE_ACCOUNTS.length, unclassifiedCount: live.filter((account) => !(account.tags ?? []).length).length } }
  }
  /* 統括の名前（絵 `JKjsE` の説明・`K7HYu` の欄）。 */
  if (method === 'GET' && pathname === '/api/tenants/me') return { success: true, data: { name: '然 -NEN- 本部' } }
  if (method === 'GET' && pathname === '/api/tenants/me/company-contact') return { success: true, data: {
    legalCompanyName: 'Shed Products株式会社', postalCode: '150-0001', address: '東京都渋谷区神宮前1-2-3',
    building: null, phone: '03-1234-5678', contactName: '山田 太郎', contactEmail: 'yamada@shed.example', invoiceAddressee: null, revision: 0,
  } }
  if (method === 'GET' && pathname === '/api/postal-code/search') return { success: true, data: {
    status: 'matched', candidates: [{postalCode: '1500001', prefecture: '東京都', city: '渋谷区', town: '神宮前'}], readiness: {fullDataset: true},
  } }
  if (pathname === '/api/line-accounts') {
    /*
      `webhook` を付ける。無いと接続状態カードが「確認中」のままで、
      設計の「正常」と並べたときに実装の差に見えてしまう。
    */
    return { success: true, data: LINE_ACCOUNTS.map((account) => {
      const first = (account.tags ?? [])[0]
      const tag = first ? LINE_ACCOUNT_TAGS.find((item) => item.id === first.id) : null
      return { ...account, folderId: tag?.id ?? null, folder: tag ? { id: tag.id, kind: 'line_account', name: tag.name, parentId: null, color: tag.color, displayOrder: tag.displayOrder, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' } : null }
    }) }
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
    return { success: true, data: { ...UID_MIGRATION_DONE, items: [
      { id: 'uid-done-1', oldUid: 'old_uid_00018', newUid: 'new_uid_00018', candidateName: '高橋 直人', evidenceType: 'operator_csv', classification: 'auto', conflictReason: null, decision: 'link', result: 'applied', errorMessage: null },
      { id: 'uid-done-2', oldUid: 'old_uid_00291', newUid: 'new_uid_00291', candidateName: 'Kyohei Yamamoto', evidenceType: 'operator_csv', classification: 'review', conflictReason: null, decision: 'link', result: 'applied', errorMessage: null },
    ], itemTotal: 2, decisionCounts: { pending: 0, link: 1844, create: 0, exclude: 3 } } }
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
    const candidate = identityCandidate[1] === IDENTITY_CANDIDATE_EC.id || identityCandidate[1].startsWith('ec-identity-')
      ? { ...IDENTITY_CANDIDATE_EC, id: identityCandidate[1] }
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
  // 会話の中を探す（API-9 の会話の検索の口）。吹き出しを NFKC＋小文字で数える。素の値を返す（外側で包む）。
  const chatSearch = pathname.match(/^\/api\/chats\/([^/]+)\/messages\/search$/)
  if (chatSearch) {
    const q = String(query.get('q') ?? '').trim().normalize('NFKC').toLowerCase()
    const offset = Number(query.get('offset') ?? 0)
    const limit = Number(query.get('limit') ?? 30)
    const rows = FRIEND_MESSAGES[decodeURIComponent(chatSearch[1])] ?? []
    const all = q ? rows.filter((m) => m.messageType === 'text' && String(m.content).normalize('NFKC').toLowerCase().includes(q)) : []
    const hits = all.slice(offset, offset + limit).map((m) => {
      const i = rows.indexOf(m)
      const at = m.lineEventAt ?? m.createdAt
      return {
        id: m.id, at, excerpt: m.content,
        before: i > 0 ? { id: rows[i - 1].id, excerpt: rows[i - 1].content } : null,
        after: i < rows.length - 1 ? { id: rows[i + 1].id, excerpt: rows[i + 1].content } : null,
        cursor: { at, id: m.id },
      }
    })
    return { success: true, data: { total: all.length, hits, nextOffset: offset + hits.length < all.length ? offset + hits.length : null } }
  }
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
          hasMoreMessages: false,
          total: (FRIEND_MESSAGES[row.friendId] ?? []).length,
        },
      }
    }
  }
  const detail = pathname.match(/^\/api\/friends\/([^/]+)$/)
  if (detail && FRIEND_DETAILS[detail[1]]) return { success: true, data: FRIEND_DETAILS[detail[1]] }
  if (/^\/api\/friends\/[^/]+\/mileage$/.test(pathname)) return { success: true, data: FRIEND_MILEAGE }
  const basicFieldsFriend = pathname.match(/^\/api\/friends\/(friend-[01])\/fields$/)
  if (basicFieldsFriend) {
    const friend = FRIEND_DETAILS[basicFieldsFriend[1]]
    const specs = [
      ['name', '名前', 'text', friend.realName],
      ['kana', 'ふりがな', 'text', 'やまだ たろう'],
      ['birthday', '生年月日', 'date', '1988-04-12'],
      ['age', '年齢', 'number', '38'],
      ['email', 'メール', 'email', 'sample@example.test'],
      ['tel', '電話', 'tel', '09012345678'],
      ['address', '住所', 'textarea', '東京都新宿区1-2'],
      // B-235：基本の8つ目。値の中身は絵へ合わせず、複数の状態を見せる。
      ['allergy', 'アレルギー', 'checkbox', JSON.stringify(['小麦', 'えび', 'くるみ'])],
    ]
    const basics = specs.map(([fixedKey, name, type, value], index) => ({
      id: `fixed-${fixedKey}`, fixedKey, name, fieldKey: `fixed_${fixedKey}`, type, value,
      folderId: null, isPersonal: true, isStarred: false, ecIsMaster: false, source: 'form',
      displayOrder: index - 7, valueSource: { type: 'form', id: 'form-1', name: '来店アンケート' },
      valueUpdatedAt: '2026-10-08T10:12:00+09:00',
    }))
    const values = ['1988-04-12', '2026-12-31', '2026-09-15', 'プレミアム']
    return {
      success: true,
      data: {
        items: [...basics, ...FRIEND_FIELDS.map((field, index) => ({ ...field, value: values[index] }))],
        hiddenPersonalCount: 0,
      },
    }
  }
  /*
   * 友だち詳細（★V8 Q5F2QE・JCDRm）の履歴・次の予定・回答。friend-1 だけ。
   * 絵の「最近の履歴」3行・「進行中」1行・回答カード2枚と同じ形にする（2026-10-07）。
   */
  /* 行動スコアの明細（V8 R8NNi「点数の変化の明細」）。新しい順に5件、合計は上から足し引きが合う。 */
  const friendScore = pathname.match(/^\/api\/friends\/([^/]+)\/score$/)
  if (friendScore) {
    const row = (id, reason, scoreChange, scoreAfter, occurredAt) => ({
      id, scoringRuleId: null, ruleKey: null, scoreChange, scoreBefore: scoreAfter - scoreChange, scoreAfter,
      reason, eventType: null, source: null, occurredAt, createdAt: occurredAt, mode: 'automatic', executedByStaffName: null,
    })
    return { success: true, data: { friendId: friendScore[1], currentScore: 36, history: [
      row('fs-1', '配信のURLを押した', 3, 36, '2026-09-30T10:32:00+09:00'),
      row('fs-2', '購入した', 30, 33, '2026-09-28T21:40:00+09:00'),
      row('fs-3', '配信のURLを押した', 3, 3, '2026-09-24T08:12:00+09:00'),
      row('fs-4', '「返信した」の点が消えた（14日）', -5, 0, '2026-09-16T09:00:00+09:00'),
      row('fs-5', 'メッセージに返信した', 5, 5, '2026-09-02T19:20:00+09:00'),
    ] } }
  }
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
  /* F-5 テンプレートの見本4件（本番 `apps/worker/src/routes/templates.ts` の TEMPLATE_EXAMPLES と同じ形）。 */
  if (pathname === '/api/templates/examples') {
    return {
      success: true,
      data: [
        { id: 'template-example-business-hours', name: '営業時間のご案内', body: 'いつもご利用ありがとうございます。営業時間のご案内です。平日 10:00〜19:00、土日祝 10:00〜18:00です。ご来店をお待ちしております。', imageSlot: '/images/template-examples/business-hours.png' },
        { id: 'template-example-campaign', name: 'キャンペーンのお知らせ', body: '期間限定キャンペーンのお知らせです。対象商品が10%お得になります。この機会にぜひご利用ください。', imageSlot: '/images/template-examples/campaign.png' },
        { id: 'template-example-booking', name: '予約の受付', body: 'ご予約を受け付けました。日時が近づきましたらご案内をお送りします。変更・キャンセルはお早めにご連絡ください。', imageSlot: '/images/template-examples/booking.png' },
        { id: 'template-example-thanks-coupon', name: '来店のお礼とクーポン', body: 'ご来店ありがとうございました。次回使えるクーポンをお送りします。またのご利用をお待ちしております。', imageSlot: '/images/template-examples/thanks-coupon.png' },
      ],
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
    // 候補のアカウント絞り込みに実APIと同じ所属を返す。
    return { success: true, data: TEMPLATES.map((item) => ({ ...item, accountId: query.get('account_id') ?? ACCOUNT.id })) }
