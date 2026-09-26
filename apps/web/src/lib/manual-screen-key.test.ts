import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { manualScreenKeyForPath } from './manual-screen-key'

const here = dirname(fileURLToPath(import.meta.url))
const appTopBar = readFileSync(join(here, '..', 'components', 'shell', 'app-top-bar.tsx'), 'utf8')

describe('manualScreenKeyForPath', () => {
  it('主な画面を画面IDへ対応づける', () => {
    expect(manualScreenKeyForPath('/friends')).toBe('3-1')
    expect(manualScreenKeyForPath('/broadcasts')).toBe('6-1')
    expect(manualScreenKeyForPath('/auto-replies')).toBe('8-1')
    expect(manualScreenKeyForPath('/booking/bookings')).toBe('27-1')
    expect(manualScreenKeyForPath('/staff')).toBe('30-1')
  })

  it('詳細・作成など下位の画面は属する画面のIDへ寄せる', () => {
    expect(manualScreenKeyForPath('/friends/detail')).toBe('3-1')
    expect(manualScreenKeyForPath('/broadcasts/detail')).toBe('6-1')
    expect(manualScreenKeyForPath('/booking/menus/new')).toBe('28-1')
  })

  it('収載していない下位ルートは一番近い親の画面へ寄せる', () => {
    expect(manualScreenKeyForPath('/broadcasts/new/step2')).toBe('6-1')
  })

  it('対応が無い画面は null を返す（リンク自体を出さない）', () => {
    expect(manualScreenKeyForPath('/')).toBeNull()
    expect(manualScreenKeyForPath('/login')).toBeNull()
    expect(manualScreenKeyForPath('/unknown-path')).toBeNull()
  })
})

describe('トップバーのマニュアル導線', () => {
  it('画面のマニュアルを正本表から引き、未登録・失敗では出さない', () => {
    expect(appTopBar).toContain('manualScreenKeyForPath(pathname)')
    expect(appTopBar).toContain('api.manualLinks.lookup(screen)')
    expect(appTopBar).toContain('manualHref={manualHref}')
    // 「空のうちは押せない見た目」の固定値は消えている
    expect(appTopBar).not.toContain('manualHref={null}')
  })
})
