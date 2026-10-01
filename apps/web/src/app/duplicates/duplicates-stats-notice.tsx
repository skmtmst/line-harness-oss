import { loadFailureCopy } from '@/components/shared/api-error-message'

/**
 * R598: 集計（`GET /api/duplicates/stats`）だけ失敗しても、取得済みの
 * 候補一覧は残す。集計の失敗はこの1行で伝えて、やり直せるものだけ
 * 再試行の口を出す（403は権限の案内にし、押しても直らない再試行は出さない）。
 *
 * ★V7 `x63W5x`：失敗の帯は増やさず、取り直し失敗と同じ中立の1行
 * （`text-ink-secondary text-xs`＋`text-action` の再試行）にする。赤は使わない。
 */
export default function DuplicatesStatsNotice({
  failure,
  onRetry,
}: {
  failure: unknown
  onRetry: () => void
}) {
  const copy = loadFailureCopy(failure, '集計')
  return (
    <p className="text-ink-secondary text-xs" role="status">
      {copy.title}。{copy.description}
      候補一覧は取得済みの内容を表示しています。
      {copy.retryable ? (
        <button
          type="button"
          className="text-action ml-2 font-semibold hover:underline"
          onClick={onRetry}
        >
          もう一度
        </button>
      ) : null}
    </p>
  )
}
