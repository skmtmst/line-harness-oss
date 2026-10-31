'use client'

import Card from '@/components/shared/card'
import StatusBadge from '@/components/shared/status-badge'
import { StepPreview } from './flow-editor'
import { RESTAURANT_TRIGGER_ROWS } from './config'
import styles from './demo.module.css'

/** 設定画面の見本。実データは読まず、ここだけを新しい画面へ差し替える。 */
export function RestaurantFollowupDemo() {
  const sample = RESTAURANT_TRIGGER_ROWS.find(row => row.trigger === 'reservation_24h')!
  return <div className={styles.layout} aria-label="LINE来店フォローの見本">
    <div className={styles.rows}>
      <h4>LINE来店フォロー</h4>
      {RESTAURANT_TRIGGER_ROWS.map(row => <Card key={row.trigger} layout="block" padding="compact">
        <div className={styles.row}><span>{row.name}</span><StatusBadge tone="neutral">まだありません</StatusBadge></div>
      </Card>)}
    </div>
    <Card layout="vertical" padding="compact" aria-label="LINEでの見え方">
      <h4>LINEでの見え方（文の見本）</h4>
      <StepPreview accountName="見本のお店" bubbles={[{ id: 'sample', type: 'text', content: { text: sample.sampleText } }]} />
    </Card>
  </div>
}
