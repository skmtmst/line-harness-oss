/*
 * 速さを測る前の「準備できたか」の判定（perf-large.mjs が使う。ROOT11）。
 *
 * 準備の条件を満たさないまま測ると、画面が開いていない・読み込み中・失敗の状態の
 * 時間を「正常な速さ」として記録してしまう。準備待ちの失敗は捨てずに投げ、
 * その場面を失敗として結果に残す。
 *
 * 準備の関数（ブラウザの中で動く）の返り値:
 *   true            … 期待するタブとデータが出た（測ってよい）
 *   'empty'/'error' … データが空・読み込み失敗（待たずに失敗にする）
 *   false/null      … まだ（待ち続ける）
 */

export class PerfNotReadyError extends Error {
  constructor(path, reason) {
    super(`${path}: 準備できないまま測ろうとしました（${reason}）`)
    this.name = 'PerfNotReadyError'
    this.path = path
    this.reason = reason
  }
}

/** 準備できるまで待つ。できなければ PerfNotReadyError を投げる。 */
export async function waitUntilReady(page, path, readyFn, { timeout = 30000 } = {}) {
  let state
  try {
    const handle = await page.waitForFunction(readyFn, null, { timeout })
    state = await handle.jsonValue()
  } catch (error) {
    throw new PerfNotReadyError(path, `${Math.round(timeout / 1000)}秒待っても出ませんでした: ${String(error?.message ?? error).slice(0, 160)}`)
  }
  if (state !== true) throw new PerfNotReadyError(path, typeof state === 'string' ? state : '準備の判定が true を返しませんでした')
}

/*
 * 監査の記録（/staff?tab=audit）。いま開いているタブが「入った記録」で、
 * 記録の表（jwVlo）にデータの行（「開く」付き）が出たときだけ準備できたとする。
 * /staff の main が出ただけ（いまいる人のタブ・読み込み中）では測らない。
 */
export function auditReady() {
  const current = document.querySelector('a[aria-current="page"][href*="tab=audit"]')
  if (!current) return false
  const panel = document.querySelector('[data-design-node="jwVlo"]')
  if (!panel) return false
  const text = panel.textContent ?? ''
  if (text.includes('読み込めませんでした') || text.includes('見る権限がありません')) return 'error'
  if (text.includes('条件に合う記録はありません')) return 'empty'
  const rows = [...panel.querySelectorAll('tbody tr')].filter((row) => row.querySelector('button'))
  return rows.length > 0 ? true : false
}
