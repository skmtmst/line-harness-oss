/** ブラウザ内の実データと読み込み状態を確認する。mainだけでは測定を始めない。 */
export function screenReady({ route, expectedRows = null }) {
  if (document.documentElement.dataset.theme !== 'v8') return false
  const main = document.querySelector('main')
  if (!main || !main.textContent?.trim()) return false
  const text = main.textContent
  if (/画面を表示できませんでした|Application error|読み込めませんでした|見る権限がありません/.test(text)
    || main.querySelector('[data-list-state="error"], [data-list-state="forbidden"]')) return 'error'
  if (main.querySelector('[aria-busy="true"], [data-list-state="loading"]')) return false
  if (route === '/friends') {
    if (!main.querySelector('[data-friend-row]')) return false
    // 応答だけでなく描画済みの行を数える。件数表示の文言・助数に依存しない。
    if (expectedRows !== null && main.querySelectorAll('[data-friend-row]').length !== expectedRows) return false
  }
  return true
}

