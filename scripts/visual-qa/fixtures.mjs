/**
 * 画面確認のための、固定の中身。
 *
 * **Pencil ★V6 の画面に描いてある値をそのまま写している。**
 * これが無いと、実装は空の表しか描けず、設計と画像で比べられない。
 * 「空の状態」だけを見て「一致した」と言えてしまうのが、いちばん危ない。
 *
 * 守ること
 * - **実在の顧客・秘密値を使わない。** 名前も数字も設計の絵の値そのもの
 * - **乱数と時刻を使わない。** 毎回まったく同じ絵になる
 * - **設計を変えたらここも変える。** 合わなくなったら、どちらが正かを決める
 *
 * 出どころ: Pencil `★ V6 4-1 友だち属性・タグ（1920）` `hqrOv`
 */

/**
 * 設計の左パネル（`DgeL8`）の並びと件数。
 * `count` は絵に書いてある数。タグはこの数だけ作る。
 */
export const FOLDER_COUNTS = [
  ['g-vip', 'VIP', 14],
  ['g-pet', 'ペット', 12],
  ['g-member', '会員', 18],
  ['g-health', '健康', 16],
  ['g-purchase', '購入', 21],
  ['', '未分類', 20],
]

/** フォルダ。 */
export const TAG_GROUPS = [
  { id: 'g-vip', name: 'VIP', sortOrder: 0, color: '#F59E0B', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'g-pet', name: 'ペット', sortOrder: 1, color: '#EC4899', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'g-member', name: '会員', sortOrder: 2, color: '#10B981', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'g-health', name: '健康', sortOrder: 3, color: '#0EA5E9', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'g-purchase', name: '購入', sortOrder: 4, color: '#3B82F6', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
]

/**
 * タグ6件。設計の表（`HrwyW`）の6行そのまま。
 *
 * `mileageMultiplierBps` は 10000 で 1.0倍。設計の「1.2倍」は 12000。
 */
const DESIGN_ROWS = [
  // 名前, フォルダ, 付与人数, 本人マイル, 紹介マイル, 倍率, ★, 登録日, 付与元, 使用先, 他N
  ['EC顧客連携済み', 'g-purchase', 64, 10, 0, 12000, true, '2026-01-11T00:00:00.000Z', 'ec', { broadcasts: 3, forms: 1 }, 1],
  ['LINEログイン連携済み', 'g-member', 198, 0, 0, null, true, '2026-01-13T00:00:00.000Z', 'line_login', { scenarios: 2 }, 0],
  ['NEN会員', 'g-member', 128, 10, 5, 15000, false, '2026-01-13T00:00:00.000Z', 'form', { broadcasts: 4 }, 3],
  ['商品到着確認対象', 'g-purchase', 41, 3, 0, null, false, '2026-01-13T00:00:00.000Z', 'ec_purchase', { autoReplies: 1 }, 1],
  ['未契約', '', 37, 0, 0, null, true, '2026-01-13T00:00:00.000Z', 'manual', { savedSearches: 2 }, 0],
  ['誕生日クーポン対象', 'g-vip', 0, 20, 0, null, false, '2026-01-13T00:00:00.000Z', 'birthday', { broadcasts: 1 }, 2],
].map(([name, groupId, friendCount, mileageReward, referralMileageReward, mileageMultiplierBps, isStarred, createdAt, assignSource, usedIn, otherActionCount], index) => ({
  id: `tag-${index}`,
  name: String(name),
  color: '#8b938d',
  groupId: String(groupId),
  friendCount: Number(friendCount),
  mileageReward: Number(mileageReward),
  referralMileageReward: Number(referralMileageReward),
  mileageMultiplierBps: mileageMultiplierBps == null ? null : Number(mileageMultiplierBps),
  mileageMultiplierPriority: 0,
  isStarred: Boolean(isStarred),
  displayOrder: index,
  createdAt: String(createdAt),
  /*
    サーバーは **0件・断定できないものを省く**。ここでも省く。
    省かずに 0 を入れると、画面が「未使用」と「取れていない」を
    言い分けられているかを確かめられなくなる。
  */
  assignSource: String(assignSource),
  ...(Object.keys(usedIn).length ? { usedIn } : {}),
  ...(otherActionCount ? { otherActionCount: Number(otherActionCount) } : {}),
}))

/**
 * タグ101件。設計の「1〜20 / 101件」に合わせる。
 *
 * 先頭6件は絵に描いてある行そのまま。残り95件は、フォルダごとの件数が
 * 絵の数（VIP 14／ペット 12／会員 18／健康 16／購入 21／未分類 20）に
 * ちょうど収まるように足した埋め草。
 *
 * **6件だけで比べない。** 桁あふれも折り返しもページ送りも出ないので、
 * 「一致した」と言えてしまう。設計は101件あるときの絵として描いてある。
 */
export const TAGS = (() => {
  const rows = [...DESIGN_ROWS]
  const used = new Map()
  for (const row of rows) used.set(row.groupId, (used.get(row.groupId) ?? 0) + 1)

  let n = rows.length
  for (const [groupId, label, count] of FOLDER_COUNTS) {
    const rest = count - (used.get(groupId) ?? 0)
    for (let i = 0; i < rest; i += 1) {
      rows.push({
        id: `tag-${n}`,
        name: `${label}タグ ${i + 1}`,
        color: '#8b938d',
        groupId,
        // 埋め草にも人数を入れる。0 にすると「整理候補」が跳ね上がる。
        friendCount: 3 + ((n * 7) % 40),
        /*
          埋め草は `assignSource` も `usedIn` も持たない。
          設計の6行が「EC連携」「配信3・フォーム1」を出すのに対し、
          埋め草は「—」「未使用」になる。**両方の見え方を1枚で確かめる。**
        */
        mileageReward: 0,
        referralMileageReward: 0,
        mileageMultiplierBps: null,
        mileageMultiplierPriority: 0,
        isStarred: false,
        displayOrder: n,
        createdAt: '2026-01-13T00:00:00.000Z',
      })
      n += 1
    }
  }
  /*
    整理候補の理由を付ける。**設計の絵に合わせて 未使用24・整理候補26。**

    サーバーは `withCounts=1` のとき、理由が無くても `[]` を必ず返す約束
    （`docs/v6-4-1-handoff.md` §0-1）。省略＝未取得なので、ここでも全件に付ける。
    1件でも欠けると画面は「未取得」と判断し、KPIが `—` になる。

    - 未使用 … 友だち0人**かつ**全参照0件。**後ろの24件**に寄せてある
      （1ページ目の見た目を変えず、KPIの数だけ設計に合わせるため）
    - 重複名 … 正規化して同じになる2件。**前後の空白違い**にしてあるので、
      `NFKC → 前後空白除去 → 連続空白を1つ → 小文字化` が効いていないと数が合わない
  */
  const UNUSED_COUNT = 24
  for (const row of rows) row.cleanupReasons = []

  for (const row of rows.slice(-UNUSED_COUNT)) {
    row.friendCount = 0
    delete row.usedIn
    row.cleanupReasons = ['unused']
  }

  // 重複名の2件。未使用と重ならない位置に置く（重なると26にならない）。
  const dup = rows.filter((row) => row.cleanupReasons.length === 0).slice(40, 42)
  dup[0].name = '長期未購入フォロー'
  dup[1].name = '長期未購入フォロー　'
  for (const row of dup) row.cleanupReasons = ['duplicate_name']

  return rows
})()

/**
 * 一覧の数。設計の4枚（`mfmn3`）に書いてある値そのまま。
 *
 * **タグ一覧から計算しない。** 「付与済み友だち」は人の数で、
 * タグごとの人数を足した数ではない（2つタグが付いた人を2人と数えてしまう）。
 * サーバーが数えて返すもの（`/api/list-stats`）。
 */
export const LIST_STATS = {
  tags: { total: 101, unused: 24, taggedFriends: 186, assignedThisMonth: 214 },
  marks: { total: 0, inUse: 0, unanswered: 0, inProgress: 0, resolved: 0, changedLast7: 0 },
  searches: { total: 0, limit: 5 },
  templates: { total: 0, inUse: 0, sentThisMonth: 0, unused90d: 0, clickRate: null },
  scenarios: { total: 0, active: 0, subscribers: 0, completed: 0, sentThisWeek: 0 },
  reminders: { total: 0, active: 0, waiting: 0, sentThisMonth: 0 },
}

/** Pencil ★V6 `PhxG6` の友だち一覧。実在の顧客データは使わない。 */
export const FRIEND_STATS = {
  active: 214,
  total: 231,
  blockedByThem: 12,
  hiddenByUs: 5,
  unanswered: 23,
  resolved: 186,
  addedThisMonth: 38,
  addedLastMonth: 26,
}

export const OPERATORS = [
  { id: 'operator-masato', name: 'Masato' },
  { id: 'operator-kenta', name: 'Kenta' },
]

export const FRIEND_SCENARIOS = [
  {
    id: 'scenario-paused',
    name: '停止中',
    description: null,
    triggerType: 'manual',
    triggerTagId: null,
    lineAccountId: 'visual-qa-account',
    isActive: false,
    deliveryMode: 'relative',
    allowConcurrent: true,
    displayOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    folderId: null,
    audienceCondition: null,
    onCompleteMode: 'pause',
    onCompleteScenarioId: null,
  },
]

/**
 * 友だち追加時配信を公開する2画面（`ec9vg` / `quhg6`）の固定データ。
 *
 * 正本は `FriendAddRoutingVersion` / `FriendAddRoutingValidation` /
 * `FriendAddRoutingDraftTestResult` / `FriendAddRoutingPublishResult`。
 * **画面の都合で別名の項目を作らない。** 本物の契約と同じ形で、
 * 通常・空・失敗を分けて撮れるようにする。
 */
export const FRIEND_ADD_LIFECYCLE_ROUTING = {
  firstTime: {
    scenarioId: 'scenario-paused',
    timing: 'immediate',
    actions: [{ kind: 'tag', tagId: 'tag-0' }],
  },
  returning: {
    scenarioId: null,
    mode: 'same',
    startPosition: 'beginning',
    actions: [],
  },
  criteria: { firstTime: 'unfollow_count_zero' },
}

export const FRIEND_ADD_LIFECYCLE_DRAFT = {
  accountId: 'visual-qa-account',
  versionId: 'friend-add-version-2',
  versionNumber: 2,
  status: 'draft',
  routing: FRIEND_ADD_LIFECYCLE_ROUTING,
  lastTestStatus: 'succeeded',
  lastTestedAt: '2026-08-30T10:00:00.000Z',
  publishedAt: null,
}

export const FRIEND_ADD_LIFECYCLE_VALIDATION = {
  canPublish: true,
  estimatedAudienceCount: 128,
  checks: [
    {
      key: 'first_time',
      label: 'はじめて友だち追加した人への配信',
      status: 'passed',
      detail: '配信するシナリオを確認できました。',
    },
    {
      key: 'returning',
      label: '以前からの友だち・ブロック解除後の配信',
      status: 'passed',
      detail: '配信方法を確認できました。',
    },
    {
      key: 'actions',
      label: '配信と一緒に行うこと',
      status: 'passed',
      detail: '1件の操作を、並べた順に実行します。',
    },
    {
      key: 'duplicate_prevention',
      label: '同じ友だち追加通知の二重実行防止',
      status: 'passed',
      detail: 'LINEアカウントとWebhookイベントの組み合わせで、同じ通知を1回だけ処理します。',
    },
  ],
  conflicts: [],
  lastTestStatus: 'succeeded',
}

export const FRIEND_ADD_LIFECYCLE_TEST_RESULT = {
  versionId: 'friend-add-version-2',
  displayName: '山田 花子',
  kind: 'first_time',
  scenarioId: 'scenario-paused',
  scenarioName: '停止中',
  suppressed: false,
  actionCount: 1,
  stateChanged: false,
}

export const FRIEND_ADD_LIFECYCLE_PUBLISHED = {
  accountId: 'visual-qa-account',
  versionId: 'friend-add-version-2',
  versionNumber: 2,
  publishedAt: '2026-08-30T10:30:00.000Z',
  estimatedAudienceCount: 128,
  duplicatePrevention: 'webhook_event',
  monitoringPath: '/friend-add-settings/runs',
}

/** 取得できて下書きが無い状態。失敗とは別に404で返す。 */
export const FRIEND_ADD_LIFECYCLE_EMPTY = {
  status: 404,
  body: { success: false, error: '確認する下書きがありません' },
}

/** 読み口が失敗した状態。0件や「まだありません」に変換しない。 */
export const FRIEND_ADD_LIFECYCLE_ERROR = {
  status: 500,
  body: { success: false, error: '下書きを読み込めませんでした' },
}

const FRIEND_TAGS = {
  subscription: { id: 'friend-tag-subscription', name: '定期便提案対象', color: '#8B938D', createdAt: '2026-01-01T00:00:00.000Z' },
  uncontracted: { id: 'friend-tag-uncontracted', name: '未契約', color: '#8B938D', createdAt: '2026-01-01T00:00:00.000Z' },
  staff: { id: 'friend-tag-staff', name: 'スタッフ', color: '#8B938D', createdAt: '2026-01-01T00:00:00.000Z' },
  nen: { id: 'friend-tag-nen', name: 'NEN会員', color: '#8B938D', createdAt: '2026-01-01T00:00:00.000Z' },
  delivery: { id: 'friend-tag-delivery', name: '商品到着確認対象', color: '#8B938D', createdAt: '2026-01-01T00:00:00.000Z' },
  login: { id: 'friend-tag-login', name: 'LINEログイン連携済み', color: '#8B938D', createdAt: '2026-01-01T00:00:00.000Z' },
  ec: { id: 'friend-tag-ec', name: 'EC顧客連携済み', color: '#8B938D', createdAt: '2026-01-01T00:00:00.000Z' },
}

function friend(overrides) {
  return {
    id: '',
    lineUserId: '',
    displayName: '',
    pictureUrl: null,
    statusMessage: null,
    isFollowing: true,
    metadata: {},
    refCode: null,
    lineAccountId: 'visual-qa-account',
    userId: null,
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
    latestIncomingMessage: null,
    latestOutgoingAt: null,
    activeScenario: { name: '停止中', status: 'paused' },
    handled: true,
    operator: null,
    supportMark: null,
    tags: [],
    ...overrides,
  }
}

export const FRIENDS = [
  friend({
    id: 'friend-kyohei', lineUserId: 'U-visual-1', displayName: 'Kyohei Yamamoto',
    metadata: { __attention: '1' }, createdAt: '2026-08-14T00:00:00.000Z',
    chatStatus: 'unread', handled: false,
    latestIncomingMessage: { content: '🚚♨', messageType: 'text', createdAt: '2026-08-14T07:58:00.000Z' },
    supportMark: { id: 'mark-unread', name: '未対応', color: '#D34851' },
    tags: [FRIEND_TAGS.subscription, FRIEND_TAGS.uncontracted],
  }),
  friend({
    id: 'friend-masato', lineUserId: 'U-visual-2', displayName: 'Masato.S',
    chatStatus: 'resolved', operator: OPERATORS[0],
    supportMark: { id: 'mark-progress', name: '対応中', color: '#A66A00' },
    tags: [FRIEND_TAGS.staff],
  }),
  friend({
    id: 'friend-kanno', lineUserId: 'U-visual-3', displayName: '菅野 亮',
    metadata: { __attention: '1' }, chatStatus: 'resolved', operator: OPERATORS[1],
    latestIncomingMessage: { content: '', messageType: 'sticker', createdAt: '2026-08-13T20:52:00.000Z' },
    supportMark: { id: 'mark-progress', name: '担当中', color: '#A66A00' },
    tags: [FRIEND_TAGS.nen, FRIEND_TAGS.delivery], createdAt: '2026-08-13T00:00:00.000Z',
  }),
  friend({
    id: 'friend-kenta', lineUserId: 'U-visual-4', displayName: 'Kenta Kawano(Obama)',
    chatStatus: 'in_progress', operator: OPERATORS[1],
    latestIncomingMessage: { content: '登録しました！', messageType: 'text', createdAt: '2026-08-13T16:16:00.000Z' },
    supportMark: { id: 'mark-progress', name: '対応中', color: '#A66A00' },
    tags: [FRIEND_TAGS.login, FRIEND_TAGS.ec], createdAt: '2026-08-13T00:00:00.000Z',
  }),
]
