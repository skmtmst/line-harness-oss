/**
 * 設計と実装を、同じ手順で撮る。
 *
 * 撮り方は `screens.mjs` に**データとして**書いてある。機能を増やすときは
 * あちらに行を足すだけで、ここは触らない。
 *
 * 使い方
 *   node scripts/visual-qa/capture-screens.mjs --feature 1 --impl
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { SCREENS, DESIGN_SIZE, WIDTHS, screensOf } from './screens.mjs'

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

/** 画面が落ちたときに出る文言。出ていたら撮らない。 */
const FAILURE_TEXTS = [
  '画面を表示できませんでした',
  '店舗が選ばれていません',
  'Application error',
  'Runtime TypeError',
  'Runtime Error',
]

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

/** 台帳の行が撮り方を持っているか。**黙って抜けたまま進まないための検査。** */
function check() {
  const problems = []
  const seen = new Set()
  for (const s of SCREENS) {
    if (seen.has(s.node)) problems.push(`${s.node}: 二重に書いてある`)
    seen.add(s.node)
    if (!s.dir) problems.push(`${s.node}: dir が無い`)
    if (s.status === 'unimplemented' || s.status === 'unconfirmed') {
      if (!s.why) problems.push(`${s.node}: ${s.status} なのに理由が無い`)
      continue
    }
    if (s.status && !['unimplemented', 'unconfirmed'].includes(s.status)) {
      problems.push(`${s.node}: 知らない status（${s.status}）`)
    }
    if (!s.route || s.route === '—') problems.push(`${s.node}: route が無い`)
    if (!['page', 'viewport'].includes(s.mode)) problems.push(`${s.node}: mode が page/viewport ではない`)
    if (s.mode === 'viewport' && !s.height) problems.push(`${s.node}: viewport なのに height が無い`)
    /* 設計の大きさは書き出したHTMLから読む。無いときだけ台帳の値を使う。 */
    if (!DESIGN_SIZE[s.node] && !existsSync(join(designDirOf(s.feature), `${s.node}.html`))) {
      problems.push(`${s.node}: 設計HTMLも大きさの控えも無い`)
    }
  }
  if (problems.length) {
    console.error('撮り方がそろっていません:\n  ' + problems.join('\n  '))
    process.exit(1)
  }
  const byFeature = {}
  for (const s of SCREENS) byFeature[s.feature] = (byFeature[s.feature] ?? 0) + 1
  console.log(`${SCREENS.length}件。機能ごと: ` + Object.entries(byFeature).map(([k, v]) => `${k}=${v}`).join(' '))
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

        **`selector: true` のときは CSS 選択子として読む。**
        台帳の10件は `input[placeholder^="例：8月キャンペーン"]` のような
        選択子で書いてあるのに、ここが必ず `getByLabel` を通していたため、
        **`fill` を使う手順が1つも通らず30秒で時間切れになっていた**
        （`h0kahp` `vW4Es` `FpgxH` `uNBlA` が撮れなかった原因）。
        ラベルで書いてある5件もあるので、両方を残す。
      */
      const field = step.selector
        ? (step.scope === 'main' ? page.locator('main') : page).locator(step.fill).first()
        : page.getByLabel(step.fill)
      await field.fill(step.text ?? '', { timeout: 15_000 })
      await page.waitForTimeout(step.after ?? 300)
      continue
    }
    const root = step.scope === 'main' ? page.locator('main') : page

    if (step.qaOpen !== undefined) {
      /*
        設計の絵と同じ状態を開く。実装側が `data-qa-open="<node>"` を
        付けた押しどころを探して押す。

        ここも実装されていなかった。台帳の33か所が下の `click` へ落ちて
        `getByRole('button', { name: undefined })` になり、
        **画面の先頭のボタンを押していた。** `quhg6` `xkRDb` が
        `/hq` へ飛んでいたのはこれ。名前で探すより確実なので、
        新しい画面はこちらで書く。
      */
      const opener = root.locator(`[data-qa-open="${step.qaOpen}"]`)
      const found = await opener.count()
      if (found === 0) {
        throw new Error(
          `${node}: data-qa-open="${step.qaOpen}" の押しどころがありません。`
          + '固定データが空でその行が描かれていないか、実装側に属性が付いていません。',
        )
      }
      await opener.first().click({ timeout: 15_000 })
      await page.waitForTimeout(step.after ?? 800)
      continue
    }

    if (step.select !== undefined) {
      /*
        選ぶ操作。**素の `<select>` と、自前のプルダウンの両方がある。**

        ここが実装されていなかった。`select` の手順は下の `click` へ落ちて
        `getByRole('button', { name: undefined })` になり、
        **画面の先頭のボタンを押していた。**
        `YZaDK` 2-8 担当者プルダウンは、それで統括コンソールへ飛んだ状態を
        撮って「撮影OK」と言っていた。台帳の17か所が同じ穴を踏んでいた。
      */
      const native = root.locator(`select[aria-label="${step.select}"]`)
      if (await native.count() > 0) {
        await native.first().selectOption({ label: step.label }, { timeout: 15_000 })
      } else {
        const opener = root.getByRole('button', { name: step.select })
        if (await opener.count() === 0) {
          throw new Error(`${node}: 選ぶ口「${step.select}」が見つかりません（素の select も自前のプルダウンも0件）`)
        }
        await opener.first().click({ timeout: 15_000 })
        await page.waitForTimeout(300)
        const option = page.getByRole('option', { name: step.label })
          .or(page.getByRole('menuitem', { name: step.label }))
          .or(page.getByRole('button', { name: step.label }))
        if (await option.count() === 0) {
          throw new Error(`${node}: 「${step.select}」を開いたが「${step.label}」がありません`)
        }
        await option.first().click({ timeout: 15_000 })
      }
      await page.waitForTimeout(step.after ?? 800)
      continue
    }

    /*
      **知らない手順で黙って進まない。**
      `click` が無いまま下へ来ると `name: undefined` で全部のボタンに当たり、
      先頭を押してしまう。台帳に新しい種類を足したとき、
      静かに間違った絵が増えるより、ここで止まったほうがいい。
    */
    if (step.click === undefined) {
      throw new Error(`${node}: 知らない手順です ${JSON.stringify(step)}`)
    }
    const target = root.getByRole(step.role ?? 'button', { name: step.click })
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
 * 一覧の状態を作る。`states.apis` の口の返事を差し替える。
 *
 * 台帳の頭に書いてある決めごとをそのまま実装した。
 *
 *   loading   … 返事を遅らせる。撮るころにはまだ読み込み中
 *   empty     … 空で返す。**器の形は保つ**（`{items:[],total:0,…}`）
 *   error     … 500。読めなかったことを画面に言わせる
 *   forbidden … 403。権限が無いことを言わせる
 *
 * **差し替えるのは一覧の口だけにしない。** 台帳の注意書きどおり、
 * 上の帯だけ前の数が残ると「読めなかったのに件数は出ている」という
 * 起きない絵になる。`states.apis` に帯の口も並べるのは台帳側の仕事。
 */
async function applyState(page, screen, kind) {
  const patterns = screen.states?.apis ?? []
  if (patterns.length === 0) {
    throw new Error(`${screen.node}: states.kinds があるのに states.apis が空です`)
  }
  /*
    **当たったかを数える。**
    当てはめが実際の口とずれていると、差し替えが一度も起きず、
    **素の絵と同じものが `-error` という名前で保存される。**
    最初にそうなった（`b3HfZ-error` が素の絵と1文字も違わなかった）。
    0回なら、あとで呼び出し側が止める。
  */
  const hits = { count: 0 }
  for (const pattern of patterns) {
    await page.route(pattern, async (route) => {
      hits.count += 1
      if (kind === 'loading') {
        /*
          **返さない。中断もしない。**
          はじめは30秒待って `route.abort()` していたが、
          中断は画面にとって失敗なので、`-loading` の絵に
          「友だちを表示できませんでした」が写っていた。
          読み込み中を撮りたいのに、エラーの絵になっていた。
          何もせず置いておけば、画面は読み込み中のまま。
          後片づけは画面を閉じるときに Playwright がやる。
        */
        await new Promise(() => {})
        return
      }
      if (kind === 'error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: '読み込めませんでした' }) })
        return
      }
      if (kind === 'forbidden') {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, error: '権限がありません' }) })
        return
      }
      // empty。**器の形を保つ。** 形が違うと画面が落ち、空ではなく壊れた絵になる。
      const response = await route.fetch()
      let shape = { items: [], total: 0, page: 1, limit: 20 }
      try {
        const original = await response.json()
        const data = original?.data
        if (Array.isArray(data)) shape = []
        else if (data && typeof data === 'object') {
          shape = {}
          for (const [key, value] of Object.entries(data)) {
            shape[key] = Array.isArray(value) ? [] : typeof value === 'number' ? 0 : value
          }
        }
      } catch { /* 返事が JSON でないときは既定の器 */ }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: shape }) })
    })
  }
  return hits
}

async function captureImpl(feature) {
  const list = screensOf(feature)
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
      **1画面が1枚とは限らない。**

      台帳は `states`（一覧の状態）と `variants`（開いた形）を持っていて、
      その説明も冒頭に書いてある。けれど `capture-screens.mjs` は
      `s.states` も `s.variants` も**一度も読んでいなかった**。
      51枚が状態別、22枚が変種を宣言しているのに、出ていたのは素の1枚だけ。
      `ledger.mjs` は `<node>-<状態>` という名前の絵を数えているので、
      **台帳の集計は、存在しない絵を前提にしていた。**

      ここで撮るぶんを組み立てる。名札が空なら素の1枚。
    */
    const shots = [{ label: '', steps: s.steps, kind: null }]
    for (const kind of s.states?.kinds ?? []) {
      // 'normal' は素の1枚と同じ絵なので、別名で二重に持たない。
      if (kind === 'normal') continue
      shots.push({ label: `-${kind}`, steps: s.steps, kind })
    }
    for (const variant of s.variants ?? []) {
      const suffix = variant.suffix.startsWith('-') ? variant.suffix : `-${variant.suffix}`
      shots.push({ label: suffix, steps: [...(s.steps ?? []), ...(variant.steps ?? [])], kind: null })
    }

    for (const shotSpec of shots) {
    for (const width of WIDTHS) {
      const page = await newPage(browser, width, s.mode === 'viewport' ? s.height : 1080, s.clock)
      try {
        const stateHits = shotSpec.kind ? await applyState(page, s, shotSpec.kind) : null
        /*
          **読み込み中を撮るときは `networkidle` を待たない。**
          待つ口をわざと止めているので、いつまでも静かにならない。
          `domcontentloaded` まで待って、少し置いてから撮る。
        */
        await page.goto(`${BASE}${s.route}`, {
          waitUntil: shotSpec.kind === 'loading' ? 'domcontentloaded' : 'networkidle',
          timeout: 120_000,
        })
        await page.waitForTimeout(1200)

        // 行き先を必ず見る。**クエリまで見る**（タブは `?tab=` でしか区別できない）。
        const url = new URL(page.url())
        const landed = url.pathname + url.search
        if (landed !== s.route) throw new Error(`${s.route} から ${landed} へ飛ばされた`)
        const body = await page.locator('body').innerText()
        if (body.includes('LINEでログイン')) throw new Error('ログイン画面になっている')
        /*
          **落ちた画面をそのまま撮らない。** 受信箱で会話を開いたとき、
          右の顧客情報が `mileage.summary.programName` で落ち、画面が
          「もう一度試す」だけになっていた。それでも撮影は成功していて、
          設計と並べる直前まで気づけなかった。
        */
        /*
          **状態別の絵では、この見張りを外す。**
          `error` や `forbidden` を撮るときは「読み込めませんでした」が
          出ているのが正解。ここで止めると、いちばん撮りたい絵が撮れない。
        */
        if (!shotSpec.kind) {
          for (const bad of FAILURE_TEXTS) {
            if (body.includes(bad)) throw new Error(`「${bad}」で止まっている`)
          }
        }

        await runSteps(page, shotSpec.steps, s.node + shotSpec.label)

        /*
          **操作のあとも行き先を見る。**
          `YZaDK` 2-8 担当者プルダウンは `/chats` に入るところまでは正しく、
          そのあとの選択で統括コンソール（店舗一覧）へ飛んでいた。
          行き先を入る前しか見ていなかったので、**別の画面を撮って
          「撮影OK」と言っていた**。設計と並べる文字を出すまで気づけなかった。
          押す先の名前が他の操作にも当たっていたのが元だが、
          当たったこと自体をここで捕まえる。
        */
        const afterUrl = new URL(page.url())
        const afterLanded = afterUrl.pathname + afterUrl.search
        if (afterLanded !== s.route) {
          throw new Error(`操作のあと ${s.route} から ${afterLanded} へ飛んだ`)
        }
        const afterBody = await page.locator('body').innerText()
        if (!shotSpec.kind) {
          for (const bad of FAILURE_TEXTS) {
            if (afterBody.includes(bad)) throw new Error(`操作のあと「${bad}」で止まっている`)
          }
        }

        if (stateHits && stateHits.count === 0) {
          throw new Error(
            `${s.node}: states.apis ${JSON.stringify(s.states.apis)} が一度も当たりませんでした。`
            + '当てはめがずれていると、素の絵が「-' + shotSpec.kind + '」という名前で保存されます。',
          )
        }

        await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' })

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )
        await page.screenshot({
          path: join(out, `${s.node}${shotSpec.label}-${width}.png`),
          fullPage: s.mode === 'page',
        })
        /*
          **絵と一緒に、見えている文字も残す。**
          絵だけだと、設計との突き合わせを人が1枚ずつ見るしかない。
          文字があれば `compare-text.mjs` が語の食い違いを機械で出せる。
          幅で中身は変わらないので、広いほうだけ残す。
        */
        if (width === WIDTHS[WIDTHS.length - 1]) {
          /*
            **`body` を使い回さない。** あれは `runSteps` の前に読んだもので、
            プルダウンやダイアログを開く前の姿しか写っていない。
            最初にこれで書いてしまい、`JN6mQ` 友だち追加QR の文字が
            「QRを表示」ボタンまでで、中身がまるごと落ちていた。
            撮る絵と同じ状態を、ここで読み直す。
          */
          const shown = await page.locator('body').innerText()
          // 行末の空白を落とす。表の空欄がタブのまま残ると `git diff --check` が怒る。
          const trimmed = shown.split('\n').map((line) => line.replace(/\s+$/, '')).join('\n')
          writeFileSync(join(out, `${s.node}${shotSpec.label}.txt`), `# ${s.name}${shotSpec.label}\n# ${s.route}\n\n${trimmed}\n`)
        }
        console.log(`${s.node}${shotSpec.label}\t${width}px\t撮影OK\tはみ出し=${overflow}`)
        if (overflow >= 2) console.log(`  ⚠ ${s.node}${shotSpec.label} ${width}px に横スクロールが出ている`)
        shot += 1
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        console.log(`${s.node}${shotSpec.label}\t${width}px\t撮れず\t${reason.split('\n')[0]}`)
        failures.push(`${s.node}${shotSpec.label} ${width}px: ${reason.split('\n')[0]}`)
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
  const list = screensOf(feature)
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
