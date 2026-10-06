import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(DIR, 'page.tsx'), 'utf8')

/*
 * UX更新 C①・D・E（予約の一覧のV8画面）。
 * 行を押すと右から詳細パネル（URLに残す・↑↓で前・次）。
 * 共通 DetailPanel・useDetailPanelUrl・withViewTransition を使う。
 * 自前の窓・自前の動きは作らない。v7 は引き出しのまま。
 */
describe('UX予約2 C① 行の詳細パネル', () => {
  it('行を押すと右のパネル（URL付き・↑↓移動）', () => {
    expect(PAGE).toContain('DetailPanel')
    expect(PAGE).toContain('useDetailPanelUrl')
    expect(PAGE).toContain(`useDetailPanelUrl('booking')`)
    expect(PAGE).toContain('hasPrev')
    expect(PAGE).toContain('hasNext')
    expect(PAGE).toContain('withViewTransition')
  })

  it('V8だけが対象でv7は引き出しのまま', () => {
    expect(PAGE).toContain('BookingDetailPanel')
    expect(PAGE).toContain(`adminTheme === 'v8'`)
  })

  it('確認の窓（承認・拒否・取消）は残す', () => {
    expect(PAGE).toContain('ConfirmDialog')
    expect(PAGE).toContain('handleDecide')
  })

  it('台帳のURL写しがパネルの行を消さない', () => {
    expect(PAGE).toContain('booking=${encodeURIComponent(activeBookingId)}')
  })
})

/*
 * C②：名前など1項目の変更はその場の書き換え（共通 InlineEdit）。
 * 口（API）がある操作だけ。予約の一覧に1項目だけを直す口は無いので付けない。
 * 状態の変更は確認の窓、備考や時間の変更は詳細ページで行う。
 */
describe('UX予約2 C② その場の書き換え', () => {
  it('一覧に1項目だけを直す口は無いのでその場書き換えは付けない', () => {
    expect(PAGE).not.toContain('InlineEdit')
    expect(PAGE).toContain('/booking/bookings/detail?id=')
  })
})

/*
 * C③：右クリックでも操作列と同じメニュー（共通 ContextMenu）。
 */
describe('UX予約2 C③ 右クリックメニュー', () => {
  it('行の操作列と同じ操作を右クリックで出せる', () => {
    expect(PAGE).toContain('bookingContextItems')
    expect(PAGE).toContain('<ContextMenu')
    expect(PAGE).toContain('ActionButtons')
  })

  it('閲覧のみの人には状態を変える操作を出さない', () => {
    expect(PAGE).toContain('canOperate')
  })
})
