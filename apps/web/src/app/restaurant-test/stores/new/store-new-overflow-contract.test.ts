import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const TERMS_DOC = readFileSync(
  new URL('../../../../components/legal/terms-document.tsx', import.meta.url),
  'utf8',
)

/*
 * #974 U095: 390pxで手順説明と規約パネルの右側が画面外へ切れた。
 * グリッドの子は既定で内容の最小幅までしか縮まないため、1列でも
 * minmax(0,1fr) と子の min-w-0 をそろえる。列を落とせない規約の表だけ
 * 内側の横スクロールを許す。
 */
describe('U095 店舗追加の画面全体のはみ出し', () => {
  it('外側と内側のグリッドは1列のとき minmax(0,1fr) で幅を越えない', () => {
    // grid-cols-1 は repeat(1, minmax(0, 1fr)) と同じ。auto の1列では中身が広いと越える。
    expect(PAGE).toContain('grid-cols-1 items-start gap-5 xl:grid-cols-[220px_minmax(0,1fr)]')
    expect(PAGE).toContain('grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]')
  })

  it('手順・本文・案内の各パネルは内容より細く縮める', () => {
    expect(PAGE).toContain('min-w-0 rounded-card border border-hairline bg-canvas p-4')
    expect(PAGE).toContain('min-w-0 rounded-card border border-hairline bg-canvas p-5 sm:p-7')
    expect(PAGE).toContain('min-w-0 rounded-card border border-hairline bg-canvas p-5')
  })

  it('長い店舗名を確認画面で折り返す', () => {
    expect(PAGE).toContain('break-words font-semibold text-ink')
  })

  it('規約の表は枠の内側だけで横へ動かせる', () => {
    expect(TERMS_DOC).toContain('overflow-x-auto')
    expect(TERMS_DOC).toContain('min-w-[520px]')
  })
})
