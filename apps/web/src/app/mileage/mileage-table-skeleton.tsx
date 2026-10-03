'use client'

/*
 * マイル V8 の表の骨組み（サクサク感 A）。
 *
 * 見出しは本物のまま、行は5行・高さと列幅は本物に合わせる。
 * 光は共通 `Skeleton`（V8 のときに自動で付く。自前の動きは書かない）。
 * 出す・消すの判定は呼ぶ側の `DelayedSkeleton` が持つ。
 */
import { Skeleton } from '@/components/shared/skeleton'
import styles from './mileage-v8.module.css'

/** 列ごとの棒の幅。先頭列は2段（題＋補足）、ほかは1段。 */
export type MileageSkelColumn = {
  header: string
  bar: string
}

export default function MileageTableSkeleton({ columns }: { columns: MileageSkelColumn[] }) {
  return (
    <div className={styles.tableWrap} aria-hidden="true">
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th scope="col" key={column.header}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3, 4].map((row) => (
            <tr key={row}>
              {columns.map((column, index) => (
                <td key={column.header}>
                  {index === 0 ? (
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <Skeleton width={column.bar} height={14} />
                      <Skeleton width="55%" height={12} />
                    </span>
                  ) : (
                    <Skeleton width={column.bar} height={13} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
