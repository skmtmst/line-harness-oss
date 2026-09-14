// N-204 (#796): 一覧の容量案内は口の state で文言と行動案を変える。
// 80%未満は何も足さない。80%以上は整理の案内、上限到達は保存不可の案内。
// 件数・KPIは quota の値だけを使い、画面内で推定しない。
import type { MediaQuota } from '@/lib/api'
import { formatMediaSize } from './media-usage-display'

export function MediaQuotaGuidance({
  quota,
  failed,
  onShowNearLimit,
}: {
  quota: MediaQuota | null
  failed: boolean
  onShowNearLimit: () => void
}) {
  if (!quota) {
    return (
      <p className={failed ? 'text-danger text-xs' : 'text-ink-faint text-xs'}>保存容量を確認できませんでした。</p>
    )
  }
  return (
    <>
      <div className="bg-canvas-sunken mt-1 ml-auto h-1.5 w-56 overflow-hidden rounded-pill" role="progressbar" aria-label="保存容量" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(quota.usageRate * 100))}>
        <div className={`h-full rounded-pill ${quota.state === 'full' ? 'bg-danger' : quota.state === 'warning' || quota.state === 'notice' ? 'bg-warning' : 'bg-accent-deep'}`} style={{ width: `${Math.min(100, quota.usageRate * 100)}%` }} />
      </div>
      <p className="text-ink-faint mt-1 text-xs">残り {formatMediaSize(quota.remainingBytes)}{quota.reservedBytes > 0 ? `（送信のため確保中 ${formatMediaSize(quota.reservedBytes)} を含む）` : ''}</p>
      {quota.state === 'full' ? (
        <div className="mt-1">
          <p className="text-danger text-xs">保存容量の上限に達しました。新しいファイルは保存できません。</p>
          <button type="button" onClick={onShowNearLimit} className="text-accent-deep mt-0.5 text-xs underline">
            上限に近いものを見る
          </button>
        </div>
      ) : quota.state === 'warning' || quota.state === 'notice' ? (
        <div className="mt-1">
          <p className="text-warning text-xs">保存容量の80%以上を使っています。不要なファイルを整理してください。</p>
          <button type="button" onClick={onShowNearLimit} className="text-accent-deep mt-0.5 text-xs underline">
            上限に近いものを見る
          </button>
        </div>
      ) : null}
    </>
  )
}
