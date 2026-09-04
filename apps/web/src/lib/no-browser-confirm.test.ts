import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.join(__dirname, '..')

/** コメントを外す。注意書きの中の `confirm()` に当てないため。 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) out.push(full)
  }
  return out
}

/**
 * **ブラウザの `confirm()` `alert()` `prompt()` を使わない。**
 *
 * 見た目がブラウザ任せで、設計の確認窓（`J6x4Q` / `H2S1T4`）と違う。
 * 何が消えるのか・戻せるのかを本文で読ませられず、押し間違いを止められない。
 * さらに**画像比較に写らない**ので、確認と失敗の絵をそもそも撮れない
 * （`Y0Sn3` の失敗状態が撮れなかったのはこれが理由だった）。
 *
 * `alert()` はもう1つ悪いところがある。**押した瞬間しか読めない。**
 * 消えると理由を確かめ直せないので、原因を追えない。実際
 * `update failed: …` `rollback not implemented in MVP — use CLI`
 * `areas は最大 20 個` のように、**内部語がそのまま出ていた**。
 *
 * 代わりに使うもの:
 * - 確認 → `components/shared/confirm-dialog`
 * - 知らせ・失敗 → 画面の中に文で残す（`role="status"` / `role="alert"`）
 *
 * **2026-09-04 に 0 件になったので、全面禁止にした。** 一覧は持たない。
 * 新しく書いたらここで落ちる。
 */

/**
 * ブラウザの `confirm` の呼び出し。
 *
 * **`window.confirm(` を見落としていた。** `[^.\w]` で「点の直前」を外して
 * いたので、`confirm(` は捕まえるのに `window.confirm(` は素通りしていた。
 * `app/form-submissions/edit/page.tsx` はそれで一覧にも載らないまま残って
 * いた。受け側（`window` / `globalThis` / `self`）を明示して捕まえる。
 */
const BROWSER_CONFIRM = /(?:^|[^.\w])confirm\(|\b(?:window|globalThis|self)\.confirm\(/

/**
 * ブラウザの `alert` と `prompt`。
 *
 * `confirm` と同じ理由で使わない。受け側（`window` / `globalThis` / `self`）を
 * 明示して、`window.alert(` の書き方も捕まえる。
 */
const BROWSER_ALERT = /(?:^|[^.\w])alert\(|\b(?:window|globalThis|self)\.alert\(/
const BROWSER_PROMPT = /(?:^|[^.\w])prompt\(|\b(?:window|globalThis|self)\.prompt\(/

/** `.tsx` と `.ts` を集める（`.test.` は除く）。 */
function sources(): string[] {
  return walk(SRC).filter((f) => !/confirm-dialog/.test(f) && !f.includes('.test.'))
}

const offenders = (re: RegExp) =>
  sources()
    .filter((f) => re.test(code(fs.readFileSync(f, 'utf8'))))
    .map((f) => path.relative(SRC, f))
    .sort()

describe('ブラウザの確認・知らせの窓を使わない', () => {
  it('読む先を取り違えていない', () => {
    // 一覧が空になったので、**数え漏れで素通りしないこと**を先に見る。
    expect(sources().length).toBeGreaterThan(300)
  })

  it('confirm を使わない', () => {
    expect(offenders(BROWSER_CONFIRM), 'ConfirmDialog を使う').toEqual([])
  })

  it('alert を使わない', () => {
    expect(offenders(BROWSER_ALERT), '知らせと失敗は画面の中に文で残す').toEqual([])
  })

  /**
   * `prompt()` は**まだ残っている。減る一方の表で数える。**
   *
   * 多くは「コピーできなかったとき、URLを選べる形で出す」代わりに使って
   * いる（`navigator.clipboard` が使えない環境の逃げ道）。逃げ道そのものは
   * 要るが、**窓ではなく画面の中に読み取り専用の欄で出すほうがよい。**
   *
   * `app/form-submissions/edit` の「ページの名前」は、そもそも入力欄を持つ窓に
   * するのが正しい。
   * 手本は `app/rich-menus/edit/page.tsx`——`ConfirmDialog` の `children` に
   * 入力欄を置いている。
   *
   * **増やせない。0 になったら行ごと消す**（消し忘れるとここで落ちる）。
   */
  const PROMPT_NOT_YET = [
    'app/booking/bookings/page.tsx',
    'app/booking/menus/page.tsx',
    'app/form-submissions/edit/page.tsx',
    'app/inflow-links/detail/page.tsx',
    'components/events/event-form.tsx',
  ]

  it('prompt を使うファイルを増やさない', () => {
    expect(offenders(BROWSER_PROMPT), 'ConfirmDialog の children に入力欄を置く').toEqual(
      [...PROMPT_NOT_YET].sort(),
    )
  })

  it('リマインダの一括削除が共通の確認窓を使う', () => {
    const src = fs.readFileSync(path.join(SRC, 'app', 'reminders', 'page.tsx'), 'utf8')
    expect(src).toContain('ConfirmDialog')
    expect(src).toContain('confirmLabel="削除する"')
    expect(src).toContain('destructive')
    expect(code(src), 'ブラウザのconfirmへ戻っている').not.toMatch(BROWSER_CONFIRM)
    // 押している間に二度押しできない
    expect(src).toContain('selected.size === 0 || deleting')
    // 失敗を握りつぶさず、成功済みを再試行しない。
    // 一部成功後に全件を選んだままにすると、成功済みの404で残りへ進めなくなる。
    const body = src.slice(src.indexOf('const handleDeleteSelected'), src.indexOf('const filtered'))
    expect(body, '削除の返事を確かめていない').toContain('return res.success')
    expect(body, '失敗したものだけを選び直していない').toContain('setSelected(new Set(failed))')
    expect(body, '一部失敗を運用者へ知らせていない').toContain('削除できなかったものだけを残しています')
  })
})
