'use client'

import { notifyToast } from '@/components/shared/toast'
import { japaneseDetailOf } from '@/components/shared/api-error-message'
import { ApiError } from '@/lib/api'

/*
 * ★V7 sTJsh §1・§4「押したらすぐ反映」「確認の代わりに元に戻す」。
 *
 * - §4 消す系の操作（`runUndoable`）：画面からはすぐ消し、
 *   サーバーへは5秒後に送る。「元に戻す」で止めたら送らない。
 *   送信が失敗したら画面を元に戻して、やり直せる失敗の知らせを出す。
 * - §1 先に画面を変える軽い操作（`runOptimistic`）：表示は先に変えて
 *   すぐ送る。失敗したら元に戻して「もう一度」の知らせを出す。
 *
 * 取り消せない操作（配信を送る・支払い・予約を消す・友だちを消す・
 * 連携を切る）はここを通さず、従来どおり確認を残して返事を待つ。
 */

/** 「元に戻す」の猶予（toast の UNDO_DURATION と揃える）。 */
const UNDO_WINDOW_MS = 5000

type Commit = () => Promise<{ success: boolean; error?: string } | void> | void

/**
 * 画面側の変更を先に済ませたあと呼ぶ。`commit` は `UNDO_WINDOW_MS` 後に
 * 実行され、「元に戻す」または ⌘Z で止められる。
 *
 * `undo` は戻したときの画面の復元。`onCommitError` は送信失敗時の復元
 * （`undo` と同じ処理を渡せることが多い）。知らせの文は呼び出し側が
 * 運用者の言葉で渡す（例「3人から『VIP』を外しました」）。
 */
export function runUndoable(options: {
  message: string
  commit: Commit
  undo: () => void
  /** commit が失敗したときの画面の復元。省略すると undo を呼ぶ。 */
  onCommitError?: () => void
  /** 失敗の知らせの文面。 */
  failureMessage?: string
  /** commit が通ったあとに呼ぶ（一覧の読み直しなど）。 */
  onCommitted?: () => void
}): void {
  /*
   * 送信期限は知らせの期限と一つのもの（R623）。知らせの hover/focus で
   * 止まったら送信も止まり、離したら一緒に動く。期限が来る・戻すの
   * どちらかが先に決まったら `settled` になり、遅れた方は何もしない。
   * 送信を始めたあとの取り消しは画面だけ戻さない。
   */
  let settled = false
  let remaining = UNDO_WINDOW_MS
  let deadline = Date.now() + remaining
  let timer: ReturnType<typeof setTimeout> | null = null

  const fire = () => {
    if (settled) return
    settled = true
    timer = null
    // 期限が来たら知らせを消す。残った取り消し操作は効かない。
    dismiss()
    void Promise.resolve()
      .then(() => options.commit())
      .then((res) => {
        if (res && res.success === false) throw new Error(res.error ?? '')
        options.onCommitted?.()
      })
      .catch(() => {
        ;(options.onCommitError ?? options.undo)()
        notifyToast(options.failureMessage ?? 'できませんでした。もう一度お試しください。', { tone: 'error' })
      })
  }
  const arm = (ms: number) => {
    deadline = Date.now() + ms
    timer = setTimeout(fire, ms)
  }
  const pauseCommit = () => {
    if (settled || timer === null) return
    clearTimeout(timer)
    timer = null
    remaining = Math.max(0, deadline - Date.now())
  }
  const resumeCommit = () => {
    if (settled || timer !== null) return
    arm(remaining)
  }
  arm(remaining)

  const dismiss = notifyToast(options.message, {
    actionLabel: '元に戻す',
    onAction: () => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      timer = null
      options.undo()
    },
    lifecycle: { onPause: pauseCommit, onResume: resumeCommit },
  })
}

/**
 * 軽い操作を「押した瞬間」に画面へ反映し、裏で保存する（★V7 sTJsh §1）。
 *
 * `apply` で先に画面を変えてから呼ぶ。`request` が失敗したら `revert`
 * で戻し、「もう一度」で同じ操作をやり直せる知らせを出す。
 * 保存できたときは何も出さない（静かに終わる）。
 */
export function runOptimistic(options: {
  request: Commit
  revert: () => void
  /** 失敗の知らせの文面（例「タグを付けられませんでした」）。 */
  failureMessage: string
  /** 「もう一度」のやり直し。省略すると失敗の知らせは文だけ。 */
  retry?: () => void
  /** 保存が通ったあとに呼ぶ（一覧の読み直しなど）。 */
  onSuccess?: () => void
}): void {
  void Promise.resolve()
    .then(() => options.request())
    .then((res) => {
      if (res && res.success === false) throw new Error(res.error ?? '')
      options.onSuccess?.()
    })
    .catch(() => {
      options.revert()
      notifyToast(options.failureMessage, {
        tone: 'error',
        actionLabel: options.retry ? 'もう一度' : undefined,
        onAction: options.retry,
      })
    })
}

/** 失敗の理由（口が返した日本語）。機械の文（API error: 500 など）・空は出さない。 */
const failureReason = (error: unknown): string => japaneseDetailOf(error)

/**
 * ★V8 受信箱の右の欄でその場で直す（A-2 採用・B-26）。
 *
 * 呼び出し側が画面を先に変えてから呼ぶ。裏で `request` を送り、
 * - 通ったら白い知らせ「〇〇にしました ［元に戻す］」（5秒。乗せている間・押している間は止まる）。
 *   ［元に戻す］は画面を戻して `undoRequest` を送る。それも失敗したら、戻した画面をまた直して知らせる。
 * - 失敗したら画面を戻し、理由と［もう一度試す］の知らせを出す。
 * 知らせは提案 F の共通の知らせ（積み重ね・消えた隙間を詰める）。
 * 返り値は知らせを消す関数（メモのように続けて保存するとき、前の知らせを片づける）。
 */
export function runOptimisticWithUndo(options: {
  request: Commit
  revert: () => void
  /** 成功の知らせ（例「対応状況を対応中にしました」）。 */
  successMessage: string
  /** 失敗の知らせの頭（例「対応状況を変えられませんでした。」）。後ろに理由が付く。 */
  failureMessage: string
  retry: () => void
  /** 元に戻すときに送る。省略すると［元に戻す］を出さない。 */
  undoRequest?: Commit
  /** 元に戻したあと、もう一度戻す（元に戻すが失敗したときの画面の当て直し）。 */
  reapply?: () => void
  onSuccess?: (res: unknown) => void
  onFailure?: (error: unknown) => void
  /** 成功の文を保存の結果で変えるとき（メモの同時編集など）。渡すと successMessage より勝つ。 */
  successMessageOf?: () => string
}): { dismiss: () => void } {
  let dismissCurrent: () => void = () => {}
  const handle = { dismiss: () => dismissCurrent() }
  const fail = (error: unknown) => {
    options.revert()
    options.onFailure?.(error)
    const reason = failureReason(error)
    dismissCurrent = notifyToast(`${options.failureMessage}${reason ? reason : '通信を確かめて、もう一度お試しください。'}`, {
      tone: 'error',
      actionLabel: 'もう一度試す',
      onAction: options.retry,
    })
  }
  void Promise.resolve()
    .then(() => options.request())
    .then((res) => {
      if (res && res.success === false) throw new ApiError(400, res.error ?? '')
      options.onSuccess?.(res)
      const undoRequest = options.undoRequest
      const message = options.successMessageOf?.() ?? options.successMessage
      // 文が空なら知らせない（v7 の画面は今までどおり静かに終わる）。
      if (!message) return
      dismissCurrent = notifyToast(message, undoRequest ? {
        actionLabel: '元に戻す',
        onAction: () => {
          options.revert()
          void Promise.resolve()
            .then(() => undoRequest())
            .then((undoRes) => {
              if (undoRes && undoRes.success === false) throw new ApiError(400, undoRes.error ?? '')
            })
            .catch((error: unknown) => {
              options.reapply?.()
              const reason = failureReason(error)
              notifyToast(`元に戻せませんでした。${reason || '通信を確かめて、もう一度お試しください。'}`, { tone: 'error' })
            })
        },
      } : undefined)
    })
    .catch(fail)
  return handle
}
