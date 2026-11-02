'use client'

import Card from '@/components/shared/card'
import StatusBadge from '@/components/shared/status-badge'
import styles from './style-demo-pages.module.css'

type SalonEntry = { time: string; name: string; menu: string; state: 'done' | 'booked'; stateLabel: string }
type SalonColumn = { staff: string; next: string; entries: SalonEntry[] }

/** script.ts のサロン盤の見本と同じ架空の値。実データの読み書きはしない。 */
const SALON_BOARD_SAMPLE: SalonColumn[] = [
  {
    staff: '見本 あおい', next: '次の空き 14:00',
    entries: [
      { time: '10:00–11:00', name: '見本 ゆい', menu: 'カット', state: 'done', stateLabel: '来店済み' },
      { time: '11:30–12:30', name: '見本 みお', menu: 'カット', state: 'booked', stateLabel: '予約' },
    ],
  },
  {
    staff: '見本 れん', next: '次の空き 10:00',
    entries: [
      { time: '12:00–13:00', name: '見本 そら', menu: 'トリートメント', state: 'booked', stateLabel: '予約' },
    ],
  },
]

/** サロン3ページ目「担当ごとの予定を確認する」の静止見本。保存・送信はしない。 */
export default function SalonOperationDemo() {
  return <section aria-label="担当ごとの予定の見本">
    <p className={styles.note}>画面と操作の見本です。実際の設定は変わりません。</p>
    <Card layout="vertical" padding="default" gap="normal" aria-label="担当ごとの予定">
      <strong>担当ごとの予定（見本）</strong>
      {SALON_BOARD_SAMPLE.map(column => (
        <section key={column.staff} aria-label={`${column.staff}の予定`}>
          <p className={styles.description}>{column.staff}・{column.next}</p>
          <ul className={styles.can}>
            {column.entries.map(entry => (
              <li key={`${column.staff}-${entry.time}`}>
                <StatusBadge tone={entry.state === 'done' ? 'success' : 'info'}>{entry.stateLabel}</StatusBadge>
                <span>{entry.time} {entry.name} さま・{entry.menu}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className={styles.note}>名前・数は架空です。見本のため実際の設定は変わりません。</p>
    </Card>
  </section>
}
