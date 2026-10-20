'use client'
import Button from '@/components/shared/button'
import SaveConflictBar from '@/components/shared/save-conflict-bar'
import styles from '../../app/emergency/control-v8.module.css'

type StopBlocker = 'unavailable' | 'forbidden' | 'scope' | 'empty' | 'stopped'
const blockerText: Record<StopBlocker, string> = {
    unavailable: '停止状態を確認できないため、停止・復旧を実行できません。',
    forbidden: '緊急停止を実行する権限がありません。オーナーに権限付与を依頼してください。',
    scope: 'この範囲を操作する権限がありません。対象アカウントを選び直すか、オーナーに確認してください。',
    empty: '停止する配信を1つ以上選んでください。',
    stopped: 'いまは止めています。戻すときは「復旧する」を使います。',
  }
export function EmergencyControlFeedback({ message, needsReload, reloading, stopBlockers, onReload }: {
  message: { tone: 'success' | 'warning' | 'danger'; text: string } | null
  needsReload: boolean
  reloading: boolean
  previewSettled?: boolean
  stopBlockers: StopBlocker[]
  onReload: () => void
}) {
  return <>
      {needsReload ? (
        <SaveConflictBar
          message={message?.text ?? '最新の状態を読み直してから、もう一度確認してください。'}
          actionLabel={reloading ? '読み直しています…' : '最新の状態を読み直す'}
          onAction={() => onReload()}
          actionQa="emergency-reload"
        />
      ) : null}

      {stopBlockers.length > 0 ? (
        <div className={`${styles.feedbackBand} ${styles.feedbackWarn}`} role="status">
          <span>{stopBlockers.map((blocker) => blockerText[blocker]).join('')}</span>
          {stopBlockers.includes('unavailable') ? (
            <Button type="button" onClick={() => onReload()} disabled={reloading} busy={reloading} busyLabel="読み直しています…">
              最新の状態を読み直す
            </Button>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <div
          className={`${styles.feedbackBand} ${message.tone === 'danger' ? styles.feedbackDanger : message.tone === 'warning' ? styles.feedbackWarn : styles.feedbackSuccess}`}
          role={message.tone === 'success' ? 'status' : 'alert'}
        >
          <span>{message.text}</span>
          {message.tone !== 'success' && needsReload ? (
            <Button type="button" onClick={() => onReload()} disabled={reloading} busy={reloading} busyLabel="読み直しています…">
              最新の状態を読み直す
            </Button>
          ) : null}
        </div>
      ) : null}

  </>
}
