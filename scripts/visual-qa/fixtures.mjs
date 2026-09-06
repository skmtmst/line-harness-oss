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
  { id: 'g-inquiry-follow', name: 'お問い合わせフォロー', sortOrder: 5, color: '#7C3AED', createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z' },
]

/** 機能4のCSV取込。DBを変えず、同じ入力には同じ判定を返す。 */
export const TAG_IMPORT_SAMPLE_ROWS = [
  { line: 12, name: '定期便リマインド', folderName: '購入' },
  { line: 13, name: 'VIP', folderName: 'VIP' },
  { line: 14, name: '誕生日クーポン 2026', folderName: '誕生日' },
  { line: 15, name: '', folderName: '会員' },
  { line: 16, name: '会員\nランク', folderName: '会員' },
  { line: 88, name: '長期未購入フォロー用の判定タグ（2026年版・暫定）'.repeat(2), folderName: '' },
  { line: 204, name: '店舗共通ラベル', folderName: 'お問い合わせフォロー' },
  { line: 331, name: '休眠', folderName: '' },
]

const EXISTING_TAG_NAMES = new Set(['VIP', 'EC顧客連携済み', 'NEN会員'])

export function tagImportPreview(rows = TAG_IMPORT_SAMPLE_ROWS) {
  const knownFolders = new Set(TAG_GROUPS.map((folder) => folder.name))
  const seen = new Set()
  const planned = rows.map((input, index) => {
    const line = Number.isInteger(input?.line) && input.line > 0 ? input.line : index + 2
    const name = typeof input?.name === 'string' ? input.name.trim() : ''
    const folderName = typeof input?.folderName === 'string' ? input.folderName.trim() : ''
    const base = { line, name, folderName }
    if (!name) return { ...base, status: 'invalid', code: 'name_required', message: 'タグ名が入っていません' }
    if (name.length > 60) return { ...base, status: 'invalid', code: 'name_too_long', message: 'タグ名が長すぎます（60文字まで）' }
    if (/[\u0000-\u001F\u007F]/u.test(name)) return { ...base, status: 'invalid', code: 'invalid_character', message: '使えない文字が入っています' }
    if (EXISTING_TAG_NAMES.has(name)) return { ...base, status: 'skipped', code: 'already_exists', message: '同じ名前のタグがあります' }
    const normalized = name.normalize('NFKC').toLowerCase()
    if (seen.has(normalized)) return { ...base, status: 'skipped', code: 'duplicate_in_file', message: '同じCSVの前の行と重複しています' }
    seen.add(normalized)
    if (folderName && !knownFolders.has(folderName)) {
      return { ...base, status: 'ready', code: 'folder_not_found', message: 'フォルダがありません。未分類として登録します' }
    }
    return { ...base, status: 'ready', message: '登録できます' }
  })
  return {
    summary: {
      total: planned.length,
      ready: planned.filter((row) => row.status === 'ready').length,
      created: 0,
      skipped: planned.filter((row) => row.status === 'skipped').length,
      invalid: planned.filter((row) => row.status === 'invalid').length,
      failed: 0,
    },
    rows: planned,
  }
}

export function tagImportResult(rows = TAG_IMPORT_SAMPLE_ROWS) {
  const preview = tagImportPreview(rows)
  const resultRows = preview.rows.map((row, index) => {
    if (row.status !== 'ready') return row
    if (row.name === '店舗共通ラベル') {
      return { ...row, status: 'failed', code: 'folder_changed', message: '担当しているアカウントの外なので、作れません' }
    }
    if (row.name === '休眠') {
      return { ...row, status: 'failed', code: 'create_failed', message: '保存できませんでした。もう一度お試しください' }
    }
    return { ...row, status: 'created', tagId: `visual-tag-${index + 1}` }
  })
  const summary = {
    total: resultRows.length,
    ready: 0,
    created: resultRows.filter((row) => row.status === 'created').length,
    skipped: resultRows.filter((row) => row.status === 'skipped').length,
    invalid: resultRows.filter((row) => row.status === 'invalid').length,
    failed: resultRows.filter((row) => row.status === 'failed').length,
  }
  const rejected = summary.invalid + summary.failed
  return {
    summary,
    rows: resultRows,
    outcome: summary.created > 0 && rejected > 0 ? 'partial' : rejected > 0 ? 'failed' : 'success',
  }
}

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
  // `tag-0` は編集画面の既存設定に使うため、一覧先頭の行とは分ける。
  id: index === 0 ? 'tag-ec-customer' : `tag-${index}`,
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

/** 設計 `ee0sk` / `VjXGX` の、保存済み「NEN会員（定期）」設定。 */
export const TAG_EDITOR_NEN_SUBSCRIPTION = {
  id: 'tag-0',
  name: 'NEN会員（定期）',
  color: '#8b938d',
  groupId: 'g-purchase',
  friendCount: 128,
  mileageReward: 10,
  referralMileageReward: 5,
  mileageMultiplierBps: 15000,
  mileageMultiplierPriority: 3,
  isStarred: false,
  assignSource: 'manual',
  usedIn: { broadcasts: 4 },
  otherActionCount: 3,
  linkedActions: [
    { id: 'tag-action-message', type: 'メッセージ', label: '「ご登録ありがとうございます。定期便の特典は…」を送信', timing: 'すぐに' },
    { id: 'tag-action-add', type: 'タグ', label: '「定期便・稼働中」を追加', timing: 'すぐに' },
    { id: 'tag-action-scenario', type: 'シナリオ', label: '「定期便オンボーディング」を開始', timing: '24時間後' },
  ],
  createdAt: '2026-01-13T00:00:00.000Z',
}

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
    編集用の `tag-0` は購入フォルダの埋め草1件と差し替える。
    101件・フォルダ件数・先頭6行を変えず、`/tags/edit?id=tag-0` も
    設計どおり保存済みの状態で開ける。
  */
  const editorRow = rows.find((row, index) => index >= DESIGN_ROWS.length && row.groupId === 'g-purchase')
  if (editorRow) Object.assign(editorRow, TAG_EDITOR_NEN_SUBSCRIPTION, { displayOrder: editorRow.displayOrder })
  const vipRow = rows.find((row, index) => index >= DESIGN_ROWS.length && row.groupId === 'g-vip')
  if (vipRow) Object.assign(vipRow, { id: 'tag-vip', name: 'VIP' })
  const purchaseRow = rows.find((row, index) => index >= DESIGN_ROWS.length && row.groupId === 'g-purchase' && row.id !== 'tag-0')
  if (purchaseRow) Object.assign(purchaseRow, { id: 'tag-purchase', name: '購入者' })
  // 機能5の配信対象・送信後アクション。埋め草2件を差し替え、総数とフォルダ件数は保つ。
  const scenarioTargetRow = rows.find((row, index) => index >= DESIGN_ROWS.length && row.groupId === 'g-member' && row.id !== 'tag-vip')
  if (scenarioTargetRow) Object.assign(scenarioTargetRow, { id: 'tag-first-guide', name: '初回案内' })
  const scenarioCompleteRow = rows.find((row, index) => index >= DESIGN_ROWS.length && row.groupId === 'g-member' && row.id !== 'tag-first-guide')
  if (scenarioCompleteRow) Object.assign(scenarioCompleteRow, { id: 'tag-first-guide-complete', name: '初回案内済み' })
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
  marks: { total: 4, inUse: 4, unanswered: 23, inProgress: 19, resolved: 186, changedLast7: 74 },
  searches: { total: 5, limit: 50 },
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
  folderId: [
    'scenario-folder-onboarding',
    'scenario-folder-purchase',
    'scenario-folder-booking',
    'scenario-folder-onboarding',
    'scenario-folder-purchase',
  ][index] ?? null,
  audienceCondition: null,
  onCompleteMode: String(onCompleteMode),
  onCompleteScenarioId: null,
  subscriberCount: Number(subscriberCount),
  completedCount: Number(completedCount),
  stepCount: index === 0 ? 4 : 3,
  createdAt: `${day}T00:00:00.000Z`,
  updatedAt: `${day}T00:00:00.000Z`,
}))

/** シナリオ一覧 `TC1b1` の3分類。中身の件数は FRIEND_SCENARIOS から数える。 */
export const SCENARIO_FOLDERS = [
  ['scenario-folder-onboarding', '初回案内', '#2563EB'],
  ['scenario-folder-purchase', '購入後', '#10B981'],
  ['scenario-folder-booking', '予約フォロー', '#F59E0B'],
].map(([id, name, color], index) => ({
  id: String(id),
  kind: 'scenario',
  name: String(name),
  parentId: null,
  displayOrder: index,
  color: String(color),
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}))

/**
 * 友だち追加時配信の実行結果 `P2J0Te`。4行は直近の例、summary は直近28日。
 * 実在する友だち・秘密値は含めず、設計に置かれた固定名だけを使う。
 */
export const FRIEND_ADD_EVENTS = {
  items: [
    {
      id: 'friend-add-event-1', friendId: 'visual-friend-add-1',
      displayName: 'Kenta Kawano', pictureUrl: null,
      kind: 'first_time', isUnblockedHint: false,
      attributionStatus: 'captured', refCode: 'store-qr',
      entryRouteId: 'entry-route-store', entryRouteName: '店頭QR',
      routingStatus: 'completed', occurredAt: '2026-09-07T01:32:00.000Z',
      processedAt: '2026-09-07T01:32:01.000Z',
    },
    {
      id: 'friend-add-event-2', friendId: 'visual-friend-add-2',
      displayName: 'Masato S.', pictureUrl: null,
      kind: 'returning', isUnblockedHint: true,
      attributionStatus: 'unavailable', refCode: null,
      entryRouteId: null, entryRouteName: null,
      routingStatus: 'completed', occurredAt: '2026-09-07T01:28:00.000Z',
      processedAt: '2026-09-07T01:28:01.000Z',
    },
    {
      id: 'friend-add-event-3', friendId: 'visual-friend-add-3',
      displayName: '菅野 亮', pictureUrl: null,
      kind: 'first_time', isUnblockedHint: false,
      attributionStatus: 'captured', refCode: 'referral-campaign',
      entryRouteId: 'entry-route-referral', entryRouteName: '紹介キャンペーン',
      routingStatus: 'pending', occurredAt: '2026-09-07T01:21:00.000Z',
      processedAt: null,
    },
    {
      id: 'friend-add-event-4', friendId: 'visual-friend-add-4',
      displayName: '山田 太郎', pictureUrl: null,
      kind: 'first_time', isUnblockedHint: null,
      attributionStatus: 'unavailable', refCode: null,
      entryRouteId: null, entryRouteName: null,
      routingStatus: 'failed', occurredAt: '2026-09-07T01:14:00.000Z',
      processedAt: '2026-09-07T01:14:02.000Z',
    },
  ],
  summary: {
    total: 214,
    firstTime: 176,
    returning: 38,
    captured: 198,
    unavailable: 16,
    pending: 8,
    failed: 3,
  },
  nextCursor: null,
}

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

/**
 * 機能21 NEN配信。★V6 `VLMGH` / `DEX0k` / `q4lajm` / `WeXbL` の通常データ。
 * 一覧の件数・状態を画面コードへ埋め込まず、この固定結果だけで再現する。
 */
const nenCampaignSetting = (campaignKey, label, category, triggerEvent, delayDays, deliveryTime, isEnabled, title, bodyText, buttonLabel = null) => ({
  campaignKey,
  label,
  category,
  triggerEvent,
  delayDays,
  deliveryTime,
  isEnabled,
  title,
  bodyText,
  buttonLabel,
  buttonUrl: buttonLabel ? 'https://example.com/nen' : null,
  imageUrl: null,
  updatedAt: '2026-08-25T10:00:00+09:00',
})

export const NEN_CAMPAIGN_SETTINGS = [
  nenCampaignSetting('order_thanks', '注文ありがとうございます', 'transactional', 'ec.order.confirmed', 0, '09:00', true, 'ご注文ありがとうございます', 'ご注文の内容を確認しました。'),
  nenCampaignSetting('shipping_notice', 'お荷物を送りました', 'transactional', 'ec.shipping.shipped', 0, '09:00', true, 'お荷物を発送しました', '追跡番号から配送状況をご確認いただけます。', '配送状況を見る'),
  nenCampaignSetting('arrival_check', '使い方のご案内', 'follow_up', 'ec.order.arrived', 1, '10:00', true, '商品は無事に届きましたか？', '使い方のポイントを3つにまとめました。', '使い方を見る'),
  nenCampaignSetting('care_check', '困っていませんか', 'follow_up', 'ec.order.arrived', 3, '19:00', true, 'お困りのことはありませんか？', '気になることを、2つの選択肢から教えてください。', '回答する'),
  nenCampaignSetting('review_request', '口コミのお願い', 'follow_up', 'ec.order.arrived', 7, '20:00', true, '使ってみた感想を教えてください', 'いただいた声を、これからの商品づくりに役立てます。', '口コミを書く'),
  nenCampaignSetting('cross_sell', 'そろそろ無くなるころ', 'follow_up', 'ec.order.arrived', 30, '10:00', false, 'そろそろ無くなるころです', '次回のお買い物に使えるご案内をお送りします。', '商品を見る'),
  nenCampaignSetting('birthday_coupon', 'お誕生日クーポン', 'birthday', 'pet.birthday', 0, '10:00', true, '{{pet_name}}、お誕生日おめでとうございます', '{{coupon_code}} を {{coupon_expiry}} までお使いいただけます。', 'クーポンを受け取る'),
  nenCampaignSetting('column', 'NENコラム', 'column', 'column.scheduled', 0, '10:00', false, '今週のNENコラム', '愛犬・愛猫との暮らしに役立つ読みものをお届けします。', 'コラムを読む'),
]

const nenColumn = (id, title, category, excerpt, deliveryStatus, publishedAt, deliveryAt = null) => ({
  id,
  externalId: `external-${id}`,
  slug: id,
  title,
  category,
  excerpt,
  introText: `${title}をご紹介します。`,
  articleUrl: `https://example.com/columns/${id}`,
  imageUrl: null,
  publishedAt,
  deliveryStatus,
  deliveryAt,
  lineAccountId: 'visual-qa-account',
  updatedAt: '2026-08-25T10:00:00+09:00',
})

const NEN_COLUMN_DESIGN_ROWS = [
  nenColumn('nen-column-tooth', '歯みがきのコツ、3つだけ', '口の中のケア', '写真2枚・1,200字', 'sent', '2026-07-14T10:00:00+09:00'),
  nenColumn('nen-column-water', '夏の水分補給、どれくらい？', '季節のこと', '写真1枚・900字', 'scheduled', null, '2026-08-28T10:00:00+09:00'),
  nenColumn('nen-column-food', 'フードの切り替えかた', '食べもの', '写真3枚・1,600字', 'sent', '2026-06-30T10:00:00+09:00'),
  nenColumn('nen-column-nail', '爪切りが苦手な子へ', 'お手入れ', '動画1本・700字', 'sent', '2026-06-16T10:00:00+09:00'),
  nenColumn('nen-column-toilet', 'トイレの回数、気にしていますか', 'からだのこと', '写真1枚・1,100字', 'sent', '2026-06-02T10:00:00+09:00'),
  nenColumn('nen-column-rain', '雨の日の遊びかた', '季節のこと', '写真2枚・800字', 'draft', null),
]

export const NEN_COLUMNS = [
  ...NEN_COLUMN_DESIGN_ROWS,
  ...Array.from({ length: 14 }, (_, index) => nenColumn(
    `nen-column-sent-${index + 1}`,
    `暮らしのコラム ${index + 1}`,
    '暮らし',
    '写真1枚・800字',
    'sent',
    `2026-${String(5 - Math.floor(index / 9)).padStart(2, '0')}-${String(28 - (index % 9)).padStart(2, '0')}T10:00:00+09:00`,
  )),
  ...Array.from({ length: 4 }, (_, index) => nenColumn(
    `nen-column-draft-${index + 1}`,
    `下書きのコラム ${index + 1}`,
    '下書き',
    '公開前の下書きです',
    'draft',
    null,
  )),
]

export const NEN_PETS = [
  { id: 'nen-pet-momo', friendId: 'friend-1', customerId: 'customer-1', name: 'ももちゃん', animalType: 'dog', gender: 'female', birthday: '2022-09-02', ownerName: '高橋 直人', lineUserId: 'Uvisualfriend000001' },
  { id: 'nen-pet-sora', friendId: 'friend-2', customerId: 'customer-2', name: 'そらくん', animalType: 'cat', gender: 'male', birthday: '2024-08-28', ownerName: '前田 さくら', lineUserId: 'Uvisualfriend000002' },
  { id: 'nen-pet-komugi', friendId: 'friend-3', customerId: 'customer-3', name: 'こむぎちゃん', animalType: 'dog', gender: 'female', birthday: '2018-11-14', ownerName: '木村 亮', lineUserId: 'Uvisualfriend000003' },
  { id: 'nen-pet-leo', friendId: 'friend-4', customerId: 'customer-4', name: 'レオくん', animalType: 'dog', gender: 'male', birthday: null, ownerName: '大西 健一', lineUserId: 'Uvisualfriend000004' },
  { id: 'nen-pet-purin', friendId: 'friend-5', customerId: 'customer-5', name: 'ぷりんちゃん', animalType: 'other', gender: 'female', birthday: '2022-10-05', ownerName: '中村 彩', lineUserId: 'Uvisualfriend000005' },
]

const nenJob = (id, campaignKey, label, friendName, scheduledAt, status, attempts, sentAt, triggerLabel, reactionLabel, lineAccountName = 'LINE 本店') => ({
  id,
  campaignKey,
  label,
  friendName,
  scheduledAt,
  status,
  attempts,
  lastError: status === 'failed' ? 'LINEへの送信が拒否されました' : null,
  sentAt,
  triggerLabel,
  reactionLabel,
  lineAccountName,
})

export const NEN_JOBS = [
  nenJob('nen-job-1', 'care_check', '困っていませんか', '前田 さくら', '2026-08-25T19:00:00+09:00', 'pending', 0, null, '8/22 の注文が到着', '—'),
  nenJob('nen-job-2', 'birthday_coupon', 'ももちゃんのお誕生日', '高橋 直人', '2026-08-25T10:00:00+09:00', 'sent', 1, '2026-08-25T10:00:02+09:00', 'ペットの誕生日 9/02', '開きました'),
  nenJob('nen-job-3', 'order_thanks', '注文ありがとうございます', '石田 未来', '2026-08-25T09:12:00+09:00', 'sent', 1, '2026-08-25T09:12:03+09:00', '注文が確定', '開きました', 'LINE 二号店'),
  nenJob('nen-job-4', 'shipping_notice', 'お荷物を送りました', '木村 亮', '2026-08-24T18:00:00+09:00', 'sent', 1, '2026-08-24T18:00:03+09:00', '発送を登録', '押しました', 'LINE 二号店'),
  nenJob('nen-job-5', 'arrival_check', '使い方のご案内', '林 里佳', '2026-08-24T10:00:00+09:00', 'failed', 3, null, '8/22 の注文が到着', '—'),
  nenJob('nen-job-6', 'review_request', '口コミのお願い', '大西 健一', '2026-08-23T20:00:00+09:00', 'sent', 1, '2026-08-23T20:00:04+09:00', '8/16 の注文が到着', '開きました'),
  nenJob('nen-job-7', 'column', '夏の水分補給、どれくらい？', '中村 彩', '2026-08-23T10:00:00+09:00', 'sent', 1, '2026-08-23T10:00:01+09:00', '毎週 月曜の予約', '開きました'),
]

export const NEN_BIRTHDAY_COUPON = {
  isEnabled: true,
  codePrefix: 'NENBDAY',
  benefitLabel: 'お誕生日月限定クーポン',
  discountAmount: 500,
  validityDays: 31,
  updatedAt: '2026-08-25T10:00:00+09:00',
}
/** 機能14 共通情報。設計の3フォルダと先頭6件を固定する。 */
export const COMMON_VAR_FOLDERS = [
  { id: 'cvf-store', kind: 'common_var', name: '01_お店の情報', parentId: null, displayOrder: 0, color: '#2563EB', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
  { id: 'cvf-guides', kind: 'common_var', name: '02_案内文の型', parentId: null, displayOrder: 1, color: '#10B981', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
  { id: 'cvf-campaign', kind: 'common_var', name: '03_キャンペーン', parentId: null, displayOrder: 2, color: '#F59E0B', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
]

export const COMMON_VARS = [
  {
    id: 'common-var-delete-target', lineAccountId: 'visual-qa-account', folderId: 'cvf-store',
    name: '会社名', varKey: 'company_name', type: 'text', value: '株式会社NEN',
    createdAt: '2025-11-20T16:40:00.000+09:00', updatedAt: '2026-08-01T10:12:00.000+09:00',
    nextSchedule: null, pendingScheduleCount: 0, usageCount: 15,
  },
  {
    id: 'common-var-hours', lineAccountId: 'visual-qa-account', folderId: 'cvf-store',
    name: '営業時間', varKey: 'shop_hours', type: 'text', value: '平日 10:00〜19:00／土日祝 休み',
    createdAt: '2026-07-01T10:00:00.000+09:00', updatedAt: '2026-08-12T10:00:00.000+09:00',
    nextSchedule: null, pendingScheduleCount: 0, usageCount: 8,
  },
  {
    id: 'common-var-phone', lineAccountId: 'visual-qa-account', folderId: 'cvf-store',
    name: '電話番号', varKey: 'phone_number', type: 'text', value: '03-1234-5678',
    createdAt: '2026-06-01T10:00:00.000+09:00', updatedAt: '2026-07-20T10:00:00.000+09:00',
    nextSchedule: null, pendingScheduleCount: 0, usageCount: 7,
  },
  {
    id: 'common-var-campaign', lineAccountId: 'visual-qa-account', folderId: 'cvf-campaign',
    name: '今月のキャンペーン', varKey: 'monthly_campaign', type: 'text', value: '夏の20%オフ（8/25〜9/30）',
    createdAt: '2026-08-01T10:00:00.000+09:00', updatedAt: '2026-08-22T10:00:00.000+09:00',
    nextSchedule: { effectiveFrom: '2026-09-30T15:00:00.000+09:00', value: '' }, pendingScheduleCount: 1, usageCount: 7,
  },
  {
    id: 'common-var-address', lineAccountId: 'visual-qa-account', folderId: 'cvf-store',
    name: '住所', varKey: 'address', type: 'text', value: '東京都渋谷区〇〇 1-2-3',
    createdAt: '2026-06-01T10:00:00.000+09:00', updatedAt: '2026-07-20T10:00:00.000+09:00',
    nextSchedule: null, pendingScheduleCount: 0, usageCount: 4,
  },
  {
    id: 'common-var-contact', lineAccountId: 'visual-qa-account', folderId: 'cvf-guides',
    name: '問い合わせ窓口', varKey: 'contact', type: 'text', value: '',
    createdAt: '2026-06-10T10:00:00.000+09:00', updatedAt: '2026-06-10T10:00:00.000+09:00',
    nextSchedule: null, pendingScheduleCount: 0, usageCount: 2,
  },
]

export const COMMON_VAR_DELETE_IMPACT = {
  variable: { id: 'common-var-delete-target', name: '会社名', varKey: 'company_name' },
  total: 15,
  blockingTotal: 15,
  historicalTotal: 0,
  unscopedFormTotal: 0,
  canDelete: false,
  byKind: { template: 12, broadcast: 0, scenario: 0, reminder: 0, auto_reply: 0, form: 3, automation: 0, friend_add: 0, common_action: 0 },
  items: [
    {
      kind: 'template', kindLabel: 'テンプレート', name: '定期便 初回のご案内',
      status: '予約中 8/26 10:00', href: '/templates/edit?id=template-first-delivery',
      blocksDeletion: true, currentPreview: 'ご不明な点は 株式会社NEN までお気軽にどうぞ。',
    },
    {
      kind: 'template', kindLabel: 'テンプレート', name: '夏の定番5点（パネル2）',
      status: '予約中 8/27 12:00', href: '/templates/edit?id=template-summer-panel',
      blocksDeletion: true, currentPreview: '株式会社NEN からのおすすめです。8月末まで送料無料。',
    },
    {
      kind: 'form', kindLabel: '回答フォーム', name: '来店アンケート',
      status: '公開中', href: '/forms/edit?id=form-store-survey',
      blocksDeletion: true, currentPreview: 'このフォームは 株式会社NEN が作成しています',
    },
    {
      kind: 'template', kindLabel: 'テンプレート', name: '商品到着のお知らせ',
      status: '下書き', href: '/templates/edit?id=template-delivered',
      blocksDeletion: true, currentPreview: '株式会社NEN です。お届けが完了しました。',
    },
    {
      kind: 'form', kindLabel: '回答フォーム', name: '資料請求',
      status: '公開中', href: '/forms/edit?id=form-document-request',
      blocksDeletion: true, currentPreview: '株式会社NEN の資料をお送りします',
    },
    {
      kind: 'template', kindLabel: 'テンプレート', name: '再開のごあいさつ',
      status: '下書き', href: '/templates/edit?id=template-restart',
      blocksDeletion: true, currentPreview: '株式会社NEN より、ひさしぶりのご案内です。',
    },
  ],
  unavailableReferences: [],
  checkedAt: '2026-09-07T10:00:00.000+09:00',
  recommendedAction: 'review_references',
}

export const COMMON_VAR_DELETE_IMPACT_EMPTY = {
  variable: { id: 'common-var-delete-safe', name: '臨時のお知らせ', varKey: 'temporary_notice' },
  total: 0,
  blockingTotal: 0,
  historicalTotal: 0,
  unscopedFormTotal: 0,
  canDelete: true,
  byKind: { template: 0, broadcast: 0, scenario: 0, reminder: 0, auto_reply: 0, form: 0, automation: 0, friend_add: 0, common_action: 0 },
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
export const MEDIA_FOLDERS = [
  { id: 'media-product', name: '01_商品写真', kind: 'media', sortOrder: 0, color: '#2563EB', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
  { id: 'media-banner', name: '02_バナー', kind: 'media', sortOrder: 1, color: '#F3C66B', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
  { id: 'media-video', name: '03_動画', kind: 'media', sortOrder: 2, color: '#7C6BC4', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
]

const mediaPreview = (color) => `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="678"><rect width="1040" height="678" fill="${color.replace('#', '%23')}"/></svg>`

export const MEDIA_ITEMS = [
  {
    id: 'media-delete-target', lineAccountId: 'visual-qa-account', folderId: 'media-product',
    kind: 'image', filename: '夏の定番セット.jpg', mimeType: 'image/jpeg',
    sizeBytes: 348160, width: 1024, height: 678, durationMs: null,
    url: mediaPreview('#e7f7ef'), uploadedBy: '川野 健太', createdAt: '2026-08-18T09:00:00.000Z', usageCount: 3,
  },
  {
    id: 'media-banner', lineAccountId: 'visual-qa-account', folderId: 'media-banner',
    kind: 'image', filename: '会員証バナー.png', mimeType: 'image/png',
    sizeBytes: 839680, width: 2500, height: 1686, durationMs: null,
    url: mediaPreview('#d9efe3'), uploadedBy: '川野 健太', createdAt: '2026-08-17T09:00:00.000Z', usageCount: 2,
  },
  {
    id: 'media-store-video', lineAccountId: 'visual-qa-account', folderId: 'media-video',
    kind: 'video', filename: '店内のようす.mp4', mimeType: 'video/mp4',
    sizeBytes: 88080384, width: null, height: null, durationMs: 164000,
    url: mediaPreview('#eef0f2'), uploadedBy: '佐々木', createdAt: '2026-08-16T09:00:00.000Z', usageCount: 1,
  },
  {
    id: 'media-coupon', lineAccountId: 'visual-qa-account', folderId: 'media-banner',
    kind: 'image', filename: '誕生月クーポン.png', mimeType: 'image/png',
    sizeBytes: 215040, width: 1029, height: 1029, durationMs: null,
    url: mediaPreview('#f3ece1'), uploadedBy: '田中', createdAt: '2026-08-15T09:00:00.000Z', usageCount: 1,
  },
  {
    id: 'media-delete-safe', lineAccountId: 'visual-qa-account', folderId: null,
    kind: 'file', filename: 'メニュー表.pdf', mimeType: 'application/pdf',
    sizeBytes: 1258291, width: null, height: null, durationMs: null,
    url: 'data:application/pdf;base64,JVBERi0xLjQ=', uploadedBy: '田中', createdAt: '2026-08-14T09:00:00.000Z', usageCount: 0,
  },
  {
    id: 'media-pamphlet', lineAccountId: 'visual-qa-account', folderId: 'media-product',
    kind: 'image', filename: '定期便パンフ.jpg', mimeType: 'image/jpeg',
    sizeBytes: 491520, width: 1024, height: 678, durationMs: null,
    url: mediaPreview('#e4eee8'), uploadedBy: '佐々木', createdAt: '2026-08-13T09:00:00.000Z', usageCount: 5,
  },
  {
    id: 'media-staff', lineAccountId: 'visual-qa-account', folderId: 'media-product',
    kind: 'image', filename: 'スタッフ紹介.jpg', mimeType: 'image/jpeg',
    sizeBytes: 399360, width: 1024, height: 678, durationMs: null,
    url: mediaPreview('#efe5dc'), uploadedBy: '佐々木', createdAt: '2026-08-12T09:00:00.000Z', usageCount: 0,
  },
  {
    id: 'media-guide-video', lineAccountId: 'visual-qa-account', folderId: 'media-video',
    kind: 'video', filename: '使い方ガイド.mp4', mimeType: 'video/mp4',
    sizeBytes: 20761804, width: null, height: null, durationMs: 215000,
    url: mediaPreview('#e8ebef'), uploadedBy: '川野 健太', createdAt: '2026-08-11T09:00:00.000Z', usageCount: 2,
  },
  {
    id: 'media-replacement', lineAccountId: 'visual-qa-account', folderId: 'media-banner',
    kind: 'image', filename: '休業のお知らせ.png', mimeType: 'image/png',
    sizeBytes: 122880, width: 1024, height: 678, durationMs: null,
    url: mediaPreview('#f1e8e8'), uploadedBy: '田中', createdAt: '2026-08-10T09:00:00.000Z', usageCount: 0,
  },
  {
    id: 'media-price-list', lineAccountId: 'visual-qa-account', folderId: null,
    kind: 'file', filename: '価格表_2026.pdf', mimeType: 'application/pdf',
    sizeBytes: 655360, width: null, height: null, durationMs: null,
    url: 'data:application/pdf;base64,JVBERi0xLjQ=', uploadedBy: '川野 健太', createdAt: '2026-08-09T09:00:00.000Z', usageCount: 1,
  },
]

export const MEDIA_DELETE_IMPACT = {
  media: { id: 'media-delete-target', filename: '夏の定番セット.jpg', kind: 'image' },
  usageCount: 3,
  references: [
    {
      kind: 'template', name: '夏の定番5点',
      href: '/templates', state: 'available',
      scannedAt: '2026-08-31T10:00:00.000Z',
    },
    {
      kind: 'broadcast', name: '夏のご案内',
      href: '/broadcasts/detail?id=broadcast-visual', state: 'available',
      scannedAt: '2026-08-31T10:00:00.000Z',
    },
    {
      kind: 'rich_menu', name: '夏キャンペーン',
      href: '/rich-menus', state: 'available',
      scannedAt: '2026-08-31T10:00:00.000Z',
    },
  ],
  checkedAt: '2026-08-31T10:00:00.000Z',
  lastScannedAt: '2026-08-31T10:00:00.000Z',
  canDelete: false,
  recommendedAction: 'review_references',
}

export const MEDIA_DELETE_IMPACT_EMPTY = {
  media: { id: 'media-delete-safe', filename: 'メニュー表.pdf', kind: 'file' },
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
  source: { id: 'media-delete-target', filename: '夏の定番セット.jpg', kind: 'image' },
  replacement: { id: 'media-replacement', filename: '休業のお知らせ.png', kind: 'image' },
  usageCount: 3,
  replaceableCount: 3,
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
  source: { id: 'media-delete-safe', filename: 'メニュー表.pdf', kind: 'file' },
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
 * 機能12の5画面を実APIと同じ器で確認する固定データ。
 *
 * `rmg-1` は3枚を行き来できるが、「予約する」だけ入口へ戻れない。
 * `rmg-2` は切替ボタンを持たない。設計 `DIUbO` / `NXdDk` の通常状態を
 * 同じ取得口で描き分けられるようにしている。
 */
const richMenuArea = (id, label, targetPageId, boundsX) => ({
  id,
  boundsX,
  boundsY: 0,
  boundsWidth: 833,
  boundsHeight: 260,
  actionType: 'richmenuswitch',
  actionData: { targetPageId },
  intent: 'switch',
  label,
  tagIds: [],
  scoreChange: null,
  templateId: null,
  formId: null,
  trackedLinkId: null,
})

const richMenuPage = (id, orderIndex, name, areas = []) => ({
  id,
  orderIndex,
  name,
  aliasId: `visual-${id}`,
  lineRichmenuId: `line-${id}`,
  imageR2Key: null,
  imageContentType: null,
  areas,
})

const RICH_MENU_BASE = {
  accountId: 'visual-qa-account',
  chatBarText: 'メニューを開く',
  size: 'large',
  isDefaultForAll: false,
  status: 'published',
  publishingAt: null,
  targetingPriority: 1,
  targetingEnabled: true,
  folderId: 'rich-menu-folder-members',
  displayOrder: 1,
  thumbnailR2Key: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
}

export const RICH_MENU_GROUPS = [
  {
    ...RICH_MENU_BASE,
    id: 'rich-menu-target',
    name: '通常メニュー（会員向け）',
    isDefaultForAll: true,
    targetingPriority: 0,
    targetingEnabled: false,
    targetingCondition: null,
    displayOrder: 0,
  },
  {
    ...RICH_MENU_BASE,
    id: 'rmg-1',
    name: '会員ランク上位',
    targetingCondition: JSON.stringify({
      operator: 'AND',
      rules: [{ type: 'tag_exists', value: 'tag-0' }],
    }),
  },
  {
    ...RICH_MENU_BASE,
    id: 'rmg-2',
    name: '初回来店ガイド',
    status: 'draft',
    targetingPriority: 3,
    targetingEnabled: false,
    targetingCondition: null,
    folderId: 'rich-menu-folder-store',
    displayOrder: 3,
  },
  {
    ...RICH_MENU_BASE,
    id: 'rich-menu-safe',
    name: '未使用の下書き',
    status: 'draft',
    targetingPriority: 4,
    targetingEnabled: false,
    targetingCondition: null,
    folderId: null,
    displayOrder: 4,
  },
]

export const RICH_MENU_GROUP_DETAILS = {
  'rmg-1': {
    ...RICH_MENU_GROUPS.find((group) => group.id === 'rmg-1'),
    defaultPageId: 'rmg-1-top',
    pages: [
      richMenuPage('rmg-1-top', 0, 'トップ', [
        richMenuArea('rmg-1-top-product', '商品を見る', 'rmg-1-product', 0),
        richMenuArea('rmg-1-top-booking', '予約する', 'rmg-1-booking', 833),
      ]),
      richMenuPage('rmg-1-product', 1, '商品を見る', [
        richMenuArea('rmg-1-product-top', 'トップ', 'rmg-1-top', 0),
        richMenuArea('rmg-1-product-booking', '予約する', 'rmg-1-booking', 1666),
      ]),
      richMenuPage('rmg-1-booking', 2, '予約する', [
        richMenuArea('rmg-1-booking-product', '商品を見る', 'rmg-1-product', 833),
      ]),
    ],
  },
  'rmg-2': {
    ...RICH_MENU_GROUPS.find((group) => group.id === 'rmg-2'),
    defaultPageId: 'rmg-2-top',
    pages: [richMenuPage('rmg-2-top', 0, 'トップ')],
  },
}

export const RICH_MENU_EXTERNAL = {
  currentDefault: 'line-rich-menu-external',
  lineMenus: [
    {
      richMenuId: 'line-rich-menu-external',
      name: 'LINE公式マネージャーで作成',
      chatBarText: 'メニュー',
      size: { width: 2500, height: 1686 },
      areasCount: 6,
      isCurrentDefault: true,
      adminManaged: false,
      adminInfo: null,
    },
  ],
}

export const RICH_MENU_TAP_STATS = {
  from: '2026-08-01',
  to: '2026-08-31',
  byArea: [],
  byGroup: [
    { groupId: 'rich-menu-target', taps: 12480 },
    { groupId: 'rmg-1', taps: 3210 },
    { groupId: 'rmg-2', taps: 0 },
  ],
  total: 15690,
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
  // 設計 `W7LBc` の送信数。先頭6件は一覧に描かれた値をそのまま使う。
  // 残りも 0 や未取得にせず、並び替えと表示を確かめられる固定値にする。
  const sendCounts = [
    [1240, 18300], [1860, 31400], [480, 9720], [210, 3040], [640, 5880],
    [320, 7600], [980, 14200], [160, 2280], [740, 11900], [90, 1640],
    [560, 8210], [430, 6940], [120, 2130], [350, 5360], [270, 4280],
    [80, 980], [190, 2760], [150, 2410], [60, 720], [40, 510],
  ]
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
        name: n === 0 ? '7日間フォロー完了のお知らせ' : `${label}のひな形 ${i + 1}`,
        category: 'text',
        messageType: 'text',
        messageContent: n === 0
          ? '7日間のご案内は以上です。ご不明な点はいつでもご返信ください。'
          : `${label}のご連絡です。内容をご確認ください。`,
        folderId,
        monthlySendCount: sendCounts[n][0],
        totalSendCount: sendCounts[n][1],
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
  ['未対応・期限超過', true, { statuses: ['unread'], sort: 'waiting_desc' }, 1],
  ['Kenta 担当の未対応', true, { statuses: ['unread'], assignees: ['operator-kenta'] }, 3],
  ['LINEからの新着', false, null, 5],
].map(([name, isShared, patch, matchCount], index) => ({
  id: `inbox-view-${index}`,
  name: String(name),
  scope: 'chats',
  conditions: patch ? { ...INBOX_VIEW_CONDITIONS, ...patch } : LEGACY_VIEW_CONDITIONS,
  createdBy: 'Kenta',
  lineAccountId: 'visual-qa-account',
  isShared: Boolean(isShared),
  matchCount: Number(matchCount),
  displayOrder: index,
  createdAt: '2026-08-17T03:00:00.000Z',
}))

/**
 * 機能4「保存した検索」。設計 `QKx8Q` の先頭5行と、編集画面 `XBkiQ` の
 * `ss-1` を同じデータで開く。使用先と該当人数を省かず、0件と未取得を混ぜない。
 */
export const FRIEND_ATTRIBUTE_SAVED_SEARCHES = [
  {
    id: 'ss-1', name: 'VIPかつ未契約', scope: 'friends',
    conditions: {
      all: [
        { kind: 'tag', op: 'includes', value: 'tag-vip' },
        { kind: 'tag', op: 'includes', value: 'tag-4' },
      ],
      any: [], visibility: 'visible_only',
      description: 'VIPだが契約していない人への案内用',
      list: { columns: ['名前', 'タグ', '担当者'], sort: 'recent', limit: 20 },
    },
    createdBy: 'Kenta', lineAccountId: 'visual-qa-account', isShared: true,
    displayOrder: 0, createdAt: '2026-08-20T19:20:00+09:00', matchCount: 18,
    usedIn: [
      { kind: 'broadcast', id: 'broadcast-vip', name: 'VIP未契約案内', mode: 'live', lastUsedAt: '2026-08-20T19:20:00+09:00' },
      { kind: 'automation', id: 'automation-follow', name: '3日後フォロー', mode: 'live', lastUsedAt: '2026-08-20T19:20:00+09:00' },
    ],
    canDelete: false, callCountThisMonth: 31,
  },
  {
    id: 'ss-2', name: '誕生日30日前', scope: 'friends',
    conditions: { all: [{ kind: 'field', key: 'birthday', op: 'eq', value: '今日から30日以内' }], any: [], visibility: 'visible_only' },
    createdBy: 'Kenta', lineAccountId: 'visual-qa-account', isShared: false,
    displayOrder: 1, createdAt: '2026-08-20T18:10:00+09:00', matchCount: 12,
    usedIn: [{ kind: 'other', id: 'reminder-birthday', name: '誕生日のお知らせ', mode: 'live', lastUsedAt: '2026-08-20T18:10:00+09:00' }],
    canDelete: false, callCountThisMonth: 18,
  },
  {
    id: 'ss-3', name: '未対応・担当なし', scope: 'friends',
    conditions: { all: [{ kind: 'mark', op: 'eq', value: 'mark-default' }], any: [], visibility: 'visible_only' },
    createdBy: 'Kenta', lineAccountId: 'visual-qa-account', isShared: true,
    displayOrder: 2, createdAt: '2026-08-19T20:05:00+09:00', matchCount: 11,
    usedIn: [{ kind: 'other', id: 'inbox-unassigned', name: '受信箱', mode: 'live', lastUsedAt: '2026-08-19T20:05:00+09:00' }],
    canDelete: false, callCountThisMonth: 14,
  },
  {
    id: 'ss-4', name: '購入者または予約者', scope: 'friends',
    conditions: { all: [], any: [{ kind: 'tag', op: 'includes', value: 'tag-purchase' }], visibility: 'visible_only' },
    createdBy: 'Masato', lineAccountId: 'visual-qa-account', isShared: true,
    displayOrder: 3, createdAt: '2026-08-18T14:30:00+09:00', matchCount: 42,
    usedIn: [
      { kind: 'broadcast', id: 'broadcast-purchase-1', name: '購入者へのご案内', mode: 'fixed', lastUsedAt: '2026-08-18T14:30:00+09:00' },
      { kind: 'broadcast', id: 'broadcast-purchase-2', name: '予約者へのご案内', mode: 'fixed', lastUsedAt: '2026-08-18T14:30:00+09:00' },
      { kind: 'broadcast', id: 'broadcast-purchase-3', name: '来店前のお知らせ', mode: 'fixed', lastUsedAt: '2026-08-18T14:30:00+09:00' },
    ],
    canDelete: false, callCountThisMonth: 12,
  },
  {
    id: 'ss-5', name: '離脱注意', scope: 'friends',
    conditions: {
      all: [
        { kind: 'created_at', op: 'between', value: { to: '2026-06-18' } },
        { kind: 'following', op: 'eq', value: true },
      ],
      any: [], visibility: 'visible_only',
    },
    createdBy: 'Kenta', lineAccountId: 'visual-qa-account', isShared: false,
    displayOrder: 4, createdAt: '2026-08-17T11:22:00+09:00', matchCount: 0,
    usedIn: [], canDelete: true, callCountThisMonth: 9,
  },
]

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
    isInherited: false, friendCount: 23, automaticChangeLabel: '受信時・期限超過',
    usedIn: { broadcasts: 1, scenarios: 0, autoReplies: 1, savedSearches: 1, automations: 1 },
  },
  {
    id: 'mark-in-progress', name: '対応中', color: '#3B82F6', isDefault: false,
    autoOnInbound: false, displayOrder: 1, createdAt: '2026-01-02T00:00:00.000Z',
    isInherited: false, friendCount: 19, automaticChangeLabel: '担当者割当時',
    usedIn: { broadcasts: 0, scenarios: 0, autoReplies: 0, savedSearches: 0, automations: 1 },
  },
  {
    id: 'mark-resolved', name: '対応済み', color: '#10B981', isDefault: false,
    autoOnInbound: false, displayOrder: 2, createdAt: '2026-01-03T00:00:00.000Z',
    isInherited: false, friendCount: 186, automaticChangeLabel: '手動・返信完了時',
    usedIn: { broadcasts: 1, scenarios: 0, autoReplies: 0, savedSearches: 0, automations: 0 },
  },
  {
    id: 'mark-hold', name: '保留', color: '#94A3B8', isDefault: false,
    autoOnInbound: false, displayOrder: 3, createdAt: '2026-01-04T00:00:00.000Z',
    isInherited: false, friendCount: 3, automaticChangeLabel: '条件一致時',
    usedIn: { broadcasts: 0, scenarios: 0, autoReplies: 0, savedSearches: 0, automations: 0 },
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
 * シナリオの通。設計 `bV5Vs`（5-1-C シナリオ編集）の4通。
 *
 * **`steps` を配列で返さないと画面ごと落ちる**（`scenario.steps` を回す）。
 * 空の一覧の形で返していたあいだ、シナリオを開くたびに「もう一度試す」
 * だけの画面になっていた。
 */
export const SCENARIO_STEPS = [
  {
    id: 'step-0', scenarioId: 'scenario-0', stepOrder: 1, delayMinutes: 0,
    offsetDays: 0, offsetMinutes: null, deliveryTime: '10:00', templateId: null,
    onReachTagId: null, afterSend: 'continue', messageType: 'text',
    messageContent: 'ご登録ありがとうございます。7日間で使い方をご案内します。',
    targetCondition: null, question: null, isDraft: false,
    createdAt: '2026-08-16T00:00:00.000Z',
  },
  {
    id: 'step-1', scenarioId: 'scenario-0', stepOrder: 2, delayMinutes: 1440,
    offsetDays: 1, offsetMinutes: null, deliveryTime: '20:00', templateId: null,
    onReachTagId: null, afterSend: 'continue', messageType: 'image',
    messageContent: '最初に確認してほしい3つのポイント',
    targetCondition: {
      operator: 'AND',
      rules: [{ type: 'tag_exists', value: 'tag-first-guide' }],
      groups: [],
    },
    question: null, isDraft: false,
    createdAt: '2026-08-16T00:00:00.000Z',
  },
  {
    id: 'step-2', scenarioId: 'scenario-0', stepOrder: 3, delayMinutes: 4320,
    offsetDays: 3, offsetMinutes: null, deliveryTime: '20:00', templateId: null,
    onReachTagId: null, afterSend: 'pause', messageType: 'text',
    messageContent: '使い方で迷っていることはありますか？',
    targetCondition: {
      operator: 'AND',
      rules: [
        { type: 'tag_exists', value: 'tag-first-guide' },
        { type: 'registered_at', value: { from: '2026-08-01', to: '' } },
      ],
      groups: [],
    },
    question: {
      text: '使い方で迷っていることはありますか？',
      tapMode: 'single',
      choices: [
        { label: 'はい', behavior: 'none' },
        { label: 'いいえ', behavior: 'none' },
      ],
    },
    isDraft: false, createdAt: '2026-08-16T00:00:00.000Z',
  },
  {
    id: 'step-3', scenarioId: 'scenario-0', stepOrder: 4, delayMinutes: 10080,
    offsetDays: 7, offsetMinutes: null, deliveryTime: '20:00', templateId: 'template-0',
    onReachTagId: null, afterSend: 'pause', messageType: 'text',
    messageContent: '7日間フォロー完了のお知らせ',
    targetCondition: null, question: null, isDraft: false,
    createdAt: '2026-08-16T00:00:00.000Z',
  },
]

/** `hz9ti` の設定済み3動作。現行 ScenarioAction の5種だけで完全な値を返す。 */
export const SCENARIO_ACTIONS = [
  {
    id: 'scenario-action-1', scenarioId: 'scenario-0', hook: 'step_sent',
    stepId: 'step-0', choiceIndex: null, sortOrder: 0, actionType: 'tag',
    config: { op: 'add', tagIds: ['tag-first-guide-complete'] },
    condition: null, repeatOnRefire: true, complete: true,
  },
  {
    id: 'scenario-action-2', scenarioId: 'scenario-0', hook: 'step_sent',
    stepId: 'step-0', choiceIndex: null, sortOrder: 1, actionType: 'support_mark',
    config: { markId: 'mark-in-progress' },
    condition: {
      operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-first-guide-complete' }], groups: [],
    },
    repeatOnRefire: true, complete: true,
  },
  {
    id: 'scenario-action-3', scenarioId: 'scenario-0', hook: 'step_sent',
    stepId: 'step-0', choiceIndex: null, sortOrder: 2, actionType: 'scenario',
    config: { op: 'start', scenarioId: 'scenario-1', restart: 'from_start', rememberPrevious: true },
    condition: {
      operator: 'AND', rules: [{ type: 'registered_at', value: { from: '2026-08-01', to: '' } }], groups: [],
    },
    repeatOnRefire: false, complete: true,
  },
]

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
    reachedCount: [428, 412, 386, 351][index] ?? 0,
    reachRate: [0.96, 0.92, 0.86, 0.78][index] ?? 0,
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
  lineAccountId: 'visual-qa-account',
  folderId: ['bf-campaign', 'bf-ec', 'bf-campaign', 'bf-ec', null][index] ?? null,
  createdAt: '2026-08-16T00:00:00.000Z',
}))

/** 一斉配信のフォルダ操作 `xkRDb` を開くための固定データ。 */
export const BROADCAST_FOLDERS = [
  ['bf-reserved', '予約配信', '#3B82F6'],
  ['bf-campaign', 'キャンペーン', '#10B981'],
  ['bf-ec', 'EC・フォロー', '#F59E0B'],
].map(([id, name, color], index) => ({
  id: String(id),
  kind: 'broadcast',
  name: String(name),
  parentId: null,
  displayOrder: index,
  color: String(color),
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
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
 * 機能4「友だち情報欄」。設計 `HBTk0` に見えている4行。
 * リマインダ等が使う `FRIEND_FIELDS` とは分け、`withUsage=1` の一覧だけで返す。
 */
export const FRIEND_ATTRIBUTE_FIELDS = [
  {
    id: 'field-dog-name', folderId: null, name: '愛犬のお名前', fieldKey: 'dog_name',
    type: 'text', options: null, defaultValue: null, source: 'form',
    ecFieldPath: null, ecIsMaster: false, isPersonal: false, isStarred: false,
    displayOrder: 1, usageCount: 187, formUsageCount: 3,
    displayTargets: ['友だち詳細', 'テンプレート差し込み'],
    createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'field-prefecture', folderId: null, name: 'お住まい', fieldKey: 'prefecture',
    type: 'select', options: ['北海道', '東京都', '大阪府', '福岡県'], defaultValue: null, source: 'form',
    ecFieldPath: null, ecIsMaster: false, isPersonal: true, isStarred: false,
    displayOrder: 2, usageCount: 164, formUsageCount: 2,
    displayTargets: ['友だち詳細', '配信の絞り込み'],
    createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z',
  },
  {
    id: 'field-birthday', folderId: null, name: '生年月日', fieldKey: 'birthday',
    type: 'date', options: null, defaultValue: null, source: 'form',
    ecFieldPath: null, ecIsMaster: false, isPersonal: true, isStarred: false,
    displayOrder: 3, usageCount: 141, formUsageCount: 1,
    displayTargets: ['友だち詳細', '誕生日配信'],
    createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
  },
  {
    id: 'field-delivery-status', folderId: null, name: '便の状態', fieldKey: 'delivery_status',
    type: 'select', options: ['準備中', '配送中', 'お届け済み'], defaultValue: null, source: 'automation',
    ecFieldPath: null, ecIsMaster: false, isPersonal: false, isStarred: false,
    displayOrder: 4, usageCount: 72, formUsageCount: 2,
    displayTargets: ['友だち詳細', 'オートメーション'],
    createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z',
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

const autoReplyRun = (id, friendName, occurredAt, inputPreview, status, detail, overrides = {}) => ({
  id,
  ownerKind: 'auto_reply',
  ownerId: 'rule-a',
  lineAccountId: 'visual-qa-account',
  occurredAt,
  subject: friendName,
  accountLabel: '然-NEN- TEST',
  triggerLabel: '予約',
  reference: `message-${id}`,
  status,
  detail,
  durationMs: 800,
  canRetry: false,
  autoReplyId: 'rule-a',
  autoReplyName: '予約問い合わせ',
  friendId: `friend-${id}`,
  friendName,
  messageKind: 'text',
  inputPreview,
  matchedKeyword: '予約',
  versionNumber: 3,
  domainStatus: status === 'failed' ? 'reply_failed' : status === 'pending' ? 'actions_running' : 'completed',
  replyStatus: status === 'failed' ? 'failed' : status === 'pending' ? 'not_attempted' : 'accepted',
  actionSummary: {},
  lineRequestId: status === 'succeeded' ? `line-request-${id}` : null,
  ...overrides,
})

/** 機能8 `t7UtYQ`。本番の AutoReplyRunsResponse と同じ器。 */
export const AUTO_REPLY_RUNS = {
  rule: { id: 'rule-a', name: '予約問い合わせ', isActive: true, priorityPosition: 1 },
  summary: {
    monthHits: 214,
    totalHits: 1_842,
    handovers: 36,
    errors: 3,
    lastRunAt: '2026-08-25T10:32:00+09:00',
    averageResponseMs: 800,
  },
  handovers: { waiting: 8, inProgress: 21, completed: 7 },
  triggerBreakdown: [
    { trigger: '予約', count: 128, share: 0.598 },
    { trigger: '日程変更', count: 54, share: 0.252 },
    { trigger: 'キャンセル', count: 32, share: 0.15 },
  ],
  items: [
    autoReplyRun('1', 'Kenta Kawano', '2026-08-25T10:32:00+09:00', '予約を変更したい', 'succeeded', '返信とタグ追加が完了しました', { actionSummary: { executed: 1 } }),
    autoReplyRun('2', 'Masato S.', '2026-08-25T10:28:00+09:00', '予約の確認', 'succeeded', '返信と担当通知が完了しました', { actionSummary: { executed: 1 }, matchedKeyword: '予約の確認' }),
    autoReplyRun('3', '菅野 亮', '2026-08-25T10:21:00+09:00', '予約キャンセル', 'pending', '担当者へ引き継ぎました', { replyStatus: 'not_attempted', domainStatus: 'actions_running', matchedKeyword: 'キャンセル' }),
    autoReplyRun('4', '山田 太郎', '2026-08-25T10:14:00+09:00', '予約', 'failed', 'LINEへの返信を受け付けてもらえませんでした', { durationMs: 1_200, actionSummary: { failed: 1 } }),
  ],
  pagination: { total: 4, limit: 20, offset: 0 },
}

/** 機能8の公開フロー。設計 g46ja / Yj6CQ / e6iJG と同じ1件を通す。 */
export const AUTO_REPLY_PUBLISH_DRAFT = {
  autoReplyId: 'ar-2',
  versionId: 'ar-2-draft-v3',
  versionNumber: 3,
  status: 'draft',
  lastTestStatus: null,
  lastTestedAt: null,
  publishedAt: null,
  matchedLast28Days: 214,
  settings: {
    keyword: '予約',
    matchType: 'contains',
    responseType: 'text',
    responseContent: 'Kentaさん、お問い合わせありがとうございます。\nご予約内容を確認します。',
    templateId: 'template-booking',
    lineAccountId: 'visual-qa-account',
    activeFrom: '08:00',
    activeUntil: '21:00',
    cooldownMinutes: 5,
    skipWhenOperatorActive: true,
    priority: 1,
    messageKinds: ['text'],
    friendConditions: { label: '予約者・未対応' },
    actions: [
      { actionType: 'add_tag', config: { tagId: 'tag-booking' } },
      { actionType: 'notify', config: { notificationDefinitionId: 'notify-operator' } },
    ],
    responseWeekdays: [0, 1, 2, 3, 4, 5, 6],
    responseHolidayRule: 'include',
    oncePerFriend: true,
    keywords: [{ keyword: '予約', matchType: 'contains' }],
    respondToAll: false,
    name: '予約問い合わせ',
    keywordMatchMode: 'any',
    folderId: 'arf-booking',
  },
}

export const AUTO_REPLY_PUBLISH_CONFLICTS = [
  {
    autoReplyId: 'ar-hours',
    name: '「営業時間」への一律返信',
    certainty: 'possible',
    winnerAutoReplyId: 'ar-2',
    reason: '時間帯によって同じメッセージに反応します。',
  },
  {
    autoReplyId: 'ar-booking-existing',
    name: '予約の問い合わせ',
    certainty: 'certain',
    winnerAutoReplyId: 'ar-2',
    reason: '「予約」を含むメッセージに反応します。',
  },
]

export const AUTO_REPLY_PUBLISH_TEST = {
  matched: true,
  draftWon: true,
  winner: {
    autoReplyId: 'ar-2',
    name: '予約変更のお問い合わせ',
    responseType: 'text',
    responseContent: '予約変更を承ります。ご希望の日時をこのトークでお知らせください。\n担当者から改めてご連絡します。',
  },
  candidates: [
    { autoReplyId: 'ar-2', name: '予約変更のお問い合わせ', priority: 1, result: 'won', reasonCodes: [] },
  ],
  actions: [{ kind: 'set_support_mark' }],
  stateChanged: false,
}

export const AUTO_REPLY_PUBLISH_VALIDATION = {
  valid: true,
  errors: [],
  warnings: ['同じメッセージに反応する自動応答があります。'],
  conflicts: AUTO_REPLY_PUBLISH_CONFLICTS,
  lastTestStatus: 'succeeded',
}

export const AUTO_REPLY_PUBLISH_RESULT = {
  autoReplyId: 'ar-2',
  versionId: 'ar-2-published-v3',
  versionNumber: 3,
  publishedAt: '2026-09-06T10:00:00.000Z',
  acknowledgedConflictIds: AUTO_REPLY_PUBLISH_CONFLICTS.map((item) => item.autoReplyId),
}

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

/** 機能18。設計画像と同じ通常状態を、実データを使わずに撮るための固定値。 */
export const INFLOW_SUMMARY = {
  routes: [
    { refCode: 'summer-ig', name: '夏のInstagram投稿', friendCount: 86, clickCount: 1240, latestAt: '2026-08-25T09:12:00.000Z' },
    { refCode: 'tanaka01', name: '紹介リンク 田中 明', friendCount: 58, clickCount: 820, latestAt: '2026-08-24T18:40:00.000Z' },
    { refCode: 'shop-pop', name: '店頭POPのQRコード', friendCount: 124, clickCount: 640, latestAt: '2026-08-25T11:30:00.000Z' },
    { refCode: 'g-ads-summer', name: 'Google広告 夏キャンペーン', friendCount: 142, clickCount: 3120, latestAt: '2026-08-25T08:04:00.000Z' },
    { refCode: 'mail-sign', name: 'メール署名', friendCount: 12, clickCount: 210, latestAt: '2026-08-19T16:02:00.000Z' },
    { refCode: 'flyer-spring', name: 'チラシ（2026春）', friendCount: 0, clickCount: 12, latestAt: '2026-06-28T14:10:00.000Z' },
  ],
  totalFriends: 312,
  friendsWithRef: 289,
  friendsWithoutRef: 23,
  routeTotal: 24,
  totalClicks: 8420,
  averageAddRate: 6.4,
}

export const SITE_TRACKING_SUMMARY = {
  todayEvents: 24583,
  todayPageViews: 24583,
  linkedEvents: 20397,
  unlinkedEvents: 4186,
  pathCount: 3,
  eventTypeCount: 4,
  lastEventAt: '2026-08-25T11:17:00.000Z',
}

export const SITE_TRACKING_PAGES = [
  { path: 'https://example.com/', views: 12480, visitors: 186 },
  { path: 'https://shop.example.com/', views: 8120, visitors: 94 },
  { path: 'https://lp.example.com/', views: 2403, visitors: 2 },
  { path: 'https://unknown-site.net/', views: 620, visitors: 0 },
]

export const AD_PLATFORMS = [
  { id: 'ad-meta', name: 'meta', displayName: 'Meta広告', config: { pixel_id: 'PIXEL-8420', monthly_cost: 170000, synced_at: '2026-08-25T11:20:00.000Z', sent_count: 866, pending_count: 12, failed_count: 7, retry_success_count: 23 }, isActive: true, createdAt: '2026-01-10T00:00:00.000Z', updatedAt: '2026-08-25T11:20:00.000Z' },
  { id: 'ad-google', name: 'google', displayName: 'Google広告', config: { customer_id: '123-456-7890', monthly_cost: 312000, synced_at: '2026-08-25T11:20:00.000Z' }, isActive: true, createdAt: '2026-01-10T00:00:00.000Z', updatedAt: '2026-08-25T11:20:00.000Z' },
  { id: 'ad-x', name: 'x', displayName: 'X（旧Twitter）', config: { connection_error: '権限が足りません' }, isActive: false, createdAt: '2026-01-10T00:00:00.000Z', updatedAt: '2026-08-22T09:00:00.000Z' },
]

export const AD_CONVERSION_LOGS = [
  { id: 'adlog-1', adPlatformId: 'ad-meta', friendId: 'friend-inflow-1', friendName: '木村 亮', eventName: '体験申込フォームの送信', conversionName: 'Lead', clickId: 'fixed-fbclid-1', clickIdType: 'fbclid', status: 'sent', errorMessage: null, createdAt: '2026-08-25T11:32:00.000Z' },
  { id: 'adlog-2', adPlatformId: 'ad-google', friendId: 'friend-inflow-2', friendName: '中村 さくら', eventName: '初回のご購入', conversionName: 'purchase', clickId: 'fixed-gclid-1', clickIdType: 'gclid', status: 'sent', errorMessage: null, createdAt: '2026-08-25T11:18:00.000Z' },
  { id: 'adlog-3', adPlatformId: 'ad-meta', friendId: 'friend-inflow-3', friendName: '田口 みなみ', eventName: '予約が入った', conversionName: 'Schedule', clickId: 'fixed-fbclid-2', clickIdType: 'fbclid', status: 'pending', errorMessage: null, createdAt: '2026-08-25T10:54:00.000Z', nextRetryAt: '2026-08-25T11:35:00.000Z' },
  { id: 'adlog-4', adPlatformId: 'ad-meta', friendId: 'friend-inflow-4', friendName: '佐藤 健', eventName: '体験申込フォームの送信', conversionName: 'Lead', clickId: 'fixed-fbclid-3', clickIdType: 'fbclid', status: 'failed', errorMessage: '接続設定を確認してください', createdAt: '2026-08-25T09:41:00.000Z' },
  { id: 'adlog-5', adPlatformId: 'ad-google', friendId: 'friend-inflow-5', friendName: '山本 あおい', eventName: '初回のご購入', conversionName: 'purchase', clickId: 'fixed-gclid-2', clickIdType: 'gclid', status: 'failed', errorMessage: '広告アカウントをつなぎ直してください', createdAt: '2026-08-25T08:20:00.000Z', nextRetryAt: 'reconnect' },
  { id: 'adlog-6', adPlatformId: 'ad-meta', friendId: '', friendName: '', eventName: '定期便のお申し込み', conversionName: '—', clickId: null, clickIdType: null, status: 'skipped', errorMessage: '対応が付いていないため送っていません', createdAt: '2026-08-24T22:05:00.000Z' },
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

/*
  紹介者。設計 `PouPn` の「アフィリエイター 12」のうち、札の内訳が撮れる6人。

  **状態を混ぜる。** 全員を有効にすると、設計の札（すべて12／有効10／停止中2／
  未払いあり4／重複の疑い1）が撮れない。停止中を1人、率0%（定額の人）を1人入れる。
  `code` は運用者が決めてURLに出す符号なので、設計と同じ値を使う。
*/
export const AFFILIATES = [
  { id: 'af-1', name: '田中 明', code: 'tanaka01', commissionRate: 10, isActive: true, email: 'tanaka@example.com', holdDays: 30, payoutCycle: '月末締め翌月末払い', notifyOnConversion: true, createdAt: '2026-02-01T00:00:00.000Z' },
  { id: 'af-2', name: '合同会社ノース', code: 'north', commissionRate: 0, isActive: true, email: 'north@example.com', holdDays: 30, payoutCycle: '月末締め翌月末払い', notifyOnConversion: false, createdAt: '2026-03-12T00:00:00.000Z' },
  { id: 'af-3', name: '木村 亮', code: 'miyuki', commissionRate: 15, isActive: true, email: 'miyuki.s@example.jp', holdDays: 30, payoutCycle: '月末締め翌月末払い', notifyOnConversion: true, createdAt: '2026-04-02T00:00:00.000Z' },
  { id: 'af-4', name: '中村 彩', code: 'aya-n', commissionRate: 10, isActive: true, email: null, holdDays: null, payoutCycle: null, notifyOnConversion: false, createdAt: '2026-05-20T00:00:00.000Z' },
  { id: 'af-5', name: '山口 商店', code: 'yamaguchi', commissionRate: 5, isActive: true, email: 'yamaguchi@example.com', holdDays: 60, payoutCycle: '四半期', notifyOnConversion: false, createdAt: '2026-01-15T00:00:00.000Z' },
  { /* 設計の「停止中 2」のうち1人。 */ id: 'af-6', name: '旧パートナーA', code: 'old-a', commissionRate: 10, isActive: false, email: null, holdDays: 30, payoutCycle: null, notifyOnConversion: false, createdAt: '2025-11-01T00:00:00.000Z' },
]

/** 案件。設計 `GH8VL` の「案件 5」。金額は設計の ¥3,000／¥5,000／¥100／¥1,500／¥8,000。 */
export const AFFILIATE_OFFERS = [
  { id: 'ao-1', name: '体験の申し込み', description: 'はじめての方の体験予約', rewardAmount: 3000, rewardMiles: 0, mileageProgramId: 'mp-1', lineAccountId: 'visual-qa-account', tagId: 'tag-0', scenarioId: null, isActive: true, createdAt: '2026-02-01T00:00:00.000Z' },
  { id: 'ao-2', name: '定期便のお申し込み', description: '定期便の初回', rewardAmount: 5000, rewardMiles: 500, mileageProgramId: 'mp-1', lineAccountId: 'visual-qa-account', tagId: 'tag-1', scenarioId: null, isActive: true, createdAt: '2026-02-10T00:00:00.000Z' },
  { id: 'ao-3', name: '友だち追加', description: null, rewardAmount: 100, rewardMiles: 0, mileageProgramId: 'mp-1', lineAccountId: 'visual-qa-account', tagId: 'tag-2', scenarioId: null, isActive: true, createdAt: '2026-03-01T00:00:00.000Z' },
  { id: 'ao-4', name: '資料請求', description: null, rewardAmount: 1500, rewardMiles: 0, mileageProgramId: 'mp-1', lineAccountId: 'visual-qa-account', tagId: null, scenarioId: 'scenario-0', isActive: true, createdAt: '2026-03-15T00:00:00.000Z' },
  { /* 設計の「停止・終了 1」。 */ id: 'ao-5', name: '春の紹介キャンペーン', description: '2026春で終了', rewardAmount: 8000, rewardMiles: 0, mileageProgramId: 'mp-1', lineAccountId: 'visual-qa-account', tagId: null, scenarioId: null, isActive: false, createdAt: '2026-01-05T00:00:00.000Z' },
]

/*
  マイルの残高。設計 `s98Vfw` の並びそのまま。

  **`/api/mileage/overview` は器の形が要る。** 画面の `isMileageAdminOverview` は
  `summary` の5つの数と `pagination` を見て、1つでも欠けると
  「友だちのマイルを表示できませんでした」に落ちる。既定の器が返っていたので、
  固定データ以前に**この画面は一度も中身が撮れていなかった。**
*/
const mileageMember = (id, name, available, pending, lifetime, actions, days) => ({
  identityKey: `ik-${id}`, primaryFriendId: id, displayName: name, pictureUrl: null,
  accountCount: 1, accountNames: ['LINE 本店'],
  available, pending, lifetimeEarned: lifetime,
  actionCount: actions, messageCount: 0, linkClickCount: 0, formCount: 0,
  bookingCount: 0, webinarCount: 0, instagramCount: 0,
  followingDays: days, unfollowCount: 0, referralMiles: 0, qualityReferralCount: 0,
  lastActivityAt: '2026-08-25T00:00:00.000Z',
})

export const MILEAGE_OVERVIEW = {
  summary: {
    totalMembers: 1284,
    totalAvailable: 486200,
    activeMembers30d: 642,
    totalActions: 4180,
    queuedEvents: 12,
  },
  members: [
    mileageMember('friend-1', '高橋 直人', 8420, 0, 12400, 42, 296),
    mileageMember('friend-2', '前田 さくら', 6150, 300, 9800, 31, 216),
    mileageMember('friend-3', '木村 亮', 4980, 0, 7200, 24, 377),
    mileageMember('friend-4', '中村 彩', 2310, 0, 3100, 12, 120),
    mileageMember('friend-5', '石田 未来', 860, 0, 1200, 6, 64),
    mileageMember('friend-6', '松本 圭', 120, 0, 200, 2, 21),
  ],
  pagination: { total: 1284, limit: 20, offset: 0 },
}

/*
  たまる決めごと。設計 `N46cQ` の「すべて 9／動いている 7／止めている 2」。
  **止めているものを2本入れる。** 全部動いていると、その札が撮れない。
*/
/**
 * たまる決めごと1本。**`conditions` を空にしない。**
 * 画面（`earning-rule-view.ts`）は `rule.conditions.uniquePerReferredFriendPerSubject` を
 * 直に読むので、`conditions` ごと無いと `Cannot read properties of undefined` で
 * 一覧が丸ごと落ちる。
 */
const mileageRule = (id, name, eventType, amount, conditions, isActive = true) => ({
  id, name, eventType, source: null, amount,
  initialStatus: 'available', conditions, isActive,
  validFrom: null, validUntil: null,
  createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
})

export const MILEAGE_RULES = [
  mileageRule('mr-1', 'LINEでメッセージを送ってくれた', 'message_received', 50, { dailyCapActions: 1 }),
  mileageRule('mr-2', 'Instagramから戻ってきた', 'inflow_return', 100, { uniquePerSubjectPerDay: true }),
  mileageRule('mr-3', 'ストーリーズのリンクからLINEに来た人', 'inflow_story', 120, { uniquePerSubject: true }),
  mileageRule('mr-4', '予約してくれた', 'booking_created', 300, {}),
  mileageRule('mr-5', '回答フォームに答えてくれた', 'form_submitted', 80, { uniquePerSubject: true }),
  mileageRule('mr-6', 'ウェビナーを見てくれた', 'webinar_watched', 200, {}),
  mileageRule('mr-7', '口コミを書いてくれた', 'review_posted', 200, { uniquePerSubject: true }),
  /* 設計の「止めている 2」。全部動いていると、その札が撮れない。 */
  mileageRule('mr-8', '誕生日クーポンを受け取った', 'birthday', 500, {}, false),
  mileageRule('mr-9', '旧キャンペーン（終了）', 'campaign_2025', 1000, {}, false),
]

/*
  成果地点。設計 `ZrpKn` の「すべて 12／動いている 10／止めている 2／
  どこからも使われていない 2」の内訳が撮れる6件。
*/
export const CONVERSION_POINTS = [
  { id: 'cp-1', name: '商品を買った', eventType: 'ec_order_confirmed', value: 1587, measureMethod: 'webhook', targetUrl: null, countRepeat: true, attributionDays: 90, lineAccountId: null, isActive: true, createdAt: '2026-01-10T00:00:00.000Z' },
  { id: 'cp-2', name: '体験申込フォームの送信', eventType: 'form_submitted', value: 12000, measureMethod: 'webhook', targetUrl: null, countRepeat: false, attributionDays: 90, lineAccountId: null, isActive: true, createdAt: '2026-01-10T00:00:00.000Z' },
  { id: 'cp-3', name: '予約が入った', eventType: 'reservation_confirmed', value: 1816, measureMethod: 'webhook', targetUrl: null, countRepeat: true, attributionDays: 90, lineAccountId: null, isActive: true, createdAt: '2026-02-01T00:00:00.000Z' },
  { id: 'cp-4', name: '初回の定期便が確定', eventType: 'ec_subscription_confirmed', value: 8217, measureMethod: 'webhook', targetUrl: null, countRepeat: false, attributionDays: 30, lineAccountId: null, isActive: true, createdAt: '2026-02-20T00:00:00.000Z' },
  { id: 'cp-5', name: 'ウェビナーを最後まで見た', eventType: 'webinar_completed', value: null, measureMethod: 'webhook', targetUrl: null, countRepeat: false, attributionDays: 30, lineAccountId: null, isActive: true, createdAt: '2026-03-05T00:00:00.000Z' },
  { /* どこからも使われていない1件。 */ id: 'cp-6', name: '資料をダウンロードした', eventType: 'url_reach', value: null, measureMethod: 'url_reach', targetUrl: 'https://example.com/download', countRepeat: false, attributionDays: 90, lineAccountId: null, isActive: false, createdAt: '2025-12-01T00:00:00.000Z' },
]

/*
  成果地点レポート。現期間486件・1,284,000円、直前期間412件・
  1,092,000円を固定し、一覧・レポート・作成前の同種集計が同じ数字を読む。
*/
export const CONVERSION_REPORT_CURRENT = [
  { conversionPointId: 'cp-1', conversionPointName: '商品を買った', eventType: 'ec_order_confirmed', totalCount: 386, totalValue: 612400 },
  { conversionPointId: 'cp-2', conversionPointName: '体験申込フォームの送信', eventType: 'form_submitted', totalCount: 42, totalValue: 504000 },
  { conversionPointId: 'cp-3', conversionPointName: '予約が入った', eventType: 'reservation_confirmed', totalCount: 38, totalValue: 69000 },
  { conversionPointId: 'cp-4', conversionPointName: '初回の定期便が確定', eventType: 'ec_subscription_confirmed', totalCount: 12, totalValue: 98600 },
  { conversionPointId: 'cp-5', conversionPointName: 'ウェビナーを最後まで見た', eventType: 'webinar_completed', totalCount: 8, totalValue: 0 },
  { conversionPointId: 'cp-6', conversionPointName: '資料をダウンロードした', eventType: 'url_reach', totalCount: 0, totalValue: 0 },
]

export const CONVERSION_REPORT_PREVIOUS = [
  { conversionPointId: 'cp-1', conversionPointName: '商品を買った', eventType: 'ec_order_confirmed', totalCount: 341, totalValue: 630000 },
  { conversionPointId: 'cp-2', conversionPointName: '体験申込フォームの送信', eventType: 'form_submitted', totalCount: 26, totalValue: 312000 },
  { conversionPointId: 'cp-3', conversionPointName: '予約が入った', eventType: 'reservation_confirmed', totalCount: 33, totalValue: 60000 },
  { conversionPointId: 'cp-4', conversionPointName: '初回の定期便が確定', eventType: 'ec_subscription_confirmed', totalCount: 12, totalValue: 90000 },
  { conversionPointId: 'cp-5', conversionPointName: 'ウェビナーを最後まで見た', eventType: 'webinar_completed', totalCount: 0, totalValue: 0 },
  { conversionPointId: 'cp-6', conversionPointName: '資料をダウンロードした', eventType: 'url_reach', totalCount: 0, totalValue: 0 },
]

/*
  紹介者ごとの集計。設計 `jwrbf`（成果内訳）が読む。

  **紹介者の一覧に居る人は、ここにも全員入れる。** 片方に居て片方に居ないと、
  内訳の面が `Cannot read properties of undefined (reading 'toLocaleString')` で
  落ちる（実装が行の有無を確かめずに数を整形しているため。別途 Issue に出した）。
*/
export const AFFILIATE_REPORT = [
  { affiliateId: 'af-1', affiliateName: '田中 明', code: 'tanaka01', commissionRate: 10, totalClicks: 820, totalConversions: 24, totalRevenue: 860000, confirmedReward: 86000, linkCount: 3, friendAdds: 58 },
  { affiliateId: 'af-2', affiliateName: '合同会社ノース', code: 'north', commissionRate: 0, totalClicks: 1240, totalConversions: 16, totalRevenue: 0, confirmedReward: 144000, linkCount: 2, friendAdds: 86 },
  { affiliateId: 'af-3', affiliateName: '木村 亮', code: 'miyuki', commissionRate: 15, totalClicks: 420, totalConversions: 9, totalRevenue: 620000, confirmedReward: 93000, linkCount: 1, friendAdds: 31 },
  { affiliateId: 'af-4', affiliateName: '中村 彩', code: 'aya-n', commissionRate: 10, totalClicks: 260, totalConversions: 5, totalRevenue: 400000, confirmedReward: 40000, linkCount: 1, friendAdds: 18 },
  { affiliateId: 'af-5', affiliateName: '山口 商店', code: 'yamaguchi', commissionRate: 5, totalClicks: 90, totalConversions: 1, totalRevenue: 60000, confirmedReward: 3000, linkCount: 1, friendAdds: 4 },
  { /* 成果0の人。0と未取得を混ぜないため、0はきちんと0で返す。 */ affiliateId: 'af-6', affiliateName: '旧パートナーA', code: 'old-a', commissionRate: 10, totalClicks: 0, totalConversions: 0, totalRevenue: 0, confirmedReward: 0, linkCount: 1, friendAdds: 0 },
]

/*
  紹介者ひとりぶんの内訳。設計 `jwrbf` が読む（`/api/affiliates/:id/report`）。

  **器そのものが要る。** 既定の配列が返っていたので、内訳の面は
  `report.clicks.toLocaleString()` で落ちていた。
  `duplicateFlags` に1件入れてあるのは、設計の「重複の疑い 1」を撮るため。
*/
export const AFFILIATE_REPORT_DETAIL = {
  affiliateId: 'af-1', affiliateName: '田中 明', code: 'tanaka01', commissionRate: 10,
  clicks: 820, linkClicks: 760, friendAdds: 58,
  conversions: 24, conversionsApproved: 18, conversionsPending: 4, conversionsRejected: 2,
  conversionsByPoint: [
    { conversionPointId: 'cp-1', name: 'ECの注文が確定したとき', count: 14, value: 512000 },
    { conversionPointId: 'cp-4', name: '体験の申し込み', count: 8, value: 24000 },
    { conversionPointId: 'cp-5', name: '資料請求', count: 2, value: 3000 },
  ],
  byOffer: [
    { offerId: 'ao-1', offerName: '体験の申し込み', rewardAmount: 3000, conversionsApproved: 12, conversionsPending: 2, confirmedReward: 36000 },
    { offerId: 'ao-2', offerName: '定期便のお申し込み', rewardAmount: 5000, conversionsApproved: 5, conversionsPending: 1, confirmedReward: 25000 },
    { offerId: 'ao-4', offerName: '資料請求', rewardAmount: 1500, conversionsApproved: 1, conversionsPending: 1, confirmedReward: 1500 },
  ],
  revenue: 860000, estimatedCommission: 86000, confirmedReward: 86000,
  duplicateFlags: [{ friendId: 'friend-4', identityKey: 'ik-friend-4' }],
}

/** 紹介者が配っているリンク。設計 `jwrbf` の下半分。 */
export const AFFILIATE_LINKS = [
  { id: 'al-1', ref_code: 'tanaka01', label: '体験の申し込み用', click_count: 620, friend_adds: 42, conversions: 18, is_active: true, offer_id: 'ao-1', offer_name: '体験の申し込み' },
  { id: 'al-2', ref_code: 'tanaka01-ig', label: 'Instagram用', click_count: 160, friend_adds: 12, conversions: 5, is_active: true, offer_id: 'ao-2', offer_name: '定期便のお申し込み' },
  { /* 止めているリンク。全部有効だと、止めた行の見え方が撮れない。 */ id: 'al-3', ref_code: 'tanaka01-mail', label: 'メール署名用', click_count: 40, friend_adds: 4, conversions: 1, is_active: false, offer_id: null, offer_name: null },
]

/*
  共通アクション。設計 `xOpDs` の「共通アクション 14」のうち、札の内訳が撮れる5本。

  **版と呼び出し元を混ぜる。** 設計の札は 公開中11／下書き3／**古い版あり2**／
  **呼ばれていない1**。全部が公開中・呼ばれている状態だと、その4つが撮れない。
  版が見えないと「直してよいか」が判断できない、というのが設計の言いたいこと。
*/
export const COMMON_ACTIONS = [
  { id: 'ca-1', name: '体験申込を受けたとき', description: 'タグ・シナリオ・担当の3つ', status: 'published', draftVersion: null, publishedVersion: 4, actionCount: 5, bindingCount: 5, oldVersionBindingCount: 1, updatedAt: '2026-08-25T01:00:00.000Z' },
  { id: 'ca-2', name: '定期便のご案内', description: 'メッセージ ほか2つ', status: 'published', draftVersion: 8, publishedVersion: 7, actionCount: 3, bindingCount: 3, oldVersionBindingCount: 2, updatedAt: '2026-08-24T10:00:00.000Z' },
  { id: 'ca-3', name: '予約のリマインド', description: 'リマインダ ほか1つ', status: 'published', draftVersion: null, publishedVersion: 2, actionCount: 2, bindingCount: 1, oldVersionBindingCount: 0, updatedAt: '2026-08-20T09:00:00.000Z' },
  { /* 設計の「呼ばれていない 1」。 */ id: 'ca-4', name: '休業のお知らせ', description: 'メッセージ ほか1つ', status: 'published', draftVersion: null, publishedVersion: 3, actionCount: 2, bindingCount: 0, oldVersionBindingCount: 0, updatedAt: '2026-07-30T09:00:00.000Z' },
  { /* 設計の「下書き 3」のうち1本。 */ id: 'ca-5', name: '口コミのお願い（下書き）', description: null, status: 'draft', draftVersion: 1, publishedVersion: null, actionCount: 1, bindingCount: 0, oldVersionBindingCount: 0, updatedAt: '2026-08-22T09:00:00.000Z' },
]

/** 機能25の一覧。14本稼働・4本停止を同じAPI契約で返す。 */
export const AUTOMATIONS = [
  { id: 'au-1', name: '友だち追加から案内を始める', description: '流入リンクを通っていない人に、はじめての方へをご案内', eventType: 'friend_add', conditions: { inflow: 'none' }, actions: [{ type: 'start_scenario', params: { scenarioId: 'scenario-0' } }], isActive: true, priority: 100, lineAccountId: 'visual-qa-account', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z' },
  { id: 'au-2', name: '「予約」で予約画面を出す', description: 'すべての友だちに予約用メニューを表示', eventType: 'message_received', conditions: { keyword: '予約' }, actions: [{ type: 'switch_rich_menu', params: { richMenuId: 'rmg-1' } }], isActive: true, priority: 90, lineAccountId: 'visual-qa-account', createdAt: '2026-07-02T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z' },
  { id: 'au-3', name: '体験申込のフォローを始める', description: '30日買っていない人に体験前フォローを開始', eventType: 'tag_change', conditions: { tagId: 'tag-trial', purchaseDays: 30 }, actions: [{ type: 'start_scenario', params: { scenarioId: 'scenario-trial' } }], isActive: true, priority: 80, lineAccountId: 'visual-qa-account', createdAt: '2026-07-03T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' },
  { id: 'au-4', name: '初回注文をSlackへ知らせる', description: '定期便を初めて買った人を外部連携へ通知', eventType: 'ec.order.confirmed', conditions: { firstSubscription: true }, actions: [{ type: 'send_webhook', params: { webhookId: 'wh-1' } }], isActive: true, priority: 70, lineAccountId: 'visual-qa-account', createdAt: '2026-07-04T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z' },
  { id: 'au-5', name: '反応がない人を気にかける', description: '最終接触から7日たった人に対応タグを付ける', eventType: 'tag_change', conditions: { inactiveDays: 7 }, actions: [{ type: 'add_tag', params: { tagId: 'tag-care' } }], isActive: true, priority: 60, lineAccountId: 'visual-qa-account', createdAt: '2026-07-05T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z' },
  { id: 'au-6', name: '問い合わせを担当へ知らせる', description: 'メッセージを受けたら担当用タグを付ける', eventType: 'message_received', conditions: {}, actions: [{ type: 'add_tag', params: { tagId: 'tag-support' } }], isActive: true, priority: 50, lineAccountId: null, createdAt: '2026-07-06T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' },
  ...Array.from({ length: 8 }, (_, index) => ({ id: `au-${index + 7}`, name: `定期フォロー ${index + 1}`, description: '条件に合う友だちへ順番に案内', eventType: 'tag_change', conditions: { group: index + 1 }, actions: [{ type: 'add_tag', params: { tagId: `tag-${index + 1}` } }], isActive: true, priority: 40 - index, lineAccountId: 'visual-qa-account', createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z' })),
  ...Array.from({ length: 4 }, (_, index) => ({ id: `au-${index + 15}`, name: `停止中の案内 ${index + 1}`, description: '設定を残して停止中', eventType: 'tag_change', conditions: {}, actions: [{ type: 'add_tag', params: { tagId: `tag-old-${index + 1}` } }], isActive: false, priority: 10 - index, lineAccountId: 'visual-qa-account', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' })),
]

/**
 * 機能25「動いた記録」（設計 `DkPY0`）。
 *
 * 成功・条件外・失敗を混ぜ、通常状態で3つの結果表示を確かめられるようにする。
 * `detail` は顧客本文ではなく、実行した処理の固定ラベルだけを持つ。
 */
const automationRun = ({
  id, occurredAt, subject, accountLabel, triggerLabel, status, detail, durationMs,
  automationId, automationName, domainStatus, successfulActions = [], failedAction = null,
  failureReason = null,
}) => ({
  id,
  ownerKind: 'automation',
  ownerId: automationId,
  lineAccountId: 'visual-qa-account',
  occurredAt,
  subject,
  accountLabel,
  triggerLabel,
  reference: null,
  status,
  detail,
  durationMs,
  canRetry: false,
  automationId,
  automationName,
  automationVersionId: `${automationId}-version-3`,
  friendId: `friend-${id}`,
  friendName: subject,
  sourceEventId: `event-${id}`,
  domainStatus,
  startedAt: occurredAt,
  completedAt: durationMs === null ? null : occurredAt,
  successfulActions,
  skippedActions: [],
  failedAction,
  failureReason,
})

export const AUTOMATION_RUNS = {
  summary: {
    total: 9660,
    executed: 8420,
    skipped: 1240,
    failed: 6,
    mostRunName: '「予約」と送られたとき',
    mostRunCount: 486,
  },
  items: [
    automationRun({ id: 'run-1', occurredAt: '2026-08-25T11:42:00+09:00', subject: '石田 未来', accountLabel: 'LINE 二号店', triggerLabel: '注文が確定したとき', status: 'succeeded', detail: '外部連携（Slack）／マイル 1,000', durationMs: 1200, automationId: 'au-order', automationName: '初回注文をSlackへ知らせる', domainStatus: 'success', successfulActions: ['外部連携（Slack）', 'マイル 1,000'] }),
    automationRun({ id: 'run-2', occurredAt: '2026-08-25T10:31:00+09:00', subject: '新田 遥', accountLabel: 'LINE 本店', triggerLabel: 'タグ「体験申込」が付いたとき', status: 'succeeded', detail: 'シナリオ開始／担当者 佐々木', durationMs: 800, automationId: 'au-trial', automationName: '体験申込のフォローを始める', domainStatus: 'success', successfulActions: ['シナリオ開始', '担当者 佐々木'] }),
    automationRun({ id: 'run-3', occurredAt: '2026-08-25T09:12:00+09:00', subject: '松本 圭', accountLabel: 'LINE 本店', triggerLabel: 'タグ「体験申込」が付いたとき', status: 'skipped', detail: '対象条件に当てはまりませんでした', durationMs: null, automationId: 'au-trial', automationName: '体験申込のフォローを始める', domainStatus: 'skipped_condition' }),
    automationRun({ id: 'run-4', occurredAt: '2026-08-24T18:40:00+09:00', subject: '木村 亮', accountLabel: 'LINE 二号店', triggerLabel: '注文が確定したとき', status: 'permanent_failed', detail: 'マイル 1,000 は付きました', durationMs: 30000, automationId: 'au-order', automationName: '初回注文をSlackへ知らせる', domainStatus: 'partial', successfulActions: ['マイル 1,000'], failedAction: '外部連携（Slack）', failureReason: '外部連携先が応答しませんでした' }),
    automationRun({ id: 'run-5', occurredAt: '2026-08-24T14:02:00+09:00', subject: '佐藤 千尋', accountLabel: 'LINE 本店', triggerLabel: '「予約」と送られたとき', status: 'succeeded', detail: 'メニュー切替／回答フォーム送信', durationMs: 400, automationId: 'au-reserve', automationName: '「予約」で予約画面を出す', domainStatus: 'success', successfulActions: ['メニュー切替', '回答フォーム送信'] }),
    automationRun({ id: 'run-6', occurredAt: '2026-08-24T09:05:00+09:00', subject: '高橋 直人', accountLabel: 'LINE 本店', triggerLabel: '7日 反応がないとき', status: 'succeeded', detail: '対応マーク「気にかける」', durationMs: 300, automationId: 'au-inactive', automationName: '反応がない人を気にかける', domainStatus: 'success', successfulActions: ['対応マーク「気にかける」'] }),
    automationRun({ id: 'run-7', occurredAt: '2026-08-23T20:00:00+09:00', subject: '前田 さくら', accountLabel: 'LINE 本店', triggerLabel: '友だちが追加されたとき', status: 'skipped', detail: '対象条件に当てはまりませんでした', durationMs: null, automationId: 'au-welcome', automationName: '友だち追加から案内を始める', domainStatus: 'skipped_condition' }),
  ],
  pagination: { total: 9660, limit: 20, offset: 0 },
}

/** 設計 `WjYAC` と同じ12件。選択後に利用者の実データを選び直す見本。 */
export const AUTOMATION_TEMPLATES = [
  { key: 'welcome', name: 'はじめての人にあいさつする', description: '追加された友だちへ案内を始めます', triggerLabel: '友だちが追加されたとき', actionLabel: 'シナリオ「はじめての方へ」を始める' },
  { key: 'reservation', name: '「予約」と送られたら予約画面を出す', description: '予約したい人を迷わせません', triggerLabel: 'メッセージに「予約」が入ったとき', actionLabel: 'リッチメニューを切り替える＋回答フォームを送る' },
  { key: 'inactive', name: '7日 反応がない人に声をかける', description: '対応漏れを見つけます', triggerLabel: '最終接触から7日たったとき', actionLabel: '対応マーク「気にかける」を付ける' },
  { key: 'first-order', name: 'はじめて買った人にお礼を送る', description: '初回購入のお礼を自動化します', triggerLabel: '注文が確定したとき（はじめての人だけ）', actionLabel: 'テンプレート「はじめてのご注文ありがとうございます」を送る' },
  { key: 'tag-scenario', name: 'タグが付いたらシナリオを始める', description: '自由に組み替えられる見本です', triggerLabel: 'タグが付いたとき', actionLabel: '選んだシナリオを始める' },
  { key: 'birthday', name: '誕生月にクーポンを送る', description: '誕生日に合わせて特典を届けます', triggerLabel: '誕生日の◯日前になったとき', actionLabel: 'クーポンを送る＋マイルを付ける' },
  { key: 'review', name: '口コミを書いてくれた人にマイル', description: '回答後のお礼を自動化します', triggerLabel: '回答フォームが送られたとき', actionLabel: 'マイルを付ける＋タグを付ける' },
  { key: 'winback', name: '買っていない人を掘り起こす', description: '休眠した友だちへ定期的に案内します', triggerLabel: '90日 買っていない人（毎週 月曜に見る）', actionLabel: '一斉配信「おひさしぶりです」に入れる' },
  { key: 'block', name: 'ブロックされたら記録する', description: '解除後の対応に備えます', triggerLabel: 'ブロックされたとき', actionLabel: 'タグ「ブロック」を付ける＋外部連携に知らせる' },
  { key: 'booking', name: '予約前日に確認を送る', description: '来店忘れを減らします', triggerLabel: '予約日の前日になったとき', actionLabel: '確認メッセージを送る' },
  { key: 'score', name: '関心が高まった人を担当へ知らせる', description: '対応の優先順位を揃えます', triggerLabel: '行動スコアが80になったとき', actionLabel: '担当者タグを付ける＋外部連携に知らせる' },
  { key: 'cancel', name: '解約相談を受けたら案内する', description: '相談窓口をすぐ案内します', triggerLabel: '「解約」と送られたとき', actionLabel: '相談予約フォームを送る' },
]

const caStep = (id, type, params = {}, onFailure = 'stop') => ({ id, type, params, onFailure })
export const COMMON_ACTION_DETAIL = {
  id: 'ca-1', name: '体験申込を受けたとき', description: 'タグ・シナリオ・担当の3つ', status: 'published',
  currentDraftVersionId: null, currentPublishedVersionId: 'cav-4',
  versions: [
    { id: 'cav-4', versionNumber: 4, status: 'published', actions: [caStep('s41', 'add_tag', { tagId: 'tag-trial' }), caStep('s42', 'wait', { minutes: 30 }), caStep('s43', 'send_message', { templateId: 'template-usage-1', templateName: '体験のご案内', templateVersion: 4 }, 'continue'), caStep('s44', 'start_scenario', { scenarioId: 'scenario-0' }), caStep('s45', 'set_metadata', { assignee: '佐々木' }, 'continue')], createdBy: '佐々木', createdAt: '2026-08-20T05:02:00.000Z', publishedAt: '2026-08-20T05:02:00.000Z' },
    { id: 'cav-3', versionNumber: 3, status: 'published', actions: [caStep('s31', 'add_tag'), caStep('s32', 'wait', { minutes: 30 }), caStep('s33', 'send_message'), caStep('s34', 'start_scenario')], createdBy: '田中', createdAt: '2026-08-12T00:40:00.000Z', publishedAt: '2026-08-12T00:40:00.000Z' },
    { id: 'cav-2', versionNumber: 2, status: 'published', actions: [caStep('s21', 'add_tag'), caStep('s22', 'wait', { minutes: 10 }), caStep('s23', 'start_scenario')], createdBy: '佐々木', createdAt: '2026-08-04T08:20:00.000Z', publishedAt: '2026-08-04T08:20:00.000Z' },
    { id: 'cav-1', versionNumber: 1, status: 'published', actions: [caStep('s11', 'add_tag'), caStep('s12', 'send_message')], createdBy: '佐々木', createdAt: '2026-07-28T02:15:00.000Z', publishedAt: '2026-07-28T02:15:00.000Z' },
  ],
  bindings: [
    { id: 'cab-1', consumerType: 'scenario', consumerId: 'scenario-0', consumerPath: '体験前フォロー・1通目のあと', versionId: 'cav-4', versionNumber: 4, latestVersionNumber: 4, hasNewerVersion: false, runningCount: 8, waitingCount: 2, updatedAt: '2026-08-25T00:00:00.000Z' },
    { id: 'cab-2', consumerType: 'form', consumerId: 'form-1', consumerPath: '体験のお申し込み・送信後', versionId: 'cav-3', versionNumber: 3, latestVersionNumber: 4, hasNewerVersion: true, runningCount: 4, waitingCount: 1, updatedAt: '2026-08-24T00:00:00.000Z' },
    { id: 'cab-3', consumerType: 'auto_reply', consumerId: 'ar-1', consumerPath: '「体験」と送られたとき', versionId: 'cav-4', versionNumber: 4, latestVersionNumber: 4, hasNewerVersion: false, runningCount: 2, waitingCount: 1, updatedAt: '2026-08-23T00:00:00.000Z' },
    { id: 'cab-4', consumerType: 'rich_menu', consumerId: 'rm-1', consumerPath: '体験を申し込む を押したとき', versionId: 'cav-4', versionNumber: 4, latestVersionNumber: 4, hasNewerVersion: false, runningCount: 2, waitingCount: 1, updatedAt: '2026-08-22T00:00:00.000Z' },
    { id: 'cab-5', consumerType: 'automation', consumerId: 'au-3', consumerPath: 'タグ「体験申込」が付いたとき', versionId: 'cav-4', versionNumber: 4, latestVersionNumber: 4, hasNewerVersion: false, runningCount: 2, waitingCount: 1, updatedAt: '2026-08-21T00:00:00.000Z' },
  ],
}

/*
  予約メニュー。設計 `QSLEH` の「メニュー 8／止めているもの 2つ」。
  料金は設計の ¥8,400／¥12,600／¥4,200／¥1,200／¥2,800。
  **`is_active` は 0/1 の数**（この口は DB の行をそのまま返す）。
*/
export const BOOKING_MENUS = [
  { id: 'bm-1', name: 'トリミング（小型犬）', category_label: 'トリミング', description: 'シャンプー・カット・爪切り', duration_minutes: 90, buffer_after_minutes: 15, base_price: 8400, sort_order: 1, is_active: 1, auto_tag_id: null, concurrent_capacity: 1, booking_window_days: 60, cutoff_hours_before: 24 },
  { id: 'bm-2', name: 'トリミング（大型犬）', category_label: 'トリミング', description: 'シャンプー・カット・爪切り', duration_minutes: 150, buffer_after_minutes: 15, base_price: 12600, sort_order: 2, is_active: 1, auto_tag_id: null, concurrent_capacity: 1, booking_window_days: 60, cutoff_hours_before: 24 },
  { id: 'bm-3', name: 'シャンプーのみ', category_label: 'トリミング', description: null, duration_minutes: 45, buffer_after_minutes: 10, base_price: 4200, sort_order: 3, is_active: 1, auto_tag_id: null, concurrent_capacity: 2, booking_window_days: 60, cutoff_hours_before: 12 },
  { id: 'bm-4', name: '爪切りだけ', category_label: 'お手入れ', description: null, duration_minutes: 15, buffer_after_minutes: 5, base_price: 1200, sort_order: 4, is_active: 1, auto_tag_id: null, concurrent_capacity: 2, booking_window_days: 30, cutoff_hours_before: 2 },
  { id: 'bm-5', name: '歯みがき', category_label: 'お手入れ', description: null, duration_minutes: 30, buffer_after_minutes: 5, base_price: 2800, sort_order: 5, is_active: 1, auto_tag_id: null, concurrent_capacity: 1, booking_window_days: 30, cutoff_hours_before: 6 },
  { /* 設計の「止めているもの 2つ」。 */ id: 'bm-6', name: '夏の毛刈り（終了）', category_label: '季節', description: null, duration_minutes: 60, buffer_after_minutes: 10, base_price: 6000, sort_order: 6, is_active: 0, auto_tag_id: null, concurrent_capacity: 1, booking_window_days: null, cutoff_hours_before: null },
]

/** 予約スタッフ。設計 `tksPc` の押し口「佐々木」を含む。 */
export const BOOKING_STAFF = [
  { id: 'bs-1', name: '佐々木 亮太', display_name: '佐々木', role: 'トリマー', profile_image_url: null, bio: '小型犬が得意です。', sort_order: 1, is_designation_optional: 0, is_active: 1 },
  { id: 'bs-2', name: '中川 由美', display_name: '中川', role: '受付', profile_image_url: null, bio: null, sort_order: 2, is_designation_optional: 1, is_active: 1 },
  { id: 'bs-3', name: '高田 誠', display_name: '高田', role: 'トリマー', profile_image_url: null, bio: null, sort_order: 3, is_designation_optional: 0, is_active: 1 },
]

/*
  メニューに就ける担当。設計 `GFDqW`（代理予約・内容確認）が読む。

  **`/api/booking/admin/menus/:id/staff` は道の途中にIDが入る。**
  `RAW` に載せられないので `RAW_PATTERNS` で返す。器は `{staff}` で、
  包むと `res.staff` が `undefined` になり、選ぶ口が0件のまま撮れない。
*/
export const BOOKING_MENU_STAFF = [
  { id: 'bs-1', display_name: '佐々木', role: 'トリマー', profile_image_url: null, bio: '小型犬が得意です。', is_designation_optional: 0, price: 8400, duration_minutes: 90 },
  { id: 'bs-3', display_name: '高田', role: 'トリマー', profile_image_url: null, bio: null, is_designation_optional: 0, price: 8400, duration_minutes: 90 },
]

/*
  空いている時間。設計 `GFDqW`（代理予約・内容確認）が読む。

  **時刻は動かさない。** 撮るたびに枠が変わると画像が毎回違うものになる。
  `10:00〜11:45` は「トリミング（小型犬）」の90分＋間隔15分ぶん。
  台帳の手順がこの表記で選ぶので、幅を変えるときは両方を直す。
*/
export const BOOKING_AVAILABILITY = {
  by_staff: [
    {
      staff_id: 'bs-1', display_name: '佐々木',
      slots: [
        { date: '2026-09-03', start: '10:00', end: '11:45' },
        { date: '2026-09-03', start: '13:00', end: '14:45' },
        /* 台帳の `Lg8ff`（予約枠の重なりと入力エラー）が選ぶ枠。 */
        { date: '2026-09-03', start: '14:00', end: '15:45' },
        { date: '2026-09-04', start: '10:00', end: '11:45' },
      ],
    },
    {
      staff_id: 'bs-3', display_name: '高田',
      slots: [{ date: '2026-09-03', start: '15:00', end: '16:45' }],
    },
  ],
}

/*
  受付枠画面 `tksPc` が読む、担当者ごとの通常応答。
  現行APIが持つのは1曜日1区間と特別営業で、休けい・店舗上限・
  明示休業はまだ返せない。その項目は画面側で作らず「—」にする。
*/
export const BOOKING_AVAILABILITY_RULES = [
  { id: 'bar-1', weekday: 1, start_time: '09:00', end_time: '19:00' },
  { id: 'bar-2', weekday: 2, start_time: '09:00', end_time: '19:00' },
  { id: 'bar-3', weekday: 4, start_time: '09:00', end_time: '19:00' },
  { id: 'bar-4', weekday: 5, start_time: '09:00', end_time: '20:00' },
  { id: 'bar-5', weekday: 6, start_time: '09:00', end_time: '18:00' },
  { id: 'bar-6', weekday: 0, start_time: '10:00', end_time: '17:00' },
]

export const BOOKING_STAFF_SHIFTS = [
  { id: 'bss-1', work_date: '2026-09-23', start_time: '10:00', end_time: '17:00' },
  { id: 'bss-2', work_date: '2026-12-29', start_time: '10:00', end_time: '15:00' },
]

export const BOOKING_GOOGLE_CALENDAR = {
  connection: {
    id: 'bgc-1', calendar_id: 'visual-qa-calendar@example.invalid',
    auth_type: 'service_account', is_active: 1,
    last_verified_at: '2026-09-02T00:00:00.000Z', last_error: null,
  },
  service_account: {
    configured: true,
    email: 'visual-qa-calendar@example.invalid',
  },
}

/*
  代理予約の登録結果。画面確認用なのでDB保存・通知は起こさない。
  10:00は登録完了、14:00は同じ枠を別の予約が取った競合として返す。
  本番の `POST /api/booking/admin/bookings` と同じHTTP状態・本文の形にする。
*/
export const BOOKING_PROXY_CREATE = {
  success: {
    status: 201,
    body: {
      booking_id: 'visual-qa-booking-1000',
      status: 'confirmed',
      calendar_sync: 'not_configured',
      replayed: false,
    },
  },
  conflict: {
    status: 409,
    body: { error: 'slot_conflict' },
  },
  unavailable: {
    status: 422,
    body: { error: 'slot_not_available' },
  },
}

/*
  予約。設計 `TV2DI`（予約管理）の台帳そのまま。

  **LINEからと電話からを混ぜる。** 設計は「LINEから 9・電話 3」を色で分けて
  同じところに並べる。片方だけだと、その読み分けが撮れない。
  **LINEの友だちと結びついていない行**も1つ入れる（設計の
  「LINEの友だちと結びついていません。当日の連絡ができません」を出すため）。
*/
const booking = (id, friendId, name, start, end, menu, staff, price, status = 'confirmed') => ({
  id, friend_id: friendId, starts_at: start, ends_at: end, status,
  customer_note: null, internal_note: null, price_at_booking: price,
  menu_name: menu, staff_name: staff, friend_name: name,
  requested_at: '2026-09-02T02:00:00.000Z', decided_at: '2026-09-02T02:05:00.000Z',
  external_event_id: null,
})

export const BOOKING_REQUESTS = [
  booking('bk-1', 'friend-1', '高橋 直人', '2026-09-03T00:00:00.000Z', '2026-09-03T01:45:00.000Z', 'トリミング（小型犬）', '佐々木', 8400),
  booking('bk-2', 'friend-2', '前田 さくら', '2026-09-03T02:00:00.000Z', '2026-09-03T03:45:00.000Z', 'トリミング（大型犬）', '佐々木', 12600),
  booking('bk-3', 'friend-3', '木村 亮', '2026-09-03T04:00:00.000Z', '2026-09-03T04:45:00.000Z', 'シャンプーのみ', '高田', 4200),
  booking('bk-4', 'friend-4', '中村 彩', '2026-09-03T05:00:00.000Z', '2026-09-03T05:15:00.000Z', '爪切りだけ', '中川', 1200),
  /* 電話で受けた予約。**LINEの友だちと結びついていない。** */
  { ...booking('bk-5', '', null, '2026-09-03T06:00:00.000Z', '2026-09-03T07:45:00.000Z', 'トリミング（小型犬）', '佐々木', 8400), friend_name: null },
  /* まだ決めていない1件。設計の「承認待ち」。 */
  booking('bk-6', 'friend-5', '石田 未来', '2026-09-04T01:00:00.000Z', '2026-09-04T02:45:00.000Z', 'トリミング（小型犬）', '高田', 8400, 'requested'),
]

/*
  お知らせの種類。設計 `festr`（24-1 LINE通知）の「お知らせの種類 9つ」。

  **止めているものを2つ入れる。** 設計の札は 出している7／止めている2／
  文面が未設定1。全部が出ている状態だと、その3つが撮れない。
  台帳の `Q55bb`（お知らせの中身を編集する）は「発送した」を押すので、
  その名前の行が要る。
*/
const ecNotification = (eventType, label, category, order, isEnabled = true, title = null) => ({
  eventType, label, isEnabled,
  title: title ?? label,
  introText: 'いつもご利用ありがとうございます。',
  outroText: 'ご不明な点はこのままご返信ください。',
  category, buttonLabel: '注文を見る', buttonUrl: 'https://example.com/orders',
  imageUrl: '', displayOrder: order,
  fixedFields: ['注文番号', '金額'],
  fixedPreview: 'ご注文 NEN-1001 / ¥12,800',
  updatedAt: '2026-08-25T00:00:00.000Z',
})

export const EC_NOTIFICATION_SETTINGS = [
  ecNotification('ec_order.confirmed', '注文が確定した', 'order', 1),
  ecNotification('ec_payment.received', '入金を確認した', 'payment', 2),
  ecNotification('ec_shipping.shipped', '発送した', 'shipping', 3),
  ecNotification('ec_shipping.delivered', 'お届けした', 'shipping', 4),
  ecNotification('ec_subscription.renewed', '定期便が続いた', 'subscription', 5),
  ecNotification('ec_subscription.paused', '定期便を止めた', 'subscription', 6),
  ecNotification('ec_support.cancelled', 'キャンセルした', 'support', 7),
  /* 設計の「止めている 2」。 */
  ecNotification('ec_support.refunded', '返金した', 'support', 8, false),
  /* 設計の「文面が未設定 1」。**空文字は「まだ決めていない」で、0件ではない。** */
  { ...ecNotification('ec_order.backordered', '入荷待ちになった', 'order', 9, false), title: null, introText: '', outroText: '' },
]

/** 機能24。LINE受付までの事実だけを持ち、届いた・既読は作らない。 */
export const EC_NOTIFICATION_RUNS = {
  items: [
    {
      id: 'ec-run-1', recipientType: 'customer', notificationName: '注文確定のお知らせ', source: 'EC連携',
      sourceEventId: 'ec-event-1001', friendId: 'friend-1', friendName: '高橋 直人', orderNumber: 'NEN-10482',
      channel: 'line', status: 'accepted', reason: null,
      receivedAt: '2026-08-25T10:32:00+09:00', acceptedAt: '2026-08-25T10:32:01+09:00',
      attemptCount: null, nextRetryAt: null, clickedAt: null, version: null,
      executionMode: 'automatic', retryAvailable: false,
    },
    {
      id: 'ec-run-2', recipientType: 'customer', notificationName: '発送のお知らせ', source: 'EC連携',
      sourceEventId: 'ec-event-1002', friendId: 'friend-2', friendName: '前田 さくら', orderNumber: 'NEN-10481',
      channel: 'line', status: 'pending', reason: 'LINEへの送信処理を待っています',
      receivedAt: '2026-08-25T10:28:00+09:00', acceptedAt: null,
      attemptCount: null, nextRetryAt: null, clickedAt: null, version: null,
      executionMode: 'automatic', retryAvailable: false,
    },
    {
      id: 'ec-run-3', recipientType: 'customer', notificationName: '返金のお知らせ', source: 'EC連携',
      sourceEventId: 'ec-event-1003', friendId: 'friend-3', friendName: '菅野 亮', orderNumber: 'NEN-10480',
      channel: 'line', status: 'excluded', reason: 'LINEの友だちと結び付いていないため、送信しませんでした',
      receivedAt: '2026-08-25T10:21:00+09:00', acceptedAt: null,
      attemptCount: null, nextRetryAt: null, clickedAt: null, version: null,
      executionMode: 'automatic', retryAvailable: false,
    },
    {
      id: 'ec-run-4', recipientType: 'customer', notificationName: '定期便更新のお知らせ', source: 'EC連携',
      sourceEventId: 'ec-event-1004', friendId: 'friend-4', friendName: '山田 太郎', orderNumber: 'NEN-10479',
      channel: 'line', status: 'failed', reason: 'LINEが送信を受け付けませんでした。受信箱からご連絡ください',
      receivedAt: '2026-08-25T10:14:00+09:00', acceptedAt: null,
      attemptCount: null, nextRetryAt: null, clickedAt: null, version: null,
      executionMode: 'automatic', retryAvailable: false,
    },
  ],
  summary: { accepted: 148, failed: 3, excluded: 12, pending: 2 },
  coverage: {
    source: 'current_ec_events',
    unassignedHistoricalRowsExcluded: true,
    attemptHistoryAvailable: false,
    retryAvailable: false,
  },
}

/*
  イベント。設計 `ugP5y`（29-1 イベント予約）の
  「これからの回 6／受付前 2／終わった回 24」の内訳が撮れる4件。
*/
const adminEvent = (id, name, nextSlot, capacity, active, pending, published = 1) => ({
  id, name, venue_name: '店内スペース（2階）', venue_url: null, image_url: null,
  description: 'はじめての方むけに、おうちでできるコツをお伝えします。',
  description_centered: 0, max_bookings_per_friend: 1, requires_approval: 1,
  cancel_deadline_hours_before: 24, reminder_day_before_enabled: 1, reminder_hours_before: 3,
  is_published: published, sort_order: 1,
  created_at: '2026-09-01T01:00:00.000Z', updated_at: '2026-09-02T01:00:00.000Z',
  next_slot_starts_at: nextSlot,
  total_capacity: capacity, total_active: active, pending_count: pending,
  visible_tag_id: null, visible_tag_name: null,
})

/*
  イベント。設計 `ugP5y` の「これからの回 6／受付前 2／終わった回 24」の内訳が撮れる4件。

  **`total_active` と `pending_count` は必ず数で入れる。** 画面は
  `items.reduce((sum, e) => sum + e.total_active, 0)` で足すので、
  入っていないと帯が `NaN人` `NaN件` になる（一度そうなった）。
*/
export const ADMIN_EVENTS = [
  adminEvent('ev-1', '秋のしつけ教室（第1回）', '2026-09-25T05:00:00.000Z', 12, 9, 2),
  adminEvent('ev-2', 'ごはん相談会', '2026-09-28T02:00:00.000Z', 8, 8, 1),
  /* 設計の「申し込みが少ない 1」。 */
  adminEvent('ev-3', '爪切り体験', '2026-10-02T06:00:00.000Z', 10, 1, 0),
  /* 設計の「受付前 2」。公開していないので、埋まり具合の分母にも入らない。 */
  adminEvent('ev-4', '冬のしつけ教室', '2026-12-05T05:00:00.000Z', 12, 0, 0, 0),
]

/*
  イベントの申込者。設計 `i5SN2j` の「申し込み12／キャンセル待ち3／取り消した2」。
  **同伴のペット**も入れる（設計は「ももちゃん（犬・4歳）」のように出す）。
*/
export const EVENT_BOOKINGS = [
  { id: 'eb-1', event_id: 'ev-1', friend_id: 'friend-1', friend_name: '高橋 直人', status: 'confirmed', companion_count: 1, companion_note: 'ももちゃん（犬・4歳）', is_first_time: 1, created_at: '2026-09-01T02:00:00.000Z' },
  { id: 'eb-2', event_id: 'ev-1', friend_id: 'friend-2', friend_name: '前田 さくら', status: 'confirmed', companion_count: 1, companion_note: 'そらくん（猫・2歳）', is_first_time: 0, created_at: '2026-09-01T03:00:00.000Z' },
  { id: 'eb-3', event_id: 'ev-1', friend_id: 'friend-3', friend_name: '木村 亮', status: 'confirmed', companion_count: 1, companion_note: 'こむぎちゃん（犬・7歳）', is_first_time: 1, created_at: '2026-09-01T04:00:00.000Z' },
  { /* キャンセル待ち。全部が確定だと、その札が撮れない。 */ id: 'eb-4', event_id: 'ev-1', friend_id: 'friend-4', friend_name: '中村 彩', status: 'waitlist', companion_count: 1, companion_note: 'ぷりんちゃん（うさぎ・3歳）', is_first_time: 1, created_at: '2026-09-02T01:00:00.000Z' },
  { /* 取り消した1件。 */ id: 'eb-5', event_id: 'ev-1', friend_id: 'friend-5', friend_name: '石田 未来', status: 'cancelled', companion_count: 1, companion_note: 'レオくん（犬・1歳）', is_first_time: 0, created_at: '2026-09-01T05:00:00.000Z' },
]

/*
  写真審査。設計 `Qu6Vk` の格子。

  **状態を4つとも混ぜる。** 設計の札は 審査待ち／通したもの／戻したもの／すべて。
  全部が審査待ちだと、残り3つの札が撮れない。
  戻したものには**理由**を入れる（`N2J629`「写真を戻す理由をえらぶ」の元）。
  `image_url` は作り物の SVG。外の絵を読みに行かないので、撮るたびに同じになる。
*/
const petPhoto = (id, owner, pet, caption, status, hours, reason = null, note = null) => ({
  id, owner_name: owner, pet_name: pet, caption,
  image_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="%23eef6f0"/></svg>',
  status,
  review_version: 1,
  created_at: new Date(Date.parse('2026-08-25T09:00:00.000Z') - hours * 3600 * 1000).toISOString(),
  publication_consent_at: '2026-08-20T00:00:00.000Z',
  publication_withdrawn_at: null,
  review_reason_code: reason, review_reason_note: note,
  review_notification_status: status === 'rejected' ? 'sent' : null,
})

/*
  **名前に「ちゃん」を入れない。** 画面が `{pet_name}ちゃん` と後ろに付けるので、
  ここにも入れると「ももちゃんちゃん」になる。
  なお設計 `Qu6Vk` は「そらくん」「レオくん」と**子によって呼び方を変えている**が、
  実装は全員に「ちゃん」を付ける。呼び方は画面ではなく飼い主が決めるものなので、
  そこは別に直す（板 #739 の判定に書いた）。
*/
export const NEN_PHOTOS = [
  petPhoto('ph-1', '高橋 直人', 'もも', '朝のおさんぽ', 'pending', 48),
  petPhoto('ph-2', '前田 さくら', 'そら', 'はじめてのトリミング', 'pending', 44),
  petPhoto('ph-3', '木村 亮', 'こむぎ', 'おやつを待つ顔', 'pending', 20),
  petPhoto('ph-4', '中村 彩', 'ぷりん', 'ひなたぼっこ', 'adopted', 14),
  petPhoto('ph-5', '石田 未来', 'レオ', '新しい首輪', 'adopted', 8),
  /* 戻したもの。**理由が無いと、なぜ戻したのかが画面から読めない。** */
  petPhoto('ph-6', '松本 圭', 'むぎ', '店内で撮影', 'rejected', 3, 'other_person', '人の顔が写っています'),
]

export const NEN_PHOTO_DETAIL = {
  ...NEN_PHOTOS[0], pet_name: 'レオくん', owner_name: '大西 健一（LINE 本店）',
  caption: 'はじめて海に行きました', image_width: 2048, image_height: 1536,
  image_byte_size: 1887437, captured_device: 'iPhone 15', animal_type: 'dog',
  breed: 'ラブラドール', birthday: '2025-08-24', submission_count: 3, returned_count: 0,
  risks: [
    { flag: 'face', confidence: 0.78, note: 'うしろに人の顔', provider: 'visual-qa', model_version: 'fixture-1', assessed_at: '2026-08-25T08:10:00.000Z' },
    { flag: 'blur', confidence: 0.04, note: '明るさ・ぶれは問題ありません', provider: 'visual-qa', model_version: 'fixture-1', assessed_at: '2026-08-25T08:10:00.000Z' },
  ],
}

const publicationPhoto = (id, photoId, petName, ownerName, count, label, type = 'column') => ({
  id, photo_id: photoId, status: 'published', show_owner_name: ownerName ? 1 : 0,
  view_count: count, version: 1, published_at: '2026-08-20T00:00:00.000Z',
  image_url: NEN_PHOTOS[0].image_url, publication_consent_at: '2026-08-20T00:00:00.000Z',
  pet_name: petName, owner_name: ownerName,
  placements: label ? [{ id: `${id}-place`, placement_type: type, placement_label: label, view_count: count }] : [],
})

export const NEN_PHOTO_PUBLICATIONS = {
  summary: {
    publishedCount: 8, placementCount: 4,
    topPhoto: { pet_name: 'ももちゃん', view_count: 1240 }, consentedCount: 8,
  },
  items: [
    publicationPhoto('pub-1', 'ph-11', 'ももちゃん', '高橋 直人 さま', 1240, 'リッチメニュー', 'rich_menu'),
    publicationPhoto('pub-2', 'ph-12', 'そらくん', '前田 さくら さま', 860, 'コラム「歯みがき」'),
    publicationPhoto('pub-3', 'ph-13', 'こむぎちゃん', '木村 亮 さま', 642, 'サイトのトップ', 'site'),
    publicationPhoto('pub-4', 'ph-14', 'ぷりんちゃん', '中村 彩 さま', 418, '回答フォーム', 'form'),
    publicationPhoto('pub-5', 'ph-15', 'だいふく', '松本 圭 さま', 286, 'コラム「フード」'),
    publicationPhoto('pub-6', 'ph-16', 'ここちゃん', '新田 遥 さま', null, ''),
    publicationPhoto('pub-7', 'ph-17', 'まるくん', '石田 未来 さま', 186, 'リッチメニュー', 'rich_menu'),
    publicationPhoto('pub-8', 'ph-18', 'レオくん', null, 92, 'リッチメニュー', 'rich_menu'),
  ],
}

/*
  ECの取り込み記録。設計 `eI3gs` の一覧。

  **成功だけにしない。** 設計の札は 送信完了／処理中／送信なし／失敗。
  `identity_pending`（LINEの友だちが見つからない）と `failed` を混ぜないと、
  「LINEとのつき合わせが必要」の行と失敗の行が撮れない。
*/
const ecEvent = (id, type, label, order, friendId, friendName, status, minutes, error = null) => ({
  id, externalEventId: `ext-${id}`, eventType: type, eventLabel: label,
  customerId: `cus-${id}`, friendId, friendName, orderNumber: order, status,
  errorMessage: error,
  receivedAt: new Date(Date.parse('2026-08-25T09:00:00.000Z') - minutes * 60 * 1000).toISOString(),
  processedAt: status === 'processed'
    ? new Date(Date.parse('2026-08-25T09:00:00.000Z') - (minutes - 1) * 60 * 1000).toISOString()
    : null,
})

export const EC_EVENTS = [
  ecEvent('ece-1', 'ec_order.confirmed', '注文が確定した', 'NEN-12492', 'friend-1', '高橋 直人', 'processed', 12),
  ecEvent('ece-2', 'ec_payment.received', '入金を確認した', 'NEN-12488', 'friend-2', '前田 さくら', 'processed', 40),
  ecEvent('ece-3', 'ec_shipping.shipped', '発送した', 'NEN-12471', 'friend-3', '木村 亮', 'processed', 90),
  /* LINEの友だちが見つからない。**取り込めたが送れていない**、を分けて出すため。 */
  ecEvent('ece-4', 'ec_order.confirmed', '注文が確定した', 'NEN-12486', null, null, 'identity_pending', 20),
  ecEvent('ece-5', 'ec_subscription.renewed', '定期便が続いた', 'NEN-12480', 'friend-4', '中村 彩', 'processing', 5),
  /* 失敗。理由を空にしない。 */
  ecEvent('ece-6', 'ec_support.refunded', '返金した', 'NEN-12402', 'friend-5', '石田 未来', 'failed', 180, 'LINEへの送信が拒否されました（ブロック済み）'),
]

/** 取り込みの帯。設計 `eI3gs` の「注文96・入金32・発送20」。 */
export const EC_OVERVIEW = {
  total: 2486, processed: 2412, identityPending: 24, failed: 2, skipped: 48,
  last24h: 148, lastReceivedAt: '2026-08-25T08:48:00.000Z',
  byType: [
    { eventType: 'ec_order.confirmed', label: '注文', count: 96 },
    { eventType: 'ec_payment.received', label: '入金', count: 32 },
    { eventType: 'ec_shipping.shipped', label: '発送', count: 20 },
  ],
}

/**
 * `/api/mileage/rewards` — マイルの使い道（`qlVLJ` 17-1-B）。
 *
 * 設計の数字をそのまま置いている。**`neverRedeemedFriendCount` は null。**
 * 本物の口（`packages/db/src/mileage-rewards.ts`）がいま固定で null を返すので、
 * ここで 786 を入れると、**撮った絵だけが本物より良く見える**。
 * 設計の 786人 と実装の `—` の差は、絵ではなく台帳の判定で言う。
 */
function mileageRewardVersion(requiredMiles, stockLimit, extra = {}) {
  return {
    id: `mrv-${requiredMiles}`, versionNumber: 1, status: 'published',
    requiredMiles, stockLimit, perFriendLimit: null,
    startsAt: null, endsAt: null, benefitExpiresDays: 30,
    commonActionVersionId: null, failurePolicy: 'refund',
    customerMessage: '交換ありがとうございます。', publishedAt: '2026-08-01T00:00:00.000Z',
    ...extra,
  }
}

export const MILEAGE_REWARDS = {
  rewards: [
    { id: 'mr-1', name: '送料無料', description: '次のお買い物の送料が無料になります', rewardKind: 'coupon', status: 'published', sortOrder: 1, currentVersion: mileageRewardVersion(500, null), exchangedThisMonth: 32, availableCodeCount: null },
    { id: 'mr-2', name: '誕生月クーポン', description: '誕生月に使える 10%オフ', rewardKind: 'coupon', status: 'published', sortOrder: 2, currentVersion: mileageRewardVersion(1200, 200), exchangedThisMonth: 18, availableCodeCount: 168 },
    { id: 'mr-3', name: '先行案内', description: '新商品を先にお知らせします', rewardKind: 'early_access', status: 'published', sortOrder: 3, currentVersion: mileageRewardVersion(2000, null), exchangedThisMonth: 6, availableCodeCount: null },
    { id: 'mr-4', name: 'ゴールドのタグ', description: 'タグ「ゴールド」が付きます', rewardKind: 'tag', status: 'published', sortOrder: 4, currentVersion: mileageRewardVersion(5000, null), exchangedThisMonth: 2, availableCodeCount: null },
    // 引換コードを数える経路がまだ無い使い道。**残りを 0 と書かない。**
    { id: 'mr-5', name: 'お試しセット', description: null, rewardKind: 'coupon', status: 'draft', sortOrder: 5, currentVersion: mileageRewardVersion(800, 50), exchangedThisMonth: 0, availableCodeCount: null },
  ].map((reward) => ({
    lineAccountId: 'acc-1', programId: 'mp-1', imageUrl: null,
    currentDraftVersionId: null, currentPublishedVersionId: reward.currentVersion.id,
    createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z',
    ...reward,
  })),
  summary: {
    publishedCount: 4,
    redeemedMilesThisMonth: 18900,
    neverRedeemedFriendCount: null,
    mostRedeemedRewardName: '送料無料',
    mostRedeemedRewardCount: 32,
  },
}

/*
  行動スコアの決めごと（`s6MBc` 17-2-A `/mileage/score-rules`）。

  **帯の境目は 30 / 70。** `packages/db` の `DEFAULT_BANDS` と同じ値にしてある。
  同じファイルの `/api/action-scores/friends` は長く `normalMin: 40` を返していて、
  一覧と決めごとの画面で**同じ人が別の帯に入って見えた**。40 に根拠は無かったので
  30 にそろえた。

  **止めているルールを1本入れる。** 全部動かしていると、スイッチが切れている行と
  「止める」の文字が撮れない。
*/
function scoreRule(id, name, eventType, source, operation, value, kind, limit, enabled = true) {
  return {
    id, name, eventType, source, operation, value,
    frequency: { kind, limit }, sameSourceEventOnce: true,
    validFrom: null, validUntil: null, enabled,
  }
}

const ACTION_SCORE_BUNDLE = {
  rules: [
    scoreRule('asr-1', 'メッセージに返信した', 'message_received', 'line_webhook', 'delta', 4, 'per_day', 1),
    scoreRule('asr-2', '配信のURLを押した', 'link_clicked', 'tracked_link', 'delta', 2, 'per_subject_per_day', 1),
    scoreRule('asr-3', '回答フォームに答えた', 'form_submitted', 'form', 'delta', 6, 'per_subject', 1),
    scoreRule('asr-4', '予約した', 'booking_created', null, 'delta', 10, 'unlimited', 1),
    scoreRule('asr-5', '購入した', 'purchase_completed', 'stripe', 'delta', 12, 'unlimited', 1),
    scoreRule('asr-6', '30日間反応がない', 'inactivity_30d', 'scheduler', 'delta', -6, 'once_per_period', 1),
    scoreRule('asr-7', 'ブロックした', 'friend_unfollow', 'line_webhook', 'set', 0, 'unlimited', 1, false),
  ],
  bands: { min: 0, max: 100, normalMin: 30, highMin: 70 },
}

export const ACTION_SCORE_RULES = {
  configured: true,
  status: 'published',
  currentDraftVersionId: 'asrv-3',
  currentPublishedVersionId: 'asrv-2',
  editableVersion: {
    ...ACTION_SCORE_BUNDLE,
    id: 'asrv-3', versionNumber: 3, status: 'draft',
    createdAt: '2026-08-30T10:00:00.000Z', publishedAt: null,
  },
  publishedVersion: {
    ...ACTION_SCORE_BUNDLE,
    id: 'asrv-2', versionNumber: 2, status: 'published',
    createdAt: '2026-08-20T10:00:00.000Z', publishedAt: '2026-08-21T02:00:00.000Z',
  },
}

/**
 * 機能10 ウェビナーのフォルダ。設計 `ZC13r` の名前と件数。
 * `count` は全18件を取得しなくても左の絞り込み件数を描ける一覧集計値。
 */
export const WEBINAR_FOLDERS = [
  ['webinar-folder-products', '商品説明', 6],
  ['webinar-folder-cases', '導入事例', 4],
  ['webinar-folder-seminars', 'セミナー', 5],
  ['webinar-folder-archive', 'アーカイブ', 4],
].map(([id, name, count], index) => ({
  id, kind: 'webinar', name, parentId: null, displayOrder: index, count,
  color: null, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-25T02:00:00.000Z',
}))

export const WEBINAR_FOLDER_SUMMARY = { rows: 5, total: 18 }

/** 機能32 緊急コントロール。設計 `b3HfZ` の通常運用と影響数。 */
const OPERATION_RUNNING_STATES = {
  broadcast_dispatch: 'running',
  scenario_dispatch: 'running',
  reminder_dispatch: 'running',
  automation_actions: 'running',
  auto_reply_dispatch: 'running',
  webhook_outgoing: 'running',
  ad_postback: 'running',
}

export const OPERATION_CONTROL_PREVIEW = {
  control: {
    scopeKey: 'all', lineAccountId: null, version: 8,
    states: OPERATION_RUNNING_STATES, activeIncidentId: null,
    reason: null, actorId: null, stoppedAt: null,
    updatedAt: '2026-08-25T06:00:00+09:00',
  },
  counts: {
    broadcast_dispatch: 1, scenario_dispatch: 4, reminder_dispatch: 10,
    automation_actions: 14, auto_reply_dispatch: 10,
    webhook_outgoing: 0, ad_postback: 0,
  },
  impact: {
    broadcast_dispatch: {
      itemCount: 1, friendCount: 8_486, pendingCount: 1,
      nearestScheduledAt: '2026-08-28T20:00:00+09:00',
    },
    scenario_dispatch: { itemCount: 4, friendCount: 486 },
    reminder_dispatch: { itemCount: 10, friendCount: 12 },
    automation_actions: { itemCount: 14, friendCount: 320, pendingCount: 50 },
    auto_reply_dispatch: { itemCount: 10, friendCount: null },
  },
  permissions: { canControl: true },
  calculatedAt: '2026-08-25T06:00:00+09:00',
}

function operationControlSnapshot({ version, activeIncidentId, reason, actorId, stoppedAt, capturedAt, stoppedCapabilities = [] }) {
  return {
    version,
    states: Object.fromEntries(Object.entries(OPERATION_RUNNING_STATES).map(([capability, state]) => [
      capability,
      stoppedCapabilities.includes(capability) ? 'stopped' : state,
    ])),
    activeIncidentId, reason, actorId, stoppedAt, capturedAt,
  }
}

/** 機能32 更新履歴。設計 `UhC2O` の停止→復旧済み3件。 */
export const OPERATION_HISTORY = [
  {
    id: 'operation-incident-20260824', scopeKey: 'all', lineAccountId: null,
    status: 'resolved', capabilities: ['webhook_outgoing'],
    reason: 'その他', detail: '外部連携の応答遅延を確認するため停止',
    actorId: '佐々木 亮太（管理者・東京）', resolvedByActorId: '佐々木 亮太（管理者・東京）',
    controlVersion: 8,
    stoppedAt: '2026-08-24T18:20:00+09:00', resolvedAt: '2026-08-24T18:52:00+09:00',
    createdAt: '2026-08-24T18:20:00+09:00', updatedAt: '2026-08-24T18:52:00+09:00',
    errorMessage: null,
  },
  {
    id: 'operation-incident-20260612', scopeKey: 'all', lineAccountId: null,
    status: 'resolved',
    capabilities: ['broadcast_dispatch', 'scenario_dispatch', 'reminder_dispatch', 'automation_actions', 'auto_reply_dispatch'],
    reason: '誤配信の防止', detail: '配信条件を確認してから復旧',
    actorId: '山本 京子（管理者・大阪）', resolvedByActorId: '山本 京子（管理者・大阪）',
    controlVersion: 6,
    stoppedAt: '2026-06-12T09:05:00+09:00', resolvedAt: '2026-06-12T09:40:00+09:00',
    createdAt: '2026-06-12T09:05:00+09:00', updatedAt: '2026-06-12T09:40:00+09:00',
    errorMessage: null,
  },
  {
    id: 'operation-incident-20260302', scopeKey: 'line-account-main', lineAccountId: '本店アカウント',
    status: 'resolved', capabilities: ['broadcast_dispatch', 'scenario_dispatch', 'reminder_dispatch'],
    reason: '障害対応', detail: 'LINE側の障害が解消したことを確認して復旧',
    actorId: '佐々木 亮太（管理者・東京）', resolvedByActorId: '佐々木 亮太（管理者・東京）',
    controlVersion: 4,
    stoppedAt: '2026-03-02T14:00:00+09:00', resolvedAt: '2026-03-02T15:10:00+09:00',
    createdAt: '2026-03-02T14:00:00+09:00', updatedAt: '2026-03-02T15:10:00+09:00',
    errorMessage: null,
  },
].map((incident) => ({
  ...incident,
  beforeSnapshot: operationControlSnapshot({
    version: incident.controlVersion - 2, activeIncidentId: null, reason: null,
    actorId: null, stoppedAt: null, capturedAt: incident.createdAt,
  }),
  stoppedSnapshot: operationControlSnapshot({
    version: incident.controlVersion - 1, activeIncidentId: incident.id,
    reason: incident.reason, actorId: incident.actorId, stoppedAt: incident.stoppedAt,
    capturedAt: incident.stoppedAt, stoppedCapabilities: incident.capabilities,
  }),
  restoredSnapshot: operationControlSnapshot({
    version: incident.controlVersion, activeIncidentId: null, reason: null,
    actorId: incident.resolvedByActorId, stoppedAt: null, capturedAt: incident.resolvedAt,
  }),
}))

/**
 * 機能10 ウェビナー。Pencil `ZC13r` の5行を一覧契約の値だけで表す。
 *
 * `status` に型外の「公開予定」「非公開」を入れない。保存状態は従来の
 * draft / active / archived、公開の見え方は `publicationState` で分ける。
 * 申込・視聴の未取得は0で埋めず null にする。
 */
export const WEBINARS = [
  {
    id: 'webinar-1', title: 'NEN活用スタートセミナー', slug: 'nen-start', status: 'active',
    folderId: 'webinar-folder-seminars', folderName: 'セミナー',
    durationSeconds: 2_538, registrationCount: 184, viewerCount: 142,
    publicationState: 'period', publicationStartsAt: '2026-08-01T00:00:00+09:00', publicationEndsAt: '2026-08-31T23:59:59+09:00',
  },
  {
    id: 'webinar-2', title: '予約機能の使い方', slug: 'booking-guide', status: 'active',
    folderId: 'webinar-folder-products', folderName: '商品説明',
    durationSeconds: 1_920, registrationCount: 96, viewerCount: 71,
    publicationState: 'always', publicationStartsAt: null, publicationEndsAt: null,
  },
  {
    id: 'webinar-3', title: 'EC連携 実践講座', slug: 'ec-guide', status: 'draft',
    folderId: 'webinar-folder-cases', folderName: '導入事例',
    durationSeconds: 2_160, registrationCount: 63, viewerCount: null,
    publicationState: 'scheduled', publicationStartsAt: '2026-08-28T20:00:00+09:00', publicationEndsAt: null,
  },
  {
    id: 'webinar-4', title: '顧客対応の自動化', slug: 'support-automation', status: 'draft',
    folderId: 'webinar-folder-seminars', folderName: 'セミナー',
    durationSeconds: 1_800, registrationCount: 0, viewerCount: null,
    publicationState: 'unset', publicationStartsAt: null, publicationEndsAt: null,
  },
  {
    id: 'webinar-5', title: '旧機能説明会', slug: 'legacy-guide', status: 'draft',
    folderId: 'webinar-folder-archive', folderName: 'アーカイブ',
    durationSeconds: 1_500, registrationCount: 85, viewerCount: 99,
    publicationState: 'ended', publicationStartsAt: '2026-07-01T00:00:00+09:00', publicationEndsAt: '2026-07-31T23:59:59+09:00',
  },
].map((webinar) => ({
  accountId: 'visual-qa-account', videoPrefix: `webinars/${webinar.slug}`,
  schedule: [{ type: 'daily', time: '20:00' }],
  cta: { label: '個別相談を予約する', url: 'https://example.com/consultation', showAtSeconds: 1_920 },
  tagOnAttend: '配信済み', tagOnCtaClick: '相談希望',
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-25T02:00:00.000Z',
  ...webinar,
}))

export const WEBINAR_OVERVIEW = {
  state: 'partial', registrationMode: 'people',
  metrics: {
    webinars: { value: 6, state: 'available', reason: null },
    activeWebinars: { value: 3, state: 'available', reason: null },
    registrations: { value: 428, state: 'available', reason: null },
    registrationBookings: { value: 428, state: 'available', reason: null },
    viewers: { value: 312, state: 'available', reason: null },
    viewRate: { value: 0.729, state: 'available', reason: null },
    averageWatchSeconds: { value: null, state: 'unavailable', reason: '一覧では未取得' },
    ctaUniquePeople: { value: 86, state: 'available', reason: null },
    ctaTotalClicks: { value: 86, state: 'available', reason: null },
  },
}

export const WEBINAR_NOTIFICATIONS = {
  settings: {
    webinarId: 'webinar-1', version: 3,
    registrationEnabled: true, dayBeforeEnabled: true, dayBeforeTime: '20:00',
    hourBeforeEnabled: true, hourBeforeMinutes: 60, startEnabled: true,
    missedEnabled: true, missedTime: '10:00', completedEnabled: true,
    updatedAt: '2026-08-25T02:00:00.000Z',
  },
  overview: {
    total: 184, pending: 32, sent: 149, failed: 3, skipped: 0, cancelled: 0,
    audience: { people: 184, bookings: 184, definition: 'active_registrations' },
  },
}

export const WEBINAR_CTAS = [{
  id: 'webinar-cta-1', atSeconds: 1_920, kind: 'form',
  title: '個別相談を予約する', body: '資料の確認や個別相談をご案内します。',
  buttonLabel: '個別相談を予約する', autoOpen: false, formId: 'form-1', url: null,
}]

export const WEBINAR_ACTIONS = [
  { id: 'webinar-action-1', trigger: 'completed', actionType: 'add_tag', config: { tagId: '配信済み' }, position: 0, version: 2 },
  { id: 'webinar-action-2', trigger: 'completed', actionType: 'start_scenario', config: { scenarioId: '相談シナリオ' }, position: 1, version: 2 },
]

export const WEBINAR_ANALYTICS = {
  summary: {
    reservations: 184, viewers: 142, registeredAndJoined: 128, watched5m: 128,
    watched15m: 112, completed: 96, avgWatchedSeconds: 1_722, ctaClicks: 52, formSubmissions: 18,
  },
  daily: [],
  participants: [
    ['friend-1', 'Kenta Kawano', 2_538, '2026-08-25T10:32:00+09:00', true, true],
    ['friend-2', 'Masato S.', 1_980, '2026-08-25T10:28:00+09:00', true, false],
    ['friend-3', '菅野 亮', 1_240, '2026-08-25T10:21:00+09:00', false, false],
    ['friend-4', '山田 太郎', 0, '2026-08-25T10:14:00+09:00', false, false],
  ].map(([friendId, friendName, maxWatchedSeconds, latestJoinedAt, cta, form]) => ({
    friendId, friendName, pictureUrl: null, sessions: 1,
    firstJoinedAt: latestJoinedAt, latestJoinedAt, maxWatchedSeconds,
    ctaClickedAt: cta ? latestJoinedAt : null, registered: true,
    formSubmittedAt: form ? latestJoinedAt : null,
  })),
  sessions: [], dropoff: [],
  formFunnel: {
    ctaImpressions: 96, ctaClicks: 52, formOpens: 41, formStarts: 32,
    submitAttempts: 21, submitSuccesses: 18, submitErrors: 3, fieldCompletions: [],
  },
}

/**
 * 共通情報を**変える前**の確認（`uNBlA` 14-1-B。口は #773）。
 *
 * 削除前の使用先に、保存すると何がどう変わるかを足したもの。
 * `nextValue` は呼ぶ側が入れる。ここでは形と**言い分けの見本**だけを持つ。
 *
 * わざと4通りを混ぜてある。1通りだけだと、画面の書き分けが撮れない：
 *   1. ふつうに変わる行
 *   2. 送信済みで**変わらない**行
 *   3. 差し込みの目印を読み取れず、**保存後の文を作れない**行
 *   4. 上限を超えて、**保存を止める**行
 */
export function commonVarChangeImpact(nextValue) {
  const items = COMMON_VAR_DELETE_IMPACT.items.map((item, index) => {
    const nextPreview = item.currentPreview.replaceAll('株式会社NEN', nextValue)
    const limited = index === 1
    const characterLimit = limited ? 60 : 5000
    const nextCharacterCount = limited ? 66 : nextPreview.length
    return {
      ...item,
      changesOnSave: true,
      previewAvailable: true,
      nextPreview,
      currentCharacterCount: item.currentPreview.length,
      nextCharacterCount,
      characterLimit,
      exceedsCharacterLimit: limited,
      errors: limited ? ['変更後の文が60文字を超えます'] : [],
      warnings: [],
    }
  })
  return {
    variable: {
      id: 'common-var-delete-target', name: '会社名', varKey: 'company_name',
      currentValue: '株式会社NEN', nextValue,
    },
    total: 15,
    blockingTotal: 15,
    historicalTotal: 0,
    unscopedFormTotal: 0,
    canDelete: false,
    byKind: { template: 12, broadcast: 0, scenario: 0, reminder: 0, auto_reply: 0, form: 3, automation: 0, friend_add: 0, common_action: 0 },
    items,
    unavailableReferences: [],
    checkedAt: '2026-09-07T10:00:00.000+09:00',
    errorTotal: items.reduce((sum, item) => sum + item.errors.length, 0),
    warningTotal: items.reduce((sum, item) => sum + item.warnings.length, 0),
    canSave: items.every((item) => item.errors.length === 0),
    recommendedAction: 'fix_errors',
  }
}
