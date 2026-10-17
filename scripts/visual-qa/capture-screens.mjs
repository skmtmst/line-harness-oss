/** Current capture-session setup. The old V6 registry/capture CLI is retired. */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function initializeCapture([entries]) {
  for (const [key, value] of entries) localStorage.setItem(key, value)
  try {
    window.sessionStorage.setItem('lh_visual_qa_capture', '1')
  } catch {
    // Storage can be unavailable in a sandboxed page.
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  throw new Error('旧V6の撮影CLIは廃止しました。現行画面の撮影は v8-parity.mjs または v8-guard/shots.mjs を使います')
}
