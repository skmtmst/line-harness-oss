/**
 * 画面が見えている間だけ動く定期取得の土台(#630)。
 *
 * 一斉配信の進捗・問い合わせ一覧・メール会話の3つが、それぞれ5秒ごとに
 * 取り直している。タブを隠しても裏で回り続け、失敗しても黙って速いまま
 * 叩き続けるので、ここに寄せる。使い方は `startVisiblePoll` だけ。
 *
 * 約束:
 * - 5秒起点、同時に1本だけ。止めるときは返す関数を呼ぶ(unmountで必ず)。
 * - タブ非表示の間は取得しない。表示に戻ったら失敗回数に応じた
 *   待ちで再開する(固定5秒に戻すと、失敗続きの相手を非表示の往復
 *   だけで速く叩き直してしまう)。
 * - 対象が処理中/未解決でない間も取得しない(`shouldPoll` が false の間)。
 * - 連続失敗は 5秒→10秒→20秒→40秒→60秒(上限)と待ちを延ばす。
 * - 5回続けて失敗したら止まり、`onGiveUp` を1回呼ぶ。画面は理由と
 *   再試行ボタンを出す(再試行は `startVisiblePoll` の呼び直し)。
 * - 失敗のあと成功したら `onRecovered` を1回呼ぶ。
 */

export const VISIBLE_POLL_BASE_MS = 5000
export const VISIBLE_POLL_MAX_DELAY_MS = 60000
export const VISIBLE_POLL_MAX_FAILURES = 5

/** 連続失敗回数から次の待ち時間を返す。0回は5秒。 */
export function visiblePollDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return VISIBLE_POLL_BASE_MS
  const capped = Math.min(consecutiveFailures, 4)
  return Math.min(VISIBLE_POLL_BASE_MS * 2 ** capped, VISIBLE_POLL_MAX_DELAY_MS)
}

export type VisiblePollOptions = {
  /** 対象が処理中/未解決の間だけ true を返す。省いたら可視の間ずっと動く。 */
  shouldPoll?: () => boolean
  /** 1回分の取得。失敗したら例外を投げる。 */
  work: () => Promise<unknown>
  /** 上限回数を超えたら1回だけ呼ばれる。 */
  onGiveUp?: (consecutiveFailures: number) => void
  /** 失敗のあと初めて成功したら1回だけ呼ばれる。 */
  onRecovered?: () => void
}

/** 5秒起点の単一ループを始める。返す関数で止める。 */
export function startVisiblePoll(options: VisiblePollOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let failures = 0
  let gaveUp = false

  const isHidden = () =>
    typeof document !== 'undefined' && document.hidden === true
  const hasVisibilityEvents = () =>
    typeof document !== 'undefined' && typeof document.addEventListener === 'function'

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const schedule = (delay: number) => {
    if (stopped || gaveUp) return
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      void tick()
    }, delay)
  }

  const tick = async () => {
    if (stopped || gaveUp) return
    // 非表示の間は取得せず、表示イベントで再開する(タイマーを残さない)。
    if (isHidden()) return
    if (options.shouldPoll?.() === false) {
      schedule(VISIBLE_POLL_BASE_MS)
      return
    }
    try {
      await options.work()
    } catch {
      failures += 1
      if (failures >= VISIBLE_POLL_MAX_FAILURES) {
        gaveUp = true
        clearTimer()
        options.onGiveUp?.(failures)
        return
      }
      schedule(visiblePollDelayMs(failures))
      return
    }
    if (failures > 0) {
      failures = 0
      options.onRecovered?.()
    }
    schedule(VISIBLE_POLL_BASE_MS)
  }

  const onVisibilityChange = () => {
    if (stopped || gaveUp) return
    if (isHidden()) {
      clearTimer()
    } else if (timer === null) {
      schedule(visiblePollDelayMs(failures))
    }
  }

  if (hasVisibilityEvents()) {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  // 開いた瞬間に隠れているタブでは回さない。表示イベントで再開する。
  if (!isHidden()) schedule(VISIBLE_POLL_BASE_MS)

  return () => {
    stopped = true
    clearTimer()
    if (hasVisibilityEvents()) {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }
}
