/**
 * 設計と実装を、同じ手順で撮る。
 *
 * 撮り方は `screens.mjs` に**データとして**書いてある。機能を増やすときは
 * あちらに行を足すだけで、ここは触らない。
 *
 * 使い方
 *   node scripts/visual-qa/capture-screens.mjs --feature 1 --impl
 *   node scripts/visual-qa/capture-screens.mjs --feature 4 --impl --only QKx8Q,XBkiQ
 *   node scripts/visual-qa/capture-screens.mjs --feature 1 --design --from <書き出したhtmlの置き場>
 *   node scripts/visual-qa/capture-screens.mjs --check
 *
 * 先に用意しておくもの（`--impl` のとき）
 *   node scripts/visual-qa/mock-api.mjs &
 *   NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web dev &
 *
 * 設計側は Pencil の `Export(id, "html-css", …)` で書き出したHTMLを渡す。
 * **`png` 書き出しは使えない**（砂嵐になる）。
 */
import { chromium } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { SCREENS, CAPTURED_AT, DESIGN_SIZE, WIDTHS, screensOf } from './screens.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE = process.env.VISUAL_QA_BASE ?? 'http://localhost:3101'

/**
 * Pencil から書き出した設計HTMLの置き場。機能ごとに `f7/` `f8/` と分ける。
 * リポジトリの外に置くので、場所は `V6_DESIGN_REF` で渡せる。
 */
const DESIGN_REF = process.env.V6_DESIGN_REF ?? join(ROOT, '..', '..', 'v6-design-ref')
const designDirOf = (feature) => join(DESIGN_REF, `f${feature}`)

/**
 * 設計の大きさは**書き出したHTMLから読む。** 台帳へ手で書き写すと、
 * 262枚のどこかで必ず1枚ずれる。ずれた高さで撮った絵を実装と並べると、
 * **実装のせいに見える差**が出る。Pencil の書き出しは根の div に
 * `width: 1920px; height: 1080px` を持っているので、そこが正。
 */
function sizeFromHtml(src) {
  const head = readFileSync(src, 'utf8').slice(0, 4000)
  const at = head.indexOf('data-pencil-name')
  if (at < 0) return null
  const style = head.slice(at, at + 1200)
  const w = /width:\s*(\d+)px/.exec(style)
  const h = /height:\s*(\d+)px/.exec(style)
  return w && h ? [Number(w[1]), Number(h[1])] : null
}

/**
 * 画面が落ちたときに出る文言。出ていたら撮らない。
 *
 * **「画面を表示できませんでした」はここに置かない。** 反映履歴の本文にも
 * 出るので（運用状態の更新履歴タブがそれを並べる）、文字だけでは
 * 見分けられない。落ちた画面は下の `retry` で見る。
 */
const FAILURE_TEXTS = ['店舗が選ばれていません', 'Application error']

/**
 * **描き損なった値。出ていたら撮らない。**
 *
 * `undefined` / `Invalid Date` / `NaN` が画面に出るのは、返事に無い項目を
 * そのまま文へ繋いだときです。**そのまま撮ると、その絵を設計と並べて
 * 「実装の不具合」と言ってしまう**か、逆に見落とします。実際に一斉配信の
 * 帯（`予約中 undefined`）と結果（`1通（undefined）`『Invalid Date 作成』）、
 * シナリオの到達率（`NaN%`）で、どちらも起きました。
 *
 * **原因は2つあり、どちらでも撮らないのが正しい。**
 *   - 固定データを用意していない（こちらの落ち）
 *   - 実装が欠けた項目を守っていない（実装の落ち）
 *
 * 止めれば、どちらなのかを調べてから進めます。
 */
const BROKEN_VALUES = ['undefined', 'Invalid Date', 'NaN']

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

/** 台帳の行が撮り方を持っているか。**黙って抜けたまま進まないための検査。** */
/** 設計の総数。**ここが動いたら、必ず誰かが行を足し引きしている。** */
const TOTAL_SCREENS = 262

function check() {
  const problems = []
  const seen = new Set()
  if (SCREENS.length !== TOTAL_SCREENS) {
    problems.push(`総数が ${SCREENS.length} 件（${TOTAL_SCREENS} 件のはず）`)
  }
  for (const s of SCREENS) {
    if (seen.has(s.node)) problems.push(`${s.node}: 二重に書いてある`)
    seen.add(s.node)
    if (!s.dir) problems.push(`${s.node}: dir が無い`)
    if (['unimplemented', 'unconfirmed', 'elsewhere'].includes(s.status)) {
      if (!s.why) problems.push(`${s.node}: ${s.status} なのに理由が無い`)
      /* **未実装を一致にできない。** 撮っていないものを合格として数えない。 */
      if (s.status === 'unimplemented' && s.verdict === 'match') {
        problems.push(`${s.node}: 未実装なのに verdict が match`)
      }
      continue
    }
    if (s.status && !['unimplemented', 'unconfirmed', 'elsewhere'].includes(s.status)) {
      problems.push(`${s.node}: 知らない status（${s.status}）`)
    }
    /*
      判定（`verdict`）の検査。**実装の状態（`status`）とは別**に持つ。
      「撮れた」と「合っていた」は違う。**空欄を一致として数えない。**
    */
    if (!s.verdict) {
      problems.push(`${s.node}: 比較済みなのに verdict が無い（未判定）`)
    } else if (!VERDICTS.includes(s.verdict)) {
      problems.push(`${s.node}: 知らない verdict（${s.verdict}）`)
    } else {
      if (!s.verdictSource) problems.push(`${s.node}: verdict の出どころ（verdictSource）が無い`)
      /* データ未接続は、**何が繋がっていないか**を書く。 */
      if (s.verdict === 'structure_match_data_pending' && !s.verdictNote) {
        problems.push(`${s.node}: 構造一致・データ未接続なのに、未接続の中身が書いていない`)
      }
      /* 要修正は、**P0/P1/P2 か参照先**を残す。 */
      if (s.verdict === 'needs_fix') {
        const ok = /P[012]/.test(s.verdictNote ?? '') || /\.md/.test(s.verdictSource ?? '')
        if (!ok) problems.push(`${s.node}: 要修正なのに P0/P1/P2 も参照先も無い`)
      }
    }
    if (!s.route || s.route === '—') problems.push(`${s.node}: route が無い`)
    if (!['page', 'viewport'].includes(s.mode)) problems.push(`${s.node}: mode が page/viewport ではない`)
    if (s.mode === 'viewport' && !s.height) problems.push(`${s.node}: viewport なのに height が無い`)
    /* 設計の大きさは書き出したHTMLから読む。無いときだけ台帳の値を使う。 */
    if (!DESIGN_SIZE[s.node] && !existsSync(join(designDirOf(s.feature), `${s.node}.html`))) {
      problems.push(`${s.node}: 設計HTMLも大きさの控えも無い`)
    }
  }
  /*
    **数え上げは、落ちるときにも出す。** 出さないと「あと何枚か」が
    分からないまま止まり、直す手がかりが消える。
  */
  const byFeature = {}
  for (const s of SCREENS) byFeature[s.feature] = (byFeature[s.feature] ?? 0) + 1
  console.log(`${SCREENS.length}件。機能ごと: ` + Object.entries(byFeature).map(([k, v]) => `${k}=${v}`).join(' '))

  /* 判定の内訳。**「完了まで残り」は、一致以外の全部。** */
  const tally = { match: 0, structure_match_data_pending: 0, needs_fix: 0, unjudged: 0, unimplemented: 0 }
  for (const s of SCREENS) {
    if (s.status === 'unimplemented') { tally.unimplemented += 1; continue }
    if (s.status) continue
    if (s.verdict && VERDICTS.includes(s.verdict)) tally[s.verdict] += 1
    else tally.unjudged += 1
  }
  const left = tally.structure_match_data_pending + tally.needs_fix + tally.unimplemented + tally.unjudged
  console.log(
    `判定: 一致 ${tally.match} ／ 構造一致・データ未接続 ${tally.structure_match_data_pending}`
    + ` ／ 要修正 ${tally.needs_fix} ／ 未実装 ${tally.unimplemented} ／ 未判定 ${tally.unjudged}`
    + ` ／ **完了まで残り ${left}**`,
  )

  /*
    **判定したときの head が変わっていたら、もう一度見る。**
    `CAPTURED_AT` に新しい head が入っているのに `verdictHead` が古いままなら、
    その画面の判定は古い実装に対するものです。
  */
  const stale = []
  for (const s of SCREENS) {
    if (!s.verdictHead) continue
    const entries = (CAPTURED_AT[s.feature] ?? []).filter((e) => !e.screens || e.screens.includes(s.node))
    const latest = entries.at(-1)
    if (latest && latest.head && !latest.head.startsWith(s.verdictHead) && !s.verdictHead.startsWith(latest.head)) {
      stale.push(`${s.node}: 判定は ${s.verdictHead}、いまの撮った先は ${latest.head}`)
    }
  }
  if (stale.length) console.log('head が変わったので見直す:\n  ' + stale.join('\n  '))

  /*
    **`*` は `/` をまたがない。**
    `**' + '/api/friends*` は `/api/friends/stats` に当たりません。当たらない
    まま状態を撮ると、一覧が読めていないのに**帯だけ前の数が残る**、
    起きない絵になります。機能3と機能6と機能12で実際に起きました。

    モックが答える道を読み、当てはめの前置きの先に `/` で続く道があるのに
    `/**` で受けていないものを挙げます。
  */
  const mockSrc = readFileSync(new URL('./mock-api.mjs', import.meta.url), 'utf8')
  const mockPaths = new Set()
  for (const m of mockSrc.matchAll(/'(\/api\/[^']+)'/g)) mockPaths.add(m[1])
  for (const m of mockSrc.matchAll(/\/\^\\\/api\\\/([^$]+)\$\//g)) {
    mockPaths.add('/api/' + m[1].replace(/\\\//g, '/').replace(/\(\?!stats\$\)/g, '').replace(/\(\[\^\/\]\+\)/g, ':id'))
  }
  const globGaps = []
  for (const s of SCREENS) {
    const globs = s.states?.apis ?? []
    for (const g of globs) {
      const m = g.match(/^\*\*(\/api\/[^*?]*?)\/?\*$/)
      if (!m) continue
      const prefix = m[1]
      if (globs.some((other) => other === `**${prefix}/**`)) continue
      const missed = [...mockPaths].filter((path) => path.startsWith(`${prefix}/`))
      if (missed.length) globGaps.push(`${s.node}: ${g} が ${missed[0]} に届かない（\`**${prefix}/**\` も足す）`)
    }
  }
  if (globGaps.length) problems.push(...globGaps)

  if (problems.length) {
    console.error('\n撮り方がそろっていません:\n  ' + problems.join('\n  '))
    process.exit(1)
  }
}

async function newPage(browser, width, height, clock) {
  /*
    **日本時間で撮る。** 撮る機械の時計帯そのままだと、設計の「14:16」が
    「12:16」になる。設計は日本時間で描かれているので、ここを合わせないと
    時刻の入る画面すべてが「差がある」ように見える。
  */
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
    timezoneId: 'Asia/Tokyo',
    locale: 'ja-JP',
  })
  /*
    相対時刻（「6日前」）は `Date.now()` から出る。止めないと**日をまたぐ
    たびに絵が変わり**、基準画像として使えない。
  */
  if (clock) await page.clock.setFixedTime(new Date(clock))
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('lh_auth_selection_cleared', '1')
      window.localStorage.setItem('lh_selected_account', 'visual-qa-account')
    } catch {
      // ストレージが使えない環境では何もしない
    }
  })
  return page
}

/**
 * `steps` を順に実行する。**押せなかったら黙って進まない。**
 *
 * 押せない理由はたいてい「固定データが空で、その行やボタンがそもそも
 * 描かれていない」。そのまま撮ると**空の絵を設計と並べて「差がある」と
 * 言ってしまう**ので、ここで止めて、何が何件見えているかを一緒に出す。
 */
async function runSteps(page, steps = [], node = '') {
  for (const step of steps) {
    if (step.wait) { await page.waitForTimeout(step.wait); continue }
    if (step.fill !== undefined) {
      /*
        入力してから撮る状態（保存した検索の名前など）。
        **名札の無い入れ物もある。** 配信の本文は `textarea` で、
        `getByLabel` では引けない。`selector: true` のときは CSS で引く。
      */
      const box = step.selector ? page.locator(step.fill).first() : page.getByLabel(step.fill)
      await box.fill(step.text ?? '')
      await page.waitForTimeout(step.after ?? 300)
      continue
    }
    if (step.select !== undefined) {
      /*
        選ぶ入れ物（`components/shared/select.tsx`）。

        **これは `<select>` ではない。** 見た目をそろえるために、
        `aria-label` を持つボタンと `role="listbox"` の一覧で作ってある。
        `selectOption` は効かないので、**開いてから選ぶ**。

        選ぶときは画面に出ている言葉で書く。値のほうは `bs-1` のような
        内部の id で、人の言葉ではない。
      */
      await page.getByRole('button', { name: step.select }).first().click({ timeout: 15_000 })
      await page.waitForTimeout(200)
      await page.getByRole('option', { name: step.label, exact: true }).first()
        .click({ timeout: 15_000 })
      await page.waitForTimeout(step.after ?? 500)
      continue
    }
    const root = step.scope === 'main' ? page.locator('main') : page
    /*
      **押せるものが操作の役を持っているとは限らない。** 表の行に
      `onClick` を付けただけのものは `button` でも `link` でもないので、
      名前で引けない。`role: 'text'` のときは文字そのもので探す。
    */
    const target = step.role === 'text'
      ? root.getByText(step.click, { exact: false })
      : root.getByRole(step.role ?? 'button', { name: step.click })
    const one = step.nth === undefined ? target.first() : target.nth(step.nth)
    if (step.onlyIfOff && (await one.getAttribute('aria-checked')) === 'true') continue
    try {
      await one.click({ timeout: 15_000 })
    } catch {
      const found = await target.count()
      throw new Error(
        `${node}: 「${step.click}」を押せませんでした（見つかった数 ${found}`
        + `${step.nth === undefined ? '' : `、${step.nth + 1}番目が要る`}）。`
        + '固定データが空で、その行やボタンが描かれていないことが多いです。'
        + ' モックの返事を確かめてください。',
      )
    }
    await page.waitForTimeout(step.after ?? 800)
  }
}

/**
 * 一覧の3状態を作る差し替え。
 *
 * 設計はどの一覧にも「読み込んでいます／まだ〜がありません／表示できませんでした」の
 * 3枚を並べています。**この3つを言い分けられるかどうか**が見どころで、
 * 「1件も無い」と「読めなかった」に同じ文が出ると、運用する人からは
 * 「登録したものが消えた」ように見えます。
 */
const LIST_STATES = {
  empty: { status: 200, body: { success: true, data: [] } },
  error: { status: 500, body: { success: false, error: 'internal error' } },
  forbidden: { status: 403, body: { success: false, error: 'forbidden' } },
}

/**
 * 「1件も無い」ときの返事は、口によって形が違う。
 *
 * **一覧の口だけが配列。** 上の帯を出す口は通で、`[]` を返すと
 * `s.reminders.total` のような読み方で**画面ごと落ちます**（実際に落とした）。
 * 落ちた絵を「空の状態」として撮ると、実装が空を描けないように見えます。
 *
 * 当てはまる順に見て、最初に当たったものを使います。
 */
/** 判定の3種類。**実装の状態（`status`）とは別に持つ。** */
const VERDICTS = ['match', 'structure_match_data_pending', 'needs_fix']

const EMPTY_BODIES = [
  /*
    マイルの使い道。**一覧の既定（配列）を返すと落ちる。**
    画面は `rewards` と `summary` を読む。数はすべて0（取れて0件）だが、
    **まだ数えていない `neverRedeemedFriendCount` だけは `null`** のまま。
  */
  [/\/api\/mileage\/rewards/, {
    rewards: [],
    summary: {
      publishedCount: 0, redeemedMilesThisMonth: 0,
      neverRedeemedFriendCount: null,
      mostRedeemedRewardName: null, mostRedeemedRewardCount: null,
    },
  }],
  /*
    外部連携のやり取り。**一覧の既定（配列）を返すと落ちる。**
    画面は `summary` と `items` を読む。数はすべて0（取れて0件）。
  */
  [/\/api\/webhooks\/interactions/, {
    summary: { total: 0, outgoing: 0, incoming: 0, succeeded: 0, failed: 0, averageDurationMs: null },
    items: [], total: 0, page: 1, limit: 20,
  }],
  /*
    友だち追加時の実行結果。**一覧の既定（配列）を返すと落ちる。**
    画面は `data.items.length` を読むので、`items` の無い返事だと
    「もう一度試す」の画面になる。型は `FriendAddEventList`。
  */
  [/\/api\/friend-add-routing\/events/, { items: [], nextCursor: null }],
  /*
    帯の口。**一覧の既定を返すと `summary.inUse` が無く、
    「使用中 undefined件」と撮れる。** 型は `FriendFieldListSummary`。
    `formLinks` は空でも `null`（未取得）ではなく **0（実値）** を返す。
    0件の一覧なら、繋がっているフォームも本当に0件だから。
  */
  /*
    行動スコア。**一覧の既定（配列）を返すと落ちる。**
    型は `ActionScoreOverview`（`summary` / `items` / `pagination`）。
    層の数も**0で埋める**。空は「取れて0件」なので `—` にしない。
  */
  [/\/api\/action-scores\/friends/, {
    summary: { scoredFriends: 0, high: 0, normal: 0, low: 0, decreased30d: 0, highMin: 70, normalMin: 40 },
    items: [],
    pagination: { total: 0, limit: 20, offset: 0 },
  }],
  /*
    行動スコアのルール（PR #496）。**一覧の既定（配列）を返すと画面が空白になる。**
    型は `ActionScoreRuleConfiguration`。

    **実装の「未設定」とは違う姿です。** 実装の `not_configured` は
    `DEFAULT_RULES` 7件を返します（`packages/db/src/action-score-rules.ts`）。
    ここで撮るのは**ルールを全部消した下書き**、つまり
    「公開するには1件以上要る」と出る面です。
  */
  /*
    リマインダの実行結果（PR #500）。**一覧の既定（配列）を返すと落ちる。**
    型は `ReminderDeliveryRunsResponse`。まとめの数も**0で埋める**。
    空は「取れて0件」なので `—` にしない。
    **`openRate` は `null` のまま。** 既読は取れないので0%を作らない。
  */
  /*
    自動応答の実行結果（`t7UtYQ`）。**空は「取れて0件」。**
    まとめの数は0で埋め、**平均応答と最終実行だけ `null`**
    （数えていないものを 0.0秒 と書かせない）。
  */
  /*
    オートメーションの実行結果（`DkPY0`）。**空は「取れて0件」。**
    いちばん多いものだけ `null`（並べる元が無いので0件と書かせない）。
  */
  [/\/api\/automation-runs/, {
    summary: { total: 0, executed: 0, skipped: 0, failed: 0, mostRunName: null, mostRunCount: null },
    items: [],
    pagination: { total: 0, limit: 20, offset: 0 },
  }],
  [/\/api\/auto-reply-runs/, {
    rule: { id: 'rule-a', name: '予約問い合わせ', isActive: true, priorityPosition: 1 },
    summary: { monthHits: 0, totalHits: 0, handovers: 0, errors: 0, lastRunAt: null, averageResponseMs: null },
    handovers: { waiting: 0, inProgress: 0, completed: 0 },
    triggerBreakdown: [],
    items: [],
    pagination: { total: 0, limit: 20, offset: 0 },
  }],
  [/\/api\/reminders\/[^/]+\/runs/, {
    reminder: { id: 'reminder-1', name: 'Google Meet相談リマインダ', isActive: true },
    summary: { sent: 0, scheduled: 0, stopped: 0, errors: 0, targetCount: 0, nextScheduledAt: null },
    steps: [],
    items: [],
    pagination: { total: 0, limit: 20, offset: 0 },
  }],
  [/\/api\/action-scores\/rules\?/, {
    configured: false,
    status: 'not_configured',
    currentDraftVersionId: null,
    currentPublishedVersionId: null,
    editableVersion: {
      id: null, versionNumber: 1, status: 'draft', createdAt: null, publishedAt: null,
      rules: [], bands: { min: 0, max: 100, normalMin: 30, highMin: 70 },
    },
    publishedVersion: null,
  }],
  [/\/api\/friend-fields-stats/, {
    total: 0, inUse: 0, registeredFriends: 0, formLinks: 0, updatedThisMonth: 0,
  }],
  [/\/api\/list-stats/, {
    tags: { total: 0, unused: 0, taggedFriends: 0, assignedThisMonth: 0 },
    marks: { total: 0, inUse: 0, unanswered: 0, inProgress: 0, resolved: 0, changedLast7: 0 },
    searches: { total: 0, limit: 5 },
    templates: { total: 0, inUse: 0, sentThisMonth: 0, unused90d: 0, clickRate: null },
    scenarios: { total: 0, active: 0, subscribers: 0, completed: 0, sentThisWeek: 0 },
    reminders: { total: 0, active: 0, waiting: 0, sentThisMonth: 0, failed: 0 },
  }],
  [/\/api\/mileage\/overview/, {
    summary: { totalMembers: 0, totalAvailable: 0, activeMembers30d: 0, totalActions: 0, queuedEvents: 0 },
    members: [],
    pagination: { total: 0, limit: 20, offset: 0 },
  }],
  [/\/api\/nen-campaigns\/overview/, {
    activeCampaigns: 0, jobs: { total: 0, pending: 0, sent: 0, failed: 0 },
    columns: 0, pets: 0, coupons: 0,
  }],
  [/\/api\/analytics\/ref-summary/, {
    routes: [], totalFriends: 0, friendsWithRef: 0, friendsWithoutRef: 0,
  }],
  [/\/api\/friend-stats/, {
    active: 0, total: 0, blockedByThem: 0, hiddenByUs: 0,
    unanswered: 0, resolved: 0, addedThisMonth: 0, addedLastMonth: 0,
  }],
  /* 友だちの一覧はページ送りつき。配列で返すと画面ごと落ちる。 */
  [/\/api\/friends(\?|$)/, { items: [], total: 0, page: 1, limit: 20 }],
  [/\/api\/rich-menu-groups\/(external|tap-stats)/, null],
]

/**
 * `{success,data}` で包まない口。**予約とイベントはそれぞれ別の名前で返す。**
 * 包んで返すと画面が読めず、空の状態のつもりで落ちた絵を撮ってしまう。
 */
const BARE_EMPTY = [
  /*
    顧客へのお知らせの記録。**`pagination` は `data` の外にある**
    （型は `ApiResponse<EcNotificationRunList> & { pagination }`）ので、
    包まずにそのまま返す。包むと `response.pagination.total` で落ちて
    **空のはずが失敗の面になる。** 実際そうなった。
    帯の数は**すべて0**（数えて0）。`coverage` は型どおり、
    できないことを `false` のままにする。
  */
  [/\/api\/ec-commerce\/notification-runs/, {
    success: true,
    data: {
      items: [],
      summary: { accepted: 0, failed: 0, excluded: 0, pending: 0 },
      coverage: {
        source: 'current_ec_events',
        unassignedHistoricalRowsExcluded: true,
        attemptHistoryAvailable: false,
        retryAvailable: false,
      },
    },
    pagination: { total: 0, limit: 20, offset: 0 },
  }],
  [/\/api\/booking\/admin\/menus/, { menus: [] }],
  [/\/api\/booking\/admin\/staff/, { staff: [] }],
  [/\/api\/booking\/admin\/requests/, { requests: [] }],
  [/\/api\/events\/admin\/events/, { items: [] }],
]

/** その口の「空」の返事を組み立てる。`null` なら差し替えない（そのまま通す）。 */
function emptyBodyFor(url) {
  for (const [pattern, body] of BARE_EMPTY) {
    if (pattern.test(url)) return body
  }
  for (const [pattern, data] of EMPTY_BODIES) {
    if (pattern.test(url)) return data === null ? null : { success: true, data }
  }
  return { success: true, data: [] }
}

/** 口を差し替える。`loading` は返事を遅らせて、待っている絵にする。 */
async function applyState(page, apis, kind) {
  for (const glob of apis) {
    if (kind === 'loading') {
      /* **止めるのではなく遅らせる。** 止めると画面が失敗として扱う。 */
      await page.route(glob, async () => { await new Promise(() => {}) })
      continue
    }
    const state = LIST_STATES[kind]
    await page.route(glob, (route) => {
      /* 空のときだけ、口ごとの形に合わせる。エラーはどの口でも同じ。 */
      const body = kind === 'empty' ? emptyBodyFor(route.request().url()) : state.body
      if (body === null) return route.continue()
      return route.fulfill({
        status: state.status,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(body),
      })
    })
  }
}

/**
 * 出ている状態を名前で読む。**絵だけ見ると、別の状態でも気づけない。**
 * 共通部品（`components/shared/list-state.tsx`）が `data-list-state` を
 * 付ける。付いていない画面は、状態を名前で言えていない。
 */
async function readListState(page) {
  return page
    .locator('[data-list-state]')
    .first()
    .getAttribute('data-list-state', { timeout: 2_000 })
    .catch(() => null)
}

/**
 * 撮る対象を絞る。`--only QKx8Q,XBkiQ`
 *
 * **1つの機能が複数のPRに分かれていることがある。** 機能4は #420（友だち
 * 情報欄）と #421（保存した検索）が別々に進んでいて、#421 は #420 を
 * 含まない。**片方の head で機能4を丸ごと撮り直すと、もう片方で直った絵が
 * 直る前に戻る。一度それをやった。**
 *
 * 直したPRのheadで確かめるときは、**そのPRが触った画面だけ**を撮る。
 */
function onlyFilter(list) {
  const raw = value('only')
  if (!raw) return list
  const want = new Set(raw.split(',').map((x) => x.trim()).filter(Boolean))
  const picked = list.filter((s) => want.has(s.node))
  const missing = [...want].filter((n) => !picked.some((s) => s.node === n))
  if (missing.length) {
    console.error(`--only に書いた Node が この機能にありません: ${missing.join(', ')}`)
    process.exit(1)
  }
  return picked
}

async function captureImpl(feature) {
  const list = onlyFilter(screensOf(feature))
  if (!list.length) { console.error(`機能${feature} の画面が screens.mjs にありません`); process.exit(1) }
  const browser = await chromium.launch()
  let shot = 0
  /*
    **1枚目で止めない。** 17枚ある機能で最初の1枚が撮れないたびに止まると、
    残り16枚の状態が分からないまま直しに入ることになる。撮れなかったものを
    ためて、最後にまとめて出す。**黙って飛ばすのではなく、必ず一覧にする。**
  */
  const failures = []
  for (const s of list) {
    if (s.status === 'unimplemented') {
      console.log(`${s.node}\t未実装のため撮らない\t${s.why}`)
      continue
    }
    if (s.status === 'elsewhere') {
      /*
        **別の仕掛けで撮っているもの。** CSV取り込みのように、ファイルを
        選ばせたり口の返事を細かく作り込む必要があるものは
        `capture.spec.mjs` が撮っている。**ここで二重に撮らない。**
        台帳から消すと「見ていない」ように見えるので、行は残す。
      */
      console.log(`${s.node}\t別の仕掛けで撮っている\t${s.why}`)
      continue
    }
    if (s.status === 'unconfirmed') {
      /*
        **「押せない」と「無い」は別。** 押せる場所は見つかったが無効の
        ままだった、というだけで「実装が無い」と書くと、あとで直す人が
        探す場所を間違える。分けて出す。
      */
      console.log(`${s.node}\t未確認のため撮らない\t${s.why}`)
      continue
    }
    const out = join(ROOT, 'docs', 'design-qa', s.dir)
    mkdirSync(out, { recursive: true })
    /*
      **状態のある画面は、状態のぶんだけ撮る。** 設計は3つを1枚に並べるが、
      実装は1度に1つしか出せないので、1つずつ撮って並べて比べる。
    */
    const shots = s.states
      ? s.states.kinds.map((kind) => ({ kind, suffix: `-${kind}` }))
      : [{ kind: null, suffix: '' }]
    /*
      **同じ画面の、押した先も撮る。** 取り消しの確認窓のように、
      口の差し替え（`states`）では作れず、押して初めて出るものがある。
      別の行を足すと設計の枚数（262）が動いてしまうので、
      **1つの行に枝を生やす**形にする。
    */
    if (s.variants) {
      for (const v of s.variants) shots.push({ kind: null, suffix: v.suffix, steps: v.steps, mode: v.mode })
    }
    for (const width of WIDTHS) {
     for (const shotSpec of shots) {
      const page = await newPage(browser, width, s.mode === 'viewport' ? s.height : 1080, s.clock)
      try {
        /*
          `'normal'` は口を差し替えない。**ふつうの絵も同じ行から撮る**ため。
          別の行にすると、状態の絵と本体の絵が別々のheadになりうる。
        */
        if (shotSpec.kind && shotSpec.kind !== 'normal') {
          await applyState(page, s.states.apis, shotSpec.kind)
        }
        await page.goto(`${BASE}${s.route}`, {
          /* 読み込み中は返事が来ないので `networkidle` を待てない。 */
          waitUntil: shotSpec.kind === 'loading' ? 'domcontentloaded' : 'networkidle',
          timeout: 120_000,
        })
        await page.waitForTimeout(1200)

        // 行き先を必ず見る。**クエリまで見る**（タブは `?tab=` でしか区別できない）。
        const url = new URL(page.url())
        const landed = url.pathname + url.search
        if (landed !== s.route) throw new Error(`${s.route} から ${landed} へ飛ばされた`)
        const body = await page.locator('body').innerText()
        /*
          **文字だけで見分けない。** 「LINEでログイン」は説明文にも出る
          （`/staff/new` の「3. 連携完了後はLINEでログイン」）。**押せる形**で
          在るかどうかで見る。ログイン画面はそれをボタンとして出す。
        */
        const loginButton = await page
          .getByRole('button', { name: 'LINEでログイン' })
          .count()
          .catch(() => 0)
        if (loginButton > 0) throw new Error('ログイン画面になっている')
        /* 落ちた画面（`global-error.tsx`）。押せる「もう一度試す」で見る。 */
        const retry = await page
          .getByRole('button', { name: 'もう一度試す' })
          .count()
          .catch(() => 0)
        if (retry > 0 && body.includes('画面を表示できませんでした')) {
          throw new Error('画面が落ちている（もう一度試す が出ている）')
        }
        /*
          **落ちた画面をそのまま撮らない。** 受信箱で会話を開いたとき、
          右の顧客情報が `mileage.summary.programName` で落ち、画面が
          「もう一度試す」だけになっていた。それでも撮影は成功していて、
          設計と並べる直前まで気づけなかった。
        */
        for (const bad of FAILURE_TEXTS) {
          if (body.includes(bad)) throw new Error(`「${bad}」で止まっている`)
        }
        /*
          **描き損なった値が出ていたら撮らない。**
          `NaN` は「NaN%」のように単語の途中でも出るので、そのまま含みで見る。
          `undefined` と `Invalid Date` も同じ。
        */
        for (const broken of BROKEN_VALUES) {
          if (body.includes(broken)) {
            throw new Error(`画面に「${broken}」が出ている（返事に無い項目をそのまま繋いでいる。固定データか実装のどちらかを直してから撮る）`)
          }
        }

        await runSteps(page, shotSpec.steps ?? s.steps, s.node)
        /*
          **操作したあとに、もう一度落ちていないか見る。**

          開いた直後の検査だけでは、**押してから落ちた画面**を捕まえられない。
          `Ho8z4`（通知タブ）と `jwrbf`（成果内訳）で実際に素通りし、
          「画面を表示できませんでした」の絵を撮っていた。
        */
        const afterSteps = await page.locator('body').innerText()
        const retryAfter = await page
          .getByRole('button', { name: 'もう一度試す' })
          .count()
          .catch(() => 0)
        if (retryAfter > 0 && afterSteps.includes('画面を表示できませんでした')) {
          throw new Error('操作したあとに画面が落ちている（もう一度試す が出ている）')
        }
        await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' })

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )
        await page.screenshot({
          path: join(out, `${s.node}${shotSpec.suffix}-${width}.png`),
          /*
            **窓は画面いっぱいでは撮らない。** `fixed` の窓を `fullPage` で
            撮ると、長い本文の下端へ押し出されて、実際の見え方と違う絵になる。
          */
          fullPage: (shotSpec.mode ?? s.mode) === 'page',
        })
        /*
          **絵の隣に、写っている文字も置く。**

          内部の言葉が出ていないか、未取得が `0件` になっていないか、
          失敗のときに空の文が出ていないか——**確かめたいことの多くは
          文字で足りる。** 絵を1枚読むより桁違いに安いので、
          まず `grep` で見て、置き場や列の切れなど**目でしか分からない
          ことだけ絵を開く**。

          1920px のときだけ書く（1440と中身は同じで、置き場だけが違う）。
        */
        if (width === 1920) {
          /* 左のメニューと上の帯は毎回同じなので落とす。本文だけ残す。 */
          const text = await page.locator('main').first().innerText()
            .catch(() => page.locator('body').innerText())
          writeFileSync(join(out, `${s.node}${shotSpec.suffix}.txt`), text, 'utf-8')
        }
        /*
          **どの状態が出ているかを名前で言えるか**も一緒に記録する。
          共通部品を使っていない画面は `—` になる。それ自体が結果。
        */
        const marked = shotSpec.kind ? (await readListState(page)) ?? '—' : ''
        const tail = shotSpec.kind ? `\t${shotSpec.kind}→${marked}` : ''
        console.log(`${s.node}${shotSpec.suffix}\t${width}px\t撮影OK\tはみ出し=${overflow}${tail}`)
        if (overflow >= 2) console.log(`  ⚠ ${s.node} ${width}px に横スクロールが出ている`)
        shot += 1
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        console.log(`${s.node}${shotSpec.suffix}\t${width}px\t撮れず\t${reason.split('\n')[0]}`)
        failures.push(`${s.node}${shotSpec.suffix} ${width}px: ${reason.split('\n')[0]}`)
      } finally {
        await page.close()
      }
     }
    }
  }
  await browser.close()
  console.log(`\n実装 ${shot}枚`)
  if (failures.length) {
    console.log(`\n撮れなかったもの ${failures.length}件:`)
    for (const f of failures) console.log(`  ${f}`)
    process.exitCode = 1
  }
}

async function captureDesign(feature, from) {
  const dir = from ?? designDirOf(feature)
  if (!existsSync(dir)) {
    console.error(`設計HTMLの置き場が無い: ${dir}\n  --from で渡すか V6_DESIGN_REF を設定してください`)
    process.exit(1)
  }
  const list = onlyFilter(screensOf(feature))
  const browser = await chromium.launch()
  let shot = 0
  for (const s of list) {
    const src = join(dir, `${s.node}.html`)
    if (!existsSync(src)) { console.log(`${s.node}\tHTMLが無い（Pencilから書き出してください）`); continue }
    const size = sizeFromHtml(src) ?? DESIGN_SIZE[s.node]
    if (!size) { console.log(`${s.node}\t大きさが読めない`); continue }
    const [w, h] = size
    const out = join(ROOT, 'docs', 'design-reference', s.dir)
    mkdirSync(out, { recursive: true })
    const page = await newPage(browser, w, h)
    await page.goto(pathToFileURL(src).href, { waitUntil: 'load' })
    try { await page.evaluate(() => document.fonts.ready) } catch { /* 埋め込みフォントのみのときは何もしない */ }
    await page.waitForTimeout(1200)
    await page.screenshot({ path: join(out, `${s.node}.png`), fullPage: true })
    console.log(`${s.node}\t${w}x${h}\t設計を描画`)
    await page.close()
    shot += 1
  }
  await browser.close()
  console.log(`設計 ${shot}枚`)
}

if (flag('check')) {
  check()
} else if (flag('design')) {
  await captureDesign(value('feature'), value('from'))
} else if (flag('impl')) {
  await captureImpl(value('feature'))
} else {
  console.error('--check / --design / --impl のどれかを渡してください')
  process.exit(1)
}
