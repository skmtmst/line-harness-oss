/**
 * 実ルートの画像を 1440px と 1920px で撮り、前回と比べる。
 *
 * ここが無い間、管理画面はローカルで1画面も開けず、PRは画面を見ないまま
 * 積まれていた。**新しい絵を描く道具ではなく、壊れたことに気づく道具**。
 *
 * 見張っているもの
 * 1. 画面がそもそも描けるか（エラー画面・空白ではないか）
 * 2. **横スクロールが出ていないか**（1440でも1920でも）
 * 3. 前回の画像と変わっていないか
 *
 * 使い方
 *   node scripts/visual-qa/mock-api.mjs &
 *   NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web dev &
 *   npx playwright test scripts/visual-qa/capture.spec.mjs
 *
 * 初回は基準の画像が無いので、撮って通す。2回目から比較する。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { ROUTES, TAG_STATES, WIDTHS } from './routes.mjs'

/** 撮るあいだだけ当てる規則（開発表示を消す）。 */
const STYLE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'screenshot.css')

const BASE = process.env.VISUAL_QA_BASE ?? 'http://localhost:3101'

/** 画面がエラーで止まったときの文言。出ていたら失敗させる。 */
const FAILURE_TEXTS = [
  '画面を表示できませんでした',
  '店舗が選ばれていません',
  'Application error',
]

/**
 * ログイン画面に出る文字。**これが出ていたら、その画面は見ていない。**
 *
 * 2026-08-26: 文言だけ見ていたら、24件すべてログイン画面を撮ったまま
 * 「通過」していた。`AuthGuard` が `router.replace('/login')` で飛ばすので、
 * エラーの文言はどこにも出ない。**行き先のURLを必ず見る。**
 */
const LOGIN_TEXT = 'LINEでログイン'

/**
 * 前回と違ってよい点の数。**0。**
 *
 * 割合（`maxDiffPixelRatio`）は縦に長い画面ほど甘くなる。1920pxの1枚で
 * 0.2% は約4,000点あり、**開発表示の丸い印（3,804点）が丸ごと通った**。
 * 数に変えても 120 では足りず、「が」を「は」に変えた1文字（約70点）が
 * 通ってしまう。
 *
 * 乱数も時刻も使わず、開発表示も撮る瞬間に消しているので、
 * 同じ絵は**そっくり**同じになる。3回続けて 0 で通ることを確かめてある。
 * もし機械を変えて毎回ずれるようになったら上げてよいが、**40より上げない**。
 * 1文字ぶんが約70点なので、それを超えると文字の入れ替わりを見逃す。
 */
const MAX_DIFF_PIXELS = 0

test.describe.configure({ mode: 'parallel' })

/**
 * 認証後の店舗選択は毎回消される仕組みなので、消さない印を先に置く。
 * **product 側は一切変えない。**
 */
async function signIn(page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('lh_auth_selection_cleared', '1')
      window.localStorage.setItem('lh_selected_account', 'visual-qa-account')
    } catch {
      // ストレージが使えない環境では何もしない
    }
  })
}

/** その画面に居るか。ログインへ飛ばされていたら、見ているのは別の画面。 */
async function expectLanded(page, path) {
  const landed = new URL(page.url()).pathname
  expect(landed, `${path} から ${landed} へ飛ばされた`).toBe(path)
  const body = await page.locator('body').innerText()
  expect(body, `${path} がログイン画面になっている`).not.toContain(LOGIN_TEXT)
  for (const bad of FAILURE_TEXTS) {
    expect(body, `${path} が「${bad}」で止まっている`).not.toContain(bad)
  }
}

for (const width of WIDTHS) {
  for (const route of ROUTES) {
    test(`${width}px ${route.name}（${route.path}）`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })

      await signIn(page)
      await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' })

      // 1・2. そのページに居て、描けているか
      await expectLanded(page, route.path)

      // 3. 横スクロールが出ていないか。V6共通ルール §1-8。
      //    1px の誤差は端数なので許す。2px 以上はレイアウトの破れ。
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${route.path} に横スクロールが出ている（${overflow}px）`).toBeLessThan(2)

      // 4. 前回と変わっていないか
      //
      //    Next.js の開発表示（左下の丸い印）は毎回わずかに違う絵を描く。
      //    写し込むと3〜4%ずれて、毎回赤くなる。隠して比べる。
      await expect(page).toHaveScreenshot(`${route.name}-${width}.png`, {
        fullPage: true,
        /*
         * 文字のにじみのぶんだけ許す。**割合にしない。**
         * 0.2%（1920pxの縦長1枚で約4,000px）は広すぎて、1文字の違いも、
         * エラーの帯1本も通ってしまう。「が」を「は」に変えても落ちなかった。
         * 絵が毎回同じになるようにした（乱数・時刻なし、開発表示も消した）ので、
         * 実際のばらつきはほぼ0。数で決める。
         */
        maxDiffPixels: MAX_DIFF_PIXELS,
        animations: 'disabled',
        stylePath: STYLE_PATH,
      })
    })
  }
}

/*
 * 4-1 の「中身が出せないとき」4つ。設計 ★V6 4-2-C `yKEdO`。
 *
 * **ふつうの状態だけ合わせて「一致した」と言わない。**
 * 一覧はどれも `items.length === 0` だけを見て「ありません」と出していて、
 * 読み込みに失敗したときも同じ文が出ていた（PR #216 と同じ壊れ方）。
 * 4つを別々の画像として撮り、言い分けられていることを目で確かめる。
 *
 * 差し替えは**ブラウザ側だけ**。モックは触らない（触ると他の画面の画像まで
 * 変わる）。画面のコードは本物のまま通る。
 */
const TAGS_PATH = '/tags'

for (const width of WIDTHS) {
  for (const state of TAG_STATES) {
    test(`${width}px 友だち属性・${state.label}（${state.name}）`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await signIn(page)

      // タグ・フォルダ・上部の数を**まとめて**差し替える。
      // 一部だけ残すと、「タグは読めなかった」のに上に「101件」が出る、
      // 実際には起きない絵になる。403 なら数も読めない。
      await page.route('**/api/list-stats*', (route) =>
        route.fulfill({
          status: state.status,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(state.statsBody ?? state.body),
        }),
      )
      for (const glob of ['**/api/tags*', '**/api/tag-groups*']) {
        await page.route(glob, (route) =>
          route.fulfill({
            status: state.status,
            contentType: 'application/json; charset=utf-8',
            body: JSON.stringify(state.body),
          }),
        )
      }

      await page.goto(`${BASE}${TAGS_PATH}`, { waitUntil: 'networkidle' })
      await expectLanded(page, TAGS_PATH)

      // 出ている1枚が、狙った状態かを名前で確かめる。
      // 絵だけ見ていると、別の状態が出ていても「変わっていない」で通る。
      const kind = { 'tags-empty': 'empty', 'tags-error': 'error', 'tags-forbidden': 'forbidden' }[state.name]
      await expect(page.locator(`[data-list-state="${kind}"]`)).toBeVisible()

      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${state.name} に横スクロールが出ている（${overflow}px）`).toBeLessThan(2)

      await expect(page).toHaveScreenshot(`${state.name}-${width}.png`, {
        fullPage: true,
        maxDiffPixels: MAX_DIFF_PIXELS,
        animations: 'disabled',
        stylePath: STYLE_PATH,
      })
    })
  }

  test(`${width}px 友だち属性・読み込んでいる途中（tags-loading）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await signIn(page)

    // 返事を返さない。**待たせたままの絵**を撮るため。
    // `networkidle` を待つと永久に終わらないので、ここだけ待ち方を変える。
    for (const glob of ['**/api/tags*', '**/api/tag-groups*', '**/api/list-stats*']) {
      await page.route(glob, () => {})
    }

    await page.goto(`${BASE}${TAGS_PATH}`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-list-state="loading"]')).toBeVisible()
    await expectLanded(page, TAGS_PATH)

    await expect(page).toHaveScreenshot(`tags-loading-${width}.png`, {
      fullPage: true,
      maxDiffPixels: MAX_DIFF_PIXELS,
      animations: 'disabled',
      stylePath: STYLE_PATH,
    })
  })
}

/*
 * 4-1 の削除の確認ダイアログ（設計 `★ V6 4-1-F` `dKlkz`）。
 *
 * **本物を開いて撮る。** 作り物の絵を別ルートに置くと、実際に押したときの
 * 画面とずれても誰も気づかない。一覧から赤いゴミ箱を押した先を見る。
 * 押すのはここまでで、削除そのものは実行しない（モックは更新を405で断る）。
 *
 * 2枚撮る。**使用中で止まる絵と、消せる絵は別物**で、片方だけ見ていると
 * 「押せないほうが正しい」のか「押せるべきなのに押せない」のか分からない。
 */
const DELETE_CASES = [
  {
    name: 'tags-delete',
    label: '使用中で止まる',
    // 設計の1行目。配信3・フォーム1から参照されているので消せない。
    tag: 'EC顧客連携済み',
    canDelete: false,
  },
  {
    name: 'tags-delete-ok',
    label: '消せる',
    // どこからも参照されていない埋め草。
    tag: 'VIPタグ 1',
    canDelete: true,
  },
]

for (const width of WIDTHS) {
  for (const item of DELETE_CASES) {
    test(`${width}px 友だち属性・削除の確認／${item.label}（${item.name}）`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await signIn(page)
      await page.goto(`${BASE}${TAGS_PATH}`, { waitUntil: 'networkidle' })
      await expectLanded(page, TAGS_PATH)

      // 行を決め打ちする。選ばずに撮ると影響の数が毎回変わって画像が安定しない。
      await page.locator(`button[aria-label="${item.tag} を削除"]`).click()
      const dialog = page.locator('[data-qa-dialog="tag-delete"]')
      await expect(dialog).toBeVisible()
      // 影響を読み終えるまで待つ。読込中の絵を撮ると毎回ちがう。
      await expect(dialog).toHaveAttribute('data-impact', 'ready')

      // 出ているのが本物か。影響5行がそろっているかを名前で見る。
      for (const row of ['付与人数', '参照先', '参照先（自動）', '連動の停止', '積んだマイル']) {
        await expect(dialog.getByText(row, { exact: true })).toBeVisible()
      }

      // **押せる／押せないが狙いどおりか。** 絵だけ見ていると見落とす。
      const remove = dialog.getByRole('button', { name: 'このタグを削除する' })
      if (item.canDelete) {
        // 消せるのに赤い「使用中」警告を出さない。ボタンだけを見る試験では
        // この誤表示を見逃したため、表示も同時に固定する。
        await expect(dialog.locator('[data-qa="tag-delete-blocked-warning"]')).toHaveCount(0)
        await expect(dialog.getByText('使用中のため、このタグは削除できません', { exact: true })).toHaveCount(0)
        // 名前を入れるまでは押せない。入れたら押せる。
        await expect(remove).toBeDisabled()
        await dialog.locator('input[type="text"], input:not([type])').first().fill(item.tag)
        await expect(remove).toBeEnabled()
        // 撮る絵は入力前に戻す（毎回同じにするため）。
        await dialog.locator('input[type="text"], input:not([type])').first().fill('')
      } else {
        // 使用中は、名前を入れても押せない。確認欄自体を使えなくしてある。
        await expect(remove).toBeDisabled()
        await expect(dialog.locator('input[type="text"], input:not([type])').first()).toBeDisabled()
        await expect(dialog.locator('[data-qa="tag-delete-blocked-warning"]')).toBeVisible()
        await expect(dialog.getByText('使用中のため削除できません', { exact: false })).toBeVisible()
      }

      await expect(page).toHaveScreenshot(`${item.name}-${width}.png`, {
        fullPage: true,
        maxDiffPixels: MAX_DIFF_PIXELS,
        animations: 'disabled',
        stylePath: STYLE_PATH,
      })
    })
  }
}
