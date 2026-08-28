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
export const INBOX_SAVED_VIEWS = [
  ['VIPかつ未契約', true],
  ['未対応・担当なし', true],
  ['自分の未対応', false],
].map(([name, isShared], index) => ({
  id: `inbox-view-${index}`,
  name: String(name),
  scope: 'chats',
  conditions: { all: [], any: [] },
  createdBy: 'Kenta',
  lineAccountId: 'visual-qa-account',
  isShared: Boolean(isShared),
  displayOrder: index,
  createdAt: '2026-08-17T03:00:00.000Z',
}))

/**
 * 重複検出の数（設計 `YzxU1`）。
 *
 * `{items,total}` で返していたあいだ、重複検出のタブは
 * `perAccount.length` を読んで落ち、**画面ごと「表示できませんでした」**に
 * なっていた。数の形が違うだけで、タブが1つ丸ごと開けない。
 */
export const DUPLICATE_STATS = {
  totalFollowing: 231,
  uniquePeople: 214,
  friendDups: 17,
  duplicateGroups: 8,
  wastedPerBroadcastYen: 51,
  msgUnitYen: 3,
  perAccount: [
    { accountId: 'visual-qa-account', accountName: '画面確認アカウント', friends: 231, dups: 17, dupRate: 0.074 },
  ],
  pairwiseOverlap: [],
  computedAt: '2026-08-19T03:00:00.000Z',
}

/**
 * 統合ユーザー（設計 `r7eSi`）。
 *
 * `{items,total}` で返していたあいだ、タブは `rows` を回そうとして
 * **`rows is not iterable`** で落ちていた。画面ごと開けない。
 *
 * 3件のうち1件は2アカウントに重複している人（`isDuplicate`）。
 * **重複を1件も入れないと、重複の見え方を確かめられない。**
 */
export const USERS_GROUPED = {
  total: 3,
  page: 1,
  pageSize: 20,
  computedAt: '2026-08-19T03:00:00.000Z',
  rows: [
    ['Kyohei Yamamoto', 'url_token', true, ['kyohei@example.com'], ['090-0000-0001']],
    ['Kenta Kawano (Obama)', 'uid', false, ['kenta@example.com'], []],
    ['菅野 亮', 'solo', false, [], ['090-0000-0003']],
  ].map(([displayName, kind, isDuplicate, emails, phones], index) => ({
    identityKey: `identity-${index}`,
    identityKeyKind: String(kind),
    displayName: String(displayName),
    pictureUrl: null,
    accounts: (isDuplicate ? [0, 1] : [0]).map((n) => ({
      accountId: n === 0 ? 'visual-qa-account' : 'visual-qa-account-2',
      accountName: n === 0 ? '画面確認アカウント' : '画面確認アカウント（2）',
      lineUserId: `U${index}${n}0000000000000000000000000000`,
      isFollowing: true,
      joinedAt: '2026-08-13T00:00:00.000Z',
      friendId: `friend-${index}`,
    })),
    xUsername: null,
    emails,
    phones,
    lastActivityAt: '2026-08-19T03:00:00.000Z',
    isDuplicate: Boolean(isDuplicate),
  })),
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
/**
 * 友だち情報欄の帯（`/api/friend-fields-stats`）。**型は
 * `FriendFieldListSummary`。** 一覧の既定（`{items,total,page,limit}`）を
 * 返すと `summary.inUse` が無く、「使用中 undefined件」と撮れる。
 *
 * `formLinks` は `number | null` で、**null は未取得**。実装はそのとき
 * 単位を消して「未取得」と出す（`field-list.tsx:103`）。回答フォームに
 * アカウント所属が付くまで件数は出せない、と実装自身が書いているので
 * （表の「回答フォーム」列の `title`）、ここは `null` にして
 * **未取得の道が通ることを撮る。**
 */
export const FRIEND_FIELD_SUMMARY = {
  total: 4,
  inUse: 4,
  registeredFriends: 187,
  formLinks: null,
  updatedThisMonth: 3,
}

export const FRIEND_FIELDS = [
  {
    id: 'field-birthday', folderId: null, name: '誕生日', fieldKey: 'birthday',
    type: 'date', options: null, defaultValue: null, source: 'manual',
    ecFieldPath: null, ecIsMaster: false, isPersonal: false, isStarred: true,
    displayOrder: 1, createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z',
    usageCount: 187,
  },
  {
    id: 'field-contract-end', folderId: null, name: '契約終了日', fieldKey: 'contract_end',
    type: 'date', options: null, defaultValue: null, source: 'manual',
    ecFieldPath: null, ecIsMaster: false, isPersonal: false, isStarred: false,
    displayOrder: 2, createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z',
    usageCount: 164,
  },
  {
    id: 'field-next-delivery', folderId: null, name: '次回お届け日', fieldKey: 'next_delivery',
    type: 'date', options: null, defaultValue: null, source: 'ec',
    ecFieldPath: 'subscription.next_ship_at', ecIsMaster: true, isPersonal: false, isStarred: false,
    displayOrder: 3, createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z',
    usageCount: 141,
  },
  {
    id: 'field-plan', folderId: null, name: 'ご契約プラン', fieldKey: 'plan',
    type: 'select', options: ['ライト', 'スタンダード', 'プレミアム'], defaultValue: null,
    source: 'manual', ecFieldPath: null, ecIsMaster: false, isPersonal: false, isStarred: false,
    displayOrder: 4, createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z',
    usageCount: 72,
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

/**
 * 機能9 友だち追加時の配信。設計 `uLQQc`。
 *
 * 実装は**1アカウントに1枚の設定**（`FriendAddRouting`）で、
 * ①はじめて追加した人 と ②以前からの友だち・ブロック解除した人 の
 * 2つに分かれます。設計の「流入リンクごとに複数の初回案内を並べる」形とは
 * 別物なので、行を並べる固定データは作れません。
 * **無いものを在るように見せるより、実装の形で撮って差を書きます。**
 */
export const FRIEND_ADD_ROUTING = {
  firstTime: {
    scenarioId: 'scenario-0',
    timing: 'immediate',
    actions: [
      /*
        **`tagId` ではなく `tagIds`（配列）。** 画面は `c.tagIds` を読む
        （`friend-add-settings/page.tsx:633`）。単数で書くと札が「タグ「?」を
        付ける」になり、**実装の不具合に見える。** 実際はこちらの書き方が違うだけ。
      */
      { kind: 'row', actionType: 'tag', config: { tagIds: ['tag-0'], op: 'add' } },
      { kind: 'row', actionType: 'scenario', config: { scenarioId: 'scenario-1', op: 'start' } },
    ],
  },
  returning: {
    scenarioId: 'scenario-1',
    mode: 'other',
    startPosition: 'beginning',
    actions: [{ kind: 'row', actionType: 'support_mark', config: { markId: 'mark-1' } }],
  },
  criteria: { firstTime: 'unfollow_count_zero' },
}

/** 設計 `uLQQc` の帯: 直近7日の追加86人・経路が取れた74人・分からなかった12人。 */
export const FRIEND_ADD_BREAKDOWN = { days: 7, firstTime: 74, returning: 9, unblocked: 3 }

/**
 * 友だち追加の履歴。**`{items,total,page,limit}` ではない。**
 * 画面は `summary` を読んで帯を描き、`nextCursor` で続きを取る。
 */
export const FRIEND_ADD_EVENTS = {
  items: [
    {
      id: 'fae-1', friendId: 'friend-1', displayName: 'Kenta Kawano', pictureUrl: null,
      kind: 'first_time', isUnblockedHint: false, attributionStatus: 'captured',
      refCode: 'store-qr', entryRouteId: 'route-qr', entryRouteName: '店頭QRコード',
      routingStatus: 'completed',
      occurredAt: '2026-08-22T00:14:00.000Z', processedAt: '2026-08-22T00:14:03.000Z',
    },
    {
      id: 'fae-2', friendId: 'friend-2', displayName: 'Masato S.', pictureUrl: null,
      kind: 'first_time', isUnblockedHint: false, attributionStatus: 'captured',
      refCode: 'ig-profile', entryRouteId: 'route-ad', entryRouteName: 'Instagramプロフィール',
      routingStatus: 'completed',
      occurredAt: '2026-08-22T01:05:00.000Z', processedAt: '2026-08-22T01:05:02.000Z',
    },
    {
      /* 経路が取れなかった人。**素のQR・検索から来ると `refCode` が付かない。** */
      id: 'fae-3', friendId: 'friend-3', displayName: '菅野 亮', pictureUrl: null,
      kind: 'first_time', isUnblockedHint: false, attributionStatus: 'unavailable',
      refCode: null, entryRouteId: null, entryRouteName: null,
      routingStatus: 'completed',
      occurredAt: '2026-08-22T02:21:00.000Z', processedAt: '2026-08-22T02:21:01.000Z',
    },
    {
      /* 以前からの友だち。ここを分けないと「はじめまして」が届く。 */
      id: 'fae-4', friendId: 'friend-4', displayName: '山田 太郎', pictureUrl: null,
      kind: 'returning', isUnblockedHint: true, attributionStatus: 'captured',
      refCode: 'referral', entryRouteId: 'route-referral', entryRouteName: '紹介キャンペーン',
      routingStatus: 'suppressed',
      occurredAt: '2026-08-21T09:42:00.000Z', processedAt: '2026-08-21T09:42:01.000Z',
    },
    {
      /* 失敗。**「まだ」と「もうだめ」は別。** */
      id: 'fae-5', friendId: 'friend-5', displayName: '佐藤 花子', pictureUrl: null,
      kind: 'first_time', isUnblockedHint: false, attributionStatus: 'captured',
      refCode: 'store-qr', entryRouteId: 'route-qr', entryRouteName: '店頭QRコード',
      routingStatus: 'failed',
      occurredAt: '2026-08-21T11:20:00.000Z', processedAt: null,
    },
  ],
  summary: { total: 86, firstTime: 74, returning: 12, captured: 74, unavailable: 12, pending: 0, failed: 2 },
  nextCursor: null,
}

/**
 * 機能10 ウェビナー。設計 `ZC13r` の一覧。
 *
 * **画面が読む `Webinar`（`apps/web/src/lib/api.ts`）に合わせる。**
 * `schedule` は `{type:'daily'|'weekly'|'once'}` の配列で、
 * 画面はそこを `filter` して開催の言い方を組み立てる。**通で返すと落ちる。**
 */
export const WEBINARS = [
  {
    id: 'webinar-1', accountId: null, title: 'NEN活用スタートセミナー', slug: 'nen-start',
    status: 'active', videoPrefix: 'nen-start-seminar', durationSeconds: 2538,
    schedule: [{ type: 'daily', time: '10:00' }, { type: 'daily', time: '19:00' }],
    cta: { label: '個別相談を予約する', url: 'https://example.com/booking', showAtSeconds: 1920 },
    tagOnAttend: 'tag-0', tagOnCtaClick: 'tag-1',
    createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'webinar-2', accountId: null, title: '予約機能の使い方', slug: 'booking-howto',
    status: 'active', videoPrefix: 'booking-howto', durationSeconds: 1284,
    schedule: [{ type: 'weekly', time: '20:00', days: [2, 4] }],
    cta: { label: '空き枠を見る', url: 'https://example.com/slots', showAtSeconds: 900 },
    tagOnAttend: 'tag-2', tagOnCtaClick: null,
    createdAt: '2026-06-11T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
  },
  {
    id: 'webinar-3', accountId: null, title: '導入事例まとめ', slug: 'case-studies',
    status: 'active', videoPrefix: 'case-studies', durationSeconds: 1860,
    schedule: [{ type: 'once', at: '2026-08-25T02:00:00.000Z' }],
    cta: null, tagOnAttend: null, tagOnCtaClick: null,
    createdAt: '2026-05-30T00:00:00.000Z', updatedAt: '2026-08-05T00:00:00.000Z',
  },
  {
    /* 下書き。**動画も日程もまだ無い。** ここが空でも一覧が崩れないことが要る。 */
    id: 'webinar-4', accountId: null, title: '新プラン説明会', slug: 'new-plan',
    status: 'draft', videoPrefix: null, durationSeconds: 0,
    schedule: [], cta: null, tagOnAttend: null, tagOnCtaClick: null,
    createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
  },
  {
    id: 'webinar-5', accountId: null, title: '旧機能説明会', slug: 'legacy-features',
    status: 'archived', videoPrefix: 'legacy-features', durationSeconds: 3120,
    schedule: [], cta: null, tagOnAttend: null, tagOnCtaClick: null,
    createdAt: '2026-02-14T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
  },
]

/** 設計 `Q8sHa`・`yxyzQ` の数。申込184・再生142・完了96・CTA52。 */
export const WEBINAR_ANALYTICS = {
  summary: {
    reservations: 184, viewers: 142, registeredAndJoined: 128,
    watched5m: 131, watched15m: 112, completed: 96,
    avgWatchedSeconds: 1722, ctaClicks: 52, formSubmissions: 28,
  },
  daily: [
    { date: '2026-08-18', reservations: 22, viewers: 18, ctaClicks: 6, formSubmissions: 3 },
    { date: '2026-08-19', reservations: 31, viewers: 25, ctaClicks: 9, formSubmissions: 5 },
    { date: '2026-08-20', reservations: 28, viewers: 21, ctaClicks: 8, formSubmissions: 4 },
    { date: '2026-08-21', reservations: 35, viewers: 28, ctaClicks: 11, formSubmissions: 6 },
    { date: '2026-08-22', reservations: 26, viewers: 20, ctaClicks: 7, formSubmissions: 4 },
  ],
  /*
    ここから下は **`WebinarAnalytics` に在って、`summary` と `daily` だけでは
    足りない**もの。画面は `dropoff` `participants` `formFunnel` を
    そのまま `map` するので、無いと編集画面ごと落ちる。
  */
  participants: [
    {
      friendId: 'friend-1', friendName: 'Kenta Kawano', pictureUrl: null, sessions: 2,
      firstJoinedAt: '2026-08-20T01:00:00.000Z', latestJoinedAt: '2026-08-22T01:32:00.000Z',
      maxWatchedSeconds: 2538, ctaClickedAt: '2026-08-22T01:58:00.000Z',
      registered: true, formSubmittedAt: '2026-08-22T02:01:00.000Z',
    },
    {
      friendId: 'friend-2', friendName: 'Masato S.', pictureUrl: null, sessions: 1,
      firstJoinedAt: '2026-08-21T10:00:00.000Z', latestJoinedAt: '2026-08-21T10:00:00.000Z',
      maxWatchedSeconds: 1980, ctaClickedAt: '2026-08-21T10:28:00.000Z',
      registered: true, formSubmittedAt: null,
    },
    {
      /* 未視聴。**申し込んだが再生していない人**が居ることが要る。 */
      friendId: 'friend-3', friendName: '菅野 亮', pictureUrl: null, sessions: 0,
      firstJoinedAt: '2026-08-19T00:00:00.000Z', latestJoinedAt: '2026-08-19T00:00:00.000Z',
      maxWatchedSeconds: 0, ctaClickedAt: null, registered: true, formSubmittedAt: null,
    },
    {
      /* 途中で離脱。18分20秒で止まっている（設計の「最大離脱」）。 */
      friendId: 'friend-4', friendName: '山田 太郎', pictureUrl: null, sessions: 1,
      firstJoinedAt: '2026-08-22T10:00:00.000Z', latestJoinedAt: '2026-08-22T10:00:00.000Z',
      maxWatchedSeconds: 1100, ctaClickedAt: null, registered: false, formSubmittedAt: null,
    },
  ],
  sessions: [
    { sessionStartAt: 1755648000, viewers: 62, avgWatchedSeconds: 1810, ctaClicks: 24 },
    { sessionStartAt: 1755680400, viewers: 48, avgWatchedSeconds: 1642, ctaClicks: 17 },
    { sessionStartAt: 1755734400, viewers: 32, avgWatchedSeconds: 1585, ctaClicks: 11 },
  ],
  /* 設計 `yxyzQ`「最大離脱 18分20秒：機能説明パート」に合わせて谷を作る。 */
  dropoff: [
    { bucketStart: 0, viewers: 142 }, { bucketStart: 300, viewers: 138 },
    { bucketStart: 600, viewers: 131 }, { bucketStart: 900, viewers: 124 },
    { bucketStart: 1100, viewers: 118 }, { bucketStart: 1200, viewers: 74 },
    { bucketStart: 1500, viewers: 108 }, { bucketStart: 1800, viewers: 102 },
    { bucketStart: 2100, viewers: 98 }, { bucketStart: 2400, viewers: 96 },
  ],
  formFunnel: {
    ctaImpressions: 118, ctaClicks: 52, formOpens: 48, formStarts: 41,
    submitAttempts: 31, submitSuccesses: 28, submitErrors: 3,
    fieldCompletions: [
      { fieldName: 'お名前', users: 41 },
      { fieldName: 'メールアドレス', users: 36 },
      { fieldName: 'ご相談内容', users: 29 },
    ],
  },
}

/**
 * 機能11 テンプレートの、メッセージ以外の4種。設計 `W7LBc` のタブの数
 * （カルーセル24・リッチメッセージ10・クーポン6・リサーチ4）に合わせる。
 *
 * **`kind` は4つの決まった言葉だけ**（`BroadcastAssetKind`）。
 * 設計の見出し（「カルーセル」）をそのまま入れるとタブの数が0のままになり、
 * **どのタブも空で撮れる。**
 */
export const BROADCAST_MESSAGE_ASSETS = [
  ...Array.from({ length: 24 }, (_, i) => ({
    id: `asset-card-${i + 1}`, lineAccountId: null, kind: 'card_message',
    name: i === 0 ? '夏の定番5点' : `カルーセル ${i + 1}`,
    payload: { panels: [{ title: '夏の定番セット（送料込み）', body: 'この夏いちばん出ているセットです。' }] },
    createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `asset-rich-${i + 1}`, lineAccountId: null, kind: 'rich_message',
    name: i === 0 ? '夏のキャンペーン告知' : `リッチメッセージ ${i + 1}`,
    payload: { layout: '4', areas: [] },
    createdAt: '2026-06-05T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z',
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `asset-coupon-${i + 1}`, lineAccountId: null, kind: 'coupon',
    name: i === 0 ? '夏の20%オフ' : `クーポン ${i + 1}`,
    payload: { from: '2026-08-25T00:00', to: '2026-09-30T23:59', useLimit: 'once' },
    createdAt: '2026-07-02T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `asset-research-${i + 1}`, lineAccountId: null, kind: 'research',
    name: i === 0 ? '定期便のご満足度' : `リサーチ ${i + 1}`,
    payload: { questions: [] },
    createdAt: '2026-07-11T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
  })),
]

/**
 * 機能12 リッチメニュー。設計 `GO8RQ` の一覧。
 *
 * **画面が読む形（`RichMenuGroupListItem`）に合わせる。**
 * `status` は `'draft' | 'published'` の2つだけで、設計の「予約」は
 * この型に無い（下の design-qa に書いた食い違い）。
 */
export const RICH_MENU_FOLDERS = [
  { id: 'rmf-member', kind: 'rich_menu', name: '01_会員向け', parentId: null, displayOrder: 1, color: '#2563eb' },
  { id: 'rmf-campaign', kind: 'rich_menu', name: '02_キャンペーン', parentId: null, displayOrder: 2, color: '#d97706' },
  { id: 'rmf-store', kind: 'rich_menu', name: '03_店舗別', parentId: null, displayOrder: 3, color: '#059669' },
]

export const RICH_MENU_GROUPS = [
  {
    id: 'rmg-1', accountId: 'visual-qa-account', name: '通常メニュー（会員向け）',
    chatBarText: 'メニュー', size: 'large', defaultPageId: 'rmp-1',
    isDefaultForAll: true, status: 'published', publishingAt: null,
    targetingCondition: null, targetingPriority: 3, targetingEnabled: false,
    folderId: 'rmf-member', displayOrder: 1, thumbnailR2Key: null,
    updatedAt: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'rmg-2', accountId: 'visual-qa-account', name: '夏キャンペーン',
    chatBarText: 'キャンペーン', size: 'large', defaultPageId: 'rmp-2',
    isDefaultForAll: false, status: 'published', publishingAt: '2026-08-25T01:00:00.000Z',
    targetingCondition: JSON.stringify({ match: 'all', rules: [{ field: 'tag', op: 'contains', value: 'ゴールド' }] }),
    targetingPriority: 1, targetingEnabled: true,
    folderId: 'rmf-campaign', displayOrder: 2, thumbnailR2Key: null,
    updatedAt: '2026-08-22T00:00:00.000Z',
  },
  {
    id: 'rmg-3', accountId: 'visual-qa-account', name: '会員ランク上位',
    chatBarText: 'メニュー', size: 'large', defaultPageId: 'rmp-3',
    isDefaultForAll: false, status: 'published', publishingAt: null,
    targetingCondition: JSON.stringify({ match: 'all', rules: [{ field: 'purchase_count', op: 'gte', value: 3 }] }),
    targetingPriority: 2, targetingEnabled: true,
    folderId: 'rmf-member', displayOrder: 3, thumbnailR2Key: null,
    updatedAt: '2026-08-18T00:00:00.000Z',
  },
  {
    /* 下書き。**画像も条件も無い。** ここが空でも一覧が崩れないことが要る。 */
    id: 'rmg-4', accountId: 'visual-qa-account', name: '店舗A限定メニュー',
    chatBarText: 'メニュー', size: 'compact', defaultPageId: null,
    isDefaultForAll: false, status: 'draft', publishingAt: null,
    targetingCondition: null, targetingPriority: 4, targetingEnabled: false,
    folderId: 'rmf-store', displayOrder: 4, thumbnailR2Key: null,
    updatedAt: '2026-08-15T00:00:00.000Z',
  },
]

/** 設計 `GO8RQ` の「今月のタップ 12,480回」。 */
export const RICH_MENU_TAP_STATS = {
  from: '2026-08-01', to: '2026-08-31',
  byArea: [
    { areaId: 'rma-1', groupId: 'rmg-1', pageId: 'rmp-1', label: '商品を見る', taps: 4820, viaTrackedLink: 3110 },
    { areaId: 'rma-2', groupId: 'rmg-1', pageId: 'rmp-1', label: '予約する', taps: 3960, viaTrackedLink: 2402 },
    { areaId: 'rma-3', groupId: 'rmg-2', pageId: 'rmp-2', label: 'キャンペーン', taps: 2180, viaTrackedLink: 1508 },
    /* 消したボタン。**名前が null になる。** 消しても数は残る。 */
    { areaId: 'rma-4', groupId: 'rmg-3', pageId: 'rmp-3', label: null, taps: 1520, viaTrackedLink: 0 },
  ],
  byGroup: [
    { groupId: 'rmg-1', taps: 12480 },
    { groupId: 'rmg-2', taps: 2180 },
    { groupId: 'rmg-3', taps: 1520 },
    { groupId: 'rmg-4', taps: 0 },
  ],
  total: 16180,
}

/**
 * 管理画面の外にあるメニュー（設計 `TL7tp`）。
 * LINE公式マネージャーで作ったもので、こちらに取り込んでいないもの。
 */
export const RICH_MENU_EXTERNAL = {
  currentDefault: 'richmenu-line-1',
  lineMenus: [
    {
      richMenuId: 'richmenu-line-1', name: 'LINE公式マネージャーで作成', chatBarText: 'メニュー',
      size: { width: 2500, height: 1686 }, areasCount: 6,
      isCurrentDefault: true, adminManaged: false, adminInfo: null,
    },
    {
      richMenuId: 'richmenu-line-2', name: '旧ツールの会員メニュー', chatBarText: 'メニュー',
      size: { width: 2500, height: 1686 }, areasCount: 4,
      isCurrentDefault: false, adminManaged: false, adminInfo: null,
    },
    {
      /* 取り込み済み。**こちらに持ち主がいる。** */
      richMenuId: 'richmenu-line-3', name: 'テスト用（名前なし）', chatBarText: 'メニュー',
      size: { width: 2500, height: 843 }, areasCount: 1,
      isCurrentDefault: false, adminManaged: true,
      adminInfo: { groupId: 'rmg-1', groupName: '通常メニュー（会員向け）', pageName: 'トップ', groupStatus: 'published' },
    },
  ],
}

/**
 * リッチメニュー1枚ぶんの中身（`/api/rich-menu-groups/:id`）。
 *
 * **`pages` と `areas` を通で付ける。** 一覧の既定（`{items,…}`）を返すと
 * 編集画面が `pages[0]` を見て落ちる。設計 `DIUbO` の切替3枚
 * （トップ→商品を見る→予約する）に合わせた。
 */
const rmArea = (id, x, y, w, h, label, actionType, actionData, intent) => ({
  id, boundsX: x, boundsY: y, boundsWidth: w, boundsHeight: h,
  actionType, actionData, intent, label,
  tagIds: [], scoreChange: null, templateId: null, formId: null, trackedLinkId: null,
})

/** 大サイズ 2500x1686 を6面に割る。 */
const sixAreas = (prefix) => [
  rmArea(`${prefix}-a`, 0, 0, 833, 843, '商品を見る', 'uri', { uri: 'https://example.co.jp/menu' }, 'url'),
  rmArea(`${prefix}-b`, 833, 0, 833, 843, '予約する', 'message', { text: '予約したい' }, 'text'),
  rmArea(`${prefix}-c`, 1666, 0, 834, 843, 'お問い合わせ', 'message', { text: '問い合わせ' }, 'text'),
  rmArea(`${prefix}-d`, 0, 843, 833, 843, 'マイページ', 'uri', { uri: 'https://example.co.jp/mypage' }, 'url'),
  rmArea(`${prefix}-e`, 833, 843, 833, 843, 'クーポン', 'uri', { uri: 'https://example.co.jp/coupon' }, 'url'),
  /* 設計 `UMiJ9` の公開前チェック「面 F のアクションが未設定です」。 */
  rmArea(`${prefix}-f`, 1666, 843, 834, 843, null, 'message', {}, null),
]

export const RICH_MENU_GROUP_DETAILS = {
  'rmg-1': {
    ...(() => {
      const g = RICH_MENU_GROUPS[0]
      return { ...g, createdAt: '2026-06-01T00:00:00.000Z' }
    })(),
    pages: [
      {
        id: 'rmp-1', orderIndex: 0, name: 'トップ', aliasId: 'top',
        lineRichmenuId: 'richmenu-top', imageR2Key: 'rm/top.png', imageContentType: 'image/png',
        areas: sixAreas('rma-top'),
      },
      {
        id: 'rmp-2', orderIndex: 1, name: '商品を見る', aliasId: 'products',
        lineRichmenuId: 'richmenu-products', imageR2Key: 'rm/products.png', imageContentType: 'image/png',
        areas: sixAreas('rma-products'),
      },
      {
        /* 設計 `DIUbO`「『予約する』からトップへ戻るタブがありません」。 */
        id: 'rmp-3', orderIndex: 2, name: '予約する', aliasId: 'booking',
        lineRichmenuId: null, imageR2Key: null, imageContentType: null,
        areas: sixAreas('rma-booking'),
      },
    ],
  },
}

/**
 * 機能13 回答フォーム。設計 `EMBIK` の一覧。
 *
 * **一覧が読む形（`form-submissions/page.tsx` の `Form`）に合わせる。**
 * `fields` は `{name,label,type}` の配列で、通で返さないと
 * 回答の列見出しが組み立てられない。
 */
export const FORMS = [
  {
    id: 'form-1', name: '来店アンケート', description: '来店後に感想と次回の希望を聞く',
    fields: [
      { name: 'name', label: 'お名前', type: 'text' },
      { name: 'satisfaction', label: 'ご満足度', type: 'radio' },
      { name: 'good_points', label: 'よかったところ', type: 'checkbox' },
      { name: 'comment', label: 'ご意見・ご要望', type: 'textarea' },
      { name: 'next_visit', label: '次回のご来店予定', type: 'date' },
    ],
    isActive: true, submitCount: 1284,
    createdAt: '2026-05-02T00:00:00.000Z', lastSubmittedAt: '2026-08-24T05:22:00.000Z',
    usedByAccounts: [],
  },
  {
    id: 'form-2', name: '資料請求', description: '名前と連絡先',
    fields: [
      { name: 'name', label: 'お名前', type: 'text' },
      { name: 'email', label: 'メールアドレス', type: 'email' },
      { name: 'tel', label: '電話番号', type: 'tel' },
      { name: 'company', label: '会社名', type: 'text' },
      { name: 'interest', label: 'ご関心のある内容', type: 'checkbox' },
    ],
    isActive: true, submitCount: 468,
    createdAt: '2026-04-14T00:00:00.000Z', lastSubmittedAt: '2026-08-23T02:10:00.000Z',
    usedByAccounts: [],
  },
  {
    id: 'form-3', name: '休止の理由', description: '定期便を止めたい人に聞く',
    fields: [
      { name: 'reason', label: '休止の理由', type: 'radio' },
      { name: 'detail', label: 'くわしく', type: 'textarea' },
    ],
    isActive: true, submitCount: 96,
    createdAt: '2026-06-20T00:00:00.000Z', lastSubmittedAt: '2026-08-19T08:00:00.000Z',
    usedByAccounts: [],
  },
  {
    /* 下書き。**まだ1件も答えが無い。** 「未回答」で撮れることが要る。 */
    id: 'form-4', name: '新メニューの好み', description: null,
    fields: [{ name: 'choice', label: 'どれが気になりますか', type: 'radio' }],
    isActive: false, submitCount: 0,
    createdAt: '2026-08-18T00:00:00.000Z', lastSubmittedAt: null,
    usedByAccounts: [],
  },
]

/** 設計 `v9tYhl` の「集まった回答」。 */
export const FORM_SUBMISSIONS = [
  {
    id: 'sub-1', formId: 'form-1', friendId: 'friend-4', friendName: '山田 太郎',
    data: {
      name: '山田 太郎', satisfaction: 'とても良かった',
      good_points: ['接客', '味'],
      comment: '接客がとても良かったです。またうかがいます。',
      next_visit: '2026-09-10',
    },
    createdAt: '2026-08-24T05:22:00.000Z',
  },
  {
    id: 'sub-2', formId: 'form-1', friendId: 'friend-5', friendName: '佐藤 花子',
    data: {
      name: '佐藤 花子', satisfaction: '良かった',
      good_points: ['味'], comment: '味は良かったが少し待ちました',
      next_visit: '2026-09-02',
    },
    createdAt: '2026-08-24T02:05:00.000Z',
  },
  {
    /* 自由記入なし。**空欄で撮れることが要る。** */
    id: 'sub-3', formId: 'form-1', friendId: 'friend-6', friendName: '鈴木 一郎',
    data: { name: '鈴木 一郎', satisfaction: 'ふつう', good_points: [], comment: '', next_visit: '' },
    createdAt: '2026-08-23T10:40:00.000Z',
  },
  {
    /* 友だちに結びついていない回答。**匿名で撮れることが要る。** */
    id: 'sub-4', formId: 'form-1', friendId: null, friendName: null,
    data: { name: '（未記入）', satisfaction: 'あまり', good_points: [], comment: '待ち時間が長かった', next_visit: '' },
    createdAt: '2026-08-22T08:15:00.000Z',
  },
]

/**
 * 設計 `vCqUj` の「来店アンケート」9ブロック。
 *
 * **`FormLayout`（`packages/shared/src/form-layout.ts`）の形どおりに書く。**
 * `version` `header` `sections` `options` の4つが要る。
 * 飾りのブロック（`image` `heading` `text`）と入力欄（`input`）は別の形で、
 * 入力欄は `kind: 'input'` と `type` `name` `label` を持つ。
 * ここを崩すと編集画面が `sections` を回そうとして落ちる。
 */
export const FORM_LAYOUT_VISIT = {
  version: 2,
  header: [],
  sections: [
    {
      id: 's_visit', name: 'セクション1',
      blocks: [
        { id: 'b_img', kind: 'image', mediaUrl: 'https://example.co.jp/header.png', size: 'full' },
        { id: 'b_head', kind: 'heading', text: 'ご来店ありがとうございました', level: 1 },
        { id: 'b_text', kind: 'text', text: '30秒で終わります。よろしければお答えください。' },
        {
          id: 'b_name', kind: 'input', type: 'text', name: 'name', label: 'お名前',
          required: true, placeholder: '山田 太郎',
        },
        {
          id: 'b_sat', kind: 'input', type: 'radio', name: 'satisfaction', label: 'ご満足度',
          required: true, inline: true, choiceMode: 'friendField',
          choiceFriendFieldId: 'field-plan',
          choices: [
            { id: 'c1', label: 'とても良かった', value: 'とても良かった' },
            { id: 'c2', label: '良かった', value: '良かった' },
            { id: 'c3', label: 'ふつう', value: 'ふつう' },
            { id: 'c4', label: 'あまり', value: 'あまり' },
          ],
        },
        {
          id: 'b_good', kind: 'input', type: 'checkbox', name: 'good_points', label: 'よかったところ',
          inline: true, choiceMode: 'tag',
          choices: [
            { id: 'g1', label: '接客', value: '接客' },
            { id: 'g2', label: '味', value: '味' },
            { id: 'g3', label: 'お店の雰囲気', value: 'お店の雰囲気' },
          ],
        },
        {
          id: 'b_comment', kind: 'input', type: 'textarea', name: 'comment',
          label: 'ご意見・ご要望', placeholder: '自由にお書きください',
        },
        {
          /* 設計は、ここに入った日付でリマインダ「来店前日のご案内」が動く。 */
          id: 'b_next', kind: 'input', type: 'date', name: 'next_visit',
          label: '次回のご来店予定', dateStyle: 'calendar',
          reminder: { reminderId: 'reminder-1', time: '18:00' },
        },
        { id: 'b_note', kind: 'text', text: 'このフォームは 然-NEN- TEST が作成しています' },
      ],
    },
  ],
  options: {
    thanksUrl: null, thanksText: 'ご回答ありがとうございました。',
    restorePrevious: false, pageTitle: '来店アンケート',
    submitLabel: '送信する', prevLabel: '前へ', nextLabel: '次へ',
    sectionHeader: 'pageNumber',
    confirmDialog: { enabled: false },
    deadline: { enabled: false },
    oncePerFriend: { enabled: true, message: 'すでにご回答いただいています。' },
    totalLimit: { enabled: false },
    afterActions: [{ kind: 'tag', op: 'add', tagIds: ['tag-0'] }],
  },
}

/**
 * 機能14 共通情報。設計 `WuKzU` の一覧。
 *
 * **`CommonVar` の型どおり。** `type` は `'text'|'url'|'image'|'number'` の
 * 4つで、設計の「差し込みキー」は `varKey` に入る。
 */
export const COMMON_VAR_FOLDERS = [
  { id: 'cvf-shop', kind: 'common_var', name: '01_お店の情報', parentId: null, displayOrder: 1, color: '#2563eb' },
  { id: 'cvf-text', kind: 'common_var', name: '02_案内文の型', parentId: null, displayOrder: 2, color: '#059669' },
  { id: 'cvf-campaign', kind: 'common_var', name: '03_キャンペーン', parentId: null, displayOrder: 3, color: '#d97706' },
]

export const COMMON_VARS = [
  {
    id: 'cv-1', folderId: 'cvf-shop', name: '会社名', varKey: '会社名',
    type: 'text', value: '株式会社NEN',
    createdAt: '2025-11-20T07:40:00.000Z', updatedAt: '2026-08-01T01:12:00.000Z',
  },
  {
    id: 'cv-2', folderId: 'cvf-shop', name: '営業時間', varKey: '営業時間',
    type: 'text', value: '平日 10:00〜19:00／土日祝 休み',
    createdAt: '2025-11-20T07:40:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z',
  },
  {
    id: 'cv-3', folderId: 'cvf-shop', name: '電話番号', varKey: '電話番号',
    type: 'text', value: '03-1234-5678',
    createdAt: '2025-11-20T07:40:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
  },
  {
    /* 設計の帯「中身が空のまま使われているものが1件」。**空で撮れることが要る。** */
    id: 'cv-4', folderId: 'cvf-campaign', name: '今月のキャンペーン', varKey: 'キャンペーン',
    type: 'text', value: '',
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'cv-5', folderId: 'cvf-text', name: '案内文の結び', varKey: '結び',
    type: 'text', value: 'ご不明な点はお気軽にどうぞ。',
    createdAt: '2026-02-10T00:00:00.000Z', updatedAt: '2026-06-05T00:00:00.000Z',
  },
]

/** 日付での切り替え予約。設計の「9/30 を過ぎたら自動で空になります」。 */
export const COMMON_VAR_SCHEDULES = {
  'cv-4': [
    { id: 'cvs-1', varId: 'cv-4', effectiveFrom: '2026-09-30T15:00:00.000Z', value: '', appliedAt: null },
  ],
}

/**
 * 機能15 登録メディア。設計 `g89Tc` の一覧。
 *
 * **`MediaItem` の型どおり。** `kind` は `'image'|'video'|'audio'|'file'` の4つ。
 * 設計の「JPG」「MP4」は `mimeType` から出す表示で、項目名ではない。
 */
export const MEDIA_FOLDERS = [
  { id: 'mf-product', kind: 'media', name: '01_商品写真', parentId: null, displayOrder: 1, color: '#2563eb' },
  { id: 'mf-banner', kind: 'media', name: '02_バナー', parentId: null, displayOrder: 2, color: '#059669' },
  { id: 'mf-video', kind: 'media', name: '03_動画', parentId: null, displayOrder: 3, color: '#d97706' },
]

export const MEDIA_ITEMS = [
  {
    id: 'media-1', folderId: 'mf-product', kind: 'image', filename: '夏の定番セット.jpg',
    mimeType: 'image/jpeg', sizeBytes: 348160, width: 1024, height: 678, durationMs: null,
    url: 'https://example.co.jp/media/summer-set.jpg', uploadedBy: '川野 健太',
    createdAt: '2026-08-18T00:00:00.000Z',
  },
  {
    id: 'media-2', folderId: 'mf-banner', kind: 'image', filename: '会員証バナー.png',
    mimeType: 'image/png', sizeBytes: 839680, width: 2500, height: 1686, durationMs: null,
    url: 'https://example.co.jp/media/member-banner.png', uploadedBy: '川野 健太',
    createdAt: '2026-08-14T00:00:00.000Z',
  },
  {
    /* 動画。**184MB。** 上限に近いものが混ざっていることが要る。 */
    id: 'media-3', folderId: 'mf-video', kind: 'video', filename: '店内のようす.mp4',
    mimeType: 'video/mp4', sizeBytes: 192937984, width: 1920, height: 1080, durationMs: 80000,
    url: 'https://example.co.jp/media/shop.mp4', uploadedBy: '菅野 亮',
    createdAt: '2026-08-10T00:00:00.000Z',
  },
  {
    id: 'media-4', folderId: 'mf-banner', kind: 'image', filename: '誕生月クーポン.png',
    mimeType: 'image/png', sizeBytes: 215040, width: 1029, height: 1029, durationMs: null,
    url: 'https://example.co.jp/media/birthday-coupon.png', uploadedBy: '川野 健太',
    createdAt: '2026-08-05T00:00:00.000Z',
  },
  {
    /* どこでも使っていないファイル。**消してよいものが分かることが要る。** */
    id: 'media-5', folderId: null, kind: 'file', filename: 'メニュー表.pdf',
    mimeType: 'application/pdf', sizeBytes: 1258291, width: null, height: null, durationMs: null,
    url: 'https://example.co.jp/media/menu.pdf', uploadedBy: '菅野 亮',
    createdAt: '2026-07-28T00:00:00.000Z',
  },
  {
    id: 'media-6', folderId: 'mf-product', kind: 'image', filename: '定期便パンフ.jpg',
    mimeType: 'image/jpeg', sizeBytes: 491520, width: 1024, height: 678, durationMs: null,
    url: 'https://example.co.jp/media/subscription.jpg', uploadedBy: '川野 健太',
    createdAt: '2026-07-20T00:00:00.000Z',
  },
]

/** 設計 `voJtX`「使われている場所 3か所」。**空でない使用箇所が要る。** */
export const MEDIA_USAGE = {
  'media-1': [
    { refKind: 'card_message', refId: 'asset-card-1', scannedAt: '2026-08-24T00:00:00.000Z' },
    { refKind: 'broadcast', refId: 'broadcast-2', scannedAt: '2026-08-24T00:00:00.000Z' },
    { refKind: 'rich_menu', refId: 'rmg-2', scannedAt: '2026-08-24T00:00:00.000Z' },
  ],
  'media-2': [
    { refKind: 'rich_menu', refId: 'rmg-1', scannedAt: '2026-08-24T00:00:00.000Z' },
    { refKind: 'template', refId: 'template-1', scannedAt: '2026-08-24T00:00:00.000Z' },
  ],
  'media-3': [{ refKind: 'webinar', refId: 'webinar-1', scannedAt: '2026-08-24T00:00:00.000Z' }],
  'media-4': [{ refKind: 'coupon', refId: 'asset-coupon-1', scannedAt: '2026-08-24T00:00:00.000Z' }],
  'media-5': [],
  'media-6': [
    { refKind: 'template', refId: 'template-2', scannedAt: '2026-08-24T00:00:00.000Z' },
    { refKind: 'template', refId: 'template-3', scannedAt: '2026-08-24T00:00:00.000Z' },
    { refKind: 'card_message', refId: 'asset-card-2', scannedAt: '2026-08-24T00:00:00.000Z' },
    { refKind: 'broadcast', refId: 'broadcast-1', scannedAt: '2026-08-24T00:00:00.000Z' },
    { refKind: 'scenario', refId: 'scenario-0', scannedAt: '2026-08-24T00:00:00.000Z' },
  ],
}

/**
 * 機能16 成果とアフィリエイト。設計 `PouPn`（アフィリエイター12・案件5・
 * 成果承認8・支払い3）に数を合わせる。
 *
 * **`Affiliate`（`packages/shared`）と `AffiliateOffer`・
 * `ConversionApprovalItem`（`apps/web/src/lib/api.ts`）の3つに分かれている。**
 * どれも別の形なので、まとめて1つの固定データにはできない。
 */
export const AFFILIATES = [
  {
    id: 'aff-1', name: '田中 明', code: 'tanaka01', commissionRate: 10, isActive: true,
    email: 'tanaka@example.com', holdDays: 30, payoutCycle: '毎月末締め・翌月末払い',
    notifyOnConversion: true, createdAt: '2026-02-14T00:00:00.000Z',
  },
  {
    id: 'aff-2', name: '合同会社ノース', code: 'north', commissionRate: 0, isActive: true,
    email: 'info@north.example.com', holdDays: 30, payoutCycle: '毎月末締め・翌月末払い',
    notifyOnConversion: false, createdAt: '2025-11-01T00:00:00.000Z',
  },
  {
    id: 'aff-3', name: '木村 亮', code: 'kimura', commissionRate: 15, isActive: true,
    email: null, holdDays: 30, payoutCycle: null,
    notifyOnConversion: true, createdAt: '2026-04-08T00:00:00.000Z',
  },
  {
    /* 止めている人。**成果は残るが新しくは数えない。** */
    id: 'aff-4', name: '旧パートナーA', code: 'legacy-a', commissionRate: 5, isActive: false,
    email: null, holdDays: null, payoutCycle: null,
    notifyOnConversion: false, createdAt: '2025-06-20T00:00:00.000Z',
  },
]

/** 設計 `GH8VL` の案件。**「動きが未設定」を1件混ぜる。** */
export const AFFILIATE_OFFERS = [
  {
    id: 'offer-1', name: '無料体験の申込', description: '体験レッスンに申し込んだら成果',
    rewardAmount: 3000, rewardMiles: 500, mileageProgramId: 'mp-1',
    lineAccountId: null, tagId: 'tag-0', scenarioId: 'scenario-0',
    isActive: true, createdAt: '2026-03-01T00:00:00.000Z',
  },
  {
    id: 'offer-2', name: '定期便の申込', description: '定期便に申し込んだら成果',
    rewardAmount: 8000, rewardMiles: 1000, mileageProgramId: 'mp-1',
    lineAccountId: null, tagId: 'tag-1', scenarioId: null,
    isActive: true, createdAt: '2026-03-01T00:00:00.000Z',
  },
  {
    id: 'offer-3', name: '友だち追加だけ', description: '友だち追加で成果',
    rewardAmount: 300, rewardMiles: 0, mileageProgramId: 'mp-1',
    lineAccountId: null, tagId: 'tag-2', scenarioId: null,
    isActive: true, createdAt: '2026-02-01T00:00:00.000Z',
  },
  {
    /*
      設計 `GH8VL`「動きが未設定の案件 1件・成果が出ても何も起きません」。
      **タグもシナリオも null。** ここが空でも一覧が崩れないことが要る。
    */
    id: 'offer-4', name: '資料請求', description: '資料をダウンロードしたら成果',
    rewardAmount: 1500, rewardMiles: 0, mileageProgramId: 'mp-1',
    lineAccountId: null, tagId: null, scenarioId: null,
    isActive: true, createdAt: '2026-06-11T00:00:00.000Z',
  },
  {
    id: 'offer-5', name: '春の紹介キャンペーン', description: '3月末で終了',
    rewardAmount: 5000, rewardMiles: 0, mileageProgramId: 'mp-1',
    lineAccountId: null, tagId: 'tag-0', scenarioId: null,
    isActive: false, createdAt: '2026-01-15T00:00:00.000Z',
  },
]

/** 設計 `n5VVTb` の承認待ち8件。**重複ありを1件混ぜる。** */
export const CONVERSION_APPROVALS = [
  {
    /* 同じ友だちが同じ案件で2回。**そのまま認めると二重で払う。** */
    eventId: 'cev-1', createdAt: '2026-08-23T10:41:00.000Z',
    friendId: 'friend-4', friendName: '山田 太郎',
    affiliateId: 'aff-3', affiliateName: '木村 亮',
    offerId: 'offer-1', offerName: '無料体験の申込', offerRewardMiles: 500,
    conversionPointName: '体験申込フォームの送信', value: 3000,
    approvalStatus: 'pending', duplicateFlag: true,
  },
  ...Array.from({ length: 7 }, (_, i) => ({
    eventId: `cev-${i + 2}`,
    createdAt: `2026-08-2${(i % 4) + 1}T0${i % 9}:15:00.000Z`,
    friendId: `friend-${i + 1}`, friendName: ['Kenta Kawano', 'Masato S.', '菅野 亮', '佐藤 花子', '高橋 実', '伊藤 香', '渡辺 剛'][i],
    affiliateId: ['aff-1', 'aff-2', 'aff-1', 'aff-3', 'aff-2', 'aff-1', 'aff-2'][i],
    affiliateName: ['田中 明', '合同会社ノース', '田中 明', '木村 亮', '合同会社ノース', '田中 明', '合同会社ノース'][i],
    offerId: ['offer-1', 'offer-2', 'offer-1', 'offer-3', 'offer-2', 'offer-4', 'offer-1'][i],
    offerName: ['無料体験の申込', '定期便の申込', '無料体験の申込', '友だち追加だけ', '定期便の申込', '資料請求', '無料体験の申込'][i],
    offerRewardMiles: [500, 1000, 500, 0, 1000, 0, 500][i],
    conversionPointName: '体験申込フォームの送信',
    value: [3000, 8000, 3000, 300, 8000, 1500, 3000][i],
    approvalStatus: 'pending',
    duplicateFlag: false,
  })),
]

/** 設計 `PouPn` の流れ（クリック4,820 → 友だち追加612 → 成果42 → 認めた34）。 */
export const AFFILIATES_REPORT = [
  {
    affiliateId: 'aff-1', affiliateName: '田中 明', code: 'tanaka01', commissionRate: 10,
    totalClicks: 1240, totalConversions: 12, totalRevenue: 860000,
    linkCount: 3, friendAdds: 86,
  },
  {
    affiliateId: 'aff-2', affiliateName: '合同会社ノース', code: 'north', commissionRate: 0,
    totalClicks: 2180, totalConversions: 18, totalRevenue: 1440000,
    linkCount: 5, friendAdds: 312,
  },
  {
    affiliateId: 'aff-3', affiliateName: '木村 亮', code: 'kimura', commissionRate: 15,
    totalClicks: 1400, totalConversions: 12, totalRevenue: 620000,
    linkCount: 2, friendAdds: 214,
  },
  {
    /* 止めている人。**クリックも成果も0。** 0で崩れないことが要る。 */
    affiliateId: 'aff-4', affiliateName: '旧パートナーA', code: 'legacy-a', commissionRate: 5,
    totalClicks: 0, totalConversions: 0, totalRevenue: 0, linkCount: 1, friendAdds: 0,
  },
]

/** 成果地点（`ConversionPoint`）。設計は「成果地点3つ」。 */
export const CONVERSION_POINTS = [
  {
    id: 'cp-1', name: '体験申込フォームの送信', eventType: 'form_submit', value: 3000,
    measureMethod: 'manual', targetUrl: null, countRepeat: false, attributionDays: 30,
    lineAccountId: null, createdAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'cp-2', name: '定期便の申込', eventType: 'purchase', value: 8000,
    measureMethod: 'url_reach', targetUrl: 'https://example.co.jp/thanks/subscription',
    countRepeat: false, attributionDays: 90, lineAccountId: null,
    createdAt: '2026-02-01T00:00:00.000Z',
  },
  {
    /*
      **`eventType` は画面が名前を知っている言葉から選ぶ**
      （`conversions/page.tsx:27` の `EVENT_TYPE_LABELS`）。
      `'download'` のような知らない言葉を入れると、種別の列に
      **英語のまま**出て、実装の不具合に見える。
    */
    id: 'cp-3', name: '資料ダウンロード', eventType: 'url_click', value: null,
    measureMethod: 'url_reach', targetUrl: 'https://example.co.jp/download/done',
    countRepeat: true, attributionDays: null, lineAccountId: null,
    createdAt: '2026-06-11T00:00:00.000Z',
  },
]

/**
 * 機能17 マイル。設計 `s98Vfw` の帯（友だち1,284人・486,200マイル）。
 *
 * **`MileageAdminOverview` は `{summary, members, pagination}` の通。**
 * 一覧の既定（`{items,total,page,limit}`）を返すと `summary.total…` を
 * 読もうとして画面ごと落ちる。
 */
/*
  **`MileageAdminMember` の型どおり。** `rank` は型に無いので渡さない
  （渡すと「実装にランクがある」ように見える）。`lastActivityAt` は
  型に在るのに落としていて、一覧の「最終行動」が全員 `—` で撮れていた。
*/
const mileageMember = (i, name, available, lifetime, lastActivityAt) => ({
  identityKey: `mk-${i}`, primaryFriendId: `friend-${i}`, displayName: name,
  pictureUrl: null, accountCount: 1, accountNames: ['LINE 本店'],
  available, pending: 0, lifetimeEarned: lifetime,
  actionCount: 40 - i * 6, messageCount: 18 - i, linkClickCount: 12 - i,
  formCount: 3, bookingCount: 2, webinarCount: 1, instagramCount: 0,
  followingDays: 300 - i * 20, unfollowCount: 0,
  referralMiles: Math.max(0, 3500 - i * 700), qualityReferralCount: Math.max(0, 7 - i * 2),
  lastActivityAt,
})

export const MILEAGE_OVERVIEW = {
  summary: {
    totalMembers: 1284, totalAvailable: 486200,
    activeMembers30d: 498, totalActions: 4180, queuedEvents: 0,
  },
  members: [
    mileageMember(1, '高橋 直人', 8420, 12400, '2026-08-24T05:02:00.000Z'),
    mileageMember(2, 'Kenta Kawano', 5200, 7800, '2026-08-23T01:20:00.000Z'),
    mileageMember(3, 'Masato S.', 3140, 4600, '2026-08-20T08:40:00.000Z'),
    mileageMember(4, '菅野 亮', 2050, 2900, '2026-08-12T02:10:00.000Z'),
    /*
      0マイルの人。**持っていない786人がいることが要る。**
      いちども動いていないので `lastActivityAt` は null。
    */
    mileageMember(5, '山田 太郎', 0, 0, null),
  ],
  pagination: { total: 1284, limit: 20, offset: 0 },
}

/** 設計 `N46cQ` のたまる決めごと。**止めているものを2つ混ぜる。** */
export const MILEAGE_RULES = [
  {
    id: 'mr-1', name: '友だち登録してくれた', eventType: 'friend_add', source: null,
    amount: 100, initialStatus: 'available',
    conditions: { uniquePerSubject: true },
    isActive: true, validFrom: null, validUntil: null,
    createdAt: '2025-11-03T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'mr-2', name: 'LINEでメッセージを送ってくれた', eventType: 'message', source: null,
    amount: 10, initialStatus: 'available',
    conditions: { dailyCapActions: 1 },
    isActive: true, validFrom: null, validUntil: null,
    createdAt: '2025-11-03T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'mr-3', name: '予約してくれたら 300 マイル', eventType: 'booking', source: 'booking',
    amount: 300, initialStatus: 'pending',
    conditions: { uniquePerSubject: true },
    isActive: true, validFrom: null, validUntil: null,
    createdAt: '2026-01-15T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'mr-4', name: '紹介の成果が認められた', eventType: 'affiliate_conversion', source: 'affiliate',
    amount: 500, initialStatus: 'pending',
    conditions: { beneficiary: 'referrer', uniquePerReferredFriend: true },
    isActive: true, validFrom: null, validUntil: null,
    createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
  },
  {
    /* 止めている決めごと。**残高は減らないが、もう付かない。** */
    id: 'mr-5', name: '春のキャンペーン参加', eventType: 'campaign', source: null,
    amount: 1000, initialStatus: 'available', conditions: {},
    isActive: false, validFrom: '2026-03-01T00:00:00.000Z', validUntil: '2026-03-31T00:00:00.000Z',
    createdAt: '2026-02-20T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z',
  },
]

/**
 * 機能18 流入と計測。設計 `Q4bkTg` の一覧（流入元24本・今月312人）。
 *
 * **`EntryRoute`（`packages/shared`）と `RefSummaryData`
 * （`inflow-links/page.tsx` の中の型）の2つが要る。**
 * `ref-summary` は `{routes, totalFriends, friendsWithRef, friendsWithoutRef}` の
 * 通で、一覧の既定を返すと `summary.routes.forEach` で落ちる。
 */
export const ENTRY_ROUTE_GENRES = [
  { id: 'erg-1', name: '予約', createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' },
  { id: 'erg-2', name: 'お問い合わせ', createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' },
  { id: 'erg-3', name: 'SNS', createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' },
]

export const ENTRY_ROUTES = [
  {
    id: 'er-1', refCode: 'summer-ig', genre: 'SNS', name: '夏のInstagram投稿',
    tagId: 'tag-0', scenarioId: 'scenario-0', redirectUrl: null, poolId: null,
    introTemplateId: null, runAccountFriendAddScenarios: false, isActive: true,
    createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
  },
  {
    id: 'er-2', refCode: 'store-qr', genre: '予約', name: '店頭QRコード',
    tagId: 'tag-1', scenarioId: null, redirectUrl: null, poolId: null,
    introTemplateId: null, runAccountFriendAddScenarios: true, isActive: true,
    createdAt: '2026-05-11T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'er-3', refCode: 'ig-profile', genre: 'SNS', name: 'Instagramプロフィール',
    tagId: 'tag-2', scenarioId: 'scenario-1', redirectUrl: null, poolId: null,
    introTemplateId: null, runAccountFriendAddScenarios: false, isActive: true,
    createdAt: '2026-04-18T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
  },
  {
    /* 止めているリンク。**過去の記録は残るが、新しくは数えない。** */
    id: 'er-4', refCode: 'spring-cp', genre: null, name: '春のキャンペーン',
    tagId: null, scenarioId: null, redirectUrl: null, poolId: null,
    introTemplateId: null, runAccountFriendAddScenarios: false, isActive: false,
    createdAt: '2026-02-20T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z',
  },
]

export const REF_SUMMARY = {
  routes: [
    { refCode: 'summer-ig', name: '夏のInstagram投稿', friendCount: 86, clickCount: 1240, latestAt: '2026-08-24T05:00:00.000Z' },
    { refCode: 'store-qr', name: '店頭QRコード', friendCount: 128, clickCount: 3480, latestAt: '2026-08-24T09:00:00.000Z' },
    { refCode: 'ig-profile', name: 'Instagramプロフィール', friendCount: 75, clickCount: 3700, latestAt: '2026-08-23T01:00:00.000Z' },
    { refCode: 'spring-cp', name: '春のキャンペーン', friendCount: 0, clickCount: 0, latestAt: null },
    /*
      **登録されていない ref。** URLに付いてきたが `entry_routes` に無いもの。
      名前が null で出る。ここが欠けると「知らないところから来た人」を確かめられない。
    */
    { refCode: 'unknown-ref', name: null, friendCount: 23, clickCount: 210, latestAt: '2026-08-20T00:00:00.000Z' },
  ],
  totalFriends: 312,
  friendsWithRef: 289,
  friendsWithoutRef: 23,
}

/**
 * 機能20 分析。設計 `J6Inc`（この30日に18回・のべ86,420人・押された割合6.8%）に
 * だいたい合わせる。
 *
 * **どれも通の配列。** 一覧の既定を返すと日ごとの棒が描けない。
 */
export const ANALYTICS_MESSAGES = Array.from({ length: 30 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 6, 27 + i))
  const iso = day.toISOString().slice(0, 10)
  /* 8/13 は一斉配信「夏のご案内」を出した日。設計の説明に合わせて山を作る。 */
  const spike = iso === '2026-08-13'
  return {
    date: iso,
    outgoing: spike ? 4820 : 900 + ((i * 37) % 400),
    incoming: 120 + ((i * 13) % 60),
    reply: 80 + ((i * 7) % 40),
    push: spike ? 4700 : 800 + ((i * 29) % 350),
    fromBroadcast: spike ? 4600 : 300 + ((i * 17) % 200),
    fromScenario: 200 + ((i * 11) % 120),
  }
})

export const ANALYTICS_BROADCASTS = [
  {
    broadcastId: 'broadcast-1', name: '夏のご案内', sentAt: '2026-08-13T02:00:00.000Z',
    delivered: 4801, uniqueImpression: 3120, uniqueClick: 326, suppressedByAudienceSize: false,
  },
  {
    broadcastId: 'broadcast-2', name: '定期便のお知らせ', sentAt: '2026-08-20T11:00:00.000Z',
    delivered: 3860, uniqueImpression: 2410, uniqueClick: 262, suppressedByAudienceSize: false,
  },
  {
    /* **20人未満は開封が取れない。** `null` で撮れることが要る。 */
    broadcastId: 'broadcast-3', name: '社内テスト配信', sentAt: '2026-08-18T00:00:00.000Z',
    delivered: 12, uniqueImpression: null, uniqueClick: null, suppressedByAudienceSize: true,
  },
]

export const ANALYTICS_TRACKED_LINKS = [
  {
    trackedLinkId: 'tl-1', name: '夏の特集ページ', originalUrl: 'https://example.co.jp/summer',
    shortCode: 's3k9', tagName: '夏CP', scenarioName: null, isActive: true,
    clicks: 1840, uniqueFriends: 812,
  },
  {
    trackedLinkId: 'tl-2', name: '空き枠を見る', originalUrl: 'https://example.co.jp/slots',
    shortCode: 'b7m2', tagName: null, scenarioName: '体験前フォロー', isActive: true,
    clicks: 1420, uniqueFriends: 704,
  },
  {
    trackedLinkId: 'tl-3', name: '資料ダウンロード', originalUrl: 'https://example.co.jp/download',
    shortCode: 'd1x4', tagName: null, scenarioName: null, isActive: true,
    clicks: 922, uniqueFriends: 348,
  },
  {
    /* 設計 `Fh2Qj`「押されていないURL 6・配信4本の中」。**0で撮れることが要る。** */
    trackedLinkId: 'tl-4', name: '旧キャンペーン', originalUrl: 'https://example.co.jp/spring',
    shortCode: 'p0q8', tagName: null, scenarioName: null, isActive: false,
    clicks: 0, uniqueFriends: 0,
  },
]

/** クロス集計。`{row, col, count}` の通。 */
export const ANALYTICS_CROSS = [
  { row: '店頭QRコード', col: '体験申込', count: 128 },
  { row: '店頭QRコード', col: '未申込', count: 214 },
  { row: 'Instagramプロフィール', col: '体験申込', count: 86 },
  { row: 'Instagramプロフィール', col: '未申込', count: 296 },
  { row: '紹介キャンペーン', col: '体験申込', count: 42 },
  { row: '紹介キャンペーン', col: '未申込', count: 114 },
]

/**
 * 機能21 NEN配信。設計 `VLMGH`（配信フロー8・NENコラム24・この30日2,486通）。
 *
 * **`/api/nen-campaigns/overview` は `{activeCampaigns, jobs:{…}, columns, pets, coupons}` の通。**
 * 一覧の既定を返すと `overview.jobs.pending` で落ちる。
 */
export const NEN_OVERVIEW = {
  activeCampaigns: 6,
  jobs: { total: 2640, pending: 148, sent: 2486, failed: 6 },
  columns: 24,
  pets: 864,
  coupons: 72,
}

export const NEN_CAMPAIGN_SETTINGS = [
  {
    campaignKey: 'order_confirmed', label: '注文が確定', category: 'transactional',
    triggerEvent: 'ec.order.confirmed', delayDays: 0, deliveryTime: '00:00',
    isEnabled: true, title: '注文ありがとうございます',
    bodyText: 'ご注文ありがとうございます。発送まで少しお待ちください。',
    buttonLabel: '注文をみる', buttonUrl: 'https://example.co.jp/orders',
    imageUrl: null, updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    campaignKey: 'shipped', label: '発送しました', category: 'transactional',
    triggerEvent: 'ec.order.shipped', delayDays: 0, deliveryTime: '18:00',
    isEnabled: true, title: 'お荷物の追跡番号',
    bodyText: '本日発送しました。追跡番号は {{追跡番号}} です。',
    buttonLabel: '追跡する', buttonUrl: 'https://example.co.jp/track',
    imageUrl: null, updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    campaignKey: 'delivered', label: '届きました', category: 'follow_up',
    triggerEvent: 'ec.order.delivered', delayDays: 1, deliveryTime: '10:00',
    isEnabled: true, title: '使い方のご案内',
    bodyText: 'お届けした商品の使い方をご案内します。',
    buttonLabel: null, buttonUrl: null, imageUrl: null,
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    campaignKey: 'review_request', label: '口コミのお願い', category: 'follow_up',
    triggerEvent: 'ec.order.delivered', delayDays: 7, deliveryTime: '20:00',
    isEnabled: true, title: 'いかがでしたか',
    bodyText: '{{ペットの名前}}ちゃん、{{商品名}}はいかがでしたか。',
    buttonLabel: '感想を送る', buttonUrl: 'https://example.co.jp/review',
    imageUrl: null, updatedAt: '2026-08-10T00:00:00.000Z',
  },
  {
    campaignKey: 'pet_birthday', label: 'ペットの誕生日', category: 'birthday',
    triggerEvent: 'pet.birthday', delayDays: -3, deliveryTime: '10:00',
    isEnabled: true, title: 'お誕生日おめでとうございます',
    bodyText: '{{ペットの名前}}ちゃん、お誕生日おめでとうございます。',
    buttonLabel: 'クーポンを使う', buttonUrl: 'https://example.co.jp/coupon',
    imageUrl: null, updatedAt: '2026-07-01T00:00:00.000Z',
  },
  {
    /* 止めている段。**設計は「グレーの丸」で出す。** */
    campaignKey: 'winback', label: '久しぶりの方へ', category: 'follow_up',
    triggerEvent: 'ec.order.none_90d', delayDays: 90, deliveryTime: '11:00',
    isEnabled: false, title: 'お久しぶりです',
    bodyText: 'また会えるのを楽しみにしています。',
    buttonLabel: null, buttonUrl: null, imageUrl: null,
    updatedAt: '2026-05-01T00:00:00.000Z',
  },
]

export const NEN_COLUMNS = [
  {
    id: 'nc-1', externalId: null, slug: 'summer-hydration', title: '夏の水分補給、どれくらい？',
    category: '季節のこと', excerpt: '暑い日がつづきますね。', introText: '今週のコラムです。',
    articleUrl: 'https://example.co.jp/column/summer-hydration', imageUrl: null,
    publishedAt: null, deliveryStatus: 'scheduled', deliveryAt: '2026-08-28T01:00:00.000Z',
    lineAccountId: null, updatedAt: '2026-08-24T00:00:00.000Z',
  },
  {
    id: 'nc-2', externalId: null, slug: 'toothbrush', title: '歯みがきのコツ',
    category: 'お手入れ', excerpt: '毎日でなくても大丈夫です。', introText: '今週のコラムです。',
    articleUrl: 'https://example.co.jp/column/toothbrush', imageUrl: null,
    publishedAt: '2026-08-14T01:00:00.000Z', deliveryStatus: 'sent',
    deliveryAt: '2026-08-14T01:00:00.000Z', lineAccountId: null,
    updatedAt: '2026-08-14T00:00:00.000Z',
  },
  {
    id: 'nc-3', externalId: null, slug: 'walk-in-heat', title: '暑い日のお散歩',
    category: '季節のこと', excerpt: 'アスファルトの温度に気をつけて。', introText: '今週のコラムです。',
    articleUrl: 'https://example.co.jp/column/walk-in-heat', imageUrl: null,
    publishedAt: '2026-08-07T01:00:00.000Z', deliveryStatus: 'sent',
    deliveryAt: '2026-08-07T01:00:00.000Z', lineAccountId: null,
    updatedAt: '2026-08-07T00:00:00.000Z',
  },
  {
    /* 下書き。**まだどこへも出していない。** */
    id: 'nc-4', externalId: null, slug: 'autumn-food', title: '秋のごはん',
    category: '食べもの', excerpt: '', introText: '',
    articleUrl: 'https://example.co.jp/column/autumn-food', imageUrl: null,
    publishedAt: null, deliveryStatus: 'draft', deliveryAt: null,
    lineAccountId: null, updatedAt: '2026-08-22T00:00:00.000Z',
  },
]

export const NEN_PETS = [
  { id: 'pet-1', friendId: 'friend-1', customerId: 'cus-1', name: 'モモ', animalType: 'dog', gender: 'female', birthday: '2021-09-02', ownerName: 'Kenta Kawano', lineUserId: 'U0001' },
  { id: 'pet-2', friendId: 'friend-2', customerId: 'cus-2', name: 'ソラ', animalType: 'cat', gender: 'male', birthday: '2019-08-28', ownerName: 'Masato S.', lineUserId: 'U0002' },
  { id: 'pet-3', friendId: 'friend-3', customerId: null, name: 'ココ', animalType: 'dog', gender: 'female', birthday: null, ownerName: '菅野 亮', lineUserId: 'U0003' },
  { id: 'pet-4', friendId: 'friend-4', customerId: 'cus-4', name: 'ハナ', animalType: 'other', gender: 'unknown', birthday: '2023-01-14', ownerName: '山田 太郎', lineUserId: 'U0004' },
]

/** 配信の記録。設計 `WeXbL`（送りました2,486／これから148／届きませんでした6）。 */
export const NEN_JOBS = [
  { id: 'nj-1', campaignKey: 'review_request', label: '口コミのお願い', friendName: 'Kenta Kawano', scheduledAt: '2026-08-25T11:00:00.000Z', status: 'pending', attempts: 0, lastError: null, sentAt: null },
  { id: 'nj-2', campaignKey: 'shipped', label: '発送しました', friendName: 'Masato S.', scheduledAt: '2026-08-24T09:00:00.000Z', status: 'sent', attempts: 1, lastError: null, sentAt: '2026-08-24T09:00:02.000Z' },
  { id: 'nj-3', campaignKey: 'pet_birthday', label: 'ペットの誕生日', friendName: '菅野 亮', scheduledAt: '2026-08-24T01:00:00.000Z', status: 'sent', attempts: 1, lastError: null, sentAt: '2026-08-24T01:00:01.000Z' },
  /* 届かなかったもの。**ブロックされた人。** 理由が残ることが要る。 */
  { id: 'nj-4', campaignKey: 'delivered', label: '届きました', friendName: '山田 太郎', scheduledAt: '2026-08-23T01:00:00.000Z', status: 'failed', attempts: 3, lastError: 'ブロックされています', sentAt: null },
]

/**
 * 機能22 写真審査。設計 `Qu6Vk`（見ていない18・通した486・戻した24・出している62）。
 *
 * **`/api/nen-members/photos` は `Record<string, unknown>` の配列**で、
 * 画面は `photo.pet_name` `photo.owner_name` `photo.status` `photo.created_at`
 * という**スネークケース**で読む（`nen-members/page.tsx:133`）。
 * キャメルケースで書くと名前が空のまま撮れる。
 */
export const NEN_PHOTOS = [
  {
    id: 'ph-1', pet_name: 'もも', owner_name: '高橋 直人', status: 'pending',
    image_url: 'https://example.co.jp/photos/momo.jpg',
    caption: 'はじめて海に行きました', created_at: '2026-08-22T09:22:00.000Z',
  },
  {
    id: 'ph-2', pet_name: 'そら', owner_name: '前田 さくら', status: 'pending',
    image_url: 'https://example.co.jp/photos/sora.jpg',
    caption: 'おひるね中です', created_at: '2026-08-22T02:10:00.000Z',
  },
  {
    id: 'ph-3', pet_name: 'こむぎ', owner_name: '木村 亮', status: 'pending',
    image_url: 'https://example.co.jp/photos/komugi.jpg',
    caption: '', created_at: '2026-08-23T05:40:00.000Z',
  },
  {
    id: 'ph-4', pet_name: 'レオ', owner_name: '大西 健一', status: 'adopted',
    image_url: 'https://example.co.jp/photos/leo.jpg',
    caption: '海が好きです', created_at: '2026-08-18T09:22:00.000Z',
  },
  {
    /* 戻したもの。**理由が残ることが要る。** */
    id: 'ph-5', pet_name: 'マロン', owner_name: '佐藤 花子', status: 'rejected',
    image_url: 'https://example.co.jp/photos/maron.jpg',
    caption: '', created_at: '2026-08-15T01:00:00.000Z',
    reject_reason: 'うしろに人の顔が写っています',
  },
]

/**
 * 機能23 EC連携。設計 `eI3gs`（取り込み2,486・つき合わせ24・定期便186）。
 *
 * **`overview` は `{total, processed, failed, skipped, last24h, lastReceivedAt, byType}` の通。**
 * `events` は `EcCommerceEvent` の**配列**で、一覧の既定を返すと
 * `events.map` で落ちる。
 */
export const EC_OVERVIEW = {
  total: 2486, processed: 2412, failed: 2, skipped: 24,
  last24h: 148, lastReceivedAt: '2026-08-25T02:40:00.000Z',
  byType: [
    { eventType: 'order_created', label: '注文が確定', count: 96 },
    { eventType: 'payment_confirmed', label: '入金を確認', count: 32 },
    { eventType: 'shipped', label: '発送した', count: 20 },
  ],
}

export const EC_EVENTS = [
  {
    id: 'ece-1', externalEventId: 'shopify-1', eventType: 'order_created', eventLabel: '注文が確定',
    customerId: 'cus-1', friendId: 'friend-1', friendName: 'Kenta Kawano', orderNumber: '#12486',
    status: 'processed', errorMessage: null,
    receivedAt: '2026-08-25T02:42:00.000Z', processedAt: '2026-08-25T02:42:01.000Z',
  },
  {
    id: 'ece-2', externalEventId: 'shopify-2', eventType: 'shipped', eventLabel: '発送した',
    customerId: 'cus-2', friendId: 'friend-2', friendName: 'Masato S.', orderNumber: '#12480',
    status: 'processed', errorMessage: null,
    receivedAt: '2026-08-25T01:10:00.000Z', processedAt: '2026-08-25T01:10:02.000Z',
  },
  {
    /*
      **友だちが見つからなかった注文。** 設計の「会員のつき合わせ」に並ぶもの。
      `friendId` が null で、状態は `skipped`。ここが欠けると
      「つながっていない注文」を確かめられない。
    */
    id: 'ece-3', externalEventId: 'shopify-3', eventType: 'order_created', eventLabel: '注文が確定',
    customerId: 'cus-3', friendId: null, friendName: null, orderNumber: '#12479',
    status: 'skipped', errorMessage: null,
    receivedAt: '2026-08-24T23:50:00.000Z', processedAt: '2026-08-24T23:50:01.000Z',
  },
  {
    /* 3回やり直しても入らなかったもの。**理由が残ることが要る。** */
    id: 'ece-4', externalEventId: 'shopify-4', eventType: 'payment_confirmed', eventLabel: '入金を確認',
    customerId: 'cus-4', friendId: 'friend-4', friendName: '山田 太郎', orderNumber: '#12470',
    status: 'failed', errorMessage: '注文の金額が読めませんでした',
    receivedAt: '2026-08-24T20:00:00.000Z', processedAt: null,
  },
]

export const EC_SETTINGS = [
  {
    eventType: 'order_created', label: '注文が確定した', isEnabled: true,
    title: 'ご注文ありがとうございます', introText: 'ご注文を承りました。', outroText: '発送までお待ちください。',
    category: 'order', buttonLabel: '注文をみる', buttonUrl: 'https://example.co.jp/orders',
    imageUrl: '', displayOrder: 1, fixedFields: ['注文番号', '金額'],
    fixedPreview: '注文番号 #12486 ／ ¥4,200', updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    eventType: 'payment_confirmed', label: '入金を確認した', isEnabled: true,
    title: 'お支払いを確認しました', introText: 'お支払いありがとうございます。', outroText: '',
    category: 'payment', buttonLabel: '', buttonUrl: '', imageUrl: '',
    displayOrder: 2, fixedFields: ['金額'], fixedPreview: '¥4,200',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    eventType: 'shipped', label: '発送した', isEnabled: true,
    title: 'お荷物を送りました', introText: '本日発送しました。', outroText: '',
    category: 'shipping', buttonLabel: '追跡する', buttonUrl: 'https://example.co.jp/track',
    imageUrl: '', displayOrder: 3, fixedFields: ['追跡番号'],
    fixedPreview: '追跡番号 1234-5678-9012', updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    /* 止めているもの。**チェックを外すと購入後の配信も止まる。** */
    eventType: 'refunded', label: '返品・返金した', isEnabled: false,
    title: '', introText: '', outroText: '',
    category: 'support', buttonLabel: '', buttonUrl: '', imageUrl: '',
    displayOrder: 5, fixedFields: [], fixedPreview: '',
    updatedAt: '2026-06-01T00:00:00.000Z',
  },
]

/**
 * 機能25 オートメーション。設計 `gief7`（動いている14・止めている4）。
 *
 * **`eventType` は決まった12語のどれか**（`AutomationEventType`）。
 * 設計の日本語（「タグが付いたとき」）は見出しで、項目名ではない。
 */
export const AUTOMATIONS = [
  {
    id: 'auto-1', name: 'はじめての人にあいさつする', description: '友だち追加でシナリオを始める',
    eventType: 'friend_add', conditions: {},
    actions: [{ type: 'start_scenario', params: { scenarioId: 'scenario-0' } }],
    isActive: true, priority: 1, lineAccountId: null,
    createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'auto-2', name: '「予約」と送られたら予約画面を出す', description: null,
    eventType: 'message_received', conditions: { keyword: '予約' },
    actions: [
      { type: 'switch_rich_menu', params: { groupId: 'rmg-2' } },
      { type: 'send_message', params: { templateId: 'template-1' } },
    ],
    isActive: true, priority: 2, lineAccountId: null,
    createdAt: '2026-03-11T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z',
  },
  {
    id: 'auto-3', name: '体験申込タグで担当を付ける', description: 'タグ「体験申込」が付いたとき',
    eventType: 'tag_change', conditions: { tagId: 'tag-0', direction: 'added' },
    actions: [{ type: 'add_tag', params: { tagId: 'tag-1' } }],
    isActive: true, priority: 3, lineAccountId: 'visual-qa-account',
    createdAt: '2026-04-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  },
  {
    /* 止めているもの。**残った記録は消えない。** */
    id: 'auto-4', name: '注文が確定したらお礼を送る', description: null,
    eventType: 'ec.order.confirmed', conditions: {},
    actions: [{ type: 'send_message', params: { templateId: 'template-2' } }],
    isActive: false, priority: 4, lineAccountId: null,
    createdAt: '2026-01-15T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
  },
]

/** 動いた記録。**失敗（外部連携の返事なし）を混ぜる。** */
export const AUTOMATION_LOGS = [
  { id: 'al-1', automationId: 'auto-2', friendId: 'friend-1', eventData: '{"text":"予約したい"}', actionsResult: '{"ok":2}', status: 'success', createdAt: '2026-08-24T05:00:00.000Z' },
  { id: 'al-2', automationId: 'auto-1', friendId: 'friend-2', eventData: '{}', actionsResult: '{"ok":1}', status: 'success', createdAt: '2026-08-24T02:00:00.000Z' },
  { id: 'al-3', automationId: 'auto-3', friendId: 'friend-3', eventData: '{"tagId":"tag-0"}', actionsResult: '{"ok":0,"error":"外部連携の返事がありませんでした"}', status: 'failed', createdAt: '2026-08-23T09:00:00.000Z' },
  { id: 'al-4', automationId: 'auto-2', friendId: 'friend-4', eventData: '{"text":"予約"}', actionsResult: '{"ok":1,"skipped":1}', status: 'partial', createdAt: '2026-08-23T01:00:00.000Z' },
]

/** 共通アクション。設計 `xOpDs`（14・公開中11・呼び出し元38・古い版のまま2）。 */
export const COMMON_ACTIONS = [
  {
    id: 'ca-1', name: '体験申込を受けたとき', description: 'タグ・シナリオ・担当の3つ',
    status: 'published', draftVersion: null, publishedVersion: 4,
    actionCount: 5, bindingCount: 5, oldVersionBindingCount: 1,
    updatedAt: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'ca-2', name: '購入後のお礼', description: null,
    status: 'published', draftVersion: 3, publishedVersion: 2,
    actionCount: 3, bindingCount: 8, oldVersionBindingCount: 0,
    updatedAt: '2026-08-10T00:00:00.000Z',
  },
  {
    id: 'ca-3', name: '休会の受け止め', description: '対応マークと担当の割り当て',
    status: 'published', draftVersion: null, publishedVersion: 1,
    actionCount: 2, bindingCount: 2, oldVersionBindingCount: 1,
    updatedAt: '2026-07-02T00:00:00.000Z',
  },
  {
    /* 下書き。**まだどこからも呼ばれていない。** */
    id: 'ca-4', name: '紹介のお礼', description: null,
    status: 'draft', draftVersion: 1, publishedVersion: null,
    actionCount: 2, bindingCount: 0, oldVersionBindingCount: 0,
    updatedAt: '2026-08-22T00:00:00.000Z',
  },
]

/**
 * 機能26 外部連携。設計 `k3WxrO`（こちらから送る6・こちらで受け取る3）。
 *
 * **合言葉（secret）は返事に入らない。** `hasSecret` の真偽値だけ。
 * 固定データに生の合言葉を書くと、実装より多くの物を見せてしまう。
 */
export const OUTGOING_WEBHOOKS = [
  {
    id: 'ow-1', name: 'Slack ／ #注文チャンネル',
    url: 'https://hooks.slack.com/services/T0XXXXX/B0XXXXX/xxxxxxxx',
    eventTypes: ['ec.order.confirmed'], hasSecret: true, isActive: true,
    maxRetries: 3, consecutiveFailures: 0, lastFailedAt: null,
    createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    /* 連続で失敗している先。**設計の「返事がなかった 6回・すべて Slack」。** */
    id: 'ow-2', name: 'Slack ／ #対応チーム',
    url: 'https://hooks.slack.com/services/T0YYYYY/B0YYYYY/yyyyyyyy',
    eventTypes: ['friend_add', 'message_received'], hasSecret: true, isActive: true,
    maxRetries: 3, consecutiveFailures: 6, lastFailedAt: '2026-08-24T09:00:00.000Z',
    createdAt: '2026-04-12T00:00:00.000Z', updatedAt: '2026-08-24T09:00:00.000Z',
  },
  {
    id: 'ow-3', name: '在庫システム', url: 'https://stock.example.co.jp/hook',
    eventTypes: ['ec.order.confirmed', 'ec.order.shipped'], hasSecret: true, isActive: true,
    maxRetries: 5, consecutiveFailures: 0, lastFailedAt: null,
    createdAt: '2026-02-20T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
  },
  {
    /* 止めているもの。**合言葉を入れていない。** */
    id: 'ow-4', name: '旧CRM（停止中）', url: 'https://old-crm.example.co.jp/hook',
    eventTypes: ['friend_add'], hasSecret: false, isActive: false,
    maxRetries: 0, consecutiveFailures: 0, lastFailedAt: null,
    createdAt: '2025-10-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z',
  },
]

export const INCOMING_WEBHOOKS = [
  {
    id: 'iw-1', name: '予約サービスから', sourceType: 'booking',
    hasSecret: true, isActive: true,
    createdAt: '2026-05-02T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'iw-2', name: 'アンケートツールから', sourceType: 'survey',
    hasSecret: true, isActive: true,
    createdAt: '2026-06-14T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
  },
  {
    /* 合言葉を入れていない受け取り口。**誰でも投げ込める。** */
    id: 'iw-3', name: 'テスト用', sourceType: 'other',
    hasSecret: false, isActive: false,
    createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  },
]

/**
 * 機能27・28 予約。設計 `TV2DI`（今日12件・LINEから9・電話3）。
 *
 * **予約まわりの型はスネークケース**（`BookingRequest` `BookingMenu` `BookingStaff`）。
 * ほかの機能と混ぜて書くと、名前も時刻も空のまま撮れる。
 */
export const BOOKING_MENUS = [
  {
    id: 'bm-1', name: 'トリミング（小型犬）', category_label: 'トリミング',
    description: 'シャンプー・カット・爪切り', duration_minutes: 105,
    buffer_after_minutes: 15, base_price: 8400, sort_order: 1, is_active: 1,
    auto_tag_id: 'tag-0', concurrent_capacity: 1, booking_window_days: 60,
    cutoff_hours_before: 12, cancel_deadline_hours_before: 24,
    intake_question: '気になるところはありますか',
  },
  {
    id: 'bm-2', name: 'トリミング（中型犬）', category_label: 'トリミング',
    description: null, duration_minutes: 135, buffer_after_minutes: 15,
    base_price: 11800, sort_order: 2, is_active: 1, auto_tag_id: 'tag-0',
    concurrent_capacity: 1, booking_window_days: 60, cutoff_hours_before: 12,
    cancel_deadline_hours_before: 24, intake_question: null,
  },
  {
    id: 'bm-3', name: '爪切りのみ', category_label: 'お手入れ',
    description: null, duration_minutes: 20, buffer_after_minutes: 5,
    base_price: 1200, sort_order: 3, is_active: 1, auto_tag_id: null,
    concurrent_capacity: 2, booking_window_days: 30, cutoff_hours_before: 2,
    cancel_deadline_hours_before: 2, intake_question: null,
  },
  {
    /* 止めているメニュー。**枠は残るが新しくは受けない。** */
    id: 'bm-4', name: '夏のスペシャルコース', category_label: '季節',
    description: null, duration_minutes: 150, buffer_after_minutes: 15,
    base_price: 14800, sort_order: 4, is_active: 0, auto_tag_id: null,
    concurrent_capacity: 1, booking_window_days: null,
    cutoff_hours_before: null, cancel_deadline_hours_before: null,
    intake_question: null,
  },
]

export const BOOKING_STAFF = [
  { id: 'bs-1', name: '佐々木 亮太', display_name: '佐々木', role: 'トリマー', profile_image_url: null, bio: null, sort_order: 1, is_designation_optional: 0, is_active: 1 },
  { id: 'bs-2', name: '山本 京子', display_name: '山本', role: 'トリマー', profile_image_url: null, bio: null, sort_order: 2, is_designation_optional: 0, is_active: 1 },
  { id: 'bs-3', name: '中川 みどり', display_name: '中川', role: '受付', profile_image_url: null, bio: null, sort_order: 3, is_designation_optional: 1, is_active: 1 },
]

const booking = (i, hour, menu, staff, status, friendName, note) => ({
  id: `br-${i}`, friend_id: `friend-${(i % 5) + 1}`,
  starts_at: `2026-08-25T${String(hour - 9).padStart(2, '0')}:00:00.000Z`,
  ends_at: `2026-08-25T${String(hour - 9 + 1).padStart(2, '0')}:45:00.000Z`,
  status, customer_note: note, internal_note: null,
  price_at_booking: menu === 'トリミング（小型犬）' ? 8400 : 1200,
  menu_name: menu, staff_name: staff, friend_name: friendName,
  requested_at: '2026-08-20T05:22:00.000Z', decided_at: '2026-08-20T05:30:00.000Z',
  external_event_id: null,
})

export const BOOKING_REQUESTS = [
  booking(1, 9, 'トリミング（小型犬）', '佐々木', 'confirmed', '高橋 直人', '耳のまわりは短めでお願いします'),
  booking(2, 11, 'トリミング（小型犬）', '山本', 'confirmed', 'Kenta Kawano', null),
  booking(3, 13, '爪切りのみ', '中川', 'confirmed', 'Masato S.', null),
  /* まだ決めていないもの。**受けるか断るかを人が押す。** */
  booking(4, 15, 'トリミング（小型犬）', '佐々木', 'requested', '菅野 亮', '前回 爪を嫌がりました'),
  /* 取り消されたもの。**枠は空くが記録は残る。** */
  booking(5, 16, '爪切りのみ', '山本', 'cancelled', '山田 太郎', null),
  /*
    **LINEに結びついていない予約（電話で受けたもの）。**
    `friend_name` が null。設計は青い札で並べる。
  */
  { ...booking(6, 17, 'トリミング（小型犬）', '佐々木', 'confirmed', null, '電話で受付'), friend_id: '' },
]

/**
 * 機能29 イベント予約。設計 `ugP5y`（これからの回6・申し込み86人・定員120人）。
 *
 * **`{items: EventListItem[]}` の通。** `{items,total,page,limit}` の
 * 既定に見えるが `total` `page` `limit` は返らない。項目はスネークケース。
 */
export const EVENTS = [
  {
    id: 'ev-1', name: '秋のしつけ教室（第1回）', venue_name: '店内', venue_url: null,
    image_url: null, description: 'はじめての方むけに、おうちでできるしつけのコツを90分で。',
    description_centered: 0, max_bookings_per_friend: 1, requires_approval: 0,
    cancel_deadline_hours_before: 18, reminder_day_before_enabled: 1,
    reminder_hours_before: 24, is_published: 1, sort_order: 1,
    created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z',
    next_slot_starts_at: '2026-08-28T05:00:00.000Z',
    total_capacity: 12, total_active: 12, pending_count: 3,
    visible_tag_id: null, visible_tag_name: null,
  },
  {
    id: 'ev-2', name: 'トリミング体験会', venue_name: '店内', venue_url: null,
    image_url: null, description: null, description_centered: 0,
    max_bookings_per_friend: 1, requires_approval: 0,
    cancel_deadline_hours_before: 24, reminder_day_before_enabled: 1,
    reminder_hours_before: 24, is_published: 1, sort_order: 2,
    created_at: '2026-07-20T00:00:00.000Z', updated_at: '2026-08-18T00:00:00.000Z',
    next_slot_starts_at: '2026-08-31T02:00:00.000Z',
    total_capacity: 20, total_active: 4, pending_count: 0,
    visible_tag_id: null, visible_tag_name: null,
  },
  {
    /* タグを持っている人にだけ見えるイベント。**申込条件が付いている。** */
    id: 'ev-3', name: '会員かぎりの相談会', venue_name: 'オンライン',
    venue_url: 'https://meet.example.com/nen', image_url: null,
    description: null, description_centered: 0, max_bookings_per_friend: 1,
    requires_approval: 1, cancel_deadline_hours_before: 12,
    reminder_day_before_enabled: 1, reminder_hours_before: 3,
    is_published: 1, sort_order: 3,
    created_at: '2026-08-10T00:00:00.000Z', updated_at: '2026-08-22T00:00:00.000Z',
    next_slot_starts_at: '2026-09-05T08:00:00.000Z',
    total_capacity: 8, total_active: 6, pending_count: 2,
    visible_tag_id: 'tag-2', visible_tag_name: 'NEN会員',
  },
  {
    /* まだ出していない回。**受付前。** */
    id: 'ev-4', name: '冬のケアセミナー', venue_name: '店内', venue_url: null,
    image_url: null, description: null, description_centered: 0,
    max_bookings_per_friend: 2, requires_approval: 0,
    cancel_deadline_hours_before: null, reminder_day_before_enabled: 0,
    reminder_hours_before: null, is_published: 0, sort_order: 4,
    created_at: '2026-08-22T00:00:00.000Z', updated_at: '2026-08-22T00:00:00.000Z',
    next_slot_starts_at: null, total_capacity: null, total_active: 0,
    pending_count: 0, visible_tag_id: null, visible_tag_name: null,
  },
]

/**
 * 機能30 ログインユーザー。設計 `e3jz3`（いまいる人8・招待中2）。
 *
 * **`StaffMember` の型どおり。** `role` は `'owner'|'admin'|'staff'|'viewer'` の
 * 4つで、設計の「運用」「受付」「見るだけ」はその上に乗せた言い換え。
 */
export const STAFF_MEMBERS = [
  {
    id: 'st-1', name: '佐々木 亮太', email: 'sasaki@example.com', role: 'owner',
    lineLinked: true, twoFactorEnabled: true, isActive: true,
    permissionKeys: [], notificationPreferences: {},
    assignedLineAccountId: null, accountScope: 'all', scopedLineAccountIds: [],
    inviteStatus: 'active', canAccessDescendantAccounts: true,
    createdAt: '2025-04-01T00:00:00.000Z', updatedAt: '2026-08-25T00:10:00.000Z',
  },
  {
    id: 'st-2', name: '川野 健太', email: 'kawano@example.com', role: 'admin',
    lineLinked: true, twoFactorEnabled: true, isActive: true,
    permissionKeys: [], notificationPreferences: {},
    assignedLineAccountId: null, accountScope: 'all', scopedLineAccountIds: [],
    inviteStatus: 'active', canAccessDescendantAccounts: true,
    createdAt: '2025-04-01T00:00:00.000Z', updatedAt: '2026-08-24T09:40:00.000Z',
  },
  {
    /* 2段階の確認を入れていない人。**設計は「6／8人」と数える。** */
    id: 'st-3', name: '高田 誠', email: 'takada@example.com', role: 'staff',
    lineLinked: true, twoFactorEnabled: false, isActive: true,
    permissionKeys: ['inbox', 'friends'], notificationPreferences: {},
    assignedLineAccountId: 'visual-qa-account', accountScope: 'accounts',
    scopedLineAccountIds: ['visual-qa-account'],
    inviteStatus: 'active', canAccessDescendantAccounts: false,
    createdAt: '2026-01-10T00:00:00.000Z', updatedAt: '2026-08-22T02:00:00.000Z',
  },
  {
    /* 90日 入っていない人。**辞めた方かもしれない。** */
    id: 'st-4', name: '山本 京子', email: 'yamamoto@example.com', role: 'viewer',
    lineLinked: false, twoFactorEnabled: false, isActive: true,
    permissionKeys: ['analytics'], notificationPreferences: {},
    assignedLineAccountId: null, accountScope: 'all', scopedLineAccountIds: [],
    inviteStatus: 'active', canAccessDescendantAccounts: false,
    createdAt: '2025-09-15T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z',
  },
  {
    /* まだ一度も入っていない（招待中）。**`lastLoginAt` が null。** */
    id: 'st-5', name: '中川 由美', email: 'nakagawa@example.com', role: 'staff',
    lineLinked: false, twoFactorEnabled: false, isActive: true,
    permissionKeys: [], notificationPreferences: {},
    assignedLineAccountId: null, accountScope: 'all', scopedLineAccountIds: [],
    /* **招待して返事がない人。** `inviteStatus` が `pending_email` のまま。 */
    inviteStatus: 'pending_email', canAccessDescendantAccounts: false,
    createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
  },
]

/**
 * 対応マーク（機能4-3）。設計 `k6lHgo` の5つ。
 *
 * **`autoOnInbound` を必ず入れる。** 「新しい返事が来たら自動で戻す」印で、
 * 落とすとダッシュボードの対応マークの帯が `—` のまま撮れる。
 */
export const SUPPORT_MARKS = [
  { id: 'mark-1', name: '未対応', color: '#dc2626', isDefault: true, autoOnInbound: true, displayOrder: 1, createdAt: '2026-01-05T00:00:00.000Z' },
  { id: 'mark-2', name: '対応中', color: '#d97706', isDefault: false, autoOnInbound: false, displayOrder: 2, createdAt: '2026-01-05T00:00:00.000Z' },
  { id: 'mark-3', name: '保留', color: '#2563eb', isDefault: false, autoOnInbound: false, displayOrder: 3, createdAt: '2026-01-05T00:00:00.000Z' },
  { id: 'mark-4', name: '対応済', color: '#059669', isDefault: false, autoOnInbound: false, displayOrder: 4, createdAt: '2026-01-05T00:00:00.000Z' },
  { id: 'mark-5', name: '気にかける', color: '#7c3aed', isDefault: false, autoOnInbound: false, displayOrder: 5, createdAt: '2026-04-10T00:00:00.000Z' },
]

/**
 * 保存した検索（機能4-4）。設計 `QKx8Q`。
 *
 * **`SavedSearch` の型どおり。** `isShared` を `visibility` と書いて
 * 5行とも「自分だけ」で撮ったことがある（PR #434）。`lineAccountId` は
 * #403 で足された項目で、これが無いと「すべてのアカウント」に見える。
 */
export const SAVED_SEARCHES = [
  {
    id: 'ss-1', name: '未対応・期限超過', scope: 'chats',
    conditions: { all: [{ field: 'support_mark', op: 'is', value: 'mark-1' }], any: [] },
    createdBy: 'st-1', lineAccountId: 'visual-qa-account', isShared: true,
    createdAt: '2026-05-02T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'ss-2', name: '体験申込ずみ・未購入', scope: 'friends',
    conditions: { all: [{ field: 'tag', op: 'contains', value: 'tag-0' }], any: [] },
    createdBy: 'st-2', lineAccountId: null, isShared: true,
    createdAt: '2026-06-11T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    /* 自分だけのもの。**共有と分けて撮れることが要る。** */
    id: 'ss-3', name: '（自分用）今週の宿題', scope: 'friends',
    conditions: { all: [], any: [{ field: 'tag', op: 'contains', value: 'tag-1' }] },
    createdBy: 'st-1', lineAccountId: 'visual-qa-account', isShared: false,
    createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
  },
  {
    id: 'ss-4', name: '90日 反応なし', scope: 'friends',
    conditions: { all: [{ field: 'last_activity', op: 'before', value: '90d' }], any: [] },
    createdBy: 'st-2', lineAccountId: null, isShared: true,
    createdAt: '2026-03-20T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z',
  },
  {
    id: 'ss-5', name: '来週の予約あり', scope: 'bookings',
    conditions: { all: [{ field: 'booking_date', op: 'within', value: '7d' }], any: [] },
    createdBy: 'st-1', lineAccountId: 'visual-qa-account', isShared: true,
    createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
  },
]

/**
 * 広告とのつなぎ（機能18-2）。設計 `BuVDB`（Meta・Google・X・TikTok）。
 *
 * **鍵は伏せた形で持つ。** `config` は「先頭と末尾だけ残して伏せてある」と
 * 型の覚え書きにある。生の値を書くと、実装より多くの物を見せてしまう。
 */
export const AD_PLATFORMS = [
  {
    id: 'ad-meta', name: 'meta', displayName: 'Meta広告',
    config: { clickIdType: 'fbclid', pixelId: '12••••••89', accessToken: 'EAA••••••3f' },
    isActive: true, createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-08-25T02:20:00.000Z',
  },
  {
    id: 'ad-google', name: 'google', displayName: 'Google広告',
    config: { clickIdType: 'gclid', customerId: '123-•••-4567', conversionAction: 'purchase' },
    isActive: true, createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-08-25T02:20:00.000Z',
  },
  {
    /* 権限が足りない先。**設計の「もう一度つなぎ直してください」。** */
    id: 'ad-x', name: 'x', displayName: 'X（旧Twitter）',
    config: { clickIdType: 'twclid', pixelId: 'o••••1' },
    isActive: false, createdAt: '2026-05-10T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  },
]

/** 広告へ返した記録（設計 `Im2b1`）。**断られたものが要る。** */
export const AD_CONVERSION_LOGS = [
  {
    id: 'acl-1', adPlatformId: 'ad-meta', friendId: 'friend-1', eventName: '体験申込',
    clickId: 'fb.1.1724••••.AbCdEf', clickIdType: 'fbclid', status: 'sent',
    errorMessage: null, createdAt: '2026-08-25T02:20:00.000Z',
  },
  {
    id: 'acl-2', adPlatformId: 'ad-google', friendId: 'friend-2', eventName: '定期便の申込',
    clickId: 'Cj0KCQ••••', clickIdType: 'gclid', status: 'sent',
    errorMessage: null, createdAt: '2026-08-25T01:10:00.000Z',
  },
  {
    id: 'acl-3', adPlatformId: 'ad-meta', friendId: 'friend-3', eventName: '体験申込',
    clickId: 'fb.1.1724••••.GhIjKl', clickIdType: 'fbclid', status: 'pending',
    errorMessage: null, createdAt: '2026-08-25T02:40:00.000Z',
  },
  {
    /* 断られたもの。**理由が残ることが要る。** */
    id: 'acl-4', adPlatformId: 'ad-meta', friendId: 'friend-4', eventName: '体験申込',
    clickId: null, clickIdType: null, status: 'failed',
    errorMessage: 'クリックの目印が結びつきませんでした',
    createdAt: '2026-08-24T09:00:00.000Z',
  },
]

/**
 * 機能20 分析の4タブ（PR #445 head `5d5f7a5f` で実装された）。
 *
 * **`AnalyticsMetric<T>` は `{value, state, reason}` の3つ組。**
 * 未取得（`value: null` ＋ 理由）と 実値0（`value: 0`）を型で分けています。
 * `value` だけ書くと画面が読めず、**全部が未取得に見えます。**
 */
const M = (value, state = 'available', reason = null) => ({ value, state, reason })
const envelope = (data) => ({
  lineAccountId: 'visual-qa-account',
  timeZone: 'Asia/Tokyo',
  period: { from: '2026-07-27', to: '2026-08-25' },
  dataCutoffAt: '2026-08-25T02:00:00.000Z',
  data,
})

/** 設計 `Zxezb`（いま12,486人・この30日で+486・-174・残っている96.4%）。 */
export const ANALYTICS_FRIENDS = envelope({
  state: 'available', stateReason: null,
  metrics: {
    added: M(486), removed: M(174), net: M(312),
    currentFriends: M(12486), firstTime: M(432), returning: M(54),
  },
  days: Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 6, 27 + i)).toISOString().slice(0, 10)
    /* 8/13 は一斉配信「夏のご案内」を出した日。設計の説明に合わせて谷を作る。 */
    const spike = d === '2026-08-13'
    const added = 12 + ((i * 7) % 9)
    const removed = spike ? 38 : 3 + (i % 4)
    return { date: d, added, removed, net: added - removed }
  }),
  campaigns: [
    { id: 'broadcast-1', name: '夏のご案内', kind: 'broadcast', occurredAt: '2026-08-13T02:00:00.000Z', date: '2026-08-13' },
    { id: 'scenario-0', name: '新規登録7日間フォロー', kind: 'scenario', occurredAt: '2026-08-05T01:00:00.000Z', date: '2026-08-05' },
  ],
  historyAvailableFrom: '2026-02-01',
})

/** 設計 `J6Inc`（18回・のべ86,420人・押された割合6.8%）。 */
export const ANALYTICS_REACTIONS = envelope({
  metrics: {
    sent: M(18), delivered: M(86420), opened: M(52140),
    lineClicked: M(5876), trackedClicks: M(4182),
    /*
      **20人未満は開封が取れない。** 未取得を0と書かず、理由を添える。
      ここを 0 にすると「取れているのに0件」に見える。
    */
    unavailableCampaigns: M(2, 'partial', '20人未満の配信は開封が取れません'),
  },
  campaigns: [
    {
      id: 'broadcast-1', name: '夏のご案内', kind: 'broadcast', sentAt: '2026-08-13T02:00:00.000Z',
      targetPeople: M(4980), delivered: M(4801), opened: M(3120),
      lineClicked: M(326), outcomes: M(42), fetchedAt: '2026-08-25T02:00:00.000Z',
    },
    {
      id: 'broadcast-2', name: '定期便のお知らせ', kind: 'broadcast', sentAt: '2026-08-20T11:00:00.000Z',
      targetPeople: M(3980), delivered: M(3860), opened: M(2410),
      lineClicked: M(262), outcomes: M(18), fetchedAt: '2026-08-25T02:00:00.000Z',
    },
    {
      /* 20人未満。**開封は取れない。** 0ではなく未取得。 */
      id: 'broadcast-3', name: '社内テスト配信', kind: 'broadcast', sentAt: '2026-08-18T00:00:00.000Z',
      targetPeople: M(12), delivered: M(12),
      opened: M(null, 'unavailable', '20人未満のため取れません'),
      lineClicked: M(null, 'unavailable', '20人未満のため取れません'),
      outcomes: M(0), fetchedAt: '2026-08-25T02:00:00.000Z',
    },
  ],
  trackedClickHours: Array.from({ length: 24 }, (_, h) => ({
    hour: h, clicks: h === 20 ? 782 : 40 + ((h * 37) % 180),
  })),
  clickDefinition: 'こちらで作った中継URLの押された回数です。直接貼ったURLは数えられません。',
})

/** 設計 `YBGtm`（成果486件 ¥1,284,000／広告費 ¥482,000／差し引き +¥802,000）。 */
export const ANALYTICS_ROUTES = envelope({
  attributionModel: 'first_touch',
  attributionLabel: 'はじめて触れた経路で数えます',
  routes: [
    {
      id: 'er-2', refCode: 'store-qr', name: '店頭QRコード',
      clicks: M(3480), friendAdds: M(128), currentFriends: M(119), reactionPeople: M(86),
      conversions: { approved: M(28), pending: M(3), rejected: M(1), revenue: M(624000) },
      adCost: M(0), costPerFriend: M(0),
      costPerConversion: M(0), profitAfterAdCost: M(624000),
    },
    {
      id: 'er-3', refCode: 'ig-profile', name: 'Instagramプロフィール',
      clicks: M(3700), friendAdds: M(75), currentFriends: M(68), reactionPeople: M(41),
      conversions: { approved: M(12), pending: M(2), rejected: M(0), revenue: M(312000) },
      adCost: M(482000), costPerFriend: M(6427),
      costPerConversion: M(40167), profitAfterAdCost: M(-170000),
    },
    {
      /*
        **広告費が取り込めていない経路。** 未取得を 0 と書かない。
        0 と書くと「広告費ゼロで黒字」という嘘の絵になる。
      */
      id: 'er-1', refCode: 'summer-ig', name: '夏のInstagram投稿',
      clicks: M(1240), friendAdds: M(86), currentFriends: M(78), reactionPeople: M(52),
      conversions: { approved: M(12), pending: M(2), rejected: M(0), revenue: M(348000) },
      adCost: M(null, 'unavailable', '広告側の費用を取り込んでいません'),
      costPerFriend: M(null, 'unavailable', '広告費が無いので出せません'),
      costPerConversion: M(null, 'unavailable', '広告費が無いので出せません'),
      profitAfterAdCost: M(null, 'unavailable', '広告費が無いので出せません'),
    },
  ],
  searchConsoleHref: '/search-console',
})

/** 設計 `QQ1SR`（使っている18／43・作ったのに使っていない32個）。 */
export const ANALYTICS_USAGE = envelope({
  state: 'available', stateReason: null,
  checkedAt: '2026-08-25T02:00:00.000Z',
  automaticDeletion: false,
  categories: [
    { key: 'templates', label: 'テンプレート', href: '/templates', created: M(64), inUse: M(50), unused: M(14), brokenReferences: M(0), lastUsedAt: M('2026-08-24T05:00:00.000Z') },
    { key: 'tags', label: 'タグ', href: '/tags', created: M(101), inUse: M(92), unused: M(9), brokenReferences: M(2), lastUsedAt: M('2026-08-25T01:00:00.000Z') },
    { key: 'forms', label: '回答フォーム', href: '/form-submissions', created: M(18), inUse: M(14), unused: M(4), brokenReferences: M(0), lastUsedAt: M('2026-08-24T05:22:00.000Z') },
    {
      /* 一度も使われていない種類。**最後に使った日は未取得（0ではない）。** */
      key: 'rich_menus', label: 'リッチメニュー', href: '/rich-menus',
      created: M(4), inUse: M(3), unused: M(1), brokenReferences: M(0),
      lastUsedAt: M(null, 'unavailable', '使われた記録がありません'),
    },
  ],
})

/** 設計 `Fh2Qj`（押された4,182回・押した人1,864・20時台18.4%・押されていない6本）。 */
export const ANALYTICS_URL_CLICKS = envelope({
  state: 'available', stateReason: null,
  exposureAvailableFrom: '2026-06-01',
  hasMore: false,
  clickRateDefinition: '届いた人のうち、1回でも押した人の割合です。同じ人が何度押しても1人と数えます。',
  links: [
    {
      trackedLinkId: 'tl-1', name: '夏の特集ページ', originalUrl: 'https://example.co.jp/summer',
      shortCode: 's3k9', isActive: true,
      actions: { tagName: '夏CP', scenarioName: null },
      clicks: M(1840), knownClickPeople: M(812), deliveredPeople: M(4801), clickRate: M(16.9),
      firstClickedAt: M('2026-08-13T02:10:00.000Z'), lastClickedAt: M('2026-08-24T11:40:00.000Z'),
      usageLocations: ['一斉配信「夏のご案内」'],
    },
    {
      trackedLinkId: 'tl-2', name: '空き枠を見る', originalUrl: 'https://example.co.jp/slots',
      shortCode: 'b7m2', isActive: true,
      actions: { tagName: null, scenarioName: '体験前フォロー' },
      clicks: M(1420), knownClickPeople: M(704), deliveredPeople: M(3860), clickRate: M(18.2),
      firstClickedAt: M('2026-08-01T00:00:00.000Z'), lastClickedAt: M('2026-08-25T01:20:00.000Z'),
      usageLocations: ['シナリオ「体験前フォロー」・2通目'],
    },
    {
      /*
        **配った人数が取れないリンク。** 押された数は分かるが割合は出せない。
        0 と書くと「誰にも届いていないのに押された」というありえない絵になる。
      */
      trackedLinkId: 'tl-3', name: '資料ダウンロード', originalUrl: 'https://example.co.jp/download',
      shortCode: 'd1x4', isActive: true,
      actions: { tagName: null, scenarioName: null },
      clicks: M(922), knownClickPeople: M(348),
      deliveredPeople: M(null, 'unavailable', 'このリンクを配った人数を持っていません'),
      clickRate: M(null, 'unavailable', '配った人数が無いので出せません'),
      firstClickedAt: M('2026-07-02T00:00:00.000Z'), lastClickedAt: M('2026-08-20T09:00:00.000Z'),
      usageLocations: ['リッチメニュー「通常メニュー（会員向け）」'],
    },
    {
      /* 一度も押されていないリンク。**0件（未取得ではない）。** */
      trackedLinkId: 'tl-4', name: '旧キャンペーン', originalUrl: 'https://example.co.jp/spring',
      shortCode: 'p0q8', isActive: false,
      actions: { tagName: null, scenarioName: null },
      clicks: M(0), knownClickPeople: M(0), deliveredPeople: M(1240), clickRate: M(0),
      firstClickedAt: M(null, 'unavailable', 'まだ押されていません'),
      lastClickedAt: M(null, 'unavailable', 'まだ押されていません'),
      usageLocations: [],
    },
  ],
})
