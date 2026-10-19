import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * ②アカウント接続 Step2「musubo の Webhook URL」の URL の枠。
 * 承認済み v07（LINE新規追加_v07.pen）の `E01lkh`：高さ36・左右12・角10、右に［コピー］。
 *
 * 一度、ここを `contentPadding="var(--tpl-htn-endpoint-pad)"`（中身は `8px 10px`）と
 * 変数1語で渡したために、Card が左右別々の余白だと見抜けず（card.tsx の hasSides）、
 * 共通の下限16と突き合わされて `max(16px, 8px 10px)` になり、CSS として成り立たず
 * 余白が0に落ちた。枠が文字1行ぶんに潰れ、字が枠線に付いた状態で配備された。
 * 直し方は値を空白で分けて渡すこと。種類ごとの決まりは
 * card-content-padding-contract.test.ts が全画面ぶん見ている。
 */

const STEP2 = path.join(__dirname, 'step2-connect.tsx')
const source = readFileSync(STEP2, 'utf8')

// URL の枠（内側の Card）の開き札だけを取り出す。
const urlFrame = source.match(/<Card layout="horizontal"[^>]*corner="control"[^>]*>/)?.[0] ?? ''

describe('②Step2 の Webhook URL の枠は承認済み v07 どおり', () => {
  it('URL の枠がある（走査が空振りしていない）', () => {
    expect(urlFrame).not.toBe('')
  })

  it('余白は空白で分けて渡す（変数1語にまとめない）', () => {
    expect(urlFrame).toContain('contentPadding="var(--space-8) var(--space-12)"')
  })

  it('横並び・細い線・角は control（10px）', () => {
    expect(urlFrame).toContain('layout="horizontal"')
    expect(urlFrame).toContain('surface="bordered"')
    expect(urlFrame).toContain('corner="control"')
  })

  it('枠のすぐ右に［コピー］が並ぶ', () => {
    const row = source.slice(source.indexOf(urlFrame))
    expect(row.indexOf('CopyTextButton')).toBeGreaterThan(0)
    expect(row.slice(0, row.indexOf('CopyTextButton'))).toContain('</Card>')
  })
})
