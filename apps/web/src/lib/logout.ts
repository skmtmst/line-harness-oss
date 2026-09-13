import { adminSessionHeaders, clearAdminSession } from './admin-session'
import { AUTH_SELECTION_CLEARED_KEY } from './hq-navigation'

/**
 * ログアウト。共通トップバーと、統括の左下アカウントメニューが同じものを呼ぶ。
 *
 * サーバーのセッションを消し、手元に残した名前・権限・CSRF も消してから
 * ログイン画面へ移る。通信に失敗しても手元の後始末は必ず行う。
 */
export async function logoutAndGoToLogin(): Promise<void> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    if (apiUrl) {
      await fetch(`${apiUrl}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: adminSessionHeaders(),
      })
    }
  } catch {
    // 通信に失敗しても、手元の後始末は必ず行う
  }
  try {
    localStorage.removeItem('lh_api_key')
    localStorage.removeItem('lh_csrf')
    localStorage.removeItem('lh_staff_name')
    localStorage.removeItem('lh_staff_role')
    localStorage.removeItem('lh_staff_permissions')
    sessionStorage.removeItem(AUTH_SELECTION_CLEARED_KEY)
  } catch {
    // ストレージが使えなくても、行き先だけは変える
  }
  clearAdminSession()
  window.location.href = '/login'
}
