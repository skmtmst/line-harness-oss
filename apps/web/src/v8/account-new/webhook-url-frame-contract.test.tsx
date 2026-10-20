// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import Step2Connect, { type Step2Field } from './step2-connect'

/*
 * ②アカウント接続 Step2「musubo の Webhook URL」の URL の枠。
 * 承認済み v07（LINE新規追加_v07.pen）の `E01lkh`：高さ36・左右12・角10、右に［コピー］。
 *
 * 一度、ここを `contentPadding="var(--tpl-htn-endpoint-pad)"`（中身は `8px 10px`）と
 * 変数1語で渡したために、Card が左右別々の余白だと見抜けず（card.tsx の hasSides）、
 * 共通の下限16と突き合わされて `max(16px, 8px 10px)` になり、CSS として成り立たず
 * 余白が0に落ちた。枠が文字1行ぶんに潰れ、字が枠線に付いた状態で配備された。
 *
 * なので見るのは書き方ではなく、描いた結果の枠そのもの。左右別々の余白として渡せた
 * ときだけ `data-card-spacing-sides` が付く（card.tsx）ので、これが無ければ
 * 同じ潰れ方に戻ったということ。Card 側の決まりは
 * components/shared/card-content-padding.test.tsx が見ている。
 */

const VALUES: Record<Step2Field, string> = {
  channelId: '',
  channelSecret: '',
  loginChannelId: '',
  loginChannelSecret: '',
}

afterEach(cleanup)

/** ②Step2 を描いて、Ds3E2 の中の URL の枠（内側の Card）を取り出す。 */
function urlFrame() {
  const { container } = render(
    <Step2Connect sub={2} badge="Step 2 / 3" values={VALUES} fieldErrors={{}} acks={{}} onUpdate={() => {}} onToggleAck={() => {}} />,
  )
  const box = container.querySelector('[data-design-node="Ds3E2"]')
  expect(box, '承認済み v07 Ds3E2「musubo の Webhook URL」が描かれていない').not.toBeNull()
  const frame = box?.querySelector<HTMLElement>('[data-design-part="card"][data-card-corner="control"]') ?? null
  expect(frame, 'URL の枠（角 control の内側の Card）が描かれていない').not.toBeNull()
  return frame as HTMLElement
}

describe('②Step2 の Webhook URL の枠は承認済み v07 どおり', () => {
  it('左右別々の余白として渡せている（潰れて 0 に落ちない）', () => {
    // これが無いと共通の下限16の規則に当たり、max に2値が入って padding が 0 になる。
    expect(urlFrame().hasAttribute('data-card-spacing-sides')).toBe(true)
  })

  it('承認済み v07 の左右12・上下8を渡している', () => {
    const style = urlFrame().getAttribute('style') ?? ''
    const padding = /--card-content-padding:\s*([^;]+)/.exec(style)?.[1]?.trim()
    expect(padding).toBe('var(--space-8) var(--space-12)')
  })

  it('細い線・角は control（10px）', () => {
    const frame = urlFrame()
    expect(frame.getAttribute('data-card-surface')).toBe('bordered')
    expect(frame.getAttribute('data-card-corner')).toBe('control')
  })

  it('枠のすぐ右に［コピー］が並ぶ', () => {
    const frame = urlFrame()
    const row = frame.parentElement as HTMLElement
    const copy = row.querySelector('[aria-label="Webhook URL をコピー"]')
    expect(copy, '［コピー］が URL の枠と同じ行にない').not.toBeNull()
    // 枠 → ［コピー］の順（左に枠、右にコピー）。
    expect(frame.compareDocumentPosition(copy as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0)
  })
})
