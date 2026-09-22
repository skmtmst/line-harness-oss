import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

/*
 * PERF-09: qrcode は QR を画面へ出す瞬間にだけ読む。
 * QR を一度も開かない訪問の初期バンドルへ入れないため、画面側は
 * すべて `qr-image` の動的読み込みへ通し、静的 import を残さない。
 */
const SRC = path.join(__dirname, '..')
const QR_PAGES = [
  'components/dashboard/qr-dialog.tsx',
  'components/hq/notice-line-register-dialog.tsx',
  'app/inflow-links/new/page.tsx',
  'app/ops/two-factor/page.tsx',
  'app/staff/page.tsx',
  'app/login/two-factor/setup/page.tsx',
]

describe('QRライブラリの表示時読み込み(PERF-09)', () => {
  it('QRを出す画面が qrcode を静的に import していない', () => {
    for (const rel of QR_PAGES) {
      const source = fs.readFileSync(path.join(SRC, rel), 'utf8')
      expect(source, rel).not.toMatch(/import\s+QRCode\s+from\s+['"]qrcode['"]/)
      expect(source, rel).not.toMatch(/from\s+['"]qrcode['"]/)
      expect(source, rel).toContain('qr-image')
    }
  })

  it('読み込み口は1箇所だけで、表示時の動的 import に集約されている', () => {
    const helper = fs.readFileSync(path.join(SRC, 'lib/qr-image.ts'), 'utf8')
    expect(helper).toContain("import('qrcode')")
    // 型だけの参照は消えるので静的 import は許さない（import type は可）。
    expect(helper).not.toMatch(/^import\s+QRCode\s+from\s+['"]qrcode['"]/m)
  })

  it('閉じているQRダイアログは QR を作りにいかない', () => {
    const dialog = fs.readFileSync(path.join(SRC, 'components/dashboard/qr-dialog.tsx'), 'utf8')
    expect(dialog).toContain('if (!open || routeMissing)')
  })

  it('qrToDataURL は qrcode の読み込みを1回に束ね、以後は使い回す', async () => {
    vi.resetModules()
    let loads = 0
    vi.doMock('qrcode', () => {
      loads += 1
      return { default: { toDataURL: vi.fn(async () => 'data:image/png;base64,x') } }
    })
    const { qrToDataURL } = await import('./qr-image')
    const [a, b] = await Promise.all([qrToDataURL('x'), qrToDataURL('y')])
    expect(a).toBe('data:image/png;base64,x')
    expect(b).toBe('data:image/png;base64,x')
    expect(loads).toBe(1)
    vi.doUnmock('qrcode')
  })
})
