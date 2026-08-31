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

/**
 * 一斉配信の帯（`components/broadcasts/broadcast-kpis.tsx`）。
 *
 * **用意していなかったので「予約中 undefined」と出ていました。**
 * 画面は `stats` が在るかしか見ず、欠けた項目をそのまま繋ぐので、
 * 中身の無い返事でも文字として `undefined` が出ます。
 *
 * 数は設計 `q76C35` の帯から。予約中4件・今月12件・1,842人へ到達・
 * 平均開封率69.4%。**失敗は設計に数が無いので実値0**（未取得の `—` とは別）。
 */
export const BROADCAST_STATS = {
  thisMonth: 12,
  scheduled: 4,
  delivered: 1842,
  failed: 0,
  openRate: 69.4,
}

/**
 * マイルの使い道（`GET /api/mileage/rewards`、設計 `qlVLJ`・`p9CcEB`）。
 *
 * 型は `apps/web/src/lib/api.ts` の `MileageRewardOverview` と
 * `MileageReward`。**確かめたいことを1件ずつ入れてあります。**
 *
 *   - **公開版が固定されているか**
 *     `currentPublishedVersionId` と `currentDraftVersionId` を別々に持つ行を置く。
 *     直しても公開中の版は動かない、という形が絵で見える。
 *   - **交換に失敗したときの決めごと**
 *     `failurePolicy` は `retry`（もう一度試す）・`refund`（マイルを戻す）・
 *     `manual`（人が確かめる）の3つを1件ずつ。
 *   - **未取得と0の区別**
 *     `neverRedeemedFriendCount` は `null`（＝まだ数えていない）。
 *     `availableCodeCount` は 0（＝数えて0）と `null`（＝上限なし）を分ける。
 */
const reward = (
  id, name, kind, status, sortOrder, version, exchangedThisMonth, availableCodeCount,
) => ({
  id, lineAccountId: 'visual-qa-account', programId: 'mp-1',
  name, description: null, imageUrl: null,
  rewardKind: kind, status, sortOrder,
  currentDraftVersionId: version?.draftId ?? null,
  currentPublishedVersionId: version?.publishedId ?? null,
  currentVersion: version ? {
    id: version.publishedId ?? version.draftId,
    versionNumber: version.number,
    status: version.publishedId ? 'published' : 'draft',
    requiredMiles: version.requiredMiles,
    stockLimit: version.stockLimit ?? null,
    perFriendLimit: version.perFriendLimit ?? null,
    startsAt: version.startsAt ?? null,
    endsAt: version.endsAt ?? null,
    benefitExpiresDays: version.benefitExpiresDays ?? null,
    commonActionVersionId: version.commonActionVersionId ?? null,
    failurePolicy: version.failurePolicy,
    customerMessage: version.customerMessage,
    publishedAt: version.publishedAt ?? null,
  } : null,
  exchangedThisMonth,
  availableCodeCount,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-08-24T02:00:00.000Z',
})

export const MILEAGE_REWARDS = {
  rewards: [
    /* 公開中。**直しかけの版（v3）が別にあり、公開中は v2 のまま。** */
    reward('mr-1', '送料無料クーポン', 'coupon', 'published', 0, {
      publishedId: 'mrv-1-2', draftId: 'mrv-1-3', number: 2,
      requiredMiles: 500, stockLimit: 200, perFriendLimit: 1,
      startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-09-30T14:59:59.000Z',
      benefitExpiresDays: 30, commonActionVersionId: 'cav-4',
      failurePolicy: 'retry',
      customerMessage: 'クーポンをお送りしました。ご注文時にご利用ください。',
      publishedAt: '2026-08-01T01:00:00.000Z',
    }, 128, 72),
    /* 公開中。在庫を数えて0。**「0件」であって未取得ではない。** */
    reward('mr-2', '500円ぶんのお買い物券', 'coupon', 'published', 1, {
      publishedId: 'mrv-2-1', number: 1,
      requiredMiles: 1000, stockLimit: 50, perFriendLimit: 1,
      benefitExpiresDays: 60, failurePolicy: 'refund',
      customerMessage: 'お買い物券をお送りしました。',
      publishedAt: '2026-07-15T01:00:00.000Z',
    }, 42, 0),
    /* 公開中。上限なしなので在庫は `null`（＝数える対象がない）。 */
    reward('mr-3', '先行案内に登録', 'early_access', 'published', 2, {
      publishedId: 'mrv-3-1', number: 1,
      requiredMiles: 3000, failurePolicy: 'manual',
      customerMessage: '先行案内へご登録しました。次回の入荷からお知らせします。',
      publishedAt: '2026-06-01T01:00:00.000Z',
    }, 6, null),
    /* 下書き。**まだ一度も公開していない。** */
    reward('mr-4', '会員ランクをひとつ上げる', 'rank', 'draft', 3, {
      draftId: 'mrv-4-1', number: 1,
      requiredMiles: 8000, failurePolicy: 'manual',
      customerMessage: '',
    }, 0, null),
    /* 止めている。過去の交換は残る。 */
    reward('mr-5', '旧キャンペーンのクーポン', 'coupon', 'stopped', 4, {
      publishedId: 'mrv-5-2', number: 2,
      requiredMiles: 800, stockLimit: 100, perFriendLimit: 1,
      failurePolicy: 'refund',
      customerMessage: 'クーポンをお送りしました。',
      publishedAt: '2026-04-01T01:00:00.000Z',
    }, 0, 34),
  ],
  summary: {
    publishedCount: 3,
    redeemedMilesThisMonth: 186_400,
    /* **まだ数えていない。0人ではない。** */
    neverRedeemedFriendCount: null,
    mostRedeemedRewardName: '送料無料クーポン',
    mostRedeemedRewardCount: 128,
  },
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
    pending: 300,
    lifetimeEarned: 3750,
    spent: 1000,
  },
  /*
    **`insights` と `connections` を落とさない。** `/mileage/friends/detail`
    （`HIU5O`）が `mileage.insights` `mileage.connections` を読む。
    無いと画面が落ちて撮れない。
  */
  insights: {
    accountCount: 2,
    rewardedActions: 34,
    referralMiles: 1200,
    qualityReferralCount: 3,
    lastEarnedAt: '2026-08-24T16:30:00.000Z',
  },
  connections: [
    { accountId: 'visual-qa-account', accountName: 'LINE 本店', friendId: 'friend-1' },
    { accountId: 'visual-qa-account-2', accountName: 'LINE 二号店', friendId: 'friend-11' },
  ],
  /* `entryType` `status` は型の言葉から選ぶ（`MileageHistoryItem`）。 */
  history: [
    {
      id: 'fm-1', entryType: 'grant', status: 'available', amount: 120,
      reason: 'リンクを押した', source: 'tracked_link', sourceEventId: 'ev-1',
      /* #494 で増えた2項目。手で動かした行だけ実行者と調整元IDが入る。 */
      sourceReferenceId: null, executedByStaffName: null,
      ruleName: 'リンククリックで120', mode: 'automatic',
      sourceReferenceId: null, executedByStaffName: null,
      occurredAt: '2026-08-24T16:30:00.000Z',
    },
    {
      id: 'fm-2', entryType: 'spend', status: 'available', amount: -1000,
      reason: 'クーポンと引き換え', source: 'manual', sourceEventId: 'ev-2',
      sourceReferenceId: 'ORD-20260822-004', executedByStaffName: '佐々木 亮太',
      ruleName: null, mode: 'manual',
      occurredAt: '2026-08-22T09:45:00.000Z',
    },
    {
      /* まだ確定していない。**`pending` を1件混ぜる。** */
      id: 'fm-3', entryType: 'grant', status: 'pending', amount: 300,
      reason: '回答フォームに答えた', source: 'form', sourceEventId: 'ev-3',
      sourceReferenceId: null, executedByStaffName: null,
      ruleName: 'フォーム回答で300', mode: 'automatic',
      occurredAt: '2026-08-20T02:10:00.000Z',
    },
    {
      /*
        **#494 で撮る行。** 手で増やしたぶん。`sourceReferenceId` に
        問い合わせ番号、`executedByStaffName` に押した人が入る。
        **誰がなぜ動かしたかが残る**ことを見る。
      */
      id: 'fm-5', entryType: 'adjustment', status: 'available', amount: 500,
      reason: '問い合わせ対応：配送遅延のお詫び', source: 'admin_adjustment', sourceEventId: null,
      sourceReferenceId: 'INQ-20260823-018', executedByStaffName: '佐々木 亮太',
      ruleName: null, mode: 'manual',
      occurredAt: '2026-08-23T05:00:00.000Z',
    },
    {
      /* **もとの出来事が残っていない。** 理由をたどれない行。 */
      id: 'fm-4', entryType: 'expiration', status: 'void', amount: -80,
      reason: '期限切れ', source: 'line', sourceEventId: null,
      sourceReferenceId: null, executedByStaffName: null,
      ruleName: null, mode: 'automatic',
      occurredAt: '2026-07-30T23:15:00.000Z',
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
/**
 * 一斉配信のフォルダ。設計 `q76C35` の左パネル（予約配信・キャンペーン・
 * EC・フォロー）。**フォルダが1つも無いと「…」の操作が描かれず、
 * 撮影が「目印が見つからない」で止まる。**
 */
export const BROADCAST_FOLDERS = [
  ['bf-scheduled', '予約配信'],
  ['bf-campaign', 'キャンペーン'],
  ['bf-ec', 'EC・フォロー'],
].map(([id, name], index) => ({
  id: String(id),
  kind: 'broadcast',
  name: String(name),
  parentId: null,
  displayOrder: index,
  color: null,
  createdAt: '2026-01-13T00:00:00.000Z',
  updatedAt: '2026-01-13T00:00:00.000Z',
}))

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
        /*
          **`category` は古い欄で、いまは誰も入れない。**`templates` 表の既定は
          `'general'`（`bootstrap.sql`）。ここに `'text'` と書いていたせいで、
          フォルダの縦帯に「text」と出て**種別の不具合のように見えていた**。
          既定値に戻す。**縦帯が `folderId` でなく `category` を数えている**
          という指摘は、値に関係なく残る（`templates/page.tsx:180`）。
        */
        category: 'general',
        messageType: 'text',
        messageContent: `${label}のご連絡です。内容をご確認ください。`,
        folderId,
        /*
          **`usageCount` と `tapCount` は必須**（`templates/page.tsx:14-25`）。
          入れないと「**undefined件で使用**」と出て、実装の不具合に見える。

          **`0` を混ぜる。** 使用中の行は操作が「使用先を見る」に変わり、
          削除の窓（`M9cij`）へ行けない。「未使用」の絞り込みも
          `usageCount === 0` を数えるので、0が1つも無いと空になる。
        */
        usageCount: i % 3 === 0 ? 0 : i * 2,
        tapCount: 0,
        /*
          **`isFavorite` は必須**（`templates/page.tsx:26`）。左の縦帯の
          「よく使う」がこれを数える。入れないと `undefined` が偽になり、
          **絞り込みが常に0件**になって、切替が効いていないように見える。
        */
        isFavorite: i === 0,
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
/*
  受信箱の保存した検索。**Workerは `conditions` を保存されたまま返す**
  （`routes/chats.ts:135` が `JSON.parse(...) as unknown`）。
  保存した検索の仕組みは受信箱より前からあるので、**古い行は
  `{ all: [], any: [] }` の形で入っている**。3件目をその形のままにして、
  古い保存を開いても落ちないことを撮影で確かめられるようにする。
*/
export const INBOX_SAVED_VIEWS = [
  ['VIPかつ未契約', true, {
    version: 1, query: '', channels: ['line'], statuses: ['unread', 'on_hold'],
    assignees: [], unread: 'all', messageTypes: [], receivedFrom: null, receivedTo: null,
    sort: 'newest',
  }],
  ['未対応・担当なし', true, {
    version: 1, query: '', channels: [], statuses: ['unread'],
    assignees: ['unassigned'], unread: 'all', messageTypes: [], receivedFrom: null,
    receivedTo: null, sort: 'waiting_desc',
  }],
  // 受信箱より前に作られた保存。画面が決めつけて読むと、ここで落ちる。
  ['自分の未対応', false, { all: [], any: [] }],
].map(([name, isShared, conditions], index) => ({
  id: `inbox-view-${index}`,
  name: String(name),
  scope: 'chats',
  conditions,
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
    /*
      一覧の鍵は Worker が `COALESCE(url_token, 'uid:'||friends.user_id,
      'solo:'||friends.id)` で組む（`services/users-grouped.ts`）。
      **種別ごとに形が違う。** 全部を `identity-N` にしていたころは、
      統合ユーザー詳細（`w8W4Eh`）を開く先が取り出せなかった。
    */
    identityKey: kind === 'uid'
      ? 'uid:merged-person-1'
      : kind === 'solo' ? `solo:friend-${index}` : `tok_${index}`,
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
  /*
    **`reachRate` です。`reachedRate` ではありません。**
    `packages/shared/src/types.ts` の `ScenarioStats` に照らして直しました。
    別名で書くと握りつぶされ、何も試していない絵が基準になります。
  */
  steps: SCENARIO_STEPS.map((step, index) => ({
    stepOrder: step.stepOrder,
    reachedCount: [428, 381, 312][index] ?? 0,
    reachRate: [1, 0.89, 0.73][index] ?? 0,
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
  /*
    **どのアカウントの配信かを持たせる。** 持たせないと、予約完了の画面
    （`/broadcasts/reserved`）が「選択中のアカウントの配信ではありません」で
    止まり、設計と並べる面が出ない。**空のまま撮って合格にしない。**
  */
  lineAccountId: 'visual-qa-account',
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
/**
 * ウェビナーの通知とリマインド（`GET /api/webinars/:id/notifications`、設計 `Ho8z4`）。
 *
 * **用意していないと、一覧の既定が返って `overview` が無く、画面ごと落ちます。**
 * 型は `WebinarNotificationSettings` と `WebinarNotificationOverview`
 * （`components/webinars/webinar-notifications.tsx` の既定値と同じ形）。
 *
 * 数は**すべて実値**。取れないものは入れていません。
 */
export const WEBINAR_NOTIFICATIONS = {
  settings: {
    registrationEnabled: true,
    dayBeforeEnabled: true,
    dayBeforeTime: '20:00',
    hourBeforeEnabled: true,
    hourBeforeMinutes: 60,
    startEnabled: true,
    missedEnabled: true,
    missedTime: '10:00',
    completedEnabled: true,
  },
  overview: { total: 184, pending: 42, sent: 138, failed: 2, skipped: 1, cancelled: 1 },
}

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
  {
    /*
      **消せる下書き。** 削除の失敗（405）を撮るのに要る。
      `rmg-4` はほかから参照されていて削除の押し口が出ないので、
      その1件だけでは「押した先」を撮れない。
    */
    id: 'rmg-5', accountId: 'visual-qa-account', name: '未使用の下書き',
    chatBarText: 'メニュー', size: 'compact', defaultPageId: null,
    isDefaultForAll: false, status: 'draft', publishingAt: null,
    targetingCondition: null, targetingPriority: 5, targetingEnabled: false,
    folderId: null, displayOrder: 5, thumbnailR2Key: null,
    updatedAt: '2026-08-14T00:00:00.000Z',
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

/**
 * 切替のつながり（設計 `DIUbO`）を出すための面。
 *
 * **設計が指摘しているのは「戻れない」ことです。**
 * トップ → 商品／予約 の2本を張り、**商品からはトップへ戻れるが、
 * 予約からは戻れない**形にしてあります。つながりが1本も無いと
 * `NXdDk`（つながりなし）の絵しか撮れません。
 */
const switchArea = (id, label, targetPageId) =>
  rmArea(id, 0, 0, 833, 843, label, 'richmenuswitch', { targetPageId }, null)

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
        areas: [
          ...sixAreas('rma-top'),
          switchArea('rma-top-s1', '商品を見る', 'rmp-2'),
          switchArea('rma-top-s2', '予約する', 'rmp-3'),
        ],
      },
      {
        id: 'rmp-2', orderIndex: 1, name: '商品を見る', aliasId: 'products',
        lineRichmenuId: 'richmenu-products', imageR2Key: 'rm/products.png', imageContentType: 'image/png',
        areas: [...sixAreas('rma-products'), switchArea('rma-products-s1', 'トップへ戻る', 'rmp-1')],
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

/**
 * フォーム定義（`FormLayout` v2）。**#586 の「回答の保存先」がこれを数える。**
 *
 * 形は `packages/shared/src/form-layout.ts:212`。数え方は
 * `summarizeFormDestinations()`——`Set` に入れるので、**同じ情報欄・タグを
 * 複数の質問で使っても1つとして数える**。
 *
 * 数える先は4通りある。**全部を1枚に入れてある：**
 * 1. 入力欄の `destinations.friendFieldIds`
 * 2. `destinations.realName` / `displayName` / `note`（`friends.real_name` 等）
 * 3. `choiceMode: 'tag'` の選択肢の `tagId`、`choiceMode: 'friendField'` の
 *    `choiceFriendFieldId`、`choiceMode: 'action'` の中の動作
 * 4. `options.afterActions` と、フォームの `onSubmitTagId`
 */
function formLayout(sections, afterActions = []) {
  return {
    version: 2,
    header: [],
    sections: sections.map((blocks, index) => ({
      id: `sec-${index + 1}`,
      name: `${index + 1}ページ目`,
      blocks,
    })),
    options: { afterActions },
  }
}

/** 入力欄1つ。 */
function input(id, name, label, type, extra = {}) {
  return { id, kind: 'input', type, name, label, ...extra }
}

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
    /*
      **重複を入れてある。**`次回のご来店予定` と `ご満足度` が同じ
      `field-birthday` を指し、`よかったところ` の選択肢2つが同じ `tag-0` を
      指す。数えて **友だち情報欄 3・タグ 2** になるのが正しい
      （`field-birthday` / `friends.real_name` / `field-plan`、`tag-0` / `tag-1`）。
      重複を数えると 5・4 になるので、**この1枚で `Set` が効いているか分かる**。
    */
    onSubmitTagId: 'tag-1',
    layout: formLayout([[
      input('b1', 'name', 'お名前', 'text', { destinations: { realName: true } }),
      input('b2', 'satisfaction', 'ご満足度', 'radio', {
        choiceMode: 'friendField', choiceFriendFieldId: 'field-birthday',
        choices: [{ id: 'c1', label: '満足' }, { id: 'c2', label: 'ふつう' }],
      }),
      input('b3', 'good_points', 'よかったところ', 'checkbox', {
        choiceMode: 'tag',
        choices: [{ id: 'c3', label: '接客', tagId: 'tag-0' }, { id: 'c4', label: '雰囲気', tagId: 'tag-0' }],
      }),
      input('b4', 'comment', 'ご意見・ご要望', 'textarea'),
      input('b5', 'next_visit', '次回のご来店予定', 'date', {
        destinations: { friendFieldIds: ['field-birthday', 'field-plan'] },
      }),
    ]]),
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
    /* 送信後の動作から数える例。友だち情報欄 1・タグ 1。 */
    onSubmitTagId: null,
    layout: formLayout([[
      input('b6', 'name', 'お名前', 'text'),
      input('b7', 'email', 'メールアドレス', 'email'),
    ]], [
      { kind: 'friend_field', fieldId: 'field-plan', value: '資料請求' },
      { kind: 'tag', op: 'add', tagIds: ['tag-2'] },
    ]),
  },
  {
    id: 'form-3', name: '休止の理由', description: '定期便を止めたい人に聞く',
    fields: [
      { name: 'reason', label: '休止の理由', type: 'radio' },
      { name: 'detail', label: 'くわしく', type: 'textarea' },
    ],
    isActive: true, submitCount: 96,
    /* **保存先が1つも無いフォーム。**`友だち情報欄 0・タグ 0` と出るべきで、`—` ではない。 */
    onSubmitTagId: null,
    layout: formLayout([[
      input('b8', 'reason', '休止の理由', 'radio', { choices: [{ id: 'c5', label: '価格' }] }),
      input('b9', 'detail', 'くわしく', 'textarea'),
    ]]),
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
    /*
      **定義は必ず付ける。**Worker の `parseLayout()` は `null` を返さず、
      定義が無ければ `fields` から作り、それも無ければ空の定義を返す
      （`packages/shared/src/form-layout.ts:447`）。**定義の無いフォームは
      口から返ってこない**ので、ここで省くと実際には起きない形になる。
      選択肢に動作を付けた例。友だち情報欄 1・タグ 1。
    */
    onSubmitTagId: null,
    layout: formLayout([[
      input('b10', 'choice', 'どれが気になりますか', 'radio', {
        choiceMode: 'action',
        choices: [
          { id: 'c6', label: '和風', actions: [{ kind: 'tag', op: 'add', tagIds: ['tag-3'] }] },
          { id: 'c7', label: '洋風', actions: [{ kind: 'friend_field', fieldId: 'field-plan', value: '洋風' }] },
        ],
      }),
    ]]),
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
 * 共通情報「変える前に影響を見る」。#548 の `CommonVarUsageImpact` と同じ形。
 *
 * 回答フォームはまだLINEアカウント所属を持たないため、本文や名前を作らず
 * `unscopedFormTotal` の件数だけにする。送信済み配信も1件入れ、変更される
 * 文と過去の記録を同じものとして扱う実装を捕まえる。
 */
const COMMON_VAR_ACTIVE_PREVIEWS = [
  ['tpl-1', '来店予約の前日案内', '明日は株式会社NENへお越しください。'],
  ['tpl-2', '初回のお礼', '株式会社NENをご利用いただきありがとうございます。'],
  ['tpl-3', '営業時間外の案内', '株式会社NENの営業時間外にお問い合わせを受け付けました。'],
  ['tpl-4', '予約確定のお知らせ', '株式会社NENでご予約を承りました。'],
  ['tpl-5', '発送のお知らせ', '株式会社NENから商品を発送しました。'],
  ['tpl-6', 'イベント参加案内', '株式会社NENのイベント会場をご案内します。'],
  ['tpl-7', '相談会のご案内', '株式会社NENの個別相談をご予約いただけます。'],
  ['tpl-8', '資料送付のお知らせ', '株式会社NENの資料をお送りします。'],
  ['tpl-9', '購入後のご案内', '株式会社NENでのお買い上げありがとうございます。'],
  ['tpl-10', 'アンケートのお願い', '株式会社NENのアンケートにご協力ください。'],
  ['tpl-11', '会員登録のご案内', '株式会社NENの会員登録が完了しました。'],
  ['tpl-12', 'お問い合わせ受付', '株式会社NENがお問い合わせを受け付けました。'],
]

export const COMMON_VAR_IMPACT = {
  total: 16,
  blockingTotal: 15,
  historicalTotal: 1,
  unscopedFormTotal: 3,
  canDelete: false,
  byKind: {
    template: 12,
    broadcast: 1,
    scenario: 0,
    reminder: 0,
    auto_reply: 0,
    form: 3,
    automation: 0,
  },
  items: [
    ...COMMON_VAR_ACTIVE_PREVIEWS.map(([sourceId, name, currentPreview]) => ({
      kind: 'template',
      kindLabel: 'テンプレート',
      sourceId,
      name,
      status: '使われています',
      href: `/templates/edit?id=${sourceId}`,
      changesOnSave: true,
      currentPreview,
      nextPreview: currentPreview.replaceAll('株式会社NEN', '株式会社NENグループ'),
    })),
    {
      kind: 'broadcast',
      kindLabel: '一斉配信',
      sourceId: 'broadcast-sent-1',
      name: '8月のお知らせ',
      status: '送信済み・変わりません',
      href: '/broadcasts/broadcast-sent-1',
      changesOnSave: false,
      currentPreview: '株式会社NENから8月のお知らせです。',
      nextPreview: '株式会社NENグループから8月のお知らせです。',
    },
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
    /* 使用中。**「3か所で使用中」と出る。** */
    usageCount: 3,
  },
  {
    id: 'media-2', folderId: 'mf-banner', kind: 'image', filename: '会員証バナー.png',
    mimeType: 'image/png', sizeBytes: 839680, width: 2500, height: 1686, durationMs: null,
    url: 'https://example.co.jp/media/member-banner.png', uploadedBy: '川野 健太',
    createdAt: '2026-08-14T00:00:00.000Z',
    usageCount: 1,
  },
  {
    /* 動画。**184MB。** 上限に近いものが混ざっていることが要る。 */
    id: 'media-3', folderId: 'mf-video', kind: 'video', filename: '店内のようす.mp4',
    mimeType: 'video/mp4', sizeBytes: 192937984, width: 1920, height: 1080, durationMs: 80000,
    url: 'https://example.co.jp/media/shop.mp4', uploadedBy: '菅野 亮',
    createdAt: '2026-08-10T00:00:00.000Z',
    /* 数えて0。**「どこでも使っていない」。未取得とは別。** */
    usageCount: 0,
  },
  {
    id: 'media-4', folderId: 'mf-banner', kind: 'image', filename: '誕生月クーポン.png',
    mimeType: 'image/png', sizeBytes: 215040, width: 1029, height: 1029, durationMs: null,
    url: 'https://example.co.jp/media/birthday-coupon.png', uploadedBy: '川野 健太',
    createdAt: '2026-08-05T00:00:00.000Z',
    usageCount: 2,
  },
  {
    /* どこでも使っていないファイル。**消してよいものが分かることが要る。** */
    id: 'media-5', folderId: null, kind: 'file', filename: 'メニュー表.pdf',
    mimeType: 'application/pdf', sizeBytes: 1258291, width: null, height: null, durationMs: null,
    url: 'https://example.co.jp/media/menu.pdf', uploadedBy: '菅野 亮',
    createdAt: '2026-07-28T00:00:00.000Z',
    usageCount: 0,
  },
  {
    id: 'media-6', folderId: 'mf-product', kind: 'image', filename: '定期便パンフ.jpg',
    mimeType: 'image/jpeg', sizeBytes: 491520, width: 1024, height: 678, durationMs: null,
    url: 'https://example.co.jp/media/subscription.jpg', uploadedBy: '川野 健太',
    createdAt: '2026-07-20T00:00:00.000Z',
    /*
      **`usageCount` を持たせない＝まだ数えていない。**
      これが「どこでも使っていない」と同じ扱いにならないかを見る。
      0件へ絞ったときに出てこないこと、まとめて消す側に入らないことが要る。
    */
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
/**
 * 紹介者1人ぶんの内訳（`GET /api/affiliates/:id/report`、設計 `jwrbf`）。
 *
 * **用意しないと一覧の既定が返り、`report.clicks` で画面ごと落ちます。**
 * 型は `apps/web/src/app/affiliates/tabs.tsx` の `ReportV2`。
 *
 * **承認待ちを確定報酬へ入れないことを、ここで確かめられる形にしてあります。**
 * 案件ごとの内訳は 承認ずみ16件 × ¥9,000 = ¥144,000 で、
 * 承認待ち2件（¥18,000ぶん）は `confirmedReward` に入っていません。
 */
export const AFFILIATE_REPORT_V2 = {
  affiliateId: 'aff-2', affiliateName: '合同会社ノース', code: 'north', commissionRate: 0,
  clicks: 2180, linkClicks: 2180, friendAdds: 312,
  conversions: 18, conversionsPending: 2, conversionsApproved: 16, conversionsRejected: 0,
  conversionsByPoint: [
    { conversionPointId: 'cp-1', name: '体験申込フォームの送信', count: 11, value: 880_000 },
    { conversionPointId: 'cp-2', name: '定期便の申込', count: 7, value: 560_000 },
  ],
  revenue: 1_440_000,
  estimatedCommission: 0,
  confirmedReward: 144_000,
  byOffer: [
    {
      offerId: 'ao-1', offerName: '定期便の申込', rewardAmount: 9_000,
      conversionsApproved: 16, conversionsPending: 2, confirmedReward: 144_000,
    },
  ],
  duplicateFlags: [],
}

/**
 * 帰属ジャーニー（`GET /api/affiliates/:id/journeys`、内訳の面の下）。
 *
 * **返事は配列。** 一覧の既定（`{items,total,…}`）を返すと
 * `journeys.map is not a function` で内訳の面ごと落ちます。
 */
export const AFFILIATE_JOURNEYS = [
  {
    friendId: 'friend-1', displayName: '高橋 直人', addedAt: '2026-08-20T01:00:00.000Z',
    refCode: 'north', touchCount: 4, formCount: 1, conversionCount: 1,
    lastEventAt: '2026-08-24T05:00:00.000Z',
  },
  {
    friendId: 'friend-11', displayName: null, addedAt: '2026-08-18T02:00:00.000Z',
    refCode: 'north', touchCount: 2, formCount: 0, conversionCount: 0,
    lastEventAt: '2026-08-18T02:30:00.000Z',
  },
]

/**
 * 紹介者の計測リンク（`GET /api/affiliates/:id/links`）。
 *
 * **列の名前はDBのまま**（`ref_code` `click_count` `offer_id` …）。
 * 型（`api.ts` の `affiliates.links`）がそう決めているので、
 * 固定データも合わせる。**別名で書くと画面が数を読めない。**
 */
export const AFFILIATE_LINKS = [
  {
    id: 'al-1', affiliate_id: 'aff-2', ref_code: 'north',
    label: '定期便のご案内', line_account_id: 'visual-qa-account',
    is_active: 1, created_at: '2026-06-01T00:00:00.000Z',
    click_count: 1480, offer_id: 'ao-1', offer_name: '定期便の申込',
  },
  {
    id: 'al-2', affiliate_id: 'aff-2', ref_code: 'north-trial',
    label: '体験申込', line_account_id: 'visual-qa-account',
    is_active: 1, created_at: '2026-06-20T00:00:00.000Z',
    click_count: 700, offer_id: null, offer_name: null,
  },
]

export const AFFILIATES_REPORT = [
  {
    affiliateId: 'aff-1', affiliateName: '田中 明', code: 'tanaka01', commissionRate: 10,
    totalClicks: 1240, totalConversions: 12, totalRevenue: 860000,
    /* 率で払う人。**確定した定額分は持っていても使われない**（率が勝つ）。 */
    confirmedReward: 0,
    linkCount: 3, friendAdds: 86,
  },
  {
    affiliateId: 'aff-2', affiliateName: '合同会社ノース', code: 'north', commissionRate: 0,
    totalClicks: 2180, totalConversions: 18, totalRevenue: 1440000,
    /*
      **案件ごとの決まった額で払う人。** 率は0%なので、ここが0だと
      一覧でずっと ¥0 に見える。18件のうち**承認ずみ16件 × ¥9,000 = ¥144,000**。
      **承認待ちの2件は入れない。**
    */
    confirmedReward: 144000,
    linkCount: 5, friendAdds: 312,
  },
  {
    affiliateId: 'aff-3', affiliateName: '木村 亮', code: 'kimura', commissionRate: 15,
    totalClicks: 1400, totalConversions: 12, totalRevenue: 620000,
    confirmedReward: 0,
    linkCount: 2, friendAdds: 214,
  },
  {
    /* 止めている人。**クリックも成果も0。** 0で崩れないことが要る。 */
    affiliateId: 'aff-4', affiliateName: '旧パートナーA', code: 'legacy-a', commissionRate: 5,
    totalClicks: 0, totalConversions: 0, totalRevenue: 0, confirmedReward: 0, linkCount: 1, friendAdds: 0,
  },
]

/** 成果地点（`ConversionPoint`）。設計は「成果地点3つ」。 */
/**
 * 成果地点。**型は `ConversionPointWithUsage`（`api.ts:97`）。**
 *
 * `usedIn` は**必ず入れる。** 型の覚え書きに「理由が無いときも空配列を
 * 返す。省略は『未取得』と区別するため使わない」とある。省くと
 * `point.usedIn.length` で画面が落ちる（`conversions/page.tsx:181`）。
 *
 * `status` は `'active' | 'stopped'`。止めたものは操作の列が
 * 「過去実績を保持」になる。**止めた側も撮れるように1件混ぜてある。**
 */
export const CONVERSION_POINTS = [
  {
    id: 'cp-1', name: '体験申込フォームの送信', eventType: 'form_submit', value: 3000,
    measureMethod: 'manual', targetUrl: null, countRepeat: false, attributionDays: 30,
    lineAccountId: null, status: 'active', stoppedAt: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    usedIn: [
      { conversionPointId: 'cp-1', kind: 'analytics_funnel', consumerId: 'fn-1', consumerName: '体験申込までの流れ', href: '/analytics?tab=funnel' },
      { conversionPointId: 'cp-1', kind: 'analytics_funnel', consumerId: 'fn-2', consumerName: '8月キャンペーンの効き', href: '/analytics?tab=funnel' },
    ],
  },
  {
    /* どこからも使われていない。**「0件」を撮るための1件。** */
    id: 'cp-2', name: '定期便の申込', eventType: 'purchase', value: 8000,
    measureMethod: 'url_reach', targetUrl: 'https://example.co.jp/thanks/subscription',
    countRepeat: false, attributionDays: 90, lineAccountId: null,
    status: 'active', stoppedAt: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    usedIn: [],
  },
  {
    /*
      **`eventType` は画面が名前を知っている言葉から選ぶ**
      （`conversions/page.tsx` の `EVENT_TYPE_LABELS`）。
      `'download'` のような知らない言葉を入れると、種別の列に
      **英語のまま**出て、実装の不具合に見える。
    */
    id: 'cp-3', name: '資料ダウンロード', eventType: 'url_click', value: null,
    measureMethod: 'url_reach', targetUrl: 'https://example.co.jp/download/done',
    countRepeat: true, attributionDays: null, lineAccountId: null,
    status: 'active', stoppedAt: null,
    createdAt: '2026-06-11T00:00:00.000Z',
    usedIn: [
      { conversionPointId: 'cp-3', kind: 'analytics_funnel', consumerId: 'fn-3', consumerName: '資料からの申込', href: '/analytics?tab=funnel' },
    ],
  },
  {
    /* すでに止めてある。操作の列が「過去実績を保持」になる。 */
    id: 'cp-4', name: '旧キャンペーンの申込', eventType: 'form_submit', value: 2000,
    measureMethod: 'manual', targetUrl: null, countRepeat: false, attributionDays: 30,
    lineAccountId: null, status: 'stopped', stoppedAt: '2026-07-31T15:00:00.000Z',
    createdAt: '2026-01-10T00:00:00.000Z',
    usedIn: [],
  },
]

/** 計測をやめるときに出す影響。`/api/conversions/points/:id/impact`。 */
export const CONVERSION_POINT_IMPACTS = {
  'cp-1': { eventCount: 128, totalValue: 384000 },
  'cp-2': { eventCount: 42, totalValue: 336000 },
  'cp-3': { eventCount: 0, totalValue: 0 },
  'cp-4': { eventCount: 9, totalValue: 18000 },
}

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
/**
 * マイルの付与ルール。**`eventType` は画面の `EVENT_LABELS`
 * （`mileage/page.tsx:20-34`）にある言葉から選ぶ。**
 * `friend_add` `message` `booking` のような自作の名前を書くと、
 * きっかけの列に**英語がそのまま**出て、実装の不具合に見える。
 */
export const MILEAGE_RULES = [
  {
    id: 'mr-1', name: '友だち登録してくれた', eventType: 'friend_registered', source: null,
    amount: 100, initialStatus: 'available',
    conditions: { uniquePerSubject: true },
    isActive: true, validFrom: null, validUntil: null,
    createdAt: '2025-11-03T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'mr-2', name: 'LINEでメッセージを送ってくれた', eventType: 'message_received', source: null,
    amount: 10, initialStatus: 'available',
    conditions: { dailyCapActions: 1 },
    isActive: true, validFrom: null, validUntil: null,
    createdAt: '2025-11-03T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'mr-3', name: '予約してくれたら 300 マイル', eventType: 'booking_created', source: 'booking',
    amount: 300, initialStatus: 'pending',
    conditions: { uniquePerSubject: true },
    isActive: true, validFrom: null, validUntil: null,
    createdAt: '2026-01-15T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'mr-4', name: '紹介の成果が認められた', eventType: 'affiliate_conversion_approved', source: 'affiliate',
    amount: 500, initialStatus: 'pending',
    conditions: { beneficiary: 'referrer', uniquePerReferredFriend: true },
    isActive: true, validFrom: null, validUntil: null,
    createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
  },
  {
    /* 止めている決めごと。**残高は減らないが、もう付かない。** */
    id: 'mr-5', name: '春のキャンペーン参加', eventType: 'link_clicked', source: null,
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

/**
 * NEN配信の段。**キーも並びも、`071_nen_engagement.sql` の種データどおり。**
 *
 * 勝手な名前（`shipped` `delivered` `pet_birthday` `winback`）で書いていた
 * ころは、画面が `campaignKey` で分岐する作り（`campaign-display.ts` の
 * `birthday_coupon`）に**一度も当たらず**、直っているものを
 * 「直っていない」と撮っていた。
 *
 * 実装が受け付けるキーは `nen-campaigns.ts:19-21` の5本だけだが、
 * 種データには7本ある（`order_confirmed` と `shipping_confirmed` は
 * 画面から編集できない）。**7本とも出す。** 編集できない段が一覧に
 * 並ぶことも、見るべきことのうち。
 */
export const NEN_CAMPAIGN_SETTINGS = [
  {
    campaignKey: 'order_confirmed', label: '注文完了', category: 'transactional',
    triggerEvent: 'ec.order.confirmed', delayDays: 0, deliveryTime: '10:00',
    isEnabled: true, title: '注文ありがとうございます',
    bodyText: 'ご注文ありがとうございます。発送まで少しお待ちください。',
    buttonLabel: '注文をみる', buttonUrl: 'https://example.co.jp/orders',
    imageUrl: null, updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    campaignKey: 'shipping_confirmed', label: '発送完了', category: 'transactional',
    triggerEvent: 'ec.order.shipped', delayDays: 0, deliveryTime: '10:00',
    isEnabled: true, title: 'お荷物の追跡番号',
    bodyText: '本日発送しました。追跡番号は {{追跡番号}} です。',
    buttonLabel: '追跡する', buttonUrl: 'https://example.co.jp/track',
    imageUrl: null, updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    campaignKey: 'arrival_check', label: '商品到着の確認', category: 'follow_up',
    triggerEvent: 'ec.order.shipped', delayDays: 5, deliveryTime: '10:00',
    isEnabled: true, title: '商品は無事に届きましたか？',
    bodyText: '発送から数日が経ちました。商品が無事に届いているか確認させてください。',
    buttonLabel: '注文内容を確認する', buttonUrl: 'https://example.co.jp/orders',
    imageUrl: null, updatedAt: '2026-08-02T00:00:00.000Z',
  },
  {
    campaignKey: 'review_request', label: '使用感・口コミのお願い', category: 'follow_up',
    triggerEvent: 'ec.order.shipped', delayDays: 10, deliveryTime: '10:00',
    isEnabled: true, title: '実際に使ってみていかがでしたか？',
    bodyText: '{{ペットの名前}}ちゃん、{{商品名}}はいかがでしたか。よろしければ、ひとことだけ感想を聞かせてください。',
    buttonLabel: '感想を送る', buttonUrl: 'https://example.co.jp/review',
    imageUrl: null, updatedAt: '2026-08-10T00:00:00.000Z',
  },
  {
    campaignKey: 'cross_sell', label: '他の商品・定期便のご案内', category: 'follow_up',
    triggerEvent: 'ec.order.shipped', delayDays: 14, deliveryTime: '10:00',
    isEnabled: false, title: '毎日のごはんを、もっと安心で手軽に',
    bodyText: '然-NEN-には、素材や食べ方に合わせた商品と、お得で続けやすい定期便があります。',
    buttonLabel: '商品をみる', buttonUrl: 'https://example.co.jp/items',
    imageUrl: null, updatedAt: '2026-07-20T00:00:00.000Z',
  },
  {
    campaignKey: 'column', label: 'NENコラム', category: 'column',
    triggerEvent: null, delayDays: 0, deliveryTime: '10:00',
    isEnabled: true, title: 'NENコラムを更新しました',
    bodyText: 'ジビエ、ペットフード、愛犬・愛猫の健康についてお届けします。',
    buttonLabel: 'コラムを読む', buttonUrl: 'https://example.co.jp/column',
    imageUrl: null, updatedAt: '2026-08-22T00:00:00.000Z',
  },
  {
    /*
      **`delayDays` は 0。** 誕生日の3日前は `delay_days` ではなく
      `birthdayDeliveryTarget`（`nen-engagement.ts:414-429`）が決めている
      （3日先の誕生日を探し、当日の10:00 JSTに送る）。
      画面は `campaignKey === 'birthday_coupon'` で言い分ける。
    */
    campaignKey: 'birthday_coupon', label: 'お誕生日クーポン', category: 'birthday',
    triggerEvent: null, delayDays: 0, deliveryTime: '10:00',
    isEnabled: true, title: '{{pet_name}}ちゃん、お誕生日月おめでとうございます',
    bodyText: '大切なお誕生日月をお祝いして、然-NEN-から特別なクーポンをお届けします。',
    buttonLabel: 'クーポンを受け取る', buttonUrl: 'https://example.co.jp/coupon',
    imageUrl: null, updatedAt: '2026-08-24T00:00:00.000Z',
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
  { id: 'nj-1', campaignKey: 'review_request', label: '使用感・口コミのお願い', friendName: 'Kenta Kawano', scheduledAt: '2026-08-25T11:00:00.000Z', status: 'pending', attempts: 0, lastError: null, sentAt: null },
  { id: 'nj-2', campaignKey: 'shipping_confirmed', label: '発送完了', friendName: 'Masato S.', scheduledAt: '2026-08-24T09:00:00.000Z', status: 'sent', attempts: 1, lastError: null, sentAt: '2026-08-24T09:00:02.000Z' },
  { id: 'nj-3', campaignKey: 'birthday_coupon', label: 'お誕生日クーポン', friendName: '菅野 亮', scheduledAt: '2026-08-24T01:00:00.000Z', status: 'sent', attempts: 1, lastError: null, sentAt: '2026-08-24T01:00:01.000Z' },
  /* 届かなかったもの。**ブロックされた人。** 理由が残ることが要る。 */
  { id: 'nj-4', campaignKey: 'arrival_check', label: '商品到着の確認', friendName: '山田 太郎', scheduledAt: '2026-08-23T01:00:00.000Z', status: 'failed', attempts: 3, lastError: 'ブロックされています', sentAt: null },
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
    eventType: 'friend_registered', conditions: {},
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
/**
 * 入った記録（`GET /api/login-audit`、設計 `jwVlo`）。
 *
 * **用意していなかったので、表が空のまま撮れていました。** 空の絵を設計と
 * 並べても何も比べていないので、実型に合わせて入れます。
 *
 * 型は `apps/web/src/lib/api.ts` の `loginAudit.list` の返り値。
 * `action` は画面が名前を持っている5つだけ（`ACTION_LABEL`：login /
 * logout / fail / view_personal / export）。**設計にある「テンプレートを
 * 消しました」「マイルを手で増やしました」などは、いまの口が持っていません。**
 * 持っていないものを固定データで足すと、実装が記録している気になります。
 *
 * `ip` は `null`。**画像に接続元のアドレスを出さない。**
 * `connectionSource` は設計と同じく場所の名前で置きます。
 */
export const LOGIN_AUDIT = [
  ['al-1', 'st-1', '佐々木 亮太', 'sasaki@example.com', 'owner', 'login', 'ログインユーザー', '東京（いつもの場所）', 'success', '2026-08-25T00:02:00.000Z'],
  ['al-2', 'st-1', '佐々木 亮太', 'sasaki@example.com', 'owner', 'export', '友だち', '東京（いつもの場所）', 'success', '2026-08-24T09:20:00.000Z'],
  ['al-3', 'st-4', '山本 京子', 'yamamoto@example.com', 'viewer', 'view_personal', '友だち詳細', '大阪（いつもの場所）', 'success', '2026-08-23T02:00:00.000Z'],
  ['al-4', 'st-3', '高田 誠', 'takada@example.com', 'staff', 'fail', 'ログインユーザー', '福岡（はじめての場所）', 'failure', '2026-08-22T11:14:00.000Z'],
  ['al-5', 'st-5', '中川 由美', 'nakagawa@example.com', 'staff', 'logout', 'ログインユーザー', '東京（いつもの場所）', 'success', '2026-08-21T07:40:00.000Z'],
  ['al-6', 'st-2', '川野 健太', 'kawano@example.com', 'admin', 'login', 'ログインユーザー', '東京（いつもの場所）', 'success', '2026-08-21T00:00:00.000Z'],
].map(([id, adminUserId, userName, email, role, action, screen, connectionSource, result, createdAt]) => ({
  id, adminUserId, userName, email, role,
  lineLinked: true, isActive: true,
  action, screen, ip: null, connectionSource, result, createdAt,
}))

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
/**
 * 保存した検索。**型は `SavedSearch`。**
 *
 * 条件は `{ kind, key, op, value }`（`SavedSearchCondition`）。
 * `{ field, op, value }` で書いていた頃は、画面の当てはめが
 * `o.field` の逃げ道を通っていて、**書き方が間違っていることに
 * 気づけなかった。**
 *
 * `kind` は `SavedSearchConditionKind` の11個から選ぶ。対応マークは
 * **`mark`**（`support_mark` ではない）。union に無い値を書くと、
 * 編集画面の種類のプルダウンが先頭（タグ）に落ちる。**実装のせいに
 * 見えるが、こちらの書き間違い。**
 *
 * `usedIn` と `canDelete` と `matchCount` は、**未取得と0件を分けるために
 * わざと混ぜてある。**
 *
 *   ss-1  使用先2件（一斉配信・オートメーション）→ 消せない
 *   ss-2  `lineAccountId` が無い → アカウントを割り当てるまで触れない
 *   ss-3  使用先0件（サーバーが確かめた）→ 消せる
 *   ss-4  `usedIn` を返せない（未取得）→ 消させない。`matchCount` も null で理由つき
 *   ss-5  使用先1件（シナリオ・固定参照）→ 消せない
 */
export const SAVED_SEARCHES = [
  {
    id: 'ss-1', name: '未対応・期限超過', scope: 'chats',
    conditions: {
      all: [{ kind: 'mark', op: 'eq', value: 'mark-1' }],
      any: [], visibility: 'visible_only',
      list: { sort: 'recent', limit: 20 },
    },
    createdBy: 'st-1', lineAccountId: 'visual-qa-account', isShared: true,
    displayOrder: 1, createdAt: '2026-05-02T00:00:00.000Z',
    matchCount: 38, matchCountError: null,
    usedIn: [
      { kind: 'broadcast', id: 'broadcast-2', name: '8月の再入荷のお知らせ', mode: 'live', lastUsedAt: '2026-08-20T10:00:00.000Z' },
      { kind: 'automation', id: 'auto-1', name: '未対応が3日続いたら知らせる', mode: 'live', lastUsedAt: '2026-08-24T01:00:00.000Z' },
    ],
    canDelete: false,
  },
  {
    /* 管理者がアカウントを割り当てるまで触れない。 */
    id: 'ss-2', name: '体験申込ずみ・未購入', scope: 'friends',
    conditions: {
      all: [{ kind: 'tag', op: 'includes', value: 'tag-0' }],
      any: [], visibility: 'visible_only',
      list: { sort: 'recent', limit: 20 },
    },
    createdBy: 'st-2', lineAccountId: null, isShared: true,
    displayOrder: 2, createdAt: '2026-06-11T00:00:00.000Z',
    matchCount: null, matchCountError: 'アカウントが割り当てられていません',
    usedIn: [], canDelete: false,
  },
  {
    /* 自分だけのもの。**共有と分けて撮れることが要る。** */
    id: 'ss-3', name: '（自分用）今週の宿題', scope: 'friends',
    conditions: {
      all: [], any: [{ kind: 'tag', op: 'includes', value: 'tag-1' }],
      visibility: 'visible_only', list: { sort: 'recent', limit: 20 },
    },
    createdBy: 'st-1', lineAccountId: 'visual-qa-account', isShared: false,
    displayOrder: 3, createdAt: '2026-08-18T00:00:00.000Z',
    matchCount: 12, matchCountError: null,
    usedIn: [], canDelete: true,
  },
  {
    /* **使用先を確かめられなかった。** 0件と同じ絵にしてはいけない。 */
    id: 'ss-4', name: '90日 反応なし', scope: 'friends',
    conditions: {
      all: [{ kind: 'created_at', op: 'between', value: { from: '2026-01-01', to: '2026-05-27' } }],
      any: [], visibility: 'visible_only', list: { sort: 'oldest', limit: 50 },
    },
    createdBy: 'st-2', lineAccountId: 'visual-qa-account', isShared: true,
    displayOrder: 4, createdAt: '2026-03-20T00:00:00.000Z',
    matchCount: null, matchCountError: '条件が重く、いまは数えられません',
    canDelete: false,
  },
  {
    id: 'ss-5', name: '来週の予約あり', scope: 'bookings',
    conditions: {
      all: [{ kind: 'field', key: 'next_delivery', op: 'eq', value: '2026-09-01' }],
      any: [], visibility: 'visible_only', list: { sort: 'recent', limit: 20 },
    },
    createdBy: 'st-1', lineAccountId: 'visual-qa-account', isShared: true,
    displayOrder: 5, createdAt: '2026-07-15T00:00:00.000Z',
    matchCount: 7, matchCountError: null,
    usedIn: [{ kind: 'scenario', id: 'sc-3', name: '予約前日・当日案内', mode: 'fixed', lastUsedAt: null }],
    canDelete: false,
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
/**
 * 分析の「使われ方」（設計 `QQ1SR`）。**#584 で `summary` と8分類が入った。**
 *
 * 形は Worker の `getAnalyticsUsageOverview()`
 * （`packages/db/src/analytics-overviews.ts:788`）に合わせている。書き写した決めごと：
 *
 * - 分類は8つ。`usageCategory()` は `created` か `inUse` が `null` なら
 *   **`unused` も `null`**（`Math.max(0, created - inUse)` は片方欠けたら出さない）
 * - `brokenReferences` は**どの分類でも必ず未取得**
 *   （`metric(null, 'partial', 'JSON内の参照切れは次の利用関係台帳で追加します')`）
 * - `media_vars` は `state: 'unavailable'`。旧データに所属が無く安全に分けられない
 * - よって `unusedItems` は**取れた分類だけの合計**で `partial`
 * - `automaticRuns` は**常に `partial`**。オートメーションの実行記録しか数えていない
 * - `estimatedHoursSaved` は `automaticRuns * 30 / 3600` を小数2桁に丸めた**試算**
 *
 * **未使用が実値0の分類（`scenarios`）と、未取得の分類（`media_vars`）を
 * 両方入れている。** 画面が2つを混ぜないことを、この1枚で確かめるため。
 */
const USAGE_BROKEN = M(null, 'partial', 'JSON内の参照切れは次の利用関係台帳で追加します')

/** `usageCategory()` と同じ計算。`created` か `inUse` が `null` なら `unused` も `null`。 */
function usageCategory(key, label, href, created, inUse, lastUsedAt, state = 'available', reason = null) {
  const unused = created == null || inUse == null ? null : Math.max(0, created - inUse)
  return {
    key, label, href,
    created: M(created, state, reason),
    inUse: M(inUse, state, reason),
    unused: M(unused, state, reason),
    brokenReferences: USAGE_BROKEN,
    lastUsedAt: M(lastUsedAt, state, reason),
  }
}

export const ANALYTICS_USAGE = envelope({
  state: 'partial',
  stateReason: '旧データの所属が分からない項目は合計へ混ぜていません',
  checkedAt: '2026-08-25T02:00:00.000Z',
  automaticDeletion: false,
  summary: {
    /* 3 + 0 + 3 + 1 + 8 + 3 + 2 = 20。`media_vars` は未取得なので足していない。 */
    unusedItems: M(20, 'partial', '取得できた分類だけの合計です'),
    automaticRuns: M(412, 'partial', '現在はオートメーションの実行記録だけを数えています'),
    manualSends: M(96),
    /* Math.round((412 * 30 / 3600) * 100) / 100 = 3.43 */
    estimatedHoursSaved: M(3.43, 'partial', '現在はオートメーションの実行記録だけを数えています。1回30秒として試算しています'),
  },
  categories: [
    usageCategory('templates', 'テンプレート', '/templates', 24, 21, '2026-08-24T05:00:00.000Z'),
    /* **未使用が実値0。** 「すべて利用中です」と出て、「片づける」は出ない。 */
    usageCategory('scenarios', 'シナリオ', '/scenarios', 12, 12, '2026-08-25T01:00:00.000Z'),
    usageCategory('forms', '回答フォーム', '/form-submissions', 9, 6, '2026-08-24T05:22:00.000Z',
      'partial', '回答実績から所属を確認できるフォームのみです'),
    usageCategory('rich_menus', 'リッチメニュー', '/rich-menus', 5, 4, null),
    usageCategory('friend_attributes', 'タグ・友だち情報', '/tags', 38, 30, '2026-08-25T00:30:00.000Z',
      'partial', '旧共通項目はLINEアカウント所属を持たないため、利用実績から判定しています'),
    usageCategory('inflow_conversion', '流入リンク・成果地点', '/inflow-links', 14, 11, '2026-08-23T09:00:00.000Z'),
    usageCategory('automations', 'オートメーション・共通アクション', '/automations', 17, 15, '2026-08-25T01:40:00.000Z'),
    /* **未取得。** `created` が `null` なので `unused` も `null`。「片づける」は出ない。 */
    usageCategory('media_vars', '登録メディア・共通情報', '/contents', null, null, null,
      'unavailable', '旧データにLINEアカウント所属がないため、安全に分けられません'),
  ],
})

/** 設計 `Fh2Qj`（押された4,182回・押した人1,864・20時台18.4%・押されていない6本）。 */
/**
 * URLクリック。**割合は 0〜1 で書く。** 画面は `percent` を付けて
 * `Math.round(x * 1000) / 10` にする（`analytics/page.tsx:1281`）ので、
 * `16.9` と書くと **1690%** と出る。**実装の不具合に見えるが書き間違い。**
 */
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
      clicks: M(1840), knownClickPeople: M(812), deliveredPeople: M(4801), clickRate: M(0.169),
      firstClickedAt: M('2026-08-13T02:10:00.000Z'), lastClickedAt: M('2026-08-24T11:40:00.000Z'),
      usageLocations: ['一斉配信「夏のご案内」'],
    },
    {
      trackedLinkId: 'tl-2', name: '空き枠を見る', originalUrl: 'https://example.co.jp/slots',
      shortCode: 'b7m2', isActive: true,
      actions: { tagName: null, scenarioName: '体験前フォロー' },
      clicks: M(1420), knownClickPeople: M(704), deliveredPeople: M(3860), clickRate: M(0.182),
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

/* ── 機能20 分析（PR #445 で増えた口） ───────────────────────────── */

/**
 * ファネルの定義。`/api/analytics/funnels`（`v6Funnels.list`）。
 *
 * **`currentVersion` と `migrationState` を必ず入れる。** 版が無いものを
 * `null` で、`needs_migration` のものを1本混ぜてある。**移行前のものが
 * 一覧でどう出るかも見るべきことのうち。**
 */
export const ANALYTICS_FUNNEL_DEFS = [
  {
    id: 'fn-1', name: '体験申込までの流れ', windowDays: 30,
    createdAt: '2026-06-01T00:00:00.000Z',
    currentVersion: { id: 'fv-1', versionNumber: 3, createdAt: '2026-08-10T00:00:00.000Z' },
    migrationState: 'ready',
  },
  {
    id: 'fn-2', name: '8月キャンペーンの効き', windowDays: 14,
    createdAt: '2026-07-28T00:00:00.000Z',
    currentVersion: { id: 'fv-2', versionNumber: 1, createdAt: '2026-07-28T00:00:00.000Z' },
    migrationState: 'ready',
  },
  {
    /* 版がまだ無い。移行が要る側を撮るための1本。 */
    id: 'fn-3', name: '資料からの申込', windowDays: 60,
    createdAt: '2026-03-02T00:00:00.000Z',
    currentVersion: null, migrationState: 'needs_migration',
  },
]

/**
 * ファネルの実行結果。`/api/analytics/funnels/:id/runs/latest`。
 *
 * **`conversionFromPrevious` は割合（0〜1）。百分率ではない。**
 * `packages/db/src/analytics.ts` と worker の試験が `0.5`（2人中1人）で
 * 揃えている。画面は `Math.round(x * 1000) / 10` で百分率にするので、
 * `68.7` と書くと **6870%** と出る。**実装の不具合に見えるが書き間違い。**
 *
 * 1段目は前の段が無いので `null`、時間が測れない段も `null`。
 * 0 で埋めると「0%で落ちた」「0秒で進んだ」と読めてしまう。
 *
 * `droppedAfter` は前後の `reached` の差と合わせる。ずれていると、
 * 画面が自分で計算した数と食い違って見える。
 */
export const ANALYTICS_FUNNEL_RUN = {
  runId: 'run-1', funnelId: 'fn-1', versionId: 'fv-1', versionNumber: 3,
  lineAccountId: 'visual-qa-account',
  cohortFrom: '2026-07-27', cohortTo: '2026-08-25', timeZone: 'Asia/Tokyo',
  dataCutoffAt: '2026-08-25T02:00:00.000Z',
  state: 'available', stateReason: null,
  groups: [
    {
      key: 'all', label: 'すべて', entrants: 1284, completed: 42,
      steps: [
        { stepOrder: 1, label: '配信を開いた', reached: 1284, conversionFromPrevious: null, droppedAfter: 402, inProgressAfter: 0, averageSecondsFromPrevious: null, medianSecondsFromPrevious: null },
        { stepOrder: 2, label: 'リンクを押した', reached: 882, conversionFromPrevious: 0.687, droppedAfter: 658, inProgressAfter: 18, averageSecondsFromPrevious: 214, medianSecondsFromPrevious: 96 },
        { stepOrder: 3, label: 'フォームを開いた', reached: 224, conversionFromPrevious: 0.254, droppedAfter: 182, inProgressAfter: 0, averageSecondsFromPrevious: 1860, medianSecondsFromPrevious: 720 },
        { stepOrder: 4, label: '申し込んだ', reached: 42, conversionFromPrevious: 0.188, droppedAfter: 0, inProgressAfter: 0, averageSecondsFromPrevious: null, medianSecondsFromPrevious: null },
      ],
    },
  ],
}

/**
 * 保存した分析。`/api/analytics/saved`。
 *
 * **`latestSnapshot.state` を散らしてある**（`available` / `partial` /
 * `unavailable`）。取れた・一部だけ・取れなかったを、同じ一覧の中で
 * 見分けられるかを見る。**版がまだ無いものは `latestSnapshot: null`。**
 */
export const SAVED_ANALYTICS = [
  {
    id: 'sa-1', name: '体験申込までの流れ（8月）', kind: 'funnel', status: 'active',
    currentVersionNumber: 3, createdBy: 'st-1', createdByName: '川野 健太',
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-25T02:00:00.000Z',
    snapshotCount: 4,
    latestSnapshot: {
      id: 'sn-1', state: 'available',
      periodFrom: '2026-07-27', periodTo: '2026-08-25',
      dataCutoffAt: '2026-08-25T02:00:00.000Z', createdAt: '2026-08-25T02:05:00.000Z',
    },
  },
  {
    /* 一部だけ取れた。0件と混ぜてはいけない側。 */
    id: 'sa-2', name: 'タグ×流入経路のクロス', kind: 'cross', status: 'active',
    currentVersionNumber: 1, createdBy: 'st-2', createdByName: '菅野 亮',
    createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-08-24T02:00:00.000Z',
    snapshotCount: 2,
    latestSnapshot: {
      id: 'sn-2', state: 'partial',
      periodFrom: '2026-07-26', periodTo: '2026-08-24',
      dataCutoffAt: '2026-08-24T02:00:00.000Z', createdAt: '2026-08-24T02:05:00.000Z',
    },
  },
  {
    /* 取れなかった。 */
    id: 'sa-3', name: '資料からの申込', kind: 'funnel', status: 'active',
    currentVersionNumber: 2, createdBy: 'st-1', createdByName: '川野 健太',
    createdAt: '2026-05-02T00:00:00.000Z', updatedAt: '2026-08-20T02:00:00.000Z',
    snapshotCount: 1,
    latestSnapshot: {
      id: 'sn-3', state: 'unavailable',
      periodFrom: '2026-07-22', periodTo: '2026-08-20',
      dataCutoffAt: '2026-08-20T02:00:00.000Z', createdAt: '2026-08-20T02:05:00.000Z',
    },
  },
  {
    /* まだ一度も取っていない。**`snapshotCount: 0` と `null` は別のこと。** */
    id: 'sa-4', name: '休眠からの復帰（下書き）', kind: 'cross', status: 'archived',
    currentVersionNumber: 1, createdBy: 'st-2', createdByName: '菅野 亮',
    createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z',
    snapshotCount: 0, latestSnapshot: null,
  },
]

/** 保存した分析の記録。`/api/analytics/saved/:id/snapshots`。 */
export const SAVED_ANALYTICS_SNAPSHOTS = [
  {
    id: 'sn-1', savedAnalysisId: 'sa-1', analysisVersionId: 'fv-1',
    sourceKind: 'funnel', sourceResultId: 'run-1',
    periodFrom: '2026-07-27', periodTo: '2026-08-25', timeZone: 'Asia/Tokyo',
    dataCutoffAt: '2026-08-25T02:00:00.000Z', state: 'available',
    result: ANALYTICS_FUNNEL_RUN, createdBy: 'st-1',
    createdAt: '2026-08-25T02:05:00.000Z',
  },
]

/**
 * マイルの履歴（`/api/mileage/history`）。**型は `MileageAdminHistory`。**
 *
 * `hasSourceEvent` と `mode` を散らしてある。**もとの出来事が残っていない
 * 行**（`hasSourceEvent: false`）と、**手で足した行**（`mode: 'manual'`、
 * `ruleName: null`）が、自動で付いた行と見分けられるかを見る。
 *
 * **`source` は `mileage-display.ts` の `SOURCE_LABELS` にある言葉から選ぶ**
 * （`tracked_link` `form` `webinar` `manual` `admin_adjustment` など）。
 * 無い言葉を書くと全部「その他の自動処理」に落ちて、**当てはめが
 * 効いていないように見える。**
 *
 * `occurredAt` は UTC。画面が日本時間へ直しているかを見るため、
 * **9時間をまたぐ時刻**（`2026-08-24T16:30:00.000Z` ＝ 8/25 01:30 JST）を
 * 1件入れてある。
 */
export const MILEAGE_HISTORY = {
  items: [
    {
      id: 'mh-1', primaryFriendId: 'friend-1', displayName: '高橋 直人', pictureUrl: null,
      entryType: 'grant', status: 'available', amount: 120,
      reason: 'リンクを押した', source: 'tracked_link', hasSourceEvent: true,
      ruleName: 'リンククリックで120', mode: 'automatic',
      sourceReferenceId: null, executedByStaffName: null,
      occurredAt: '2026-08-24T16:30:00.000Z',
    },
    {
      id: 'mh-2', primaryFriendId: 'friend-2', displayName: '前田 さくら', pictureUrl: null,
      entryType: 'grant', status: 'pending', amount: 300,
      reason: '回答フォームに答えた', source: 'form', hasSourceEvent: true,
      ruleName: 'フォーム回答で300', mode: 'automatic',
      occurredAt: '2026-08-24T02:10:00.000Z',
    },
    {
      /* 手で足した。**決めごとに紐づかない。** */
      id: 'mh-3', primaryFriendId: 'friend-3', displayName: '菅野 亮', pictureUrl: null,
      entryType: 'adjustment', status: 'available', amount: 500,
      reason: '店頭でのご来店ぶん', source: 'admin_adjustment', hasSourceEvent: false,
      ruleName: null, mode: 'manual',
      sourceReferenceId: 'INQ-20260823-018', executedByStaffName: '佐々木 亮太',
      occurredAt: '2026-08-23T05:00:00.000Z',
    },
    {
      /* 減らした側。 */
      id: 'mh-4', primaryFriendId: 'friend-1', displayName: '高橋 直人', pictureUrl: null,
      entryType: 'spend', status: 'available', amount: -1000,
      reason: 'クーポンと引き換え', source: 'manual', hasSourceEvent: true,
      ruleName: null, mode: 'manual',
      occurredAt: '2026-08-22T09:45:00.000Z',
    },
    {
      /* **もとの出来事が残っていない。** 理由をたどれない行。 */
      id: 'mh-5', primaryFriendId: 'friend-4', displayName: '山田 太郎', pictureUrl: null,
      entryType: 'expiration', status: 'void', amount: -80,
      reason: '期限切れ', source: 'line', hasSourceEvent: false,
      ruleName: 'メッセージで80', mode: 'automatic',
      occurredAt: '2026-07-30T23:15:00.000Z',
    },
  ],
  pagination: { total: 5, limit: 50, offset: 0 },
}

/**
 * 行動スコア（`/api/action-scores/friends`）。**型は `ActionScoreOverview`。**
 *
 * `lastChangedAt` と `lastReason` を **`null` にした行を1つ**入れてある。
 * 未取得（`—`）と実値0（`0`）を、同じ列で見分けられるかを見る。
 * `currentScore: 0` と `change30d: 0` の行も別に置いてある。
 *
 * `highMin` `normalMin` は帯の境目。**帯の数と一覧の数が食い違わない**よう、
 * `high` `normal` `low` の合計は `scoredFriends` に合わせる。
 *
 * **境目は `packages/db` の `DEFAULT_BANDS`（30 / 70）と同じにする。**
 * ここに 40 と書いていたせいで、画面が「ふつう 40〜69点」と出し、
 * **実装が設計と違うように見えていた。**実装は口が返した値をそのまま
 * 描いており、間違っていたのは固定データのほう。
 */
const scoreRow = (i, name, currentScore, band, change30d, lastReason, lastChangedAt) => ({
  friendId: `friend-${i}`,
  displayName: name,
  pictureUrl: null,
  currentScore,
  band,
  change30d,
  lastReason,
  lastChangedAt,
})

export const ACTION_SCORES = {
  summary: {
    scoredFriends: 6,
    high: 2, normal: 2, low: 2,
    decreased30d: 2,
    highMin: 70, normalMin: 30,
  },
  items: [
    scoreRow(1, '高橋 直人', 92, 'high', 14, 'リンクを押した', '2026-08-24T16:30:00.000Z'),
    scoreRow(2, '前田 さくら', 78, 'high', -6, '30日 反応なし', '2026-08-20T02:10:00.000Z'),
    scoreRow(3, '菅野 亮', 61, 'normal', 3, '回答フォームに答えた', '2026-08-18T05:00:00.000Z'),
    /* **一度も動いていない。** 理由も日時も取れない行。 */
    scoreRow(4, '山田 太郎', 44, 'normal', 0, null, null),
    scoreRow(5, '石田 未来', 22, 'low', -18, '配信をブロックした', '2026-08-12T09:45:00.000Z'),
    /* **実値0。** `—` と並べて見分けられるか。 */
    scoreRow(6, '新田 遥', 0, 'low', 0, 'まだ行動がありません', '2026-07-30T23:15:00.000Z'),
  ],
  pagination: { total: 6, limit: 20, offset: 0 },
}

/*
  行動スコアのルール（PR #496）。

  **`packages/db/src/action-score-rules.ts` の `DEFAULT_RULES` と
  `ActionScoreRuleConfiguration` に合わせてあります。** 名前を勝手に付けると、
  画面の `EVENT_OPTIONS`（`eventType|source` で引き当てる）に当たらず、
  「きっかけ」の選択が先頭へ落ちます。**それを実装の不具合と読み違えます。**

  ここは**公開済み**の姿です。第1版が動いていて、第2版が下書きにある。
  `status: 'published'` と `currentPublishedVersionId` が入っているので、
  「公開中のルールを停止」が出ます。
*/
const SCORE_RULES = [
  { id: 'message-replied', name: 'こちらに返信した', eventType: 'message_received', source: 'line_webhook',
    operation: 'delta', value: 8, frequency: { kind: 'per_day', limit: 1 },
    sameSourceEventOnce: true, validFrom: null, validUntil: null, enabled: true },
  { id: 'delivery-url-clicked', name: '配信のURLを押した', eventType: 'link_clicked', source: 'tracked_link',
    operation: 'delta', value: 5, frequency: { kind: 'per_subject', limit: 1 },
    sameSourceEventOnce: true, validFrom: null, validUntil: null, enabled: true },
  { id: 'form-answered', name: '回答フォームに答えた', eventType: 'form_submitted', source: 'form',
    operation: 'delta', value: 15, frequency: { kind: 'unlimited', limit: 1 },
    sameSourceEventOnce: true, validFrom: null, validUntil: null, enabled: true },
  { id: 'booking-created', name: '予約をした', eventType: 'booking_created', source: null,
    operation: 'delta', value: 20, frequency: { kind: 'unlimited', limit: 1 },
    sameSourceEventOnce: true, validFrom: null, validUntil: null, enabled: true },
  { id: 'purchase-completed', name: '買った', eventType: 'purchase_completed', source: 'stripe',
    operation: 'delta', value: 25, frequency: { kind: 'unlimited', limit: 1 },
    sameSourceEventOnce: true, validFrom: null, validUntil: null, enabled: true },
  /* **期間を入れた行。** 有効期間の欄が空のままだと撮れない。 */
  { id: 'inactive-30-days', name: '30日間反応がない', eventType: 'inactivity_30d', source: 'scheduler',
    operation: 'delta', value: -10, frequency: { kind: 'once_per_period', limit: 1 },
    sameSourceEventOnce: true, validFrom: '2026-08-01T00:00:00.000Z', validUntil: '2026-12-31T14:59:00.000Z',
    enabled: true },
  /* **止めてある行。** 「動かす／止める」の見分けが撮れる。 */
  { id: 'friend-blocked', name: 'ブロックした', eventType: 'friend_unfollow', source: 'line_webhook',
    operation: 'set', value: 0, frequency: { kind: 'unlimited', limit: 1 },
    sameSourceEventOnce: true, validFrom: null, validUntil: null, enabled: false },
]

const SCORE_BANDS = { min: 0, max: 100, normalMin: 30, highMin: 70 }

const scoreBundle = () => ({
  rules: SCORE_RULES.map((rule) => ({ ...rule, frequency: { ...rule.frequency } })),
  bands: { ...SCORE_BANDS },
})

export const ACTION_SCORE_RULE_CONFIG = {
  configured: true,
  status: 'published',
  currentDraftVersionId: 'asrv-2',
  currentPublishedVersionId: 'asrv-1',
  editableVersion: {
    id: 'asrv-2', versionNumber: 2, status: 'draft',
    createdAt: '2026-08-27T02:10:00.000Z', publishedAt: null,
    ...scoreBundle(),
  },
  publishedVersion: {
    id: 'asrv-1', versionNumber: 1, status: 'published',
    createdAt: '2026-08-20T01:00:00.000Z', publishedAt: '2026-08-20T01:05:00.000Z',
    ...scoreBundle(),
  },
}

export const ACTION_SCORE_BANDS = { ...SCORE_BANDS }

/*
  「ルールをテスト」は**送られてきた設定でその場で計算します。**
  固定の答えを返すと、点数や帯を変えても同じ絵が出て、
  **効いていないことに気づけません。**
  `packages/db/src/action-score-rules.ts` の `testActionScoreRuleBundle` と
  同じ順番（上から当てはめ、`set` は置き換え、最後に上下限で切る）です。
*/
export function testActionScoreRules(bundle, input) {
  const bands = bundle?.bands ?? SCORE_BANDS
  const band = (score) => (score >= bands.highMin ? 'high' : score >= bands.normalMin ? 'normal' : 'low')
  let score = Number(input.currentScore)
  const matched = []
  for (const rule of bundle?.rules ?? []) {
    if (!rule.enabled) continue
    if (rule.eventType !== input.eventType) continue
    if (rule.source && rule.source !== (input.source ?? null)) continue
    const before = score
    const next = rule.operation === 'set' ? rule.value : score + rule.value
    score = Math.max(bands.min, Math.min(bands.max, next))
    matched.push({ ruleId: rule.id, ruleName: rule.name, scoreBefore: before, scoreAfter: score })
  }
  return {
    scoreBefore: Number(input.currentScore),
    scoreAfter: score,
    bandBefore: band(Number(input.currentScore)),
    bandAfter: band(score),
    matched,
  }
}

/*
  リマインダの実行結果（PR #500）。

  **`packages/shared/src/types.ts` の `ReminderDeliveryRunsResponse` に
  合わせてあります。** 共通の9項目（`ExecutionRunListItem`）と、
  リマインダの書込台帳だけが持つ詳細（`domainStatus` ほか）の両方を
  1行に入れる形です。

  設計（`f7/GC4St.html`）の数に寄せてあります。
  送信済み1,126通／送信予定398通／停止28人／エラー2件。

  **`openRate` は `null` のままにします。** LINE は友だち単位の既読を
  返しません。実装も `openRate: null` を返し、コードにその旨が書いてあります。
  ここで数を作ると、**取れないものが取れているように撮れます。**
*/
const runRow = (n, name, step, domainStatus, status, over) => ({
  id: `rdr-${n}`,
  ownerKind: 'reminder',
  ownerId: 'reminder-1',
  lineAccountId: 'visual-qa-account',
  occurredAt: over?.occurredAt ?? '2026-08-24T00:00:00.000Z',
  subject: name,
  accountLabel: '然-NEN- TEST',
  triggerLabel: 'Google Meet相談リマインダ',
  reference: null,
  status,
  detail: over?.detail ?? `${step}通目`,
  durationMs: over?.durationMs ?? 420,
  canRetry: domainStatus === 'retry_wait' || domainStatus === 'permanent_failed',
  reminderId: 'reminder-1',
  friendReminderId: `fr-${n}`,
  friendId: `friend-${n}`,
  friendName: name,
  reminderStepId: `rs-${step}`,
  stepNumber: step,
  scheduledAt: over?.scheduledAt ?? '2026-08-24T00:00:00.000Z',
  startedAt: over?.startedAt ?? '2026-08-24T00:00:00.000Z',
  completedAt: over?.completedAt ?? '2026-08-24T00:00:07.000Z',
  domainStatus,
  attemptCount: over?.attemptCount ?? 1,
  nextRetryAt: over?.nextRetryAt ?? null,
  lastErrorCode: over?.lastErrorCode ?? null,
  lastErrorMessage: over?.lastErrorMessage ?? null,
  lineRequestId: over?.lineRequestId ?? null,
  messageLogId: over?.messageLogId ?? null,
})

export const REMINDER_RUNS = {
  reminder: { id: 'reminder-1', name: 'Google Meet相談リマインダ', isActive: true },
  summary: {
    sent: 1126, scheduled: 398, stopped: 28, errors: 2,
    targetCount: 398,
    nextScheduledAt: '2026-08-24T00:00:00.000Z',
  },
  steps: [
    { id: 'rs-1', stepNumber: 1, offsetMinutes: -1440, messageType: 'text',
      messageContent: '明日のGoogle Meet相談のご案内です。', sent: 382, openRate: null, errors: 1 },
    { id: 'rs-2', stepNumber: 2, offsetMinutes: -60, messageType: 'text',
      messageContent: 'まもなく開始のお時間です。', sent: 361, openRate: null, errors: 0 },
    { id: 'rs-3', stepNumber: 3, offsetMinutes: 0, messageType: 'text',
      messageContent: '本日のご案内です。', sent: 383, openRate: null, errors: 1 },
  ],
  items: [
    runRow(1, 'Kenta Kawano', 1, 'succeeded', 'succeeded',
      { completedAt: '2026-08-24T00:00:04.000Z', durationMs: 4000, lineRequestId: 'req-8f21', messageLogId: 'ml-1' }),
    runRow(2, 'Masato S.', 2, 'succeeded', 'succeeded',
      { occurredAt: '2026-08-24T00:15:00.000Z', startedAt: '2026-08-24T00:15:00.000Z',
        completedAt: '2026-08-24T00:15:03.000Z', durationMs: 3000, lineRequestId: 'req-8f22', messageLogId: 'ml-2' }),
    /* **再試行待ち。** 「もう一度やる」が出る行。 */
    runRow(3, '菅野 亮', 3, 'retry_wait', 'pending',
      { occurredAt: '2026-08-24T00:32:00.000Z', startedAt: '2026-08-24T00:32:00.000Z',
        completedAt: null, durationMs: null, attemptCount: 2,
        nextRetryAt: '2026-08-24T01:02:00.000Z',
        lastErrorCode: 'rate_limited', lastErrorMessage: '送信が混み合っています。時間をおいて送り直します。',
        detail: '送信が混み合っています。時間をおいて送り直します。' }),
    /* **送れなかったもの。** 理由が要る行。 */
    runRow(4, '前田 さくら', 1, 'permanent_failed', 'failed',
      { occurredAt: '2026-08-23T00:00:09.000Z', startedAt: '2026-08-23T00:00:00.000Z',
        completedAt: '2026-08-23T00:00:09.000Z', durationMs: 9000, attemptCount: 3,
        lastErrorCode: 'blocked', lastErrorMessage: 'ブロックされています。',
        detail: 'ブロックされています。' }),
    /* **送らなかったもの。** 失敗ではない。見分けが撮れる。 */
    runRow(5, '石田 未来', 2, 'skipped', 'skipped',
      { occurredAt: '2026-08-23T00:15:00.000Z', startedAt: '2026-08-23T00:15:00.000Z',
        completedAt: '2026-08-23T00:15:00.000Z', durationMs: 0,
        detail: '予約が取り消されたため送っていません。' }),
    /* **これから送るもの。** 実行時刻がまだ無い（`—` になるか）。 */
    runRow(6, '新田 遥', 1, 'planned', 'pending',
      { occurredAt: '2026-08-25T00:00:00.000Z', scheduledAt: '2026-08-25T00:00:00.000Z',
        startedAt: null, completedAt: null, durationMs: null, attemptCount: 0 }),
    /* **消された友だち。** 名前が取れない行。 */
    runRow(7, null, 3, 'cancelled', 'cancelled',
      { occurredAt: '2026-08-22T00:00:00.000Z', startedAt: null, completedAt: null,
        durationMs: null, attemptCount: 0, detail: 'リマインダを取り消しました。' }),
  ],
  pagination: { total: 7, limit: 20, offset: 0 },
}

/*
  自動応答の実行結果（`t7UtYQ`）— PR #501 head `93edbe17`。

  **`packages/shared/src/types.ts` の `AutoReplyRunsResponse` に
  合わせてあります。** 口は `GET /api/auto-reply-runs?ruleId=rule-a`。

  値は実装の写像に照らしてあります
  （`apps/worker/src/routes/auto-reply-runs.ts`）。

    commonStatus  completed / reply_accepted → succeeded
                  reply_failed / failed      → failed
                  partial_failed             → partial
                  skipped                    → skipped
                  それ以外                    → pending

  **見送りの行がいちばん大事です。** 選んだルールが条件で見送られ、
  後ろのルールが動いても、この画面は「選んだルールは何もしなかった」と
  出します（`effectiveDomainStatus`）。`detail` は `SKIP_LABELS` の文言。
*/
const arRow = (n, over) => ({
  id: `are-${n}`,
  ownerKind: 'auto_reply',
  ownerId: 'rule-a',
  lineAccountId: 'visual-qa-account',
  occurredAt: over.occurredAt,
  subject: over.friendName ?? null,
  accountLabel: '然-NEN- TEST',
  triggerLabel: over.triggerLabel,
  reference: over.reference ?? null,
  status: over.status,
  detail: over.detail,
  durationMs: over.durationMs ?? 800,
  canRetry: false,
  autoReplyId: over.autoReplyId ?? 'rule-a',
  autoReplyName: over.autoReplyName ?? '予約問い合わせ',
  friendId: `friend-${n}`,
  friendName: over.friendName ?? null,
  messageKind: over.messageKind ?? 'text',
  inputPreview: over.inputPreview,
  matchedKeyword: over.matchedKeyword ?? null,
  versionNumber: over.versionNumber ?? 3,
  domainStatus: over.domainStatus,
  replyStatus: over.replyStatus ?? 'not_attempted',
  actionSummary: over.actionSummary ?? {},
  lineRequestId: over.lineRequestId ?? null,
})

export const AUTO_REPLY_RUNS = {
  rule: { id: 'rule-a', name: '予約問い合わせ', isActive: true, priorityPosition: 1 },
  summary: {
    monthHits: 214, totalHits: 1842, handovers: 36, errors: 3,
    lastRunAt: '2026-08-24T01:32:00.000Z',
    /* **800ms → 「0.8秒」** と出るか。未取得は空の返事側で `null` にする。 */
    averageResponseMs: 800,
  },
  handovers: { waiting: 8, inProgress: 21, completed: 7 },
  triggerBreakdown: [
    { trigger: '予約', count: 128, share: 0.598 },
    { trigger: '日程変更', count: 54, share: 0.252 },
    { trigger: 'キャンセル', count: 32, share: 0.150 },
    /* **割合が取れない行。** `—` と `0%` を見分けられるか。 */
    { trigger: 'その他', count: 0, share: null },
  ],
  items: [
    /* 1. ふつうに動いた（返信＋処理まで完了） */
    arRow(1, {
      occurredAt: '2026-08-24T01:32:00.000Z', friendName: 'Kenta Kawano',
      inputPreview: '予約を変更したい', triggerLabel: '予約', matchedKeyword: '予約',
      domainStatus: 'completed', status: 'succeeded',
      detail: '返信と設定した処理が完了しました',
      replyStatus: 'accepted', actionSummary: { reply: 1, tag: 1 },
      reference: 'ml-9001', lineRequestId: 'req-a1', durationMs: 800,
    }),
    /* 2. 返信だけ受け付けられた */
    arRow(2, {
      occurredAt: '2026-08-24T01:28:00.000Z', friendName: 'Masato S.',
      inputPreview: '予約の確認', triggerLabel: '予約', matchedKeyword: '予約',
      domainStatus: 'reply_accepted', status: 'succeeded',
      detail: '返信と設定した処理が完了しました',
      replyStatus: 'accepted', actionSummary: { reply: 1, notify: 1 },
      reference: 'ml-9002', lineRequestId: 'req-a2', durationMs: 620,
    }),
    /* 3. 一部だけできた。**成功ではない** */
    arRow(3, {
      occurredAt: '2026-08-24T01:21:00.000Z', friendName: '菅野 亮',
      inputPreview: '予約キャンセル', triggerLabel: 'キャンセル', matchedKeyword: 'キャンセル',
      domainStatus: 'partial_failed', status: 'partial',
      detail: '返信または一部の処理だけ完了しました',
      replyStatus: 'accepted', actionSummary: { reply: 1, handover: 0 },
      reference: 'ml-9003', durationMs: 1450,
    }),
    /* 4. 返信を受け付けてもらえなかった */
    arRow(4, {
      occurredAt: '2026-08-24T01:14:00.000Z', friendName: '山田 太郎',
      inputPreview: '予約', triggerLabel: '予約', matchedKeyword: '予約',
      domainStatus: 'reply_failed', status: 'failed',
      detail: 'LINEへの返信を受け付けてもらえませんでした',
      replyStatus: 'failed', actionSummary: { reply: 0 },
      reference: 'ml-9004', durationMs: 2400,
    }),
    /*
      5. **要の行。** 「予約問い合わせ」が条件で見送られ、
      後ろのルールが動いた。**それでもこの画面は skipped。**
      `autoReplyId` は選んだルール（`rule-a`）のまま。
    */
    arRow(5, {
      occurredAt: '2026-08-24T00:58:00.000Z', friendName: '前田 さくら',
      inputPreview: '予約したい', triggerLabel: '条件に合いませんでした',
      matchedKeyword: null,
      domainStatus: 'skipped', status: 'skipped',
      detail: '1人1回の設定により何もしませんでした',
      replyStatus: 'not_attempted', actionSummary: {},
      reference: 'ml-9005', durationMs: 40,
    }),
    /* 6. 別の見送り理由。文言が理由ごとに変わるか */
    arRow(6, {
      occurredAt: '2026-08-24T00:41:00.000Z', friendName: '石田 未来',
      inputPreview: 'こんにちは', triggerLabel: '条件に合いませんでした',
      matchedKeyword: null,
      domainStatus: 'skipped', status: 'skipped',
      detail: '担当者が対応中のため何もしませんでした',
      replyStatus: 'not_attempted', actionSummary: {},
      reference: 'ml-9006', durationMs: 35,
    }),
    /* 7. まだ処理中。**時間が取れない行**（`—` になるか） */
    arRow(7, {
      occurredAt: '2026-08-24T00:30:00.000Z', friendName: null,
      inputPreview: '予約', triggerLabel: '確認中', matchedKeyword: null,
      domainStatus: 'actions_running', status: 'pending',
      detail: '処理中です',
      replyStatus: 'accepted', actionSummary: { reply: 1 },
      reference: null, durationMs: null, versionNumber: null,
    }),
  ],
  pagination: { total: 7, limit: 20, offset: 0 },
}

/* ═══════════════════════════════════════════════════════════════
   実行の記録・残り4枚の下ごしらえ（`M2b2B` `Se65i` `X8JCA5` `KNG00`）

   **口はまだありません。** 4枚とも、いまの実装に読む口が
   1本もありません（`apps/web/src/lib/api.ts` を探して0件）。
   **推測した道をここへ書きません。** 実装PRの番号と head が届いてから、
   実物に照らして `mock-api.mjs` へ足します。

   形は `packages/shared/src/types.ts` の `ExecutionRunListItem`
   （共通9項目）に合わせてあります。**これは #500/#501 で入った正本です。**

   **取れないものは `null` にしてあります。** 数を作ると、
   「取れている」絵が基準画像になります。どこが `—` で写るかを
   見るための固定データです。
   ═══════════════════════════════════════════════════════════════ */

const execRow = (over) => ({
  ownerKind: over.ownerKind,
  ownerId: over.ownerId,
  lineAccountId: 'visual-qa-account',
  occurredAt: over.occurredAt,
  subject: over.subject ?? null,
  accountLabel: over.accountLabel ?? '然-NEN- TEST',
  triggerLabel: over.triggerLabel,
  reference: over.reference ?? null,
  status: over.status,
  detail: over.detail,
  durationMs: over.durationMs ?? null,
  canRetry: over.canRetry ?? false,
  domainStatus: over.domainStatus,
})

/* ── M2b2B シナリオ配信結果 ─────────────────────────────────
   **固定データは作りません。** PR #503 は**新しい口を1本も足さず**、
   既存の `api.scenarios.get(id)` と `api.scenarios.stats(id)` を読みます。
   使うのは上の `SCENARIO_STEPS` と `SCENARIO_STATS`。

   （推測の形で `SCENARIO_RESULTS` を書いていましたが、実装が来たので外しました。）
*/

/* ── Se65i 運用者通知の記録 ─────────────────────────────────
   既存：`notifications`（title・body・channel・category・
         status は pending/sent/failed・line_account_id・created_at）
   **無い：だれに送ったか。** `notifications` に `friend_id` が無い。
   **無い：開封・クリック。** 設計の「開かれた 96.2%」「押された 22.9%」
         「読まれた」列は、いまの記録から出せない。
   **無い：注文番号との結びつき。** `metadata` に入るかは実装しだい。
*/
/**
 * 顧客へのお知らせの実行記録（`GET /api/ec-commerce/notification-runs`、
 * 設計 `Se65i`＝記録／`X8JCA5`＝送れなかったもの）。
 *
 * 型は `apps/web/src/lib/api.ts` の `EcNotificationRunList` と
 * `EcNotificationRun`。**型そのものが「できないこと」を書いています**：
 * `attemptHistoryAvailable: false`（試行の履歴は残していない）、
 * `retryAvailable: false`（画面からは送り直せない）、
 * `unassignedHistoricalRowsExcluded: true`（所属を確定できない過去分は外す）。
 *
 * **個人の既読を持たせる場所はどこにもありません。**
 * あるのは `clickedAt`（短縮URLを押した時刻）だけです。
 *
 * `attemptCount` と `nextRetryAt` は `null`（＝まだ数えていない）。
 * **0にしない。** 0にすると「1度も試していない」と読めてしまいます。
 */
const run = (id, name, eventId, friendId, friendName, orderNumber, status, reason, receivedAt, acceptedAt, clickedAt) => ({
  id, recipientType: 'customer', notificationName: name, source: 'EC連携',
  sourceEventId: eventId, friendId, friendName, orderNumber, channel: 'line',
  status, reason, receivedAt, acceptedAt,
  attemptCount: null, nextRetryAt: null, clickedAt,
  version: 1, executionMode: 'automatic', retryAvailable: false,
})

const NOTIFICATION_RUN_ITEMS = [
  run('ecr-1', '注文ありがとうございます', 'ece-1', 'friend-1', '石田 未来', '#12492', 'accepted', null,
    '2026-08-25T02:42:00.000Z', '2026-08-25T02:42:08.000Z', null),
  run('ecr-2', 'ご入金を確認しました', 'ece-2', 'friend-2', '木村 亮', '#12488', 'accepted', null,
    '2026-08-25T02:20:00.000Z', '2026-08-25T02:20:04.000Z', null),
  run('ecr-3', 'お荷物を送りました', 'ece-3', 'friend-3', '前田 さくら', '#12471', 'accepted', null,
    '2026-08-25T01:58:00.000Z', '2026-08-25T01:58:03.000Z', '2026-08-25T02:02:00.000Z'),
  /* 届かなかったもの。**理由が要る。** */
  run('ecr-4', 'お荷物を送りました', 'ece-4', 'friend-4', '林 里佳', '#12466', 'failed',
    '相手がブロックしています', '2026-08-24T09:00:00.000Z', null, null),
  run('ecr-5', '返金しました', 'ece-5', 'friend-5', '大西 健一', '#12402', 'failed',
    'LINEの受け取り上限を超えました', '2026-08-24T06:20:00.000Z', null, null),
  /* 友だちが結び付いていない。**推測で誰かに当てない。** */
  run('ecr-6', '定期便の発送予定', 'ece-6', '', null, '#12455', 'excluded',
    'この注文とLINEの友だちを結び付けられませんでした', '2026-08-25T00:40:00.000Z', null, null),
  /* まだ送っていない。 */
  run('ecr-7', '注文ありがとうございます', 'ece-7', 'friend-7', '高橋 直人', '#12480', 'pending', null,
    '2026-08-24T00:15:00.000Z', null, null),
]

export const EC_NOTIFICATION_RUNS = {
  items: NOTIFICATION_RUN_ITEMS,
  summary: { accepted: 3, failed: 2, excluded: 1, pending: 1 },
  coverage: {
    source: 'current_ec_events',
    unassignedHistoricalRowsExcluded: true,
    attemptHistoryAvailable: false,
    retryAvailable: false,
  },
}

/** 送れなかったものだけ。画面は `view=failures` で読む。 */
export const EC_NOTIFICATION_FAILURES = {
  items: NOTIFICATION_RUN_ITEMS.filter((r) => r.status === 'failed'),
  summary: EC_NOTIFICATION_RUNS.summary,
  coverage: EC_NOTIFICATION_RUNS.coverage,
}

/**
 * 運用者へのお知らせ（`GET /api/notifications/rules`、設計 `DpxOK`）。
 * 型は `packages/shared/src/types.ts` の `NotificationRule`。
 */
export const NOTIFICATION_RULES = [
  {
    id: 'nr-1', name: '配信が失敗したとき', eventType: 'broadcast.failed',
    conditions: { minFailures: 1 }, channels: ['line', 'slack'], isActive: true,
    createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'nr-2', name: '受信箱に未対応が溜まったとき', eventType: 'inbox.unanswered',
    conditions: { threshold: 10 }, channels: ['line'], isActive: true,
    createdAt: '2026-06-10T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
  },
  {
    /* 止めているもの。**0件と混ざらないことが要る。** */
    id: 'nr-3', name: '在庫が少なくなったとき', eventType: 'ec.stock.low',
    conditions: { threshold: 5 }, channels: ['slack'], isActive: false,
    createdAt: '2026-07-02T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z',
  },
]

export const NOTIFICATION_RECORDS = {
  summary: {
    sent30d: 3826,
    perDay: 127,
    /* **取れない。** LINEは友だち単位の既読を返さない。 */
    opened: null, openRate: null,
    clicked: null, clickRate: null,
    undelivered: 4, undeliveredRate: 0.001,
  },
  tabs: { customer: 9, operator: 11, undelivered: 4 },
  items: [
    execRow({ ownerKind: 'notification', ownerId: 'notif-1', occurredAt: '2026-08-25T02:42:00.000Z',
      subject: '石田 未来', accountLabel: 'LINE 二号店',
      triggerLabel: '注文ありがとうございます', reference: '#12492',
      status: 'succeeded', domainStatus: 'sent', detail: '届きました' }),
    execRow({ ownerKind: 'notification', ownerId: 'notif-2', occurredAt: '2026-08-24T06:20:00.000Z',
      subject: '大西 健一', triggerLabel: '返金しました', reference: '#12402',
      status: 'succeeded', domainStatus: 'sent', detail: '届きました' }),
    /* **まだ送っていない。** 失敗ではない。 */
    execRow({ ownerKind: 'notification', ownerId: 'notif-3', occurredAt: '2026-08-24T09:10:00.000Z',
      subject: '高橋 直人', triggerLabel: 'お荷物を送りました', reference: '#12480',
      status: 'pending', domainStatus: 'pending', detail: 'これから送ります' }),
    /* **届かなかった。** 理由の置き場が `notifications` に無い。 */
    execRow({ ownerKind: 'notification', ownerId: 'notif-4', occurredAt: '2026-08-24T09:00:00.000Z',
      subject: '林 里佳', triggerLabel: 'お荷物を送りました', reference: '#12466',
      status: 'failed', domainStatus: 'failed', detail: '届きませんでした' }),
  ],
  pagination: { total: 4, limit: 20, offset: 0 },
}

/* ── X8JCA5 送れなかった通知 ────────────────────────────────
   `Se65i` と同じ `notifications` を、届かなかったものに絞った面。
   **無い：届かなかった理由**（ブロック・友だちでない・結びついていない）
   **無い：メールアドレスと、メールで送った記録**
   **無い：「いまどうなっているか」の状態**

   **メールアドレスは作り物です。** `example.com` しか置きません。
*/
export const UNDELIVERED_RECORDS = {
  summary: {
    undelivered: 4, undeliveredRate: 0.0016,
    blocked: 3, mailed: 2, untouched: 2,
  },
  items: [
    { ...execRow({ ownerKind: 'notification', ownerId: 'notif-4', occurredAt: '2026-08-24T09:00:00.000Z',
        subject: '林 里佳', triggerLabel: 'お荷物を送りました', reference: '#12466',
        status: 'failed', domainStatus: 'blocked', detail: 'ブロックされています' }),
      contactEmail: 'rika@example.com', followUp: 'mailed', followUpLabel: 'メールで届きました' },
    { ...execRow({ ownerKind: 'notification', ownerId: 'notif-5', occurredAt: '2026-08-23T03:20:00.000Z',
        subject: '佐野 亮', triggerLabel: 'ご入金を確認しました', reference: '#12440',
        status: 'failed', domainStatus: 'blocked', detail: 'ブロックされています' }),
      /* **連絡先が無い行。** `—` と空文字を分ける。 */
      contactEmail: null, followUp: 'untouched', followUpLabel: 'まだ何もできていません' },
    { ...execRow({ ownerKind: 'notification', ownerId: 'notif-6', occurredAt: '2026-08-22T00:40:00.000Z',
        subject: '井上 大輔', triggerLabel: '注文ありがとうございます', reference: '#12418',
        status: 'failed', domainStatus: 'not_friend', detail: '友だちではありません' }),
      contactEmail: 'daisuke@example.com', followUp: 'mailed', followUpLabel: 'メールで届きました' },
    { ...execRow({ ownerKind: 'notification', ownerId: 'notif-7', occurredAt: '2026-08-19T06:02:00.000Z',
        subject: null, triggerLabel: '返金しました', reference: '#12388',
        status: 'failed', domainStatus: 'unlinked', detail: '結びついていません' }),
      contactEmail: null, followUp: 'untouched', followUpLabel: 'まだ何もできていません' },
  ],
  pagination: { total: 4, limit: 20, offset: 0 },
}

/* ── KNG00 外部連携のやり取りの記録 ──────────────────────────
   既存：`outgoing_webhooks`／`incoming_webhooks`（**つなぎ先の定義だけ**）
   **無い：やり取り1件ずつの記録。** 送った・受け取った・返事・
         かかった時間・やり直し、どれも置き場が無い。
   `rt_sync_events` は飲食店向けの受信専用（`direction='inbound'` 固定、
   `store_id` 必須）で、**汎用の記録ではありません。**

   **つなぎ先は名前だけにします。** `outgoing_webhooks` は `url` と
   `secret` を持ちます。**画面にも画像にも出しません。**
   送った中身も、鍵になりうるものは入れません。
*/
export const INTEGRATION_RECORDS = {
  summary: {
    total: 1972, outgoing: 1486, incoming: 486,
    succeeded: 1966,
    failed: 6,
    averageDurationMs: 400,
  },
  items: [
    { id: 'hook-run-1', direction: 'outgoing', webhookName: 'Slack ／ #注文チャンネル',
      eventType: 'order.created', triggerSummary: '注文が確定したとき', status: 'succeeded',
      responseLabel: '200 OK', responseStatus: 200, attemptCount: 1, durationMs: 400,
      failureReason: null, canRetry: false, startedAt: '2026-08-25T02:42:00.000Z',
      completedAt: '2026-08-25T02:42:00.400Z', retryOfId: null },
    { id: 'hook-run-2', direction: 'incoming', webhookName: 'アンケートツールから ／ 受け取り口 2',
      eventType: 'incoming_webhook.form', triggerSummary: '回答が届いたとき', status: 'succeeded',
      responseLabel: '結びつきました', responseStatus: 200, attemptCount: 1, durationMs: 200,
      failureReason: null, canRetry: false, startedAt: '2026-08-24T07:30:00.000Z',
      completedAt: '2026-08-24T07:30:00.200Z', retryOfId: null },
    /* **人が見つからない。** 失敗だがやり直しても直らない種類。 */
    { id: 'hook-run-3', direction: 'incoming', webhookName: 'アンケートツールから ／ 受け取り口 2',
      eventType: 'incoming_webhook.form', triggerSummary: '回答が届いたとき', status: 'failed',
      responseLabel: '受け取った内容を処理できませんでした', responseStatus: 500, attemptCount: 1,
      durationMs: 200, failureReason: '受け取った内容を処理できませんでした', canRetry: false,
      startedAt: '2026-08-24T00:00:00.000Z', completedAt: '2026-08-24T00:00:00.200Z', retryOfId: null },
    /* **やり直せる失敗。** 相手が落ちていただけ。 */
    { id: 'hook-run-4', direction: 'outgoing', webhookName: 'Slack ／ #注文チャンネル',
      eventType: 'conversion.created', triggerSummary: '成果が認められたとき', status: 'failed',
      responseLabel: 'つなぎ先で処理できませんでした', responseStatus: 503, attemptCount: 3,
      durationMs: 10000, failureReason: 'つなぎ先で処理できませんでした', canRetry: true,
      startedAt: '2026-08-24T00:10:00.000Z', completedAt: '2026-08-24T00:10:10.000Z', retryOfId: null },
    { id: 'hook-run-5', direction: 'outgoing', webhookName: '顧客管理',
      eventType: 'friend.added', triggerSummary: '友だちが追加されたとき', status: 'pending',
      responseLabel: '処理中です', responseStatus: null, attemptCount: 0, durationMs: null,
      failureReason: null, canRetry: false, startedAt: '2026-08-23T05:00:00.000Z',
      completedAt: null, retryOfId: null },
  ],
  total: 5,
  page: 1,
  limit: 20,
}

/*
  オートメーションの実行結果（`DkPY0`）— PR #502 head `75b010fc`。

  **`AutomationExecutionRunsResponse` に合わせてあります。**
  口は `GET /api/automation-runs?lineAccountId=&status=&search=&from=&to=`。
  **新しい表は作らず、既存の `automation_runs` を読むだけ**の実装です。

  文言は実装の写像そのままです（`apps/worker/src/routes/automations.ts`）。
  `TRIGGER_LABELS` `ACTION_LABELS` `safeFailureReason` を通した後の形。
  **失敗の理由は日本語に置き換えられ、`failure_code` は出ません。**

  **「もう一度やる」は出しません。** `canRetry` は常に `false`。
  安全な再実行の口が無いため、意図して外してあります（実装にその旨の注釈あり）。
*/
const autoRow = (n, over) => ({
  id: `arun-${n}`,
  ownerKind: 'automation',
  ownerId: over.automationId,
  lineAccountId: 'visual-qa-account',
  occurredAt: over.occurredAt,
  subject: over.friendName ?? null,
  accountLabel: over.accountLabel ?? 'LINE 本店',
  triggerLabel: over.triggerLabel,
  reference: null,
  status: over.status,
  detail: over.detail,
  durationMs: over.durationMs ?? null,
  /* **常に false。** 安全な再実行の口が無い。 */
  canRetry: false,
  automationId: over.automationId,
  automationName: over.automationName,
  automationVersionId: `${over.automationId}-v2`,
  friendId: over.friendName ? `friend-${n}` : null,
  friendName: over.friendName ?? null,
  sourceEventId: `evt-${n}`,
  domainStatus: over.domainStatus,
  startedAt: over.startedAt ?? over.occurredAt,
  completedAt: over.completedAt ?? over.occurredAt,
  successfulActions: over.successfulActions ?? [],
  skippedActions: over.skippedActions ?? [],
  failedAction: over.failedAction ?? null,
  failureReason: over.failureReason ?? null,
})

export const AUTOMATION_RUNS = {
  summary: {
    total: 9660, executed: 9412, skipped: 242, failed: 6,
    mostRunName: '予約のご案内', mostRunCount: 3820,
  },
  items: [
    /* 1. 動いた。処理を2つ実行 */
    autoRow(1, {
      occurredAt: '2026-08-24T05:02:00.000Z', friendName: '佐藤 千尋',
      automationId: 'auto-1', automationName: '予約のご案内',
      triggerLabel: 'メッセージが届いたとき',
      domainStatus: 'success', status: 'succeeded',
      successfulActions: ['メニューを切り替え', 'メッセージを送信'],
      detail: 'メニューを切り替え／メッセージを送信', durationMs: 400,
    }),
    /* 2. 動いた。処理は1つ */
    autoRow(2, {
      occurredAt: '2026-08-24T00:05:00.000Z', friendName: '高橋 直人',
      automationId: 'auto-2', automationName: '反応がない人へ',
      triggerLabel: '行動スコアが条件に達したとき',
      domainStatus: 'success', status: 'succeeded',
      successfulActions: ['対応マークを変更'],
      detail: '対応マークを変更', durationMs: 300,
    }),
    /*
      3. **条件に合わず何もしていない。** 失敗ではない。
      設計の「動きませんでした／何もしていません」がここ。
    */
    autoRow(3, {
      occurredAt: '2026-08-23T11:00:00.000Z', friendName: '前田 さくら',
      automationId: 'auto-3', automationName: '友だち追加のお礼',
      triggerLabel: '友だちが追加されたとき',
      domainStatus: 'skipped_condition', status: 'skipped',
      detail: '条件に合わなかったため、何もしていません', durationMs: 30,
    }),
    /*
      4. **一部だけ。** 成功・見送り・失敗が1行に混ざる。
      **「成功」と1語で書かせないための行。**
    */
    autoRow(4, {
      occurredAt: '2026-08-23T09:30:00.000Z', friendName: '菅野 亮',
      automationId: 'auto-1', automationName: '予約のご案内',
      triggerLabel: '予約が確定したとき',
      domainStatus: 'partial', status: 'partial',
      successfulActions: ['タグを追加'],
      skippedActions: ['シナリオを開始'],
      failedAction: '外部連携へ送信',
      failureReason: '外部連携先が応答しませんでした',
      detail: 'タグを追加。シナリオを開始は見送り。外部連携先が応答しませんでした',
      durationMs: 10400,
    }),
    /* 5. 失敗。**理由は日本語。`failure_code` は出ない** */
    autoRow(5, {
      occurredAt: '2026-08-23T02:10:00.000Z', friendName: '山田 太郎',
      automationId: 'auto-4', automationName: '発送のお知らせ',
      triggerLabel: '発送が完了したとき',
      domainStatus: 'failed', status: 'failed',
      failedAction: 'メッセージを送信',
      failureReason: 'LINEへの送信を完了できませんでした',
      detail: 'LINEへの送信を完了できませんでした', durationMs: 2400,
    }),
    /* 6. まだ動いている。**時間が取れない行**（`—` になるか） */
    autoRow(6, {
      occurredAt: '2026-08-24T05:10:00.000Z', friendName: '石田 未来',
      automationId: 'auto-2', automationName: '反応がない人へ',
      triggerLabel: 'タグが変わったとき',
      domainStatus: 'running', status: 'pending',
      detail: null, durationMs: null, completedAt: null,
    }),
    /* 7. 待っている（指定時間まで） */
    autoRow(7, {
      occurredAt: '2026-08-24T04:00:00.000Z', friendName: null,
      automationId: 'auto-5', automationName: '定期便のリマインド',
      triggerLabel: '定期便の予定が近づいたとき',
      domainStatus: 'waiting', status: 'pending',
      successfulActions: ['指定時間まで待機'],
      detail: '指定時間まで待機', durationMs: null, completedAt: null,
    }),
    /* 8. 取り消した */
    autoRow(8, {
      occurredAt: '2026-08-22T23:00:00.000Z', friendName: '新田 遥',
      automationId: 'auto-3', automationName: '友だち追加のお礼',
      triggerLabel: '友だちが追加されたとき',
      domainStatus: 'cancelled', status: 'cancelled',
      detail: null, durationMs: null,
    }),
  ],
  pagination: { total: 8, limit: 20, offset: 0 },
}

/*
  代理予約の担当者（`BookingMenuStaff`）。

  **`BOOKING_STAFF` とは別の型。** あちらは店の従業員そのもの
  （`name` `sort_order` `is_active`）で、こちらは**メニューに紐づいた
  担当者**なので `price` と `duration_minutes` を持つ。同じ人でも
  メニューによって値段が変わるため、メニュー側から引き直す。
*/
export const BOOKING_MENU_STAFF = [
  {
    id: 'bs-1', display_name: '佐々木', role: 'トリマー',
    profile_image_url: null, bio: null, is_designation_optional: 0,
    price: 8400, duration_minutes: 105,
  },
  {
    /* 同じメニューでも指名料が乗る人。**値段は担当者ごとに違う。** */
    id: 'bs-2', display_name: '山本', role: 'トリマー',
    profile_image_url: null, bio: null, is_designation_optional: 0,
    price: 9400, duration_minutes: 105,
  },
]

/*
  空き時間。**問い合わせた日をそのまま返す。**

  固定の日付を返すと、画面が「今日から60日」で組み立てた問い合わせと
  食い違って、いつか必ず空になる。撮影日に左右されない形にする。

  **`14:00` は、返事を書く側では埋まっている枠。** 空き確認と登録の
  あいだに他の予約が入る競り合いを、そのまま作る。実物の Worker も
  登録の直前にもう一度空きを見て `slot_conflict` を返す。
*/
export const BOOKING_TAKEN_SLOT = '14:00'
export function bookingAvailability(date, staffId, { empty = false } = {}) {
  const person = BOOKING_MENU_STAFF.find((item) => item.id === staffId) ?? BOOKING_MENU_STAFF[0]
  /*
    **`date` は必ず入れる。**#587 の確認画面は
    `slot.date === date && slot.start === time` で空きを見直す
    （`bookings/new/page.tsx:194`）。空文字のまま返すと**どの枠も一致せず、
    常に「埋まりました」になる**。実装の不具合に見えるが、固定データの穴。

    `empty: true` は**枠が消えた状態**（`Lg8ff` の競合回復を撮るため）。
    器は同じで `slots` だけ空にする。
  */
  return {
    by_staff: [{
      staff_id: person.id,
      display_name: person.display_name,
      slots: empty ? [] : [
        { date, start: '10:00', end: '11:45' },
        { date, start: BOOKING_TAKEN_SLOT, end: '15:45' },
      ],
    }],
  }
}

/*
  保存した対象条件（`SavedSegmentPreset`）。

  **「保存した検索」とは別の型。** あちらは受信箱の絞り込み
  （`SavedSearch`、`{ all, any, visibility }`）で、こちらは配信の対象条件
  （`conditionFormat: 'segment_v1'`、`conditions.condition`）。同じ口
  （`/api/saved-searches`）を `format=segment_v1` で切り替えて使う。
  **混ぜると、受信箱の条件で配信を送ることになる。**

  `usedIn` は実データのある画面だけが使う。ここでは1本目に
  「いま予約中の配信から呼ばれている」形を入れ、
  **呼ばれている条件は消せない**（`canDelete: false`）ことを見る。
*/
export const SEGMENT_PRESETS = [
  {
    id: 'sp-1', name: '直近30日で反応した友だち', scope: 'friends',
    conditionFormat: 'segment_v1',
    conditions: {
      version: 1,
      /*
        **形は `SegmentCondition`**（`apps/web/src/lib/segment-condition.ts:29`）。
        `{ operator, rules }` であって `{ all: [...] }` ではない。
        別名で書くと「この条件を使う」で画面が落ちる（実際に落とした）。
      */
      condition: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-0' }] },
    },
    createdBy: 'staff-1', lineAccountId: 'visual-qa-account', isShared: true,
    displayOrder: 1, createdAt: '2026-08-12T02:00:00.000Z',
    usedIn: [{ kind: 'broadcast', id: 'broadcast-0', name: '8月キャンペーンのお知らせ', mode: 'live', lastUsedAt: '2026-08-22T01:00:00.000Z' }],
    canDelete: false,
  },
  {
    /* 自分だけのもの。**共有していない**ことが見えること。 */
    id: 'sp-2', name: '定期便を止めた人', scope: 'friends',
    conditionFormat: 'segment_v1',
    conditions: {
      version: 1,
      condition: { operator: 'AND', rules: [{ type: 'tag_not_exists', value: 'tag-1' }] },
    },
    createdBy: 'staff-1', lineAccountId: 'visual-qa-account', isShared: false,
    displayOrder: 2, createdAt: '2026-07-30T05:40:00.000Z',
    usedIn: [], canDelete: true,
  },
]

/*
  オートメーションの見本（`AutomationTemplateSummary`）。

  **見本は実データのIDを持たない。** タグやシナリオは、選んだ人が
  自分の環境のものを選び直す。だからここに `tag-0` のような id は書かない。
  `triggerLabel` `actionLabel` は**そのまま画面に出る言葉**。
*/
export const AUTOMATION_TEMPLATES = [
  {
    key: 'welcome-tag',
    name: '友だち追加であいさつを送る',
    description: '追加された人へ1通送り、あとから絞り込めるようタグを付けます。',
    triggerLabel: '友だちが追加されたとき',
    actionLabel: 'メッセージを送る → タグを付ける',
  },
  {
    key: 'form-followup',
    name: '回答フォームの答えでシナリオを始める',
    description: 'フォームに答えた人を、その内容に合うシナリオへ入れます。',
    triggerLabel: 'フォームに回答されたとき',
    actionLabel: 'シナリオを開始する',
  },
  {
    key: 'booking-thanks',
    name: '予約が入ったらお礼を送る',
    description: '予約が確定した人へお礼を送り、来店前の案内につなげます。',
    triggerLabel: '予約が確定したとき',
    actionLabel: 'メッセージを送る',
  },
]

/*
  リマインダの下書きと、公開までの4つの返事。

  **型は `packages/shared/src/types.ts:1078` から。** `ReminderDraftVersion`
  `ReminderValidationResult` `ReminderPreviewResult` `ReminderPublishResult`。

  **数えていないものは `null` にする。** `audience` `excluded` `next7Days`
  はどれも `number | null` で、画面は `null` を `—人` に描く。0を入れると
  「数えたら0だった」に化ける。ここでは対象は数えられている（124人）が、
  **除外だけは数える口が無い**ので `null` のままにしてある。
*/
export const REMINDER_DRAFT = {
  reminderId: 'reminder-3', versionId: 'rv-3-2', versionNumber: 2, status: 'draft',
  settings: {
    name: '予約前日のお知らせ', description: '前日の19:00に、翌日の予約をお知らせします。',
    lineAccountId: 'visual-qa-account', triggerType: 'booking', deliveryMode: 'time',
    triggerFieldId: null, repeatYearly: false, triggerOffsetMinutes: -1440,
    sendAtTime: '19:00', targetTagId: 'tag-0', folderId: null,
    stopConditions: {
      bookingCancelled: true, supportMarkCompleted: true,
      daysAfterTarget: 3, friendBlocked: true,
    },
    steps: [
      {
        stableStepId: 'rs-1', offsetMinutes: -1440, messageType: 'text',
        messageContent: '明日のご予約をお待ちしています。ご来店は10分前を目安にお願いします。',
        offsetDays: -1, sendAtTime: '19:00', templateId: null,
      },
      {
        stableStepId: 'rs-2', offsetMinutes: -120, messageType: 'text',
        messageContent: '本日おまちしています。道順はこちらからご確認ください。',
        offsetDays: 0, sendAtTime: '08:00', templateId: null,
      },
    ],
  },
  lastTestStatus: 'succeeded', lastTestedAt: '2026-08-28T09:12:00.000Z', publishedAt: null,
}

/*
  届く予定。**過去になる通と、重なる通を、そのまま出す。**
  `state` は `scheduled | past | duplicate` の3つ。都合の悪いものを隠すと、
  公開してから「送られなかった」に気づくことになる。
*/
export const REMINDER_PREVIEW = {
  targetDate: '2026-09-03',
  items: [
    { stableStepId: 'rs-1', stepNumber: 1, scheduledAt: '2026-09-02T10:00:00.000Z', label: '前日 19:00', state: 'scheduled' },
    { stableStepId: 'rs-2', stepNumber: 2, scheduledAt: '2026-09-02T23:00:00.000Z', label: '当日 08:00', state: 'scheduled' },
  ],
  summary: { audience: 124, next7Days: 38, next30Days: 162, duplicateCount: 0 },
}

/* 公開前チェック。**通ったものだけでなく、注意も出す。** */
export const REMINDER_VALIDATION = {
  valid: true,
  checks: [
    { key: 'trigger', label: '基準日が決まっています', status: 'passed', message: '予約日を基準にします' },
    { key: 'steps', label: 'すべての通に送る時刻があります', status: 'passed', message: '2通とも時刻が入っています' },
    { key: 'test', label: 'テスト送信が終わっています', status: 'passed', message: '2026/08/28 18:12 に成功' },
    { key: 'stop', label: '止める条件があります', status: 'passed', message: '予約取消・対応完了・ブロックで止まります' },
    { key: 'audience', label: '届く人がいます', status: 'warning', message: '除外される人数は数えられません' },
  ],
  audience: { matched: 124, excluded: null },
}

export const REMINDER_PUBLISHED = {
  reminderId: 'reminder-3', versionId: 'rv-3-2', versionNumber: 2,
  publishedAt: '2026-08-29T02:30:00.000Z',
  audience: 124, plannedDeliveries: 38, nextScheduledAt: '2026-09-02T10:00:00.000Z',
}

/*
  緊急停止の下見（`GET /api/operations/control/preview`）。

  **形は `OperationControlSet`**（`packages/db/src/operations.ts:15`）。
  `states` は**7つ全部**を持つ（画面が選べるのは4つだけだが、型は7つ）。

  `counts` は**件数だけ**。Workerが数えているのは
  `broadcasts` `scenarios` `reminders` `automations` の行数で、
  **友だちの人数は数えていない**（`operations.ts:283`）。ここで人数を
  作ってしまうと、実装に無いものを在るように見せることになる。
*/
const OPERATION_STATES_RUNNING = {
  broadcast_dispatch: 'running', scenario_dispatch: 'running',
  reminder_dispatch: 'running', automation_actions: 'running',
  auto_reply_dispatch: 'running', webhook_outgoing: 'running',
  ad_postback: 'running',
}

export const OPERATION_CONTROL_PREVIEW = {
  control: {
    scopeKey: 'all', lineAccountId: null, version: 3,
    states: OPERATION_STATES_RUNNING,
    activeIncidentId: null, reason: null, actorId: null,
    stoppedAt: null, updatedAt: '2026-08-28T11:00:00.000Z',
  },
  counts: {
    broadcast_dispatch: 1,
    scenario_dispatch: 4,
    reminder_dispatch: 10,
    automation_actions: 3,
  },
  permissions: { canControl: true },
  calculatedAt: '2026-08-29T02:30:00.000Z',
}

/* 1アカウントに絞ったとき。**「すべて」と数が変わることを見る。** */
export const OPERATION_CONTROL_PREVIEW_ONE = {
  ...OPERATION_CONTROL_PREVIEW,
  control: { ...OPERATION_CONTROL_PREVIEW.control, scopeKey: 'visual-qa-account', lineAccountId: 'visual-qa-account' },
  counts: {
    broadcast_dispatch: 1,
    scenario_dispatch: 2,
    reminder_dispatch: 6,
    automation_actions: 1,
  },
}

/*
  質問のひな形（#572）。**下書きと公開済みを1つずつ入れる。**

  形は `ScenarioQuestion`（`components/scenarios/question-editor.tsx:34`）。
  **`answerTarget` という欄は無い。** 回答先は選択肢ごとに
  `addTagIds` / `removeTagIds` / `field` / `scenario` へ分かれて入る。

  **シナリオの選択肢に出るのは公開済みだけ**
  （`scenario-detail-client.tsx:339` が `!t.question || t.questionStatus === 'published'`）。
  下書きが混ざらないことを見るため、両方を同じ一覧へ入れておく。
*/
export const QUESTION_TEMPLATE_PUBLISHED = {
  id: 'template-q-pub', name: '継続の意思をうかがう', category: '未分類',
  messageType: 'text', messageContent: 'ご利用ありがとうございます。',
  folderId: null, usageCount: 2, tapCount: 41, isFavorite: false,
  /* **`createdAt` と `updatedAt` は必須。** 無いと一覧の日付が `Invalid Date` になる。 */
  createdAt: '2026-08-12T02:00:00.000Z', updatedAt: '2026-08-26T04:30:00.000Z',
  questionStatus: 'published',
  question: {
    intro: 'ご利用ありがとうございます。',
    text: '来月も続けますか？',
    altText: '継続の確認',
    tapMode: 'single',
    choices: [
      {
        label: '続ける', behavior: 'none',
        userMessage: '続けます', reply: 'ありがとうございます。引き続きよろしくお願いします。',
        addTagIds: ['tag-0'], removeTagIds: ['tag-4'],
        field: { fieldId: 'ff-plan', value: '継続' },
      },
      {
        label: 'やめる', behavior: 'scenario',
        scenario: { op: 'start', scenarioId: 'scenario-2', restart: 'from_start', rememberPrevious: false },
        userMessage: 'やめます', reply: 'かしこまりました。',
        addTagIds: ['tag-4'], removeTagIds: [],
      },
    ],
  },
}

export const QUESTION_TEMPLATE_DRAFT = {
  id: 'template-q-draft', name: '（下書き）誕生月の希望をきく', category: '未分類',
  messageType: 'text', messageContent: '',
  folderId: null, usageCount: 0, tapCount: 0, isFavorite: false,
  createdAt: '2026-08-24T09:15:00.000Z', updatedAt: '2026-08-24T09:15:00.000Z',
  questionStatus: 'draft',
  question: {
    text: '誕生月に何が届くとうれしいですか？',
    tapMode: 'single',
    choices: [
      { label: 'クーポン', behavior: 'none', addTagIds: ['tag-5'] },
      { label: 'サンプル', behavior: 'none', addTagIds: [] },
    ],
  },
}

/*
  お知らせの一覧（`NotificationCenterData`、`packages/shared/src/types.ts:1147`）。

  **`counts` の4つを必ず揃える。** 画面は `counts.all` を読むので、
  欠けると `undefined.all` でダッシュボードごと落ちる。

  **未読と既読を混ぜる。** どちらか片方だけだと「未読だけ絞る」が
  効いているのか分からない。`category` は `error` と `update` の
  両方を入れて、絞り込みの札が動くようにする。
*/
export const NOTIFICATION_CENTER = {
  items: [
    {
      id: 'nc-1', eventType: 'broadcast_failed', category: 'error',
      title: '一斉配信が途中で止まりました',
      body: '「8月キャンペーンのお知らせ」で3件が送れませんでした。相手のブロックが理由です。',
      metadata: { broadcastId: 'broadcast-0' }, isRead: false,
      createdAt: '2026-08-29T23:40:00.000Z',
    },
    {
      id: 'nc-2', eventType: 'line_quota_warning', category: 'error',
      title: 'LINEの送信枠が残り少なくなっています',
      body: '今月の残りは 1,240 通です。予約中の配信で 2,100 通を使う予定です。',
      metadata: null, isRead: false,
      createdAt: '2026-08-29T12:10:00.000Z',
    },
    {
      id: 'nc-3', eventType: 'release_note', category: 'update',
      title: '質問テンプレートが使えるようになりました',
      body: 'シナリオの通に、選択肢つきの質問を差し込めます。',
      metadata: null, isRead: true,
      createdAt: '2026-08-28T02:00:00.000Z',
    },
  ],
  counts: { all: 3, error: 2, update: 1, unread: 2 },
  unreadCount: 2,
}

/**
 * 支払い（設計 `njLGA` 16-1-C）。**#585 `75d6eb9a` の実装に合わせた。**
 *
 * 形は Worker の `getAffiliatePaymentSummaries()`
 * （`packages/db/src/affiliate-payments.ts`）の返り値そのまま。読み口は
 * `GET /api/affiliate-payments`、返事は `{ success, data, limitations }`
 * （`ApiResponse` の入れ子ではない。`api.ts:2391`）。
 *
 * **問い合わせから写した決めごと：**
 * - `LEFT JOIN conversion_events ... AND COALESCE(ce.approval_status,'pending') = 'approved'`
 *   → **承認済みだけを数える。`pending` と `rejected` は合計に入らない**
 * - 報酬は `a.commission_rate > 0` なら `cp.value * rate / 100`（**割合方式**）、
 *   そうでなければ `off.reward_amount`（**定額方式。率0%でも固定額が出る**）
 * - 保留は `hold_days > 0 かつ approved_at が有り かつ 保留の窓の中`
 * - `holdStatusUnknown` は `hold_days > 0 かつ 成果が有り かつ approved_at が無い`
 *   → **保留期間内と、承認日時が取れていない件を混ぜない**
 * - 並びは `approved_reward DESC, name ASC`
 *
 * **入れてある場合分け：**
 * | 相手 | 方式 | 承認済み | 保留 | 承認日時 | 覚書 |
 * |---|---|---|---|---|---|
 * | 田中 紹介 | 割合10% | 24件 ¥72,000 | 期間内3件 | 全部あり | あり |
 * | 北の店ネットワーク | 定額（率0%） | 8件 ¥24,000 | **期間外0件** | 全部あり | あり |
 * | 佐藤 個人 | 割合 | 5件 ¥15,000 | 期間内1件 | **2件が未取得** | **なし** |
 * | 山あい商店 | — | **0件 ¥0** | 保留なし | — | なし |
 *
 * **`pending` と `rejected` はここに現れない。** Workerが問い合わせで除くため、
 * 口の返り値には入らない。**除かれていることは金額の作り方で確かめる**——
 * 田中は承認済み成果 ¥720,000 × 10% = ¥72,000 で、保留中や却下の分を足していない。
 *
 * **`— ` を作らない。** 実値0の人は `0`（`approvedReward: 0`）で持つ。
 * 取れていないことを表すのは `payoutCycle: null`（覚書なし）と
 * `holdDays: null`（保留なし）と `holdStatusUnknown`（承認日時が無い件数）だけ。
 */
export const AFFILIATE_PAYMENTS = {
  success: true,
  data: [
    {
      affiliateId: 'aff-1', affiliateName: '田中 紹介', code: 'tanaka',
      holdDays: 30, payoutCycle: '毎月末締め・翌月末払い',
      /* 割合方式。承認済み成果 ¥720,000 × 10%。 */
      approvedConversions: 24, approvedReward: 72000,
      heldConversions: 3, heldReward: 9000,
      holdStatusUnknown: 0,
    },
    {
      affiliateId: 'aff-2', affiliateName: '北の店ネットワーク', code: 'north',
      holdDays: 30, payoutCycle: '毎月末締め・翌月末払い',
      /* **定額方式。率0%でも固定額が出る。** ¥3,000 × 8件。 */
      approvedConversions: 8, approvedReward: 24000,
      /* **保留の窓の外。**実値0なので `0` で持つ（`—` にしない）。 */
      heldConversions: 0, heldReward: 0,
      holdStatusUnknown: 0,
    },
    {
      affiliateId: 'aff-3', affiliateName: '佐藤 個人', code: 'sato',
      holdDays: 14,
      /* **覚書なし。**画面は「—（覚書なし）」と出す。 */
      payoutCycle: null,
      approvedConversions: 5, approvedReward: 15000,
      heldConversions: 1, heldReward: 3000,
      /* **承認日時が取れていない2件。**画面に「一部未取得」の札が出る。 */
      holdStatusUnknown: 2,
    },
    {
      affiliateId: 'aff-4', affiliateName: '山あい商店', code: 'yamai',
      /* **保留なし。**`holdDays` が `null`。 */
      holdDays: null, payoutCycle: null,
      /* **承認済みが実値0の人。**`0円` と出るべきで、`—` ではない。 */
      approvedConversions: 0, approvedReward: 0,
      heldConversions: 0, heldReward: 0,
      holdStatusUnknown: 0,
    },
  ],
  /* **実装が返す3つの穴。**どれも `false` の直値（`api.ts:2394`）。 */
  limitations: { payoutHistory: false, bankDestination: false, settlementSchedule: false },
}

/** 支払いの「0件」。**取得はできて、相手が1人もいない状態。** */
export const AFFILIATE_PAYMENTS_EMPTY = {
  success: true,
  data: [],
  limitations: { payoutHistory: false, bankDestination: false, settlementSchedule: false },
}

/**
 * 支払いを確定する（設計 `GqFTV` 16-1-H）。**Codexが実装する前の下ごしらえ。**
 *
 * **口もルートも「想定」で、正本ではない。** PRのheadが届いたら、まず実装の
 * コードでルートと口と型を確かめてから使う。**推測したAPIパスを正本にしない。**
 * - 想定ルート：`/conversions?tab=payment`（`njLGA` と同じ面の中の操作）
 * - 想定の口：`GET /api/affiliate-payment-periods`
 *
 * **決まっていること（2026-08-30）を形にしてある：**
 * - **締め済みの期間は変更しない。**`status: 'closed'` の行は金額が動かない
 * - **返品は次の未締め期間へマイナス調整として入れる。**`adjustments` に
 *   負の `amount` を持たせ、**どの締め済み期間の返品か**を `originPeriodId` で指す
 * - `njLGA` と同じく **「未払い残高」とは書かない**。締める前は
 *   `approvedReward`（承認済み報酬の合計）、締めたあとは `closedAmount`
 *
 * **実在する表から出せる範囲**：`conversion_events`（`approval_status`
 * `approved_at` `affiliate_id`）、`affiliates`（`hold_days` `payout_cycle`）、
 * `affiliate_offers`（`reward_amount`）。**期間の台帳そのものは新しく要る。**
 *
 * 入れてある場合分け：**締め済み1・未締め1・調整あり1・調整なし1**。
 */
export const AFFILIATE_PAYMENT_PERIODS = {
  success: true,
  data: [
    {
      periodId: 'ap-2026-07', from: '2026-07-01', to: '2026-07-31',
      /* **締め済み。**金額は動かさない。 */
      status: 'closed', closedAt: '2026-08-01T01:00:00.000Z', closedBy: '川野 健太',
      closedAmount: 96000, closedConversions: 32,
      adjustments: [],
    },
    {
      periodId: 'ap-2026-08', from: '2026-08-01', to: '2026-08-31',
      /* **まだ締めていない。**締めるまで金額は動く。 */
      status: 'open', closedAt: null, closedBy: null,
      closedAmount: null, closedConversions: null,
      approvedReward: 111000, approvedConversions: 37,
      adjustments: [
        {
          /* **7月分の返品。**締め済みの7月は直さず、8月へマイナスで入れる。 */
          adjustmentId: 'adj-1', reason: '返品',
          amount: -9000, conversions: -3,
          originPeriodId: 'ap-2026-07', recordedAt: '2026-08-12T03:00:00.000Z',
        },
      ],
    },
  ],
  /* `njLGA` と同じ穴。締めが入っても振込先はまだ無い。 */
  limitations: { payoutHistory: false, bankDestination: false },
}

/** 締めの「0件」。**期間の台帳がまだ1本も無い状態。** */
export const AFFILIATE_PAYMENT_PERIODS_EMPTY = {
  success: true, data: [],
  limitations: { payoutHistory: false, bankDestination: false },
}

/**
 * コラム（設計 `ymXJK` 21-1-E）。**Codexが実装する前の下ごしらえ。**
 *
 * **列は推測ではない**——`nen_columns`（`bootstrap.sql:1458`）そのまま。
 * **想定なのは管理画面から作る口だけ**（`POST /api/nen-campaigns/columns` と想定）。
 * PRのheadが届いたら実装で確かめる。
 *
 * **決まっていること（2026-08-30）：V6は外部記事リンク方式。本文をDBに持たない。**
 * よって `article_url` は必ず埋まり、本文の列は増やさない。いまの取り込み口
 * （EC-CUBEからの署名付きWebhook）と同じ形で、管理画面からも作れるようにするだけ。
 *
 * 入れてある場合分け：**公開済み・下書き・画像なし・公開日未取得**。
 */
export const NEN_COLUMN_DRAFT = {
  id: 'col-new', externalId: null, slug: 'summer-care-2026',
  title: '夏のケアで気をつけたいこと',
  category: 'お手入れ',
  excerpt: '暑い時期に増えるご相談を、3つにまとめました。',
  introText: '暑くなってきましたね。今月は夏のケアについてお届けします。',
  articleUrl: 'https://example.co.jp/columns/summer-care-2026',
  imageUrl: 'https://example.co.jp/img/summer-care.jpg',
  /* **公開日が未取得。**`—` と出るべきで、今日の日付で埋めない。 */
  publishedAt: null,
  deliveryStatus: 'draft', deliveryAt: null,
  createdAt: '2026-08-30T01:00:00.000Z', updatedAt: '2026-08-30T01:00:00.000Z',
}

/**
 * イベントの申込者（設計 `i5SN2j`）。型は `EventBookingItem`（`api.ts:4046`）。
 *
 * **画面の押し口は状態で出し分かれる**（`events/bookings/page.tsx:410,432`）——
 * 「拒否」は `status: 'requested'` の行、「運営キャンセル」は `'confirmed'` の行
 * にしか出ない。**どちらも入れないと窓を撮れない。**
 *
 * **名前が取れない行も1つ入れてある**（`friend_display_name: null`）。
 * 画面が内部IDで代用せず「友だちは未取得」と書くかを、この1枚で確かめる。
 */
export const EVENT_BOOKINGS = [
  {
    id: 'eb-1', event_id: 'ev-1', slot_id: 'evs-1', friend_id: 'friend-1',
    line_account_id: 'visual-qa-account', status: 'requested',
    customer_note: 'はじめて参加します', internal_note: null,
    requested_at: '2026-08-28T02:10:00.000Z', decided_at: null,
    cancelled_at: null, cancelled_by: null,
    slot_starts_at: '2026-09-05T05:00:00.000Z', slot_ends_at: '2026-09-05T06:00:00.000Z',
    friend_display_name: '菅野 亮', friend_line_user_id: 'U-visual-3',
  },
  {
    id: 'eb-2', event_id: 'ev-1', slot_id: 'evs-1', friend_id: 'friend-2',
    line_account_id: 'visual-qa-account', status: 'confirmed',
    customer_note: null, internal_note: null,
    requested_at: '2026-08-26T01:00:00.000Z', decided_at: '2026-08-26T02:00:00.000Z',
    cancelled_at: null, cancelled_by: null,
    slot_starts_at: '2026-09-05T05:00:00.000Z', slot_ends_at: '2026-09-05T06:00:00.000Z',
    friend_display_name: 'Kenta Kawano', friend_line_user_id: 'U-visual-1',
  },
  {
    /* **名前が取れない行。**内部IDで代用していないかを見る。 */
    id: 'eb-3', event_id: 'ev-1', slot_id: 'evs-1', friend_id: 'friend-9',
    line_account_id: 'visual-qa-account', status: 'confirmed',
    customer_note: null, internal_note: null,
    requested_at: '2026-08-25T04:00:00.000Z', decided_at: '2026-08-25T05:00:00.000Z',
    cancelled_at: null, cancelled_by: null,
    slot_starts_at: '2026-09-05T05:00:00.000Z', slot_ends_at: '2026-09-05T06:00:00.000Z',
    friend_display_name: null, friend_line_user_id: null,
  },
  {
    id: 'eb-4', event_id: 'ev-1', slot_id: 'evs-1', friend_id: 'friend-3',
    line_account_id: 'visual-qa-account', status: 'waiting',
    customer_note: null, internal_note: null,
    requested_at: '2026-08-29T03:00:00.000Z', decided_at: null,
    cancelled_at: null, cancelled_by: null,
    slot_starts_at: '2026-09-05T05:00:00.000Z', slot_ends_at: '2026-09-05T06:00:00.000Z',
    friend_display_name: '山田 太郎', friend_line_user_id: 'U-visual-4',
  },
]

/**
 * 自動応答の下書き・確認・試験・公開（設計 `U9hzqH` `g46ja` `Yj6CQ` `e6iJG`）。
 * 型は `packages/shared/src/types.ts:1297` 以降。**#595 の契約に合わせている。**
 *
 * この一式が守っている決めごと：
 * - **下書きだけを持ち、公開中の版は変えない**（`status: 'draft'`）
 * - **試験は本番の評価順で回すが、状態は動かさない**（`stateChanged: false`）
 * - **競合は全件返す。**「たぶん当たる」も落とさず `certainty` で分ける
 * - **試験で下書き自身が勝つまで公開させない**（`draftWon`）
 */
export const AUTO_REPLY_DRAFT = {
  autoReplyId: 'ar-2', versionId: 'arv-7', versionNumber: 7, status: 'draft',
  settings: {
    name: '営業時間外の自動返信',
    keywords: ['営業時間', '何時から'],
    keywordMatch: 'any',
    responseType: 'text',
    responseContent: '平日 10:00〜19:00 に受け付けています。',
  },
  lastTestStatus: 'succeeded',
  lastTestedAt: '2026-08-30T02:10:00.000Z',
  publishedAt: null,
}

/** まだ試していない下書き。**公開前チェックが通らない状態を撮るため。** */
export const AUTO_REPLY_DRAFT_UNTESTED = {
  ...AUTO_REPLY_DRAFT, lastTestStatus: null, lastTestedAt: null,
}

/**
 * 競合（`U9hzqH`）。**確かに当たるものと、当たるかもしれないものを分ける。**
 * どちらが勝つかも `winnerAutoReplyId` で示すので、**この下書きが負ける組み合わせ**が分かる。
 */
export const AUTO_REPLY_CONFLICTS = [
  {
    autoReplyId: 'ar-1', name: '「営業時間」への一律返信', certainty: 'certain',
    winnerAutoReplyId: 'ar-1',
    reason: '同じ「営業時間」を全メッセージで受けており、順番が上のためこちらが先に返します',
  },
  {
    autoReplyId: 'ar-5', name: '予約の問い合わせ', certainty: 'possible',
    winnerAutoReplyId: 'ar-2',
    reason: '「何時から」が部分一致する場合があります。時間帯が重なるときだけ競合します',
  },
]

/** 公開前チェック（`Yj6CQ`）。**通らない理由を全部返す。** */
export const AUTO_REPLY_VALIDATION = {
  valid: false,
  errors: [],
  warnings: ['「営業時間」は、ほかの自動応答でも受けています'],
  conflicts: AUTO_REPLY_CONFLICTS,
  lastTestStatus: 'succeeded',
}

/** 通る側。 */
export const AUTO_REPLY_VALIDATION_OK = {
  valid: true, errors: [], warnings: [], conflicts: [], lastTestStatus: 'succeeded',
}

/**
 * 試験の結果（`g46ja`）。**本番と同じ評価順で候補を全部返す。**
 * 落ちた理由は `reasonCodes` で、**なぜ当たらなかったかが1件ずつ分かる。**
 * `stateChanged: false` は型が `false` の直値。**送信も状態更新もしない印。**
 */
export const AUTO_REPLY_DRY_RUN = {
  matched: true,
  draftWon: true,
  winner: {
    autoReplyId: 'ar-2', name: '営業時間外の自動返信',
    responseType: 'text', responseContent: '平日 10:00〜19:00 に受け付けています。',
  },
  candidates: [
    { autoReplyId: 'ar-1', name: '「営業時間」への一律返信', priority: 1, result: 'skipped', reasonCodes: ['outside_active_window'] },
    { autoReplyId: 'ar-2', name: '営業時間外の自動返信', priority: 2, result: 'won', reasonCodes: [] },
    { autoReplyId: 'ar-5', name: '予約の問い合わせ', priority: 3, result: 'not_matched', reasonCodes: ['keyword_not_matched'] },
  ],
  actions: [{ kind: 'send_text' }],
  stateChanged: false,
}

/** 下書きが負ける試験。**このときは公開させない。** */
export const AUTO_REPLY_DRY_RUN_LOST = {
  ...AUTO_REPLY_DRY_RUN,
  draftWon: false,
  winner: { autoReplyId: 'ar-1', name: '「営業時間」への一律返信', responseType: 'text', responseContent: '受付時間は追ってご案内します。' },
  candidates: [
    { autoReplyId: 'ar-1', name: '「営業時間」への一律返信', priority: 1, result: 'won', reasonCodes: [] },
    { autoReplyId: 'ar-2', name: '営業時間外の自動返信', priority: 2, result: 'skipped', reasonCodes: ['already_replied_once'] },
  ],
}

/** 公開の結果（`e6iJG`）。 */
export const AUTO_REPLY_PUBLISHED = {
  autoReplyId: 'ar-2', versionId: 'arv-7', versionNumber: 7,
  publishedAt: '2026-08-30T02:30:00.000Z',
  acknowledgedConflictIds: ['ar-1', 'ar-5'],
}

/**
 * 友だち追加時の配信の、公開までの契約（設計 `ec9vg` `quhg6`）。
 *
 * **Codexが作る前の下ごしらえ。API head が届くまで使わない。**
 * `screens.mjs` の `ec9vg` `quhg6` は `unimplemented` のままにしてある。
 *
 * **口もルートも「想定」で正本ではない。** head が届いたら実装のコードで
 * 確かめてから使う。**推測したAPIパスを正本にしない。**
 * - 想定ルート：`/friend-add-settings/publish`
 * - 想定の口：`/api/friend-add-rules/:id/{draft,validate,conflicts,test,publish}`
 *
 * **形は機能8（#595 の自動応答）に合わせてある。** 同じ「下書き → 確認 →
 * 試験 → 公開」なので、**別々の形にすると画面も試験も二重に持つことになる。**
 * 設定の中身だけ `FriendAddRouting`（`packages/shared/src/types.ts:1719`）。
 *
 * 機能9にだけある確認：
 * - **二重経路**（同じ人が2つの入口から入って2回配信されないか）
 * - **流入条件**（どの流入リンクから来た人か）
 * - **初回案内**（はじめての人へ最初に送るもの）
 */
export const FRIEND_ADD_DRAFT = {
  ruleId: 'far-1', versionId: 'farv-3', versionNumber: 3, status: 'draft',
  settings: {
    firstTime: { scenarioId: 'scenario-0', timing: 'immediate', actions: [{ kind: 'tag', op: 'add', tagIds: ['tag-0'] }] },
    returning: { scenarioId: null, mode: 'same', startPosition: 'resume', actions: [] },
    criteria: { firstTime: 'never_added' },
  },
  lastTestStatus: 'succeeded',
  lastTestedAt: '2026-08-30T02:10:00.000Z',
  publishedAt: null,
}

/** まだ試していない下書き。**公開前チェックが通らない状態を撮るため。** */
export const FRIEND_ADD_DRAFT_UNTESTED = {
  ...FRIEND_ADD_DRAFT, lastTestStatus: null, lastTestedAt: null,
}

/**
 * 二重経路の確認（`ec9vg`）。**同じ人が2回配信される組み合わせを出す。**
 * 機能8の「競合」に当たるが、こちらは**入口が2つある**という別の重なり方。
 */
export const FRIEND_ADD_CONFLICTS = [
  {
    ruleId: 'entry-summer-ig', name: '夏のInstagram投稿（流入リンク）', certainty: 'certain',
    winnerRuleId: 'entry-summer-ig',
    reason: 'この流入リンクにもシナリオが設定されています。同じ人に2回届きます',
  },
  {
    ruleId: 'ar-3', name: '友だち追加の自動応答', certainty: 'possible',
    winnerRuleId: 'far-1',
    reason: '追加直後のメッセージと重なることがあります。相手が先に送ってきた場合だけです',
  },
]

/** 公開前チェック（`ec9vg`）。**通らない理由を全部返す。** */
export const FRIEND_ADD_VALIDATION = {
  valid: false,
  errors: [],
  warnings: ['はじめての人のシナリオが「決めていない」ままです'],
  conflicts: FRIEND_ADD_CONFLICTS,
  lastTestStatus: 'succeeded',
  /* **対象見込み。**取得元が無い項目は `null` で返し、画面は `—（未取得）` にする。 */
  estimatedTargets: { firstTime: 116, returning: null },
}

export const FRIEND_ADD_VALIDATION_OK = {
  valid: true, errors: [], warnings: [], conflicts: [], lastTestStatus: 'succeeded',
  estimatedTargets: { firstTime: 116, returning: 8 },
}

/**
 * 試験（`ec9vg` の手前）。**送信も状態更新もしない**（`stateChanged: false`）。
 * 機能8と同じ形にしてある。
 */
export const FRIEND_ADD_DRY_RUN = {
  matched: true,
  branchTaken: 'firstTime',
  scenario: { id: 'scenario-0', name: '新規登録7日間フォロー' },
  actions: [{ kind: 'tag', op: 'add', tagIds: ['tag-0'] }],
  duplicateRoutes: [{ ruleId: 'entry-summer-ig', name: '夏のInstagram投稿（流入リンク）' }],
  stateChanged: false,
}

/** 公開の結果（`quhg6`）。 */
export const FRIEND_ADD_PUBLISHED = {
  ruleId: 'far-1', versionId: 'farv-3', versionNumber: 3,
  publishedAt: '2026-08-30T02:30:00.000Z',
  acknowledgedConflictIds: ['entry-summer-ig', 'ar-3'],
  /* **監視先。**取得元が無ければ `null` にして、画面は `—（未取得）`。 */
  monitoring: { runsPath: '/friend-add-settings/runs', slackChannel: null },
}

/**
 * 「候補を1件ずつ判定する」台帳（設計 `InCDe` 3-2-A と `ELayY` 23-1-A）。
 *
 * **Codexが作る前の下ごしらえ。API head が届くまで使わない。**
 * `screens.mjs` の2行は `unimplemented` のままにしてある。
 *
 * **口もルートも「想定」で正本ではない。** head が届いたら実装で確かめる。
 * - `InCDe` 想定ルート：`/friends/duplicates/review?id=dup-1`
 * - `ELayY` 想定ルート：`/ec-commerce/identity/review?id=idc-1`
 * - 想定の口：`/api/identity-candidates/:id` と `/api/identity-candidates/:id/decide`
 *
 * **2つは同じ形にしてある。** どちらも「2件が同じ人かを、根拠を見て決める」
 * 画面で、違うのは**何と何を突き合わせるか**だけ——`InCDe` は友だち同士、
 * `ELayY` はECの注文とLINEの友だち。**別々の形にすると、画面も試験も
 * 二重に持つことになる。**
 *
 * 判定は5つ（要件 §9）：`pending` / `linked` / `different` / `deferred` /
 * `invalidated`。**「別人」と決めたものを毎回出さない**（再提示の抑止）ため、
 * `different` を残す必要がある。**消してしまうと、また候補に出てくる。**
 */
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

/* PR #597 の公開前確認。契約と同じ項目名で置く。 */
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

/* PR #608 のリッチメニュー削除影響。契約と同じ項目名で置く。 */
/*
  **下書きでも消せないことがある。** ほかのメニューからの切替先になって
  いたり、自動処理から使われていたりすると、消すとその先が壊れる。
  公開中のメニューは削除の窓自体が出ない（先に取り下げる案内へ回る）ので、
  この影響は**参照で塞がれた下書き**の形にする。
*/
export const RICH_MENU_DELETE_IMPACT = {
  group: {
    id: 'rmg-4',
    accountId: 'visual-qa-account',
    name: '店舗A限定メニュー',
    status: 'draft',
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
    pagesWithLineRichMenuId: 0,
    isDefaultForAll: false,
    publishing: false,
  },
  blockers: ['incoming_switches', 'operational_references'],
  canDelete: false,
  recommendedAction: 'review_references',
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

/* PR #610 のメディア削除影響。契約と同じ項目名で置く。 */
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

/* PR #611 の共通情報の削除影響。契約と同じ項目名で置く。 */
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
