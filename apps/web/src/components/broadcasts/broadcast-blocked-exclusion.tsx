'use client'

import Card from '@/components/shared/card'
import StatusBadge from '@/components/shared/status-badge'
import styles from './broadcast-form-v8.module.css'

/**
 * ブロック中の人は必ず除く。外せない決まりなので押せる形（チェック）にせず、札で言い切る。
 * 対象の節で伝えるのはここ 1 か所だけにする（同じことを上の行や注意書きで繰り返さない）。
 */
export function BroadcastBlockedExclusion() {
  return (
    <Card layout="horizontal" padding="compact">
      <div className={styles.exclusionText}>
        <strong>ブロック中の人</strong>
        <small>ブロック中・非表示・宛先不明の友だちには送りません</small>
      </div>
      <StatusBadge tone="neutral">いつも除きます</StatusBadge>
    </Card>
  )
}
