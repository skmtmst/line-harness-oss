/**
 * 画面が見えている間だけ動く定期取得の土台(#630)。
 *
 * 一斉配信の進捗・問い合わせ一覧・メール会話の3つが、それぞれ5秒ごとに
 * 取り直している。タブを隠しても裏で回り続け、失敗しても黙って速いまま
 * 叩き続けるので、ここに寄せる。使い方は `startVisiblePoll` だけ。
 *
 * 約束:
 * - 5秒起点、同時に1本だけ。止めるときは返す `stop` を呼ぶ(unmountで必ず)。
 *   取得の実行中に表示が戻っても別tickを予約しない(終わったtickが
 *   次を予約するので、ここで足すと遅い取得と二重になる)。
 * - `immediate: true` のときは開始直後に1回すぐ走らせる。初回の取得も
 *   同じ1本に載せるためで、外で `void load()` を別に走らせない(重複と
 *   順序逆転の元)。初回は終わってから次を予約するので二重にならない。
 * - **初回の1回だけは `shouldPoll` を見ない。** 画面や絞り込みを変えた
 *   直後に「もう更新しない対象」でも、いま出ている中身は前の対象のもの。
 *   1回も取らずに休むと古い一覧が残ったままになる(問い合わせの
 *   「対応済み」「すべて」がそうだった)。取ってから休む。
 * - タブ非表示の間は取得しない。表示に戻ったら失敗回数に応じた
 *   待ちで再開する(固定5秒に戻すと、失敗続きの相手を非表示の往復
 *   だけで速く叩き直してしまう)。ただし初回がまだなら待たせない。
 *   隠れたタブで開いた画面が、表示に戻ってから更に5秒
 *   「読み込み中」のままになるのを避ける。
 * - `shouldPoll` が false を返したら休む(次を予約しない)。完了後に
 *   通信しないタイマーを回し続けると、終わった画面が無期限に起き続ける。
 *   再開したくなったら `wake()` を呼ぶ(対応済みのスレッドを再オープン
 *   したときなど)。表示イベントとeffectの作り直しでも再開する。
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

/**
 * 世代カウンタ。画面・選択の切替で古くなった取得の応答を捨てる(#630)。
 *
 * 使い方: fetchの直前に `next()` で番号を取り、応答が戻ったら
 * `isStale(番号)` を見る。trueなら誰か新しい取得が始まっているので、
 * setStateせずに捨てる。sidebarの seq ガードと同じ考え。
 */
export function createPollGeneration() {
  let latest = 0
  return {
    next(): number {
      latest += 1
      return latest
    },
    isStale(seq: number): boolean {
      return seq !== latest
    },
  }
}

export type VisiblePollOptions = {
  /** 対象が処理中/未解決の間だけ true を返す。falseの間は休む。 */
  shouldPoll?: () => boolean
  /** 1回分の取得。失敗したら例外を投げる。 */
  work: () => Promise<unknown>
  /** 上限回数を超えたら1回だけ呼ばれる。 */
  onGiveUp?: (consecutiveFailures: number) => void
  /** 失敗のあと初めて成功したら1回だけ呼ばれる。 */
  onRecovered?: () => void
  /**
   * trueで開始直後に1回すぐ走らせる(初回取得も同じ1本)。
   * 省いたら5秒後に始まる。初回を外で別に走らせると重複するので、
   * 初回が要る画面はこっちを使う。
   */
  immediate?: boolean
}

export type VisiblePollHandle = {
  /** 止める。unmountで必ず呼ぶ。 */
  stop: () => void
  /**
   * 休んでいたら起こす。`shouldPoll` が true に戻ったときに呼ぶ
   * (対応済み→再オープンなど)。すでに動いていれば何もしないので、
   * 二重に回ることはない。
   */
  wake: () => void
}

/** 5秒起点の単一ループを始める。返す `stop` で止める。 */
export function startVisiblePoll(options: VisiblePollOptions): VisiblePollHandle {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let failures = 0
  let gaveUp = false
  // 取得の実行中か。表示の往復で別tickを予約しないための印。
  let inFlight = false
  // 初回の取得がまだ残っているか。初回だけは shouldPoll を見ずに走らせる。
  let firstPending = options.immediate === true

  const isHidden = () =>
    typeof document !== 'undefined' && document.hidden === true
  const hasVisibilityEvents = () =>
    typeof document !== 'undefined' && typeof document.addEventListener === 'function'
  // falseの間は休む。完了後のタイマー空回りを止めるための判定。
  const shouldRest = () => options.shouldPoll?.() === false

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
    // 対象が終わっていたら休む。次を予約しない(完了後の空回り防止)。
    // ただし初回の1回だけは取る(古い中身を残さない)。
    if (!firstPending && shouldRest()) return
    firstPending = false
    inFlight = true
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
      // 休みに入ったなら再試行も予約しない。失敗回数は残るので、
      // `wake()` で再開したときは相応の待ちから始まる。
      if (!shouldRest()) schedule(visiblePollDelayMs(failures))
      return
    } finally {
      inFlight = false
    }
    if (failures > 0) {
      failures = 0
      options.onRecovered?.()
    }
    if (shouldRest()) return
    schedule(VISIBLE_POLL_BASE_MS)
  }

  // 休みから戻すときの共通処理。動いている間は何もしない。
  const resume = () => {
    if (stopped || gaveUp) return
    if (isHidden()) return
    if (timer !== null || inFlight) return
    // 初回がまだなら待たせない。隠れたタブで開いた画面が、表示に
    // 戻ってから更に5秒「読み込み中」のままになるのを避ける。
    if (firstPending) {
      void tick()
      return
    }
    if (shouldRest()) return
    schedule(visiblePollDelayMs(failures))
  }

  const onVisibilityChange = () => {
    if (stopped || gaveUp) return
    if (isHidden()) {
      clearTimer()
      return
    }
    resume()
  }

  if (hasVisibilityEvents()) {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  if (!isHidden()) {
    if (firstPending) {
      // 初回も同じ1本に載せる。終わってから次を予約するので二重にならない。
      void tick()
    } else if (!shouldRest()) {
      schedule(VISIBLE_POLL_BASE_MS)
    }
  }

  return {
    stop() {
      stopped = true
      clearTimer()
      if (hasVisibilityEvents()) {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
    },
    wake: resume,
  }
}
