import type { ConfirmedUndoHandle, ConfirmedUndoResult, runUndoable } from '@/lib/undoable'
import { notifyToast } from '@/components/shared/toast'

type Options = Parameters<typeof runUndoable>[0] & { confirmation?: boolean }

/** Test scheduler: callers trigger execute explicitly instead of waiting for the five-second window.
 * Timer/pointer/focus behaviour is covered with the real helper in undoable-confirmation.test.tsx.
 */
export function scheduledConfirmation(options: Options): { handle: ConfirmedUndoHandle; execute: Options['commit'] } {
  let finish!: (result: ConfirmedUndoResult) => void
  let closeWindow!: () => void
  let settled = false
  const finished = new Promise<ConfirmedUndoResult>(resolve => { finish = resolve })
  const undoWindowClosed = new Promise<void>(resolve => { closeWindow = resolve })
  const execute = async () => {
    if (settled) return
    settled = true; closeWindow()
    let result: Awaited<ReturnType<Options['commit']>>
    try {
      result = await options.commit()
      if (result && result.success === false) throw new Error(result.error ?? '')
    } catch (error) {
      try { (options.onCommitError ?? options.undo)() }
      finally { finish({ status: 'failed', error, message: options.failureMessage }) }
      throw error
    }
    finish({ status: 'committed' })
    try { await options.onCommitted?.() }
    catch { notifyToast('保存しました。表示を読み直してください。', { tone: 'error' }) }
    return result
  }
  return { execute, handle: { finished, undoWindowClosed,
    undo: () => { if (settled) return; settled = true; closeWindow(); try { options.undo() } finally { finish({ status: 'undone' }) } },
    pause: () => {}, resume: () => {},
  } }
}
