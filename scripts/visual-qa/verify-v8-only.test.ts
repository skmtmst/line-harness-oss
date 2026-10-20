import { describe, expect, it } from 'vitest'
// @ts-expect-error Node CLI source has no declaration file
import { inspectSource, verify } from '../../apps/web/scripts/verify-v8-only.mjs'

describe('旧見た目が戻らない検査', () => {
  it.each([
    ['screen.tsx', "import { useAdminTheme } from '@/lib/use-admin-theme'"],
    ['screen.tsx', 'const theme = process.env.NEXT_PUBLIC_ADMIN_THEME'],
    ['screen.tsx', "localStorage.getItem('lh_admin_theme')"],
    ['screen.tsx', '<div data-theme={theme} />'],
    ['screen.tsx', 'if (document.documentElement.dataset.theme === "v8") run()'],
    ['screen.tsx', '<div className="v7:p-4" />'],
    ['screen.tsx', '<div className="v8:p-4" />'],
    ['screen-v7.tsx', 'export default () => <div />'],
    ['screen.tsx', "import Old from './screen-v6'"],
    ['screen.css', '[data-theme="v8"] .card { padding: 16px }'],
    ['screen.css', 'html:not([data-theme="v8"]) .card { padding: 20px }'],
    ['screen.css', '@custom-variant v7 (&:where(.v7 *));'],
    ['screen.css', '@keyframes v7-enter { to { opacity: 1 } }'],
  ])('%sの旧分岐の負の例を落とす', (name, source) => {
    expect(inspectSource(name, source).length).toBeGreaterThan(0)
  })

  it('固定V8・状態・狭幅とAPIの機能名を残す', () => {
    expect(inspectSource('screen.tsx', 'const dispatch = { v6: "自動化" }; const view = <html data-theme="v8" />')).toEqual([])
    expect(inspectSource('screen.css', ':root .card { padding: 16px } @media (max-width: 1100px) { :root .card { padding: 12px } }')).toEqual([])
    expect(inspectSource('screen.test.tsx', 'useAdminTheme(); localStorage.setItem("lh_admin_theme", "v7")')).toEqual([])
  })

  it('現役の作業ツリーに旧分岐が無い', () => {
    expect(verify()).toEqual([])
  }, 30_000)
})
