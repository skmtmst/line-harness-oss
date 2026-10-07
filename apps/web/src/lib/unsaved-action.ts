/** V8のアカウント切替など、URLの変わらない離脱にも共通の確認を通す。 */
export const UNSAVED_ACTION_EVENT = 'musubo:request-unsaved-action'
export function requestUnsavedAction(run: () => void): void {
  if (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'v8') {
    const event = new CustomEvent<{ run: () => void }>(UNSAVED_ACTION_EVENT, { cancelable: true, detail: { run } })
    if (!window.dispatchEvent(event)) return
  }
  run()
}
