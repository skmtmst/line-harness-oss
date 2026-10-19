'use client'
import {
type BannerUsage
} from '@/lib/hq-banners';
import styles from './generation-panel.module.css';



/**
 * パネル内の利用量の棒（板 ）。空きがあるときだけ出す。上限のときは下の帯が出る。
 * `heading` を渡すと上に「利用量」を置く（★BG-B `qIp42` の `ta8eS`。棒と同時に出る）。
 * 文字は `ta8eS` 3文字 w=37・h=17 ＝ 12px・太さ600 で、同じパネルの「色の決め方」と同じ見た目。
 */
export function UsageBars({ usage, heading, v8Layout }: { usage: BannerUsage | null; heading?: boolean; v8Layout?: boolean }) {
  if (!usage) return null
  if (usage.blocked || usage.paused || usage.month.remaining <= 0 || usage.today.remaining <= 0) return null
  const rows = [
    { label: '今月', bucket: usage.month },
    { label: '今日', bucket: usage.today },
  ]
  return (
    <div data-design-node="iMnph-usage" className={v8Layout ? 'flex flex-col gap-2 rounded-control bg-canvas-sunken p-3' : 'flex flex-col gap-1.5'}>
      {heading ? <p className={v8Layout ? styles.v8Caption : "text-caption font-semibold text-ink"}>利用量</p> : null}
      {rows.map(({ label, bucket }) => {
        const pct = bucket.limit > 0 ? Math.max(0, Math.min(100, (bucket.remaining / bucket.limit) * 100)) : 0
        return (
          <div key={label} className={v8Layout ? 'flex flex-col gap-1' : 'flex items-center gap-2'}>
            {v8Layout ? <div className={styles.v8UsageLabels}><span>{label}</span><span>{`残り ${bucket.remaining} / ${bucket.limit} 枚`}</span></div> : <span className="w-8 shrink-0 text-micro text-ink-secondary">{label}</span>}
            <span className={v8Layout ? 'h-1.5 w-full shrink-0 overflow-hidden rounded-pill bg-hairline' : 'h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-hairline'}>
              <span className="block h-full rounded-pill bg-success" style={{ width: `${pct}%` }} />
            </span>
            {v8Layout ? null : <span className="shrink-0 text-micro text-ink-secondary">残り{bucket.remaining}/{bucket.limit}枚</span>}
          </div>
        )
      })}
    </div>
  )
}
