import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PUBLIC_AUTH_PATHS } from '@/lib/auth-email'

const SRC = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(SRC, p), 'utf8')

/**
 * ★V6 0-1 ログイン・36-4 会員登録・36-6 パスワード再設定の見張り。
 * 正本は Pencil `V6正本.pen` と `docs/v6-requirements/v6-36-hq-account-billing-requirements-draft.md`。
 */
describe('ログイン前の画面（0-1／36-4／36-6）', () => {
  it('ログイン前に開ける画面はすべて page.tsx があり、shell と guard の両方が同じ一覧を見る', () => {
    for (const path of PUBLIC_AUTH_PATHS) {
      expect(existsSync(join(SRC, 'app', path, 'page.tsx')), `${path} の page.tsx`).toBe(true)
    }
    expect(read('components/app-shell.tsx')).toContain('isPublicAuthPath(pathname)')
    expect(read('components/auth-guard.tsx')).toContain('isPublicAuthPath(pathname)')
  })

  it('ログインはメール＋パスワードが主で、LINE ログインが副。登録と再設定への導線がある', () => {
    const login = read('app/login/page.tsx')
    expect(login).toContain("node=\"UufG8\"")
    expect(login).toContain('/api/auth/password/login')
    expect(login).toContain('/api/auth/line')
    expect(login).toContain('href="/register"')
    expect(login).toContain('href="/password/forgot"')
    expect(login).toContain('autoComplete="current-password"')
    // 二段階認証の人は既存の 6 桁コードの画面へ
    expect(login).toContain('/login/two-factor#')
  })

  it('登録の 1 歩目はメールだけ。Turnstile と同意があり、印（deviceMarker）を送る', () => {
    const page = read('app/register/page.tsx')
    expect(page).toContain("node=\"JBd7P\"")
    expect(page).toContain('/api/auth/register/request')
    expect(page).toContain('<Turnstile')
    expect(page).toContain('readDeviceMarker()')
    expect(page).toContain('agreed: true')
    expect(page).not.toContain('autoComplete="new-password"')
    // 入れたメールは URL に載せない
    expect(page).toContain('rememberSignupEmail(')
    expect(page).not.toContain('?email=')
  })

  it('本登録は URL の token を確かめてから出し、終わったら印を残して統括の画面へ', () => {
    const page = read('app/register/complete/page.tsx')
    expect(page).toContain('/api/auth/register/check?token=')
    expect(page).toContain('/api/auth/register/complete')
    expect(page).toContain('storeDeviceMarker(')
    expect(page).toContain("window.location.assign('/hq')")
    expect(page).toContain('autoComplete="new-password"')
  })

  it('再設定は Turnstile 付きで依頼し、URL の token で新しいパスワードを設定する', () => {
    const forgot = read('app/password/forgot/page.tsx')
    expect(forgot).toContain('<Turnstile')
    expect(forgot).toContain('/api/auth/password/forgot')
    const reset = read('app/password/reset/page.tsx')
    expect(reset).toContain('/api/auth/password/reset/check?token=')
    expect(reset).toContain('/api/auth/password/reset')
    expect(reset).toContain('autoComplete="new-password"')
  })

  it('Turnstile はサイト用の鍵が無いと枠を出さず、親のボタンも押せない', () => {
    const turnstile = read('components/auth/turnstile.tsx')
    expect(turnstile).toContain('NEXT_PUBLIC_TURNSTILE_SITE_KEY')
    expect(turnstile).toContain('challenges.cloudflare.com/turnstile/v0/api.js')
    for (const p of ['app/register/page.tsx', 'app/password/forgot/page.tsx']) {
      expect(read(p)).toContain('disabled={busy || !TURNSTILE_SITE_KEY}')
    }
  })

  it('同意欄の規約リンクは、ページができるまで文字だけで出す（URL は環境変数）', () => {
    const lib = read('lib/auth-email.ts')
    expect(lib).toContain('NEXT_PUBLIC_TERMS_URL')
    expect(lib).toContain('NEXT_PUBLIC_PRIVACY_URL')
    expect(read('components/auth/auth-card.tsx')).toContain('if (!href) return <span>')
  })
})
