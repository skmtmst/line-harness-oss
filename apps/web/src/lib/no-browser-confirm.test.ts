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
    else if (full.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * **ブラウザの `confirm()` を消していく。**
 *
 * 見た目がブラウザ任せで、設計の確認窓（`J6x4Q` / `H2S1T4`）と違う。
 * 何が消えるのか・戻せるのかを本文で読ませられず、押し間違いを止められない。
 * さらに**画像比較に写らない**ので、確認の絵をそもそも撮れない
 * （`Y0Sn3` の失敗状態が撮れなかったのはこれが理由だった）。
 *
 * 代わりに `components/shared/confirm-dialog` を使う。
 *
 * 下の一覧は**まだ直していないファイル。増やさないこと。**
 * 直したら一覧から消す。空にできたら `confirm(` を全面禁止にする。
 */
const NOT_YET_MIGRATED = [
  'app/automations/page.tsx',
  'app/booking/bookings/detail/page.tsx',
  'app/booking/bookings/page.tsx',
  'app/booking/menus/page.tsx',
  'app/booking/staff/page.tsx',
  'app/booking/staff/shifts/page.tsx',
  'app/broadcasts/page.tsx',
  'app/conversions/page.tsx',
  'app/events/bookings/page.tsx',
  'app/pools/page.tsx',
  'app/reminders/page.tsx',
  'app/restaurant-test/restaurant-console.tsx',
  'app/staff/page.tsx',
  'app/templates/detail/page.tsx',
  'app/templates/page.tsx',
  'app/webhooks/page.tsx',
  'components/events/event-form.tsx',
  'components/events/event-wizard.tsx',
  'components/rich-menus/apply-to-tag-modal.tsx',
  'components/scenarios/scenario-list.tsx',
]

/**
 * ブラウザの `confirm` の呼び出し。
 *
 * **`window.confirm(` を見落としていた。** `[^.\w]` で「点の直前」を外して
 * いたので、`confirm(` は捕まえるのに `window.confirm(` は素通りしていた。
 * `app/form-submissions/edit/page.tsx` はそれで一覧にも載らないまま残って
 * いた。受け側（`window` / `globalThis` / `self`）を明示して捕まえる。
 */
const BROWSER_CONFIRM = /(?:^|[^.\w])confirm\(|\b(?:window|globalThis|self)\.confirm\(/

describe('ブラウザのconfirmを使わない', () => {
  it('confirm を使うファイルを増やさない', () => {
    const offenders = walk(SRC)
      .filter((f) => !/confirm-dialog/.test(f))
      .filter((f) => BROWSER_CONFIRM.test(code(fs.readFileSync(f, 'utf8'))))
      .map((f) => path.relative(SRC, f))
      .sort()
    const unexpected = offenders.filter((f) => !NOT_YET_MIGRATED.includes(f))
    expect(unexpected, 'ブラウザのconfirmを使う新しいファイルが増えた').toEqual([])
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
