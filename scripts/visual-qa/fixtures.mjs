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
  // 設計 `TC1b1` の帯: シナリオ9件（稼働中8）/ 購読中1,028人 / 読了済728人 / 今週342通
  scenarios: { total: 9, active: 8, subscribers: 1028, completed: 728, sentThisWeek: 342 },
  // 設計 `M1EXwB` の帯: リマインダ9件（有効7）/ 送信予定124通 / 今月386通 / 失敗2通
  reminders: { total: 9, active: 7, waiting: 124, sentThisMonth: 386, failed: 2 },
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

/**
 * シナリオ配信の一覧。設計 `★ V6 5-1` `TC1b1` の5行そのまま。
 *
 * 1件だけで返していたころは、**配信方式も終了後の動きも1通りしか出ず**、
 * 設計の5行（時刻／経過時間、一時停止／別シナリオへ／1つ前を再開、
 * 稼働中／停止中／下書き）をどれも確かめられなかった。
 */
export const FRIEND_SCENARIOS = [
  // 名前, 説明, 配信方式, 購読中, 読了, 登録日, 終了後, 稼働
  ['新規登録7日間フォロー', '登録直後から7日間の初回案内', 'absolute_time', 428, 312, '2026-08-16', 'pause', true],
  ['商品購入後サポート', '購入1日後から使い方を案内', 'elapsed', 316, 201, '2026-08-18', 'start_other', true],
  ['予約前日・当日案内', '予約日を基準に前日と当日へ配信', 'absolute_time', 164, 98, '2026-08-20', 'pause', true],
  ['休眠ユーザー復帰', '90日反応がない友だちへ再案内', 'relative', 0, 0, '2026-08-22', 'restart_prev', false],
  ['会員更新リマインド', '更新月の14日前からお知らせ', 'elapsed', 83, 51, '2026-08-23', 'pause', false],
].map(([name, description, deliveryMode, subscriberCount, completedCount, day, onCompleteMode, isActive], index) => ({
  id: `scenario-${index}`,
  name: String(name),
  description: String(description),
  triggerType: 'manual',
  triggerTagId: null,
  lineAccountId: 'visual-qa-account',
  isActive: Boolean(isActive),
  deliveryMode: String(deliveryMode),
  allowConcurrent: true,
  displayOrder: index,
  folderId: null,
  audienceCondition: null,
  onCompleteMode: String(onCompleteMode),
  onCompleteScenarioId: null,
  subscriberCount: Number(subscriberCount),
  completedCount: Number(completedCount),
  stepCount: 3,
  createdAt: `${day}T00:00:00.000Z`,
  updatedAt: `${day}T00:00:00.000Z`,
}))

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
  monitoringPath: null,
  monitoringUnavailableReason: '実行結果の画面はまだ接続されていません。',
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

/**
 * 統合ユーザー一覧と重複集計。
 *
 * どちらも既定の EMPTY_PAGE では描けない1件返しの口。`rows` や
 * `perAccount` を欠くと画面が落ちるため、Workerの返却契約と同じ形で持つ。
 * 連絡先は平文の個人情報を置かず、画面と同じマスク済みの値にする。
 */
export const USERS_GROUPED = {
  total: 2,
  page: 1,
  pageSize: 50,
  computedAt: '2026-08-31T01:00:00.000Z',
  rows: [
    {
      identityKey: 'uid:merged-person-1',
      identityKeyKind: 'uid',
      displayName: '田中 はなこ',
      pictureUrl: null,
      accounts: [
        {
          accountId: 'visual-qa-account',
          accountName: '画面確認アカウント',
          lineUserId: 'U-visual-merged-1',
          isFollowing: true,
          joinedAt: '2026-08-01T01:00:00.000Z',
          friendId: 'friend-merged-1',
        },
        {
          accountId: 'visual-qa-branch',
          accountName: '画面確認・支店',
          lineUserId: 'U-visual-merged-2',
          isFollowing: true,
          joinedAt: '2026-08-03T01:00:00.000Z',
          friendId: 'friend-merged-2',
        },
      ],
      xUsername: null,
      emails: ['ta***@example.jp'],
      phones: ['090-****-0001'],
      lastActivityAt: '2026-08-30T01:00:00.000Z',
      isDuplicate: true,
    },
    {
      identityKey: 'solo:friend-solo-1',
      identityKeyKind: 'solo',
      displayName: '佐藤 けん',
      pictureUrl: null,
      accounts: [
        {
          accountId: 'visual-qa-account',
          accountName: '画面確認アカウント',
          lineUserId: 'U-visual-solo-1',
          isFollowing: true,
          joinedAt: '2026-08-10T01:00:00.000Z',
          friendId: 'friend-solo-1',
        },
      ],
      xUsername: null,
      emails: [],
      phones: [],
      lastActivityAt: '2026-08-29T01:00:00.000Z',
      isDuplicate: false,
    },
  ],
}

export const DUPLICATE_STATS = {
  totalFollowing: 231,
  uniquePeople: 228,
  friendDups: 3,
  duplicateGroups: 3,
  wastedPerBroadcastYen: 9,
  msgUnitYen: 3,
  perAccount: [
    {
      accountId: 'visual-qa-account',
      accountName: '画面確認アカウント',
      friends: 150,
      dups: 3,
      dupRate: 3 / 150,
    },
    {
      accountId: 'visual-qa-branch',
      accountName: '画面確認・支店',
      friends: 81,
      dups: 3,
      dupRate: 3 / 81,
    },
  ],
  pairwiseOverlap: [
    { fromAccountId: 'visual-qa-account', toAccountId: 'visual-qa-branch', overlap: 3 },
    { fromAccountId: 'visual-qa-branch', toAccountId: 'visual-qa-account', overlap: 3 },
  ],
  computedAt: '2026-08-31T01:00:00.000Z',
}

/**
 * 回答フォーム削除確認（`gBp2J`）の読み口。
 *
 * - `archive`: 回答と利用先があるので、物理削除ではなく保管する
 * - `delete`: 取得できた実値0。未取得を0件へ丸めた状態ではない
 * - `failure`: ブラウザ側の route.fulfill で使い、0件の絵を作らない
 */
export const FORM_DELETE_IMPACT_FIXTURES = {
  archive: {
    form: { id: 'form-visit', name: '来店アンケート', isActive: true, status: 'active' },
    submissionCount: 128,
    openCount: 214,
    references: [
      { kind: 'webinar', name: '使い方講座', href: '/webinars/edit?id=webinar-guide', state: 'available' },
      { kind: 'rich_menu', name: '通常メニュー・予約', href: '/rich-menus/edit?id=rich-menu-main', state: 'available' },
    ],
    referenceCount: 2,
    answerUrl: 'https://liff.line.me/visual-qa/?page=form&id=form-visit',
    revision: 7,
    checkedAt: '2026-08-31T11:00:00.000',
    canDelete: false,
    canArchive: true,
    recommendedAction: 'archive',
    blockers: ['published', 'has_submissions', 'has_opens', 'in_use'],
  },
  delete: {
    form: { id: 'form-empty', name: '下書きフォーム', isActive: false, status: 'active' },
    submissionCount: 0,
    openCount: 0,
    references: [],
    referenceCount: 0,
    answerUrl: 'https://liff.line.me/visual-qa/?page=form&id=form-empty',
    revision: 2,
    checkedAt: '2026-08-31T11:00:00.000',
    canDelete: true,
    canArchive: true,
    recommendedAction: 'delete',
    blockers: [],
  },
  failure: {
    status: 503,
    body: { success: false, error: 'form_delete_impact_unavailable', message: '削除の影響を確認できませんでした。' },
  },
}

/**
 * V6 `ymXJK` NENコラム下書き作成。Workerの公開契約と同じ6項目だけを持つ。
 * 画面側は通常・入力エラー・重複・保存失敗を、このstatus/bodyで描き分ける。
 */
export const NEN_COLUMN_CREATE = {
  request: {
    title: '鹿肉の選び方',
    category: '食事',
    excerpt: '原材料表示の基本をご紹介します。',
    articleUrl: 'https://example.com/columns/venison-guide',
    imageUrl: 'https://cdn.example.com/columns/venison-guide.jpg',
    publishedAt: null,
  },
  success: {
    status: 201,
    body: { success: true, data: { id: 'nen-column-draft-1' } },
  },
  inputError: {
    status: 400,
    body: { success: false, error: 'article_url_invalid' },
  },
  duplicate: {
    status: 409,
    body: { success: false, error: 'column_already_exists' },
  },
  failure: {
    status: 500,
    body: { success: false, error: 'column_create_failed' },
  },
}
/** 機能14 共通情報。削除影響の通常・0件を同じ一覧から開ける。 */
export const COMMON_VARS = [
  {
    id: 'common-var-delete-target', lineAccountId: 'visual-qa-account', folderId: null,
    name: '営業時間', varKey: 'shop_hours', type: 'text', value: '10:00〜19:00',
    createdAt: '2026-08-01T10:00:00.000+09:00', updatedAt: '2026-08-20T10:00:00.000+09:00',
    nextSchedule: null, pendingScheduleCount: 0,
  },
  {
    id: 'common-var-delete-safe', lineAccountId: 'visual-qa-account', folderId: null,
    name: '臨時のお知らせ', varKey: 'temporary_notice', type: 'text', value: '通常どおり営業します',
    createdAt: '2026-08-02T10:00:00.000+09:00', updatedAt: '2026-08-21T10:00:00.000+09:00',
    nextSchedule: null, pendingScheduleCount: 0,
  },
]

export const COMMON_VAR_DELETE_IMPACT = {
  variable: { id: 'common-var-delete-target', name: '営業時間', varKey: 'shop_hours' },
  total: 3,
  blockingTotal: 2,
  historicalTotal: 1,
  unscopedFormTotal: 1,
  canDelete: false,
  byKind: { template: 1, broadcast: 1, scenario: 0, reminder: 0, auto_reply: 0, form: 1, automation: 0 },
  items: [
    {
      kind: 'template', kindLabel: 'テンプレート', name: '来店後のご案内',
      status: '使われています', href: '/templates/edit?id=template-usage-1',
      blocksDeletion: true, currentPreview: '営業時間は10:00〜19:00です',
    },
    {
      kind: 'broadcast', kindLabel: '一斉配信', name: '夏季営業のお知らせ',
      status: '送信済み・変わりません', href: '/broadcasts/detail?id=broadcast-history-1',
      blocksDeletion: false, currentPreview: '本日は10:00〜19:00で営業しました',
    },
  ],
  unavailableReferences: [{
    kind: 'form', kindLabel: '回答フォーム', count: 1,
    reason: '所属するLINEアカウントを確認できないため、名前と内容は表示しません',
  }],
  checkedAt: '2026-08-31T10:00:00.000+09:00',
  recommendedAction: 'review_references',
}

export const COMMON_VAR_DELETE_IMPACT_EMPTY = {
  variable: { id: 'common-var-delete-safe', name: '臨時のお知らせ', varKey: 'temporary_notice' },
  total: 0,
  blockingTotal: 0,
  historicalTotal: 0,
  unscopedFormTotal: 0,
  canDelete: true,
  byKind: { template: 0, broadcast: 0, scenario: 0, reminder: 0, auto_reply: 0, form: 0, automation: 0 },
  items: [],
  unavailableReferences: [],
  checkedAt: '2026-08-31T10:00:00.000+09:00',
  recommendedAction: 'delete',
}

export const COMMON_VAR_DELETE_IMPACT_ERROR = {
  success: false,
  error: '使用先を確認できないため削除できません',
}

/**
 * 機能15 `YfTfJ` の登録メディアと削除影響。
 *
 * 使用先の名前はすべて作り物。内部IDは画面に出さず、hrefの中だけで使う。
 * 通常・0件・失敗を同じ契約から撮れるよう、形を分けて固定してある。
 */
export const MEDIA_ITEMS = [
  {
    id: 'media-delete-target', lineAccountId: 'visual-qa-account', folderId: null,
    kind: 'image', filename: '来店後のご案内.png', mimeType: 'image/png',
    sizeBytes: 245760, width: 1040, height: 1040, durationMs: null,
    url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="1040"><rect width="1040" height="1040" fill="%23e7f7ef"/></svg>',
    uploadedBy: 'visual-qa-owner', createdAt: '2026-08-31T09:00:00.000Z', usageCount: 2,
  },
  {
    id: 'media-delete-safe', lineAccountId: 'visual-qa-account', folderId: null,
    kind: 'image', filename: '未使用の案内.png', mimeType: 'image/png',
    sizeBytes: 102400, width: 1040, height: 1040, durationMs: null,
    url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="1040"><rect width="1040" height="1040" fill="%23f4f5f4"/></svg>',
    uploadedBy: 'visual-qa-owner', createdAt: '2026-08-30T09:00:00.000Z', usageCount: 0,
  },
  {
    id: 'media-replacement', lineAccountId: 'visual-qa-account', folderId: null,
    kind: 'image', filename: '新しい来店案内.png', mimeType: 'image/png',
    sizeBytes: 204800, width: 1040, height: 1040, durationMs: null,
    url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="1040"><rect width="1040" height="1040" fill="%23d9efe3"/></svg>',
    uploadedBy: 'visual-qa-owner', createdAt: '2026-08-31T08:00:00.000Z', usageCount: 0,
  },
]

export const MEDIA_DELETE_IMPACT = {
  media: { id: 'media-delete-target', filename: '来店後のご案内.png', kind: 'image' },
  usageCount: 2,
  references: [
    {
      kind: 'broadcast', name: '8月のお知らせ',
      href: '/broadcasts/detail?id=broadcast-visual', state: 'available',
      scannedAt: '2026-08-31T10:00:00.000Z',
    },
    {
      kind: 'scenario_step', name: '来店後シナリオ・1通目',
      href: '/scenarios/detail?id=scenario-visual', state: 'available',
      scannedAt: '2026-08-31T10:00:00.000Z',
    },
  ],
  checkedAt: '2026-08-31T10:00:00.000Z',
  lastScannedAt: '2026-08-31T10:00:00.000Z',
  canDelete: false,
  recommendedAction: 'review_references',
}

export const MEDIA_DELETE_IMPACT_EMPTY = {
  media: { id: 'media-delete-safe', filename: '未使用の案内.png', kind: 'image' },
  usageCount: 0,
  references: [],
  checkedAt: '2026-08-31T10:00:00.000Z',
  lastScannedAt: null,
  canDelete: true,
  recommendedAction: 'delete',
}

export const MEDIA_DELETE_IMPACT_ERROR = {
  success: false,
  error: '削除したときの影響を確認できませんでした',
}

export const MEDIA_REPLACEMENT_IMPACT = {
  source: { id: 'media-delete-target', filename: '来店後のご案内.png', kind: 'image' },
  replacement: { id: 'media-replacement', filename: '新しい来店案内.png', kind: 'image' },
  usageCount: 2,
  replaceableCount: 2,
  references: MEDIA_DELETE_IMPACT.references.map((reference) => ({
    ...reference, replaceable: true, blocker: null, reason: null,
  })),
  blockers: [],
  canReplace: true,
  checkedAt: '2026-08-31T10:00:00.000Z',
  revision: 'visual-qa-media-replacement-v1',
}

export const MEDIA_REPLACEMENT_IMPACT_EMPTY = {
  ...MEDIA_REPLACEMENT_IMPACT,
  source: { id: 'media-delete-safe', filename: '未使用の案内.png', kind: 'image' },
  usageCount: 0,
  replaceableCount: 0,
  references: [],
  revision: 'visual-qa-media-replacement-empty-v1',
}

export const MEDIA_REPLACEMENT_IMPACT_BLOCKED = {
  ...MEDIA_REPLACEMENT_IMPACT,
  replaceableCount: 1,
  blockers: ['shared_reference'],
  canReplace: false,
  references: [
    MEDIA_REPLACEMENT_IMPACT.references[0],
    {
      ...MEDIA_REPLACEMENT_IMPACT.references[1],
      replaceable: false,
      blocker: 'shared_reference',
      reason: '複数のLINEアカウントで共有しているため、この画面からは差し替えません。',
    },
  ],
  revision: 'visual-qa-media-replacement-blocked-v1',
}

/**
 * `GET /api/rich-menu-groups/:id/delete-impact` の正本形。
 *
 * Claude は szXsT の通常・0件・失敗を撮るとき、この3つをそのまま使う。
 * 表示中人数は記録する台帳が無いので、設計の人数を固定値で作らない。
 */
export const RICH_MENU_DELETE_IMPACT = {
  group: {
    id: 'rich-menu-target',
    accountId: 'visual-qa-account',
    name: '来店後フォローメニュー',
    status: 'published',
  },
  currentAudience: { value: null, reason: 'assignment_ledger_unavailable' },
  nextDisplay: {
    guaranteedGroupId: null,
    reason: 'friend_specific_rules',
    candidates: [
      {
        groupId: 'rich-menu-next',
        name: '通常メニュー',
        targetingPriority: 20,
        isTargetingEnabled: false,
        isDefaultForAll: true,
      },
    ],
  },
  incomingSwitches: [
    {
      sourceGroupId: 'rich-menu-source',
      sourceGroupName: '会員向けメニュー',
      sourcePageId: 'rich-menu-source-page',
      sourcePageName: '特典',
      areaId: 'rich-menu-source-area',
      areaLabel: '来店後のご案内',
      targetPageId: 'rich-menu-target-page',
      targetPageName: 'フォロー',
    },
  ],
  operationalReferences: [
    { kind: 'automation', ownerId: 'automation-visual', ownerName: '来店後の自動案内' },
    { kind: 'common_action', ownerId: 'common-action-visual', ownerName: 'フォローを始める' },
  ],
  lineResources: {
    pageCount: 2,
    pagesWithLineRichMenuId: 2,
    isDefaultForAll: false,
    publishing: false,
  },
  blockers: ['published', 'line_resources', 'incoming_switches', 'operational_references'],
  canDelete: false,
  recommendedAction: 'unpublish',
}

export const RICH_MENU_DELETE_IMPACT_EMPTY = {
  group: {
    id: 'rich-menu-safe',
    accountId: 'visual-qa-account',
    name: '未使用の下書き',
    status: 'draft',
  },
  currentAudience: { value: null, reason: 'assignment_ledger_unavailable' },
  nextDisplay: {
    guaranteedGroupId: null,
    reason: 'friend_specific_rules',
    candidates: [],
  },
  incomingSwitches: [],
  operationalReferences: [],
  lineResources: {
    pageCount: 1,
    pagesWithLineRichMenuId: 0,
    isDefaultForAll: false,
    publishing: false,
  },
  blockers: [],
  canDelete: true,
  recommendedAction: 'delete',
}

export const RICH_MENU_DELETE_IMPACT_ERROR = {
  success: false,
  error: '削除したときの影響を確認できませんでした',
}

/**
 * 受信箱のLINEの会話。設計 `★ V6 2-1 受信箱` `xGLVe` の一覧のうち、LINEの3件。
 *
 * **メールはここに入れない。** 画面は `/api/chats`（LINE）と
 * `/api/support/inbox?channel=email`（メール）を別々に読んで混ぜる。
 * メールをここへ入れると、MAILの札が付かずLINE扱いで描かれる。
 *
 * 空で返していたあいだ、受信箱は「チャットを選択してください」しか描けず、
 * **一覧も吹き出しも顧客情報も出ないまま**だった。空の絵を設計と並べても
 * 「差が無い」とは言えない。
 *
 * 画面が読むのは `Chat` に画面用の項目を足した形（`friendName`
 * `lastMessageContent` `isUnread` など）。**型に無いからと省くと、
 * 名前も本文も出ない行になる。**
 */
export const CHATS = [
  // 名前, 状態, 担当, 本文, 最終受信, 未読
  ['Kyohei Yamamoto', 'unread', 'operator-kenta', '本日8月19日のお知らせです。内容をご確認ください。', '2026-08-19T09:48:00.000Z', true],
  ['Kenta Kawano (Obama)', 'in_progress', 'operator-kenta', 'テスト', '2026-08-18T10:20:00.000Z', false],
  ['菅野 亮', 'resolved', 'operator-masato', '最新のやり取りを確認できます。', '2026-08-13T05:16:00.000Z', false],
].map(([friendName, status, operatorId, lastMessageContent, lastMessageAt, isUnread], index) => ({
  id: `chat-${index}`,
  friendId: `friend-${index}`,
  friendName: String(friendName),
  friendPictureUrl: null,
  operatorId,
  status: String(status),
  notes: null,
  revision: 1,
  isUnread: Boolean(isUnread),
  lastMessageAt: String(lastMessageAt),
  lastMessageContent: String(lastMessageContent),
  lastMessageDirection: 'inbound',
  lastMessageType: 'text',
  sendMode: 'line',
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: String(lastMessageAt),
}))

/**
 * 受信箱の上に出る数。設計 `xGLVe` の帯そのまま。
 * 「要返信 1件・最長 1時間12分待ち」。
 */
export const INBOX_STATS = {
  waiting: 1,
  oldestWaitingMinutes: 72,
  averageFirstReplyMinutes: null,
  waitingOverAnHour: 1,
  mine: 0,
  todayInbound: 0,
  todayByChannel: { line: 0, email: 0 },
  /*
    担当者ごとの未読数（設計 `YZaDK`）。**0件の担当者はここに載らない**
    契約なので、`Masato` はわざと入れない——画面が実値0として描くところを
    確かめるため。担当がまだ決まっていない会話は `operatorId` が `null`。
  */
  assigneeUnread: [
    { operatorId: null, operatorName: null, unread: 2 },
    { operatorId: 'operator-kenta', operatorName: 'Kenta', unread: 3 },
  ],
}

/**
 * 選んだ会話の吹き出し。設計 `xGLVe` のトーク欄そのまま。
 *
 * 空で返すとトーク欄が真っ白になり、**日付の区切り・シナリオの記録・
 * 送った人の名前**という設計の3要素をどれも確かめられない。
 *
 * 向きは `incoming` / `outgoing`。**`inbound` / `outbound` ではない。**
 * 違う言葉で書くと、画面はどれも受信側の吹き出しとして描く。
 *
 * 吹き出しは `/api/chats/:id` の `messages` から出る。
 * `/api/friends/:id/messages` は別の口で、こちらには出ない。
 */
export const FRIEND_MESSAGES = {
  'friend-1': [
    {
      id: 'msg-1', friendId: 'friend-1', direction: 'incoming', messageType: 'text',
      content: '登録しました！', createdAt: '2026-08-13T05:16:00.000Z',
      broadcastId: null, scenarioStepId: null,
      source: 'line', scenarioName: null, sentByStaffName: null,
    },
    {
      id: 'msg-2', friendId: 'friend-1', direction: 'outgoing', messageType: 'text',
      content: 'シナリオ「友だち挨拶」を開始', createdAt: '2026-08-13T05:18:00.000Z',
      broadcastId: null, scenarioStepId: 'step-1',
      source: 'scenario', scenarioName: '友だち挨拶', sentByStaffName: null,
    },
    {
      id: 'msg-3', friendId: 'friend-1', direction: 'outgoing', messageType: 'text',
      content: 'テスト', createdAt: '2026-08-13T10:20:00.000Z',
      broadcastId: null, scenarioStepId: null,
      source: 'manual', scenarioName: null, sentByStaffName: '河野',
    },
  ],
}

/**
 * 友だちのマイル。設計 `xGLVe` の右パネル「利用可能 2,450 mile」。
 *
 * **`summary` を返さないと画面ごと落ちる**（`summary.programName` を読む）。
 * 空の一覧で返していたあいだ、会話を開くたびに「もう一度試す」だけの
 * 画面になっていた。
 */
export const FRIEND_MILEAGE = {
  summary: {
    programId: 'mile-default',
    programName: 'NENマイル',
    available: 2450,
    pending: 0,
    lifetimeEarned: 2450,
    spent: 0,
  },
  history: [],
  /*
    **`insights` と `connections` を欠かさない。**

    口の契約は `{ summary, history, insights, connections }` の4つ。
    `insights` が無いと `mileage/friends/detail/page.tsx` が
    `insights.rewardedActions` で投げ、**画面ごと「画面を表示できませんでした」
    になって `HIU5O` と `vz0Ji` が1枚も撮れない。**
    型に無い名前で書いても握りつぶされるだけなので、`MileageSelfInsights` と
    `MileageConnectedAccount` の名前をそのまま使う。
  */
  insights: {
    accountCount: 1,
    rewardedActions: 3,
    referralMiles: 0,
    qualityReferralCount: 0,
    lastEarnedAt: '2026-08-24T20:53:00+09:00',
  },
  connections: [
    {
      accountId: 'visual-qa-account',
      accountName: '画面確認アカウント',
      friendId: 'friend-1',
      available: 5,
      lastEarnedAt: '2026-08-24T20:53:00+09:00',
    },
  ],
}

/**
 * 会話を開いたときの右パネル。設計 `xGLVe` の「顧客情報」そのまま。
 *
 * **`tags` と `formSubmissions` は必ず配列で返す。** 一覧の口が返す
 * `{items,total,page,limit}` のままだと `friend.tags.length` で落ち、
 * 会話を開くたびに「もう一度試す」だけの画面になっていた。
 */
export const FRIEND_DETAILS = {
  'friend-1': {
    id: 'friend-1',
    displayName: 'Kenta Kawano (Obama)',
    systemDisplayName: 'Kenta Kawano (Obama)',
    realName: '河野 健太',
    pictureUrl: null,
    isFollowing: true,
    createdAt: '2026-08-13T00:00:00.000Z',
    metadata: {},
    tags: [
      { id: 'friend-tag-kubun', name: '顧客区分：既存顧客', color: '#8B938D', createdAt: '2026-08-13T00:00:00.000Z' },
      { id: 'friend-tag-store', name: '来店店舗：渋谷店', color: '#8B938D', createdAt: '2026-08-13T00:00:00.000Z' },
    ],
    formSubmissions: [],
  },
}

/**
 * テンプレートの置き場。設計 `NWbuF`（2-6 全フォルダ展開）の件数そのまま。
 * 未分類3・お問い合わせ8・予約5・EC4 で計20件。
 */
export const TEMPLATE_FOLDERS = [
  ['tf-inquiry', 'お問い合わせ', 8],
  ['tf-booking', '予約', 5],
  ['tf-ec', 'EC', 4],
].map(([id, name, count], index) => ({
  id: String(id),
  kind: 'template',
  name: String(name),
  parentId: null,
  displayOrder: index,
  color: null,
  createdAt: '2026-01-13T00:00:00.000Z',
  updatedAt: '2026-01-13T00:00:00.000Z',
  templateCount: Number(count),
}))

/**
 * テンプレート20件。**件数はフォルダの数に合わせる。**
 * 合わないと、フォルダの脇に出る数と一覧の行数が食い違う。
 */
export const TEMPLATES = (() => {
  const rows = []
  const plan = [
    [null, '未分類', 3],
    ['tf-inquiry', 'お問い合わせ', 8],
    ['tf-booking', '予約', 5],
    ['tf-ec', 'EC', 4],
  ]
  let n = 0
  for (const [folderId, label, count] of plan) {
    for (let i = 0; i < count; i += 1) {
      rows.push({
        id: `template-${n}`,
        name: `${label}のひな形 ${i + 1}`,
        category: 'text',
        messageType: 'text',
        messageContent: `${label}のご連絡です。内容をご確認ください。`,
        folderId,
        createdAt: '2026-01-13T00:00:00.000Z',
        updatedAt: '2026-01-13T00:00:00.000Z',
      })
      n += 1
    }
  }
  return rows
})()

/**
 * 受信箱の保存した検索。設計 `ASsb3`（2-13 保存した検索を開く）の並び。
 *
 * **空で返すと、同じ名前かどうかを確かめられない。** 2-17（重複エラー）は
 * すでにある名前を打ったときの絵なので、既存が0件だと「保存しました」に
 * なってしまう。実際そうなった。
 */
/**
 * 受信箱の保存した検索（設計 `ASsb3`）。
 *
 * **友だち側の `{all,any}` とは別の形。** 受信箱は軸ごとに値を持つ。
 * 前はここに `{ all: [], any: [] }` を入れていたので、
 * 名前の下の要約が全部「絞り込みなし」になっていた。
 *
 * 名前と中身は設計の3件をそのまま置く。
 */
const INBOX_VIEW_CONDITIONS = {
  version: 1,
  query: '',
  channels: [],
  statuses: [],
  assignees: [],
  unread: 'all',
  messageTypes: [],
  receivedFrom: null,
  receivedTo: null,
  sort: 'newest',
}

/*
  **1件だけ古い形のまま残す。**

  保存した検索の仕組みは受信箱より前からあり、古い行は友だち側と同じ
  `{ all: [], any: [] }` の形で入っている。3件とも新しい形にすると、
  **古い行を開くと受信箱ごと落ちる**という起きた不具合を二度と踏めない。
  画面はこれを「絞り込みなし」として開く。
*/
const LEGACY_VIEW_CONDITIONS = { all: [], any: [] }

export const INBOX_SAVED_VIEWS = [
  ['未対応・期限超過', true, { statuses: ['unread'], sort: 'waiting_desc' }],
  ['河野担当の未対応', true, { statuses: ['unread'], assignees: ['operator-kenta'] }],
  ['LINEからの新着', false, null],
].map(([name, isShared, patch], index) => ({
  id: `inbox-view-${index}`,
  name: String(name),
  scope: 'chats',
  conditions: patch ? { ...INBOX_VIEW_CONDITIONS, ...patch } : LEGACY_VIEW_CONDITIONS,
  createdBy: 'Kenta',
  lineAccountId: 'visual-qa-account',
  isShared: Boolean(isShared),
  displayOrder: index,
  createdAt: '2026-08-17T03:00:00.000Z',
}))

/*
  リマインダの実行結果（設計 `GC4St` 7-1-H、要件 §3-7）。

  **成功だけを並べない。** 送信済み・配信予定・再試行待ち・送信失敗・
  送らなかったもの を1件ずつ入れて、状態の描き分けと「失敗した1通だけ
  再試行できる」を確かめられるようにする。

  **かかった時間が出せない行を混ぜる**（まだ始まっていない予定）。
  `durationMs` を0で埋めると「一瞬で終わった」と読めてしまう。
*/
const RUN_BASE = {
  ownerKind: 'reminder',
  ownerId: 'reminder-1',
  lineAccountId: 'visual-qa-account',
  accountLabel: '然-NEN-TEST',
  triggerLabel: '予約前日のお知らせ',
  reference: null,
  reminderId: 'reminder-1',
  friendReminderId: 'fr-1',
  reminderStepId: 'step-1',
}

export const REMINDER_RUNS = {
  reminder: { id: 'reminder-1', name: '予約前日のお知らせ', isActive: true },
  summary: {
    sent: 128, scheduled: 42, stopped: 6, errors: 3,
    targetCount: 179, nextScheduledAt: '2026-08-20T09:00:00+09:00',
  },
  steps: [
    {
      id: 'step-1', stepNumber: 1, offsetMinutes: -1440, messageType: 'text',
      messageContent: '明日のご予約のお知らせです。お待ちしております。',
      /** LINEは友だち単位の既読を返さない。**0%を作らない。** */
      sent: 128, openRate: null, errors: 3,
    },
    {
      id: 'step-2', stepNumber: 2, offsetMinutes: -60, messageType: 'text',
      messageContent: '1時間後にお会いできるのを楽しみにしています。',
      sent: 96, openRate: null, errors: 0,
    },
  ],
  items: [
    {
      ...RUN_BASE, id: 'run-1', friendId: 'friend-kyohei', friendName: 'Kyohei Yamamoto',
      stepNumber: 1, scheduledAt: '2026-08-19T09:00:00+09:00',
      startedAt: '2026-08-19T09:00:02+09:00', completedAt: '2026-08-19T09:00:03+09:00',
      occurredAt: '2026-08-19T09:00:03+09:00', subject: 'Kyohei Yamamoto',
      status: 'succeeded', domainStatus: 'succeeded', detail: '1通目',
      durationMs: 1200, attemptCount: 1, nextRetryAt: null,
      lastErrorCode: null, lastErrorMessage: null,
      lineRequestId: '0f3c2a8e-1b44-4f0a-9d21-77c0a1b2c3d4', messageLogId: 'log-1',
      canRetry: false,
    },
    {
      ...RUN_BASE, id: 'run-2', friendId: 'friend-masato', friendName: 'Masato.S',
      stepNumber: 1, scheduledAt: '2026-08-20T09:00:00+09:00',
      startedAt: null, completedAt: null,
      occurredAt: '2026-08-20T09:00:00+09:00', subject: 'Masato.S',
      status: 'pending', domainStatus: 'queued', detail: '1通目',
      /** まだ始まっていないので出せない。**0にしない。** */
      durationMs: null, attemptCount: 0, nextRetryAt: null,
      lastErrorCode: null, lastErrorMessage: null,
      lineRequestId: null, messageLogId: null,
      canRetry: false,
    },
    {
      ...RUN_BASE, id: 'run-3', friendId: 'friend-kenta', friendName: 'Kenta Kawano(Obama)',
      stepNumber: 1, scheduledAt: '2026-08-19T09:00:00+09:00',
      startedAt: '2026-08-19T09:00:02+09:00', completedAt: null,
      occurredAt: '2026-08-19T09:00:02+09:00', subject: 'Kenta Kawano(Obama)',
      status: 'pending', domainStatus: 'retry_wait', detail: '一時的にLINEへ届きませんでした',
      durationMs: null, attemptCount: 2, nextRetryAt: '2026-08-19T09:30:00+09:00',
      lastErrorCode: '429', lastErrorMessage: '一時的にLINEへ届きませんでした',
      lineRequestId: null, messageLogId: null,
      canRetry: true,
    },
    {
      ...RUN_BASE, id: 'run-4', friendId: 'friend-taro', friendName: 'テスト 太郎',
      stepNumber: 1, scheduledAt: '2026-08-19T09:00:00+09:00',
      startedAt: '2026-08-19T09:00:02+09:00', completedAt: '2026-08-19T09:00:05+09:00',
      occurredAt: '2026-08-19T09:00:05+09:00', subject: 'テスト 太郎',
      status: 'failed', domainStatus: 'permanent_failed',
      detail: '友だちがブロックしているため送れません',
      durationMs: 3100, attemptCount: 3, nextRetryAt: null,
      lastErrorCode: '403', lastErrorMessage: '友だちがブロックしているため送れません',
      lineRequestId: null, messageLogId: null,
      canRetry: true,
    },
    {
      ...RUN_BASE, id: 'run-5', friendId: 'friend-hanako', friendName: null,
      stepNumber: 2, scheduledAt: '2026-08-19T17:00:00+09:00',
      startedAt: '2026-08-19T17:00:01+09:00', completedAt: '2026-08-19T17:00:01+09:00',
      occurredAt: '2026-08-19T17:00:01+09:00', subject: null,
      status: 'skipped', domainStatus: 'skipped', detail: '予約が取り消されたため送りませんでした',
      durationMs: 400, attemptCount: 1, nextRetryAt: null,
      lastErrorCode: null, lastErrorMessage: '予約が取り消されたため送りませんでした',
      lineRequestId: null, messageLogId: null,
      canRetry: false,
    },
  ],
  pagination: { total: 5, limit: 20, offset: 0 },
}

/*
  対応マーク（設計 `rIhbN` 4-3、`GMvBd` 4-3-A）。

  **「保留」を必ず入れる。** 撮影の手順が「保留」を押して編集画面へ進む。
  行が無いと押しどころが描かれず、4-3-A が1枚も撮れない
  （kentavndng/line-harness-board#105 に挙げていた欠け）。
*/
export const SUPPORT_MARKS = [
  {
    id: 'mark-default', name: '未対応', color: '#F59E0B', isDefault: true,
    autoOnInbound: true, displayOrder: 0, createdAt: '2026-01-01T00:00:00.000Z',
    isInherited: false, friendCount: 8,
  },
  {
    id: 'mark-hold', name: '保留', color: '#94A3B8', isDefault: false,
    autoOnInbound: false, displayOrder: 1, createdAt: '2026-01-02T00:00:00.000Z',
    isInherited: false, friendCount: 3,
  },
  {
    id: 'mark-unused', name: '確認待ち', color: '#3B82F6', isDefault: false,
    autoOnInbound: false, displayOrder: 2, createdAt: '2026-01-03T00:00:00.000Z',
    isInherited: false, friendCount: 0,
  },
]

/*
  対応マークの自動変更ルール。

  **止めているルールを1件混ぜる。** 全部動いていると、「動いています／
  止めています」の描き分けと、止めたものが実行順から外れて見えるかを
  一度も確かめられない。優先度も変えて、実行順の並びが出るようにする。
*/
export const SUPPORT_MARK_AUTOMATION_RULES = [
  {
    id: 'support-rule-assigned',
    name: '担当者が決まったら対応中へ',
    markId: 'mark-hold',
    event: 'staff_assigned',
    condition: null,
    priority: 100,
    manualProtectionMinutes: 60,
    isActive: true,
    version: 2,
    updatedAt: '2026-08-31T10:00:00+09:00',
  },
  {
    id: 'support-rule-overdue',
    name: '期限を過ぎたら確認待ちへ',
    markId: 'mark-hold',
    event: 'response_overdue',
    condition: { operator: 'AND', rules: [] },
    priority: 50,
    manualProtectionMinutes: 0,
    isActive: false,
    version: 1,
    updatedAt: '2026-08-30T15:00:00+09:00',
  },
]

// V6 3-1-D `IAf7j`（友だち一括操作）。画面側はこの契約をそのまま使う。
// 0件と未取得を混ぜないため、通常・空・失敗は同じ配列の増減ではなく
// API状態として切り替える。ここには「取得できた通常値」だけを置く。
export const FRIEND_BULK_RUN = {
  preview: {
    selectedCount: 4,
    targetCount: 3,
    excludedCount: 1,
    accountBreakdown: [{ lineAccountId: 'visual-qa-account', count: 3 }],
    exclusions: [{ reason: 'LINEの友だちではないため対象外', count: 1 }],
    sample: FRIENDS.slice(0, 3).map((item) => ({
      friendId: item.id,
      displayName: item.displayName,
      pictureUrl: item.pictureUrl,
      lineAccountId: item.lineAccountId,
    })),
    reversible: true,
  },
  detail: {
    id: 'friend-bulk-run-1',
    status: 'partial',
    selection: { kind: 'explicit', friendIds: FRIENDS.slice(0, 4).map((item) => item.id) },
    operation: { kind: 'add_tag', tagId: 'tag-0' },
    targetCount: 3,
    excludedCount: 1,
    successCount: 2,
    skippedCount: 0,
    temporaryFailureCount: 1,
    permanentFailureCount: 0,
    reversible: true,
    scheduledAt: null,
    createdAt: '2026-08-31T01:00:00.000Z',
    startedAt: '2026-08-31T01:00:01.000Z',
    completedAt: '2026-08-31T01:00:03.000Z',
    updatedAt: '2026-08-31T01:00:03.000Z',
    page: 1,
    limit: 50,
    total: 3,
    items: FRIENDS.slice(0, 3).map((item, index) => ({
      id: `friend-bulk-item-${index + 1}`,
      friendId: item.id,
      displayName: item.displayName,
      pictureUrl: item.pictureUrl,
      lineAccountId: item.lineAccountId,
      status: index === 2 ? 'temporary_failure' : 'success',
      attemptCount: 1,
      errorMessage: index === 2 ? '時間をおいて、もう一度お試しください' : null,
      retryAt: null,
      completedAt: '2026-08-31T01:00:03.000Z',
    })),
  },
}

/**
 * `InCDe`（友だち同士）と `ELayY`（EC会員と友だち）が共有する本人照合契約。
 * 値はすべて作り物で、メール・電話は必ずマスクする。
 */
const IDENTITY_CONFIDENCE = { score: 92, label: 'very_high' }
const IDENTITY_FRIEND_LEFT = {
  kind: 'friend', id: 'friend-identity-left', label: '田中 はなこ', detail: '支店',
  lineAccountId: 'visual-qa-account', lineAccountName: '画面確認アカウント', shopKey: null,
  attributes: [
    { label: 'メールアドレス', valuePreview: 'ta***@example.jp', verified: true },
    { label: '電話番号', valuePreview: '090-****-0001', verified: true },
  ],
}
const IDENTITY_FRIEND_RIGHT = {
  kind: 'friend', id: 'friend-identity-right', label: '田中 花子', detail: '本店',
  lineAccountId: 'visual-qa-account', lineAccountName: '画面確認アカウント', shopKey: null,
  attributes: [
    { label: 'メールアドレス', valuePreview: 'ta***@example.jp', verified: true },
    { label: '電話番号', valuePreview: '090-****-0001', verified: true },
  ],
}
const IDENTITY_EVIDENCE = [
  {
    key: 'verified_email', label: '確認済みのメールアドレスが同じ', strength: 'strong',
    verified: true, valuePreview: 'ta***@example.jp',
  },
  {
    key: 'similar_name', label: '表示名が似ている', strength: 'weak',
    verified: false, valuePreview: null,
  },
]

export const IDENTITY_CANDIDATE_FRIEND = {
  id: 'identity-friend-1', kind: 'friend_duplicate', status: 'pending', version: 1,
  confidence: IDENTITY_CONFIDENCE, left: IDENTITY_FRIEND_LEFT, right: IDENTITY_FRIEND_RIGHT,
  evidence: IDENTITY_EVIDENCE,
  impact: [
    { key: 'duplicate_deliveries', label: '重複配信', value: 3, unit: '通', note: null },
    { key: 'orders', label: '注文', value: null, unit: '件', note: '取得元を接続後に表示' },
  ],
  history: [], detectedAt: '2026-08-30T10:00:00.000Z', reviewedAt: null,
  canDecide: true, canUndo: false, undoNote: '判定を取り消すと、根拠を確認する候補へ戻ります。',
}

export const IDENTITY_CANDIDATE_EC = {
  ...IDENTITY_CANDIDATE_FRIEND,
  id: 'identity-ec-1', kind: 'ec_member',
  left: {
    kind: 'ec_event', id: 'event-identity-1', label: '注文 NEN-1001', detail: '2026/08/30',
    lineAccountId: 'visual-qa-account', lineAccountName: '画面確認アカウント', shopKey: 'shop-a',
    attributes: [
      { label: 'メールアドレス', valuePreview: 'ta***@example.jp', verified: true },
      { label: '電話番号', valuePreview: '090-****-0001', verified: true },
    ],
  },
  impact: [
    { key: 'orders', label: '結び付く注文', value: 24, unit: '件', note: null },
    { key: 'past_messages', label: '過去のLINE送信', value: 0, unit: '通', note: '再送しません' },
  ],
}

function identityListItem(candidate) {
  return {
    id: candidate.id, kind: candidate.kind, status: candidate.status, version: candidate.version,
    confidence: candidate.confidence, left: candidate.left, right: candidate.right,
    evidenceSummary: candidate.evidence.map((item) => item.label),
    detectedAt: candidate.detectedAt, reviewedAt: candidate.reviewedAt,
  }
}

export const IDENTITY_CANDIDATE_LISTS = {
  friend_duplicate: {
    items: [identityListItem(IDENTITY_CANDIDATE_FRIEND)], total: 1, limit: 20, offset: 0,
  },
  ec_member: {
    items: [identityListItem(IDENTITY_CANDIDATE_EC)], total: 1, limit: 20, offset: 0,
  },
  empty: { items: [], total: 0, limit: 20, offset: 0 },
}

export const IDENTITY_CANDIDATE_ERROR = {
  success: false, error: '本人照合の候補を読み込めませんでした', code: 'VISUAL_QA_ERROR',
}

/** `w8W4Eh` 統合ユーザー詳細。平文のメール・電話は置かない。 */
export const MERGED_PERSON_DETAIL = {
  id: 'merged-person-1', status: 'active', revision: 4, primaryDisplayName: '田中 花子',
  linkedFriends: [
    {
      friendId: 'friend-identity-right', displayName: '田中 花子',
      lineAccountId: 'visual-qa-account', lineAccountName: '本店', isFollowing: true,
      linkedAt: '2026-08-28T10:00:00.000Z', linkMethod: 'operator_review', confidence: 92,
      candidateId: 'identity-friend-1', candidateVersion: 2,
    },
    {
      friendId: 'friend-identity-left', displayName: '田中 はなこ',
      lineAccountId: 'visual-qa-account-sub', lineAccountName: '支店', isFollowing: true,
      linkedAt: '2026-08-28T10:00:00.000Z', linkMethod: 'operator_review', confidence: 92,
      candidateId: 'identity-friend-1', candidateVersion: 2,
    },
  ],
  profileValues: [
    {
      fieldKey: 'email', fieldLabel: 'メールアドレス', valuePreview: 'ta***@example.jp',
      sourceType: 'form', sourceLabel: '来店アンケート', sourceFriendId: 'friend-identity-right',
      verifiedAt: '2026-08-28T09:00:00.000Z', selectedByName: '画面確認',
      selectedAt: '2026-08-28T10:10:00.000Z', updateMode: 'fixed',
    },
    {
      fieldKey: 'phone', fieldLabel: '電話番号', valuePreview: '090-****-0001',
      sourceType: 'friend_field', sourceLabel: '支店の友だち情報',
      sourceFriendId: 'friend-identity-left', verifiedAt: null, selectedByName: '画面確認',
      selectedAt: '2026-08-28T10:12:00.000Z', updateMode: 'auto',
    },
  ],
  deliveryPriorities: [
    {
      purpose: 'broadcast', friendId: 'friend-identity-right',
      lineAccountId: 'visual-qa-account', lineAccountName: '本店', priority: 1,
      isActive: true, reason: '通常の配信は本店から送ります',
    },
    {
      purpose: 'broadcast', friendId: 'friend-identity-left',
      lineAccountId: 'visual-qa-account-sub', lineAccountName: '支店', priority: 2,
      isActive: true, reason: '本店から送れないときの代替です',
    },
  ],
  history: [
    {
      id: 'merged-event-2', eventType: 'profile',
      summary: 'プロフィールの採用値を2件更新しました', actorName: '画面確認',
      occurredAt: '2026-08-28T10:12:00.000Z',
    },
    {
      id: 'merged-event-1', eventType: 'link', summary: '本人照合で友だちを結び付けました',
      actorName: '画面確認', occurredAt: '2026-08-28T10:00:00.000Z',
    },
  ],
  createdAt: '2026-08-28T10:00:00.000Z', updatedAt: '2026-08-28T10:12:00.000Z',
  archivedAt: null,
}

/** 0件を未取得へ変えないため、器は通常時と同じまま空配列を返す。 */
export const MERGED_PERSON_EMPTY = {
  ...MERGED_PERSON_DETAIL,
  revision: 1,
  linkedFriends: [MERGED_PERSON_DETAIL.linkedFriends[0]],
  profileValues: [],
  deliveryPriorities: [],
  history: [],
}

export const MERGED_PERSON_ERROR = {
  success: false, error: '統合ユーザーを読み込めませんでした', code: 'VISUAL_QA_ERROR',
}

export const IDENTITY_CANDIDATE_DETECTION = {
  normal: { processed: 1, hasMore: false, nextCursor: null },
  empty: { processed: 0, hasMore: false, nextCursor: null },
}

/**
 * シナリオの通。設計 `bV5Vs`（5-1-C シナリオ編集）の3通。
 *
 * **`steps` を配列で返さないと画面ごと落ちる**（`scenario.steps` を回す）。
 * 空の一覧の形で返していたあいだ、シナリオを開くたびに「もう一度試す」
 * だけの画面になっていた。
 */
export const SCENARIO_STEPS = [
  [1, 0, 'ご登録ありがとうございます。まずはこちらをご覧ください。'],
  [2, 1440, '使い方のご案内です。よくある質問もまとめました。'],
  [3, 4320, 'ご不明な点はありませんか。お気軽にご返信ください。'],
].map(([stepOrder, delayMinutes, messageContent], index) => ({
  id: `step-${index}`,
  scenarioId: 'scenario-0',
  stepOrder: Number(stepOrder),
  delayMinutes: Number(delayMinutes),
  offsetDays: null,
  offsetMinutes: null,
  deliveryTime: null,
  templateId: null,
  onReachTagId: null,
  afterSend: 'continue',
  messageType: 'text',
  messageContent: String(messageContent),
  targetCondition: null,
  question: null,
  isDraft: false,
  createdAt: '2026-08-16T00:00:00.000Z',
}))

/**
 * シナリオの到達率。設計 `bV5Vs` の通ごとの数。
 *
 * 一覧の形で返していたあいだ、画面は `stats.steps.find(...)` で落ちていた。
 * **配列には `steps` が無い。**
 */
export const SCENARIO_STATS = {
  enrolledTotal: 428,
  activeNow: 116,
  completed: 312,
  paused: 0,
  steps: SCENARIO_STEPS.map((step, index) => ({
    stepOrder: step.stepOrder,
    reachedCount: [428, 381, 312][index] ?? 0,
    reachedRate: [1, 0.89, 0.73][index] ?? 0,
  })),
}

/**
 * 一斉配信の一覧。設計 `★ V6 6-1` `q76C35` の5行そのまま。
 *
 * **状態を1通りしか入れないと、状態ごとの見え方を確かめられない。**
 * 設計は 予約済み・下書き（未設定）・送信済み・停止中 の4通りが並ぶが、
 * **「停止中」は型に無い**（draft / scheduled / sending / sent の4つ）。
 */
export const BROADCASTS = [
  // 題, 種別, 対象, 状態, 予定, 対象数, 成功数
  ['8月キャンペーンのお知らせ', 'image', 'all', 'scheduled', '2026-08-24T01:00:00.000Z', 0, 0],
  ['未購入者フォロー', 'text', 'segment', 'draft', null, 18, 0],
  ['新商品発売のお知らせ', 'carousel', 'tag', 'sent', '2026-08-20T03:00:00.000Z', 624, 624],
  ['予約空き枠のご案内', 'text', 'tag', 'sent', '2026-08-18T09:30:00.000Z', 203, 203],
  /*
    設計の5行目は「停止中／停止済み」だが、**その状態が型に無い**
    （`BroadcastStatus` は draft / scheduled / sending / sent の4つ）。
    近いものが無いので下書きで置き、突き合わせ文書に差として書いた。
  */
  ['重要なお知らせ', 'text', 'all', 'draft', '2026-08-17T00:00:00.000Z', 0, 0],
].map(([title, messageType, targetType, status, scheduledAt, totalCount, successCount], index) => ({
  id: `broadcast-${index}`,
  title: String(title),
  messageType: String(messageType),
  messageContent: `${title}の本文です。`,
  targetType: String(targetType),
  targetTagId: targetType === 'tag' ? 'tag-0' : null,
  status: String(status),
  scheduledAt,
  sentAt: status === 'sent' ? scheduledAt : null,
  totalCount: Number(totalCount),
  successCount: Number(successCount),
  folderId: null,
  createdAt: '2026-08-16T00:00:00.000Z',
}))

/**
 * 機能7 リマインダ。設計 `M1EXwB` の5行そのまま。
 *
 * **`Reminder` の型に照らして書く。** 設計の言葉（「予約日時の1日前」）は
 * 見出しであって項目名ではない。`triggerType` は
 * `'manual' | 'booking' | 'event' | 'friend_field'` の4つしかなく、
 * ここに設計の日本語をそのまま入れると画面は既定値のまま描かれ、
 * **5行とも同じきっかけで撮れてしまう**（機能4で一度やった）。
 */
export const REMINDER_FOLDERS = [
  { id: 'rf-booking', kind: 'reminder', name: '予約', parentId: null, displayOrder: 1, color: '#2563eb' },
  { id: 'rf-contract', kind: 'reminder', name: '契約更新', parentId: null, displayOrder: 2, color: '#d97706' },
  { id: 'rf-event', kind: 'reminder', name: 'イベント', parentId: null, displayOrder: 3, color: '#7c3aed' },
  { id: 'rf-follow', kind: 'reminder', name: 'フォロー', parentId: null, displayOrder: 4, color: '#059669' },
]

export const REMINDERS = [
  {
    id: 'reminder-1', name: '予約前日のご案内', description: '予約日時の1日前',
    isActive: true, triggerType: 'booking', deliveryMode: 'time',
    triggerOffsetMinutes: -1440, sendAtTime: '18:00', targetTagId: null,
    triggerFieldId: null, repeatYearly: false,
    folderId: 'rf-booking', stepCount: 1, displayOrder: 1,
    createdAt: '2026-06-02T00:00:00.000Z', updatedAt: '2026-08-22T09:00:00.000Z',
  },
  {
    id: 'reminder-2', name: '予約1時間前のご案内', description: '予約日時の1時間前',
    isActive: true, triggerType: 'booking', deliveryMode: 'countdown',
    triggerOffsetMinutes: -60, sendAtTime: null, targetTagId: null,
    triggerFieldId: null, repeatYearly: false,
    folderId: 'rf-booking', stepCount: 1, displayOrder: 2,
    createdAt: '2026-06-02T00:00:00.000Z', updatedAt: '2026-08-22T11:00:00.000Z',
  },
  {
    id: 'reminder-3', name: '契約更新30日前', description: '契約終了の30日前',
    isActive: true, triggerType: 'friend_field', deliveryMode: 'time',
    triggerOffsetMinutes: -43200, sendAtTime: '10:00', targetTagId: null,
    triggerFieldId: 'field-contract-end', repeatYearly: false,
    folderId: 'rf-contract', stepCount: 2, displayOrder: 3,
    createdAt: '2026-05-11T00:00:00.000Z', updatedAt: '2026-08-21T01:00:00.000Z',
  },
  {
    /* 下書き。**0通なので「最終送信」は空。** ここを「—」ではなく空で
       出すか、設計どおり空欄にするかは実装側の決めごと。 */
    id: 'reminder-4', name: 'イベント当日案内', description: 'イベント当日',
    isActive: false, triggerType: 'event', deliveryMode: 'time',
    triggerOffsetMinutes: 0, sendAtTime: '09:00', targetTagId: null,
    triggerFieldId: null, repeatYearly: false,
    folderId: 'rf-event', stepCount: 1, displayOrder: 4,
    createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
  },
  {
    /* 停止中。設計は「下書き」と別の札で描いている。実装の `isActive` は
       真偽値ひとつなので、**下書きと停止中を描き分けられない。** */
    id: 'reminder-5', name: '未返信3日後フォロー', description: '最終送信の3日後',
    isActive: false, triggerType: 'manual', deliveryMode: 'time',
    triggerOffsetMinutes: 4320, sendAtTime: '12:00', targetTagId: null,
    triggerFieldId: null, repeatYearly: false,
    folderId: 'rf-follow', stepCount: 1, displayOrder: 5,
    createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-08-19T03:00:00.000Z',
  },
]

/** 設計 `M1EXwB` の帯。リマインダ9件（有効7）／送信予定124通／今月386通／失敗2通。 */
export const REMINDER_STATS = { total: 9, active: 7, waiting: 124, sentThisMonth: 386, failed: 2 }

/**
 * 友だち情報欄の項目。リマインダの起点（`triggerFieldId`）に日付の欄が要る。
 *
 * **`FriendField` の型どおりに書く。** `type` は10種類の決まった言葉で、
 * ここに設計の日本語を入れると欄は既定の1行入力として描かれ、
 * 「日付の欄だけ選べる」という決まりを**何も確かめないまま**撮れてしまう。
 */
export const FRIEND_FIELDS = [
  {
    id: 'field-birthday', folderId: null, name: '誕生日', fieldKey: 'birthday',
    type: 'date', options: null, defaultValue: null, source: 'manual',
    ecFieldPath: null, ecIsMaster: false, isPersonal: false, isStarred: true,
    displayOrder: 1, createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z',
  },
  {
    id: 'field-contract-end', folderId: null, name: '契約終了日', fieldKey: 'contract_end',
    type: 'date', options: null, defaultValue: null, source: 'manual',
    ecFieldPath: null, ecIsMaster: false, isPersonal: false, isStarred: false,
    displayOrder: 2, createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z',
  },
  {
    id: 'field-next-delivery', folderId: null, name: '次回お届け日', fieldKey: 'next_delivery',
    type: 'date', options: null, defaultValue: null, source: 'ec',
    ecFieldPath: 'subscription.next_ship_at', ecIsMaster: true, isPersonal: false, isStarred: false,
    displayOrder: 3, createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z',
  },
  {
    id: 'field-plan', folderId: null, name: 'ご契約プラン', fieldKey: 'plan',
    type: 'select', options: ['ライト', 'スタンダード', 'プレミアム'], defaultValue: null,
    source: 'manual', ecFieldPath: null, ecIsMaster: false, isPersonal: false, isStarred: false,
    displayOrder: 4, createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z',
  },
]

/**
 * 機能8 自動応答。設計 `cmDfJ` の5行。
 *
 * **画面が読む形に合わせる。** `packages/shared` の `AutoReply` は
 * `keyword / matchType / responseType / responseContent / isActive` しか
 * 持たないが、画面（`auto-replies/page.tsx`）はそれより広い形を読む
 * （`priority` `folderId` `actions` `responseWeekdays` `hits` など）。
 * 狭いほうに合わせて書くと、優先順位も曜日も当たり回数も空のまま撮れて、
 * **設計の一覧と比べるものが何も無くなる。**
 */
export const AUTO_REPLY_FOLDERS = [
  { id: 'arf-inquiry', kind: 'auto_reply', name: 'お問い合わせ', parentId: null, displayOrder: 1, color: '#2563eb' },
  { id: 'arf-booking', kind: 'auto_reply', name: '予約', parentId: null, displayOrder: 2, color: '#059669' },
  { id: 'arf-keyword', kind: 'auto_reply', name: 'キーワード', parentId: null, displayOrder: 3, color: '#d97706' },
  { id: 'arf-afterhours', kind: 'auto_reply', name: '営業時間外', parentId: null, displayOrder: 4, color: '#7c3aed' },
]

const AR_BASE = {
  templateId: null, lineAccountId: null, activeFrom: null, activeUntil: null,
  cooldownMinutes: null, skipWhenOperatorActive: false, messageKinds: null,
  responseWeekdays: null, responseHolidayRule: null, oncePerFriend: false,
  friendConditions: null, respondToAll: false, keywordMatchMode: 'any',
}

export const AUTO_REPLIES = [
  {
    ...AR_BASE, id: 'ar-1', name: '営業時間外の自動返信', keyword: '', matchType: 'contains',
    responseType: 'text', responseContent: '本日の受付は終了しました。翌営業日にご連絡します。',
    isActive: true, priority: 1, folderId: 'arf-afterhours',
    activeFrom: '21:00', activeUntil: '09:00',
    responseWeekdays: [0, 1, 2, 3, 4, 5, 6], respondToAll: true,
    actions: [{ actionType: 'support_mark' }],
    keywords: [], hits: { period: 214, total: 1893 },
    createdAt: '2026-03-04T00:00:00.000Z',
  },
  {
    ...AR_BASE, id: 'ar-2', name: '予約変更のお問い合わせ', keyword: '予約変更', matchType: 'contains',
    responseType: 'text', responseContent: '予約変更を承ります。ご希望の日時をこのトークでお知らせください。',
    isActive: true, priority: 2, folderId: 'arf-booking', templateId: 'template-1',
    keywords: [{ word: '予約変更' }, { word: '日程変更' }, { word: 'キャンセル' }],
    actions: [{ actionType: 'support_mark' }],
    hits: { period: 186, total: 942 }, createdAt: '2026-04-18T00:00:00.000Z',
  },
  {
    ...AR_BASE, id: 'ar-3', name: '商品についての質問', keyword: '商品', matchType: 'contains',
    responseType: 'text', responseContent: '商品についてのご質問ありがとうございます。',
    isActive: true, priority: 3, folderId: 'arf-inquiry',
    keywords: [{ word: '商品' }, { word: '価格' }, { word: '在庫' }, { word: 'サイズ' }, { word: '送料' }],
    actions: [{ actionType: 'tag' }],
    hits: { period: 152, total: 733 }, createdAt: '2026-05-06T00:00:00.000Z',
  },
  {
    /* 下書き。**当たった回数は0。** 「一度も当たっていない」と
       「まだ動かしていない」は違うので、0で撮れることが要る。 */
    ...AR_BASE, id: 'ar-4', name: 'キャンセル受付', keyword: 'キャンセル', matchType: 'contains',
    responseType: 'text', responseContent: 'キャンセルを承りました。',
    isActive: false, priority: 4, folderId: 'arf-booking',
    keywords: [{ word: 'キャンセル' }, { word: '取り消し' }],
    actions: [], hits: { period: 0, total: 0 }, createdAt: '2026-08-12T00:00:00.000Z',
  },
  {
    ...AR_BASE, id: 'ar-5', name: '旧キーワードルール', keyword: '営業時間', matchType: 'exact',
    responseType: 'text', responseContent: '平日 09:00〜18:00 です。',
    isActive: false, priority: 5, folderId: 'arf-keyword',
    keywords: [{ word: '営業時間' }],
    actions: [], hits: { period: 0, total: 411 }, createdAt: '2026-01-20T00:00:00.000Z',
  },
]

/*
  外部連携。設計 `k3WxrO` の「こちらから送る 6／こちらで受け取る 3」そのまま。

  **つなぎ先はサービス名で持つ。** 設計は Slack・Googleスプレッドシート・kintone と
  相手の名前で見せる。`Webhook` は仕組みの名前で、運用者が探すときの手がかりにならない。
  URLは設計と同じく途中を伏せる（実在しない作り物）。
*/
export const OUTGOING_WEBHOOKS = [
  {
    id: 'owh-slack-order', name: 'Slack ／ #注文チャンネル',
    url: 'https://hooks.slack.com/services/T0XXXXXXXXX/BXXXXXXXXX/visual-qa',
    eventTypes: ['conversion.confirmed'], hasSecret: true, isActive: true,
    maxRetries: 3, consecutiveFailures: 2, lastFailedAt: '2026-08-24T05:12:00.000Z',
    createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-08-24T05:12:00.000Z',
  },
  {
    id: 'owh-sheets', name: 'Googleスプレッドシート ／ 顧客台帳',
    url: 'https://script.google.com/macros/s/visual-qa/exec',
    eventTypes: ['friend.added'], hasSecret: true, isActive: true,
    maxRetries: 3, consecutiveFailures: 0, lastFailedAt: null,
    createdAt: '2026-03-10T00:00:00.000Z', updatedAt: '2026-08-25T02:30:00.000Z',
  },
  {
    id: 'owh-kintone', name: 'kintone ／ 案件アプリ',
    url: 'https://visual-qa.cybozu.com/k/v1/record.json',
    eventTypes: ['form.submitted'], hasSecret: true, isActive: true,
    maxRetries: 3, consecutiveFailures: 0, lastFailedAt: null,
    createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-08-25T01:10:00.000Z',
  },
  {
    id: 'owh-chatwork', name: 'Chatwork ／ 店舗連絡',
    url: 'https://api.chatwork.com/v2/rooms/000000/messages',
    eventTypes: ['booking.created'], hasSecret: true, isActive: true,
    maxRetries: 3, consecutiveFailures: 0, lastFailedAt: null,
    createdAt: '2026-05-20T00:00:00.000Z', updatedAt: '2026-08-23T09:00:00.000Z',
  },
  {
    id: 'owh-zapier', name: 'Zapier ／ 申込のふり分け',
    url: 'https://hooks.zapier.com/hooks/catch/000000/visual-qa/',
    eventTypes: ['form.submitted'], hasSecret: true, isActive: true,
    maxRetries: 3, consecutiveFailures: 0, lastFailedAt: null,
    createdAt: '2026-06-02T00:00:00.000Z', updatedAt: '2026-08-22T04:00:00.000Z',
  },
  {
    /* 設計の「止めているもの 1本」。**合言葉なしの1本**でもある（健全性チェックの「注意」の元）。 */
    id: 'owh-paused', name: 'テスト用の受け口 ／ 検証中',
    url: 'https://example.com/hook/visual-qa',
    eventTypes: ['friend.added'], hasSecret: false, isActive: false,
    maxRetries: 0, consecutiveFailures: 0, lastFailedAt: null,
    createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  },
]

/** 受け取る口。設計 `M0Gb7` の3本。 */
export const INCOMING_WEBHOOKS = [
  {
    id: 'iwh-booking', name: '予約サービスから', sourceType: 'booking',
    hasSecret: true, isActive: true,
    createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
  },
  {
    id: 'iwh-ec', name: 'ECサイトから（注文）', sourceType: 'ec',
    hasSecret: true, isActive: true,
    createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
  },
  {
    id: 'iwh-form', name: '外部フォームから', sourceType: 'form',
    hasSecret: false, isActive: true,
    createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  },
]

/*
  流入経路。設計 `Q4bkTg` の6本そのまま。

  **`refCode` は運用者が決めてURLに出す符号**なので、値は設計の `summer-ig` などを使う。
  出してはいけないのは列名のほう（`v6-no-internal-ids.test.ts` が見張っている）。
*/
export const ENTRY_ROUTES = [
  { id: 'er-1', refCode: 'summer-ig', genre: 'SNS', name: '夏のInstagram投稿', tagId: 'tag-vip', scenarioId: 'scenario-0', redirectUrl: null, poolId: null, introTemplateId: null, runAccountFriendAddScenarios: true, isActive: true, createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-25T00:12:00.000Z' },
  { id: 'er-2', refCode: 'tanaka01', genre: '紹介', name: '紹介リンク 田中 明', tagId: null, scenarioId: 'scenario-0', redirectUrl: null, poolId: null, introTemplateId: null, runAccountFriendAddScenarios: true, isActive: true, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-24T09:40:00.000Z' },
  { id: 'er-3', refCode: 'shop-pop', genre: '店頭', name: '店頭POPのQRコード', tagId: null, scenarioId: 'scenario-0', redirectUrl: null, poolId: null, introTemplateId: null, runAccountFriendAddScenarios: true, isActive: true, createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-08-25T02:30:00.000Z' },
  { id: 'er-4', refCode: 'g-ads-summer', genre: '広告', name: 'Google広告 夏キャンペーン', tagId: null, scenarioId: null, redirectUrl: null, poolId: null, introTemplateId: null, runAccountFriendAddScenarios: false, isActive: true, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z' },
  { id: 'er-5', refCode: 'mail-sign', genre: 'メール', name: 'メール署名', tagId: null, scenarioId: null, redirectUrl: null, poolId: null, introTemplateId: null, runAccountFriendAddScenarios: false, isActive: true, createdAt: '2026-02-14T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z' },
  { id: 'er-6', refCode: 'flyer-spring', genre: '紙', name: 'チラシ（2026春）', tagId: null, scenarioId: 'scenario-0', redirectUrl: null, poolId: null, introTemplateId: null, runAccountFriendAddScenarios: true, isActive: false, createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-06-30T00:00:00.000Z' },
]

/*
  ログインユーザー。設計 `e3jz3` の並びそのまま。

  **2段階の確認を入れていない人を混ぜる**（設計の帯「2段階の確認 6／8人」）。
  全員 true にすると、帯が「全員入れています」に化けて、見張りたい状態が撮れない。
*/
export const STAFF_MEMBERS = [
  { id: 'stf-1', name: '佐々木 亮太', email: 'sasaki@example.com', role: 'admin', lineLinked: true, twoFactorEnabled: true, isActive: true, permissionKeys: [], notificationPreferences: {}, inviteStatus: 'active', createdAt: '2026-01-10T00:00:00.000Z', updatedAt: '2026-08-25T00:02:00.000Z', assignedLineAccountId: null, canAccessDescendantAccounts: true, accountScope: 'all' },
  { id: 'stf-2', name: '山本 京子', email: 'yamamoto@example.com', role: 'admin', lineLinked: true, twoFactorEnabled: true, isActive: true, permissionKeys: [], notificationPreferences: {}, inviteStatus: 'active', createdAt: '2026-01-10T00:00:00.000Z', updatedAt: '2026-08-24T23:40:00.000Z', assignedLineAccountId: null, canAccessDescendantAccounts: true, accountScope: 'all' },
  { id: 'stf-3', name: '中川 由美', email: 'nakagawa@example.com', role: 'staff', lineLinked: true, twoFactorEnabled: true, isActive: true, permissionKeys: [], notificationPreferences: {}, inviteStatus: 'active', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-08-24T10:00:00.000Z', assignedLineAccountId: 'visual-qa-account', canAccessDescendantAccounts: false, accountScope: 'accounts', scopedLineAccountIds: ['visual-qa-account'] },
  { id: 'stf-4', name: '高田 誠', email: 'takada@example.com', role: 'staff', lineLinked: false, twoFactorEnabled: false, isActive: true, permissionKeys: [], notificationPreferences: {}, inviteStatus: 'active', createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-08-18T10:00:00.000Z', assignedLineAccountId: 'visual-qa-account', canAccessDescendantAccounts: false, accountScope: 'accounts', scopedLineAccountIds: ['visual-qa-account'] },
  { id: 'stf-5', name: '外部デザイン', email: 'design@partner.example.com', role: 'viewer', lineLinked: false, twoFactorEnabled: true, isActive: true, permissionKeys: [], notificationPreferences: {}, inviteStatus: 'active', createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z', assignedLineAccountId: 'visual-qa-account', canAccessDescendantAccounts: false, accountScope: 'accounts', scopedLineAccountIds: ['visual-qa-account'] },
  { /* 設計の「90日 入っていない 1」。 */ id: 'stf-6', name: '佐野 直人', email: 'sano@example.com', role: 'viewer', lineLinked: false, twoFactorEnabled: false, isActive: true, permissionKeys: [], notificationPreferences: {}, inviteStatus: 'active', createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-05-20T10:00:00.000Z', assignedLineAccountId: null, canAccessDescendantAccounts: false, accountScope: 'all' },
  { /* 設計の「招待中 2」。 */ id: 'stf-7', name: '新井 千夏', email: 'arai@example.com', role: 'staff', lineLinked: false, twoFactorEnabled: false, isActive: true, permissionKeys: [], notificationPreferences: {}, inviteStatus: 'pending_email', createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z', assignedLineAccountId: 'visual-qa-account', canAccessDescendantAccounts: false, accountScope: 'accounts', scopedLineAccountIds: ['visual-qa-account'] },
  { id: 'stf-8', name: '森 涼太', email: 'mori@example.com', role: 'staff', lineLinked: false, twoFactorEnabled: false, isActive: true, permissionKeys: [], notificationPreferences: {}, inviteStatus: 'pending_line', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', assignedLineAccountId: 'visual-qa-account', canAccessDescendantAccounts: false, accountScope: 'accounts', scopedLineAccountIds: ['visual-qa-account'] },
]

/*
  入った記録。設計 `jwVlo` は「気になるもの 1」を札で持つので、
  **失敗した記録を1件混ぜる**。全部成功にすると、その札が撮れない。
*/
export const LOGIN_AUDIT = [
  { id: 'la-1', adminUserId: 'stf-1', userName: '佐々木 亮太', role: 'admin', lineLinked: true, isActive: true, action: 'login', screen: null, ip: '203.0.113.10', connectionSource: '社内', result: 'success', createdAt: '2026-08-25T00:02:00.000Z' },
  { id: 'la-2', adminUserId: 'stf-2', userName: '山本 京子', role: 'admin', lineLinked: true, isActive: true, action: 'settings_changed', screen: '機能設定', ip: '203.0.113.11', connectionSource: '社内', result: 'success', createdAt: '2026-08-24T23:41:00.000Z' },
  { id: 'la-3', adminUserId: 'stf-3', userName: '中川 由美', role: 'staff', lineLinked: true, isActive: true, action: 'broadcast_sent', screen: '一斉配信', ip: '203.0.113.12', connectionSource: '社内', result: 'success', createdAt: '2026-08-24T10:05:00.000Z' },
  { id: 'la-4', adminUserId: 'stf-4', userName: '高田 誠', role: 'staff', lineLinked: false, isActive: true, action: 'delete', screen: 'テンプレート', ip: '203.0.113.13', connectionSource: '社外', result: 'success', createdAt: '2026-08-23T08:20:00.000Z' },
  { id: 'la-5', adminUserId: null, userName: '名前を取得できませんでした', role: null, lineLinked: false, isActive: false, action: 'login', screen: null, ip: '198.51.100.7', connectionSource: '社外', result: 'failure', createdAt: '2026-08-22T19:44:00.000Z' },
]
