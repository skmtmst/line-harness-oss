import { formatListTimestamp } from '@/lib/format'
import styles from './list-date-time.module.css'

export default function ListDateTime({ value, fallback, now, timeZone }: {
  value: Parameters<typeof formatListTimestamp>[0]
} & NonNullable<Parameters<typeof formatListTimestamp>[1]>) {
  const text = formatListTimestamp(value, { fallback, now, timeZone })
  const parts = text.match(/^(.*) (\d{2}:\d{2})$/)
  if (!parts) return <span data-list-date-time>{text}</span>
  return <span className={styles.timestamp} data-list-date-time title={text}>
    <span>{parts[1]}</span>{' '}<span>{parts[2]}</span>
  </span>
}
