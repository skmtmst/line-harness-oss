import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * V8-B 予約台帳・運営の板の印（`iJdAi`・`YXrF6`・`tOPeY`）。
 * 画面は作ってあるのに板 ID が無いだけなので、外枠に印を付ける。
 * 印を消すと見本との対応が切れる。消さない・変えない。
 */

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')

function src(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), 'utf8')
}

describe('V8-B 予約台帳・運営の板の印', () => {
  it('取消の確認（iJdAi）は取消のときだけ付く', () => {
    const page = src('app', 'booking', 'bookings', 'page.tsx')
    // 承認・却下など他の操作の窓に取消の板 ID が付かないようにする。
    expect(page).toContain("designNode={decideTarget?.action === 'cancel' ? 'iJdAi' : undefined}")
  })

  it('予約の変更（YXrF6）は詳細ページの変更の段に付く', () => {
    const detail = src('app', 'booking', 'bookings', 'detail', 'page.tsx')
    expect(detail).toContain('data-design-node="YXrF6"')
    expect(detail).toContain('予約内容を変更する')
  })

  it('6桁の確認（tOPeY）は6マスの入力に付く', () => {
    const twoFactor = src('app', 'login', 'two-factor', 'page.tsx')
    expect(twoFactor).toContain('data-design-node="tOPeY"')
    expect(twoFactor).toContain('<OtpInput')
  })
})
