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

type ConsultEntry = { time: string; name: string; meet: string; stateLabel: string }
type ConsultColumn = { staff: string; next: string; entries: ConsultEntry[] }

/** script.ts の面談盤の見本と同じ架空の値。実データの読み書きはしない。 */
const CONSULT_BOARD_SAMPLE: ConsultColumn[] = [
  {
    staff: '見本 かい', next: '次の空き 11:00',
    entries: [
      { time: '10:00–10:45', name: '見本 ひな', meet: 'オンライン', stateLabel: '予約' },
    ],
  },
  {
    staff: '見本 なな', next: '次の空き 10:00',
    entries: [
      { time: '10:30–11:15', name: '見本 りく', meet: '対面', stateLabel: '予約' },
    ],
  },
]

/** サロン3ページ目「担当ごとの予定を確認する」の静止見本。保存・送信はしない。 */
export function SalonOperationDemo() {
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

type LessonEntry = { time: string; name: string; note: string; tone: 'success' | 'info'; stateLabel: string }

/**
 * 教室のクラスの見本の値。購入・月謝・決済は描かない（未検証のため完成済みとしない）。
 * 実データの読み書きはしない。
 */
const LESSON_BOARD_SAMPLE: LessonEntry[] = [
  { time: '9:00–10:00', name: '朝のヨガ', note: '12人', tone: 'success', stateLabel: '出席済み' },
  { time: '10:00–11:00', name: 'はじめてのヨガ', note: '残り 3・出欠待ち 2人', tone: 'info', stateLabel: '出欠待ち' },
  { time: '14:00–15:00', name: 'おひるのヨガ', note: '残り 8', tone: 'info', stateLabel: '受付中' },
]

/** 面談・相談3ページ目「相談の予定を確認する」の静止見本。保存・送信はしない。 */
export function ConsultOperationDemo() {
  return <section aria-label="相談の予定の見本">
    <p className={styles.note}>画面と操作の見本です。実際の設定は変わりません。</p>
    <Card layout="vertical" padding="default" gap="normal" aria-label="相談の予定">
      <strong>相談の予定（見本）</strong>
      {CONSULT_BOARD_SAMPLE.map(column => (
        <section key={column.staff} aria-label={`${column.staff}の予定`}>
          <p className={styles.description}>{column.staff}・{column.next}</p>
          <ul className={styles.can}>
            {column.entries.map(entry => (
              <li key={`${column.staff}-${entry.time}`}>
                <StatusBadge tone="info">{entry.stateLabel}</StatusBadge>
                <span>{entry.time} {entry.name} さま・{entry.meet}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className={styles.note}>名前・数は架空です。見本のため実際の設定は変わりません。</p>
    </Card>
  </section>
}

/** 教室・レッスン3ページ目「クラスの予定を確認する」の静止見本。保存・送信はしない。 */
export function LessonOperationDemo() {
  return <section aria-label="クラスの予定の見本">
    <p className={styles.note}>画面と操作の見本です。実際の設定は変わりません。</p>
    <Card layout="vertical" padding="default" gap="normal" aria-label="クラスの予定">
      <strong>クラスの予定（見本）</strong>
      <ul className={styles.can}>
        {LESSON_BOARD_SAMPLE.map(entry => (
          <li key={`${entry.time}-${entry.name}`}>
            <StatusBadge tone={entry.tone}>{entry.stateLabel}</StatusBadge>
            <span>{entry.time} {entry.name}・{entry.note}</span>
          </li>
        ))}
      </ul>
      <p className={styles.note}>名前・数は架空です。見本のため実際の設定は変わりません。</p>
    </Card>
  </section>
}
