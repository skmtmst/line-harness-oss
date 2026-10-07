/**
 * 会員登録（★V6 36-4）・メール＋パスワードのログイン（0-1）・パスワード再設定（36-6）の、画面側の道具。
 *
 * API は `routes/auth-email.ts`。ログイン前の入口なので `fetchApi` は使わない
 * （401 を「セッション切れ」として扱われると困る。返事の言葉はすべて Worker が
 * 利用者向けに書いたものなので、状態にかかわらずそのまま出す）。
 */

export const PASSWORD_MIN_LENGTH = 8

export interface AuthResult<T> {
  ok: boolean
  status: number
  data?: T
  csrfToken?: string
  error?: string
  code?: string
  errors?: Record<string, string>
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

export async function authRequest<T>(path: string, body?: unknown, method: 'GET' | 'POST' = body === undefined ? 'GET' : 'POST'): Promise<AuthResult<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean
      data?: T
      csrfToken?: string
      error?: string
      code?: string
      errors?: Record<string, string>
    }
    return {
      ok: res.ok && json.success === true,
      status: res.status,
      data: json.data,
      csrfToken: json.csrfToken,
      error: json.error,
      code: json.code,
      errors: json.errors,
    }
  } catch {
    return { ok: false, status: 0, error: '通信できませんでした。電波の状態を確かめて、もう一度お試しください' }
  }
}

/**
 * 公開入口（ログイン・本登録）の失敗文。Worker が書いた利用者向けの日本語は
 * そのまま返す。`audit_unavailable` のような内部コードだけ、日本語の失敗理由と
 * 再試行案内へ変える。呼び出し側は `?? res.error ?? 従来文言` で使う。
 */
export function internalAuthFailureCopy(status: number, error: string | undefined): string | null {
  if (error && /[぀-ヿ一-鿿]/.test(error)) return null
  if (status === 429) return '混み合っています。少し待ってから、もう一度お試しください。'
  if (status === 401) return 'メールアドレスかパスワードが違います。もう一度お試しください。'
  return '通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度お試しください。'
}

/** メールの形。Worker と同じ「@ の両側に何かあり、空白が無い」程度。 */
export function emailError(value: string): string | null {
  const email = value.trim()
  if (!email) return 'メールアドレスを入力してください'
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'メールアドレスの形式が正しくありません'
  return null
}

/** パスワードの決まり。Worker の `validatePasswordPolicy` と同じ。 */
export function passwordError(value: string): string | null {
  if (!value) return 'パスワードを入力してください'
  if (value.length < PASSWORD_MIN_LENGTH) return `パスワードは${PASSWORD_MIN_LENGTH}文字以上で入力してください`
  if (value.length > 128) return 'パスワードは128文字以内で入力してください'
  if (/\s/.test(value)) return 'パスワードに空白は使えません'
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return 'パスワードは英字と数字の両方を含めてください'
  return null
}

export function confirmError(password: string, confirm: string): string | null {
  if (!confirm) return '確認のため、もう一度入力してください'
  if (password !== confirm) return 'パスワードが一致しません'
  return null
}

const DEVICE_MARKER_KEY = 'lh_signup_marker'
const SIGNUP_EMAIL_KEY = 'lh_signup_email'

/** 「このブラウザで登録済み」の印。本登録が終わったときに Worker から受け取って残す。 */
export function readDeviceMarker(): string | null {
  try {
    return localStorage.getItem(DEVICE_MARKER_KEY)
  } catch {
    return null
  }
}

export function storeDeviceMarker(marker: string): void {
  try {
    localStorage.setItem(DEVICE_MARKER_KEY, marker)
  } catch {
    // 保存できなくても Worker 側の Cookie が同じ役目をする
  }
}

/** 「送りました」画面に出すため、入力したメールを同じタブの中だけで持ち回す（URL には載せない）。 */
export function rememberSignupEmail(email: string): void {
  try {
    sessionStorage.setItem(SIGNUP_EMAIL_KEY, email)
  } catch {
    // 出せないだけ
  }
}

export function recallSignupEmail(): string {
  try {
    return sessionStorage.getItem(SIGNUP_EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

/**
 * 同意欄・ログイン前のフッターのリンク先。
 *
 * 文面はサービスサイト（musubo.jp）に 2026-10-04 に承認・公開済み。配備の変数が
 * 無くてもリンクが空にならないよう、既定は公開先にする（変数があればそちらを使う）。
 */
export const MUSUBO_SITE_URL = 'https://musubo.jp'
export const LEGAL_LINKS = {
  terms: process.env.NEXT_PUBLIC_TERMS_URL || `${MUSUBO_SITE_URL}/terms/`,
  privacy: process.env.NEXT_PUBLIC_PRIVACY_URL || `${MUSUBO_SITE_URL}/privacy/`,
  commerce: process.env.NEXT_PUBLIC_COMMERCE_LAW_URL || `${MUSUBO_SITE_URL}/legal/`,
} as { terms: string | null; privacy: string | null; commerce: string | null }

/**
 * ログイン前に開けるお問い合わせの口。サービスサイトの /contact/ へつなぐ。
 * 新しい公開フォームは作らない（監査 m18e・2026-09-27 司令塔の決定）。
 * 管理画面の /hq/support はログインが要るので、ログイン前の導線には使わない。
 */
export const CONTACT_URL = process.env.NEXT_PUBLIC_CONTACT_URL || `${MUSUBO_SITE_URL}/contact/`

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null

/** ログイン前に開ける画面。`app-shell` と `auth-guard` の両方がこれを見る（片方だけ足すと壊れる）。 */
export const PUBLIC_AUTH_PATHS = ['/login', '/login/two-factor', '/login/two-factor/setup', '/staff/invite', '/staff/email-change', '/register', '/register/sent', '/register/complete', '/password/forgot', '/password/reset', '/ops/login', '/ops/invite'] as const

export function isPublicAuthPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return (PUBLIC_AUTH_PATHS as readonly string[]).includes(normalized)
}
