'use client'

/*
 * タグ・友だち情報の欄の一覧の骨組み（V8「サクサク感」A）。
 *
 * 行の高さと列幅は本物と同じ（`list-v8.module.css` の行の入れ物を
 * そのまま使い、入れ替わってもガタつかない）。中身は共通の `Skeleton`
 *（`data-skeleton` の印に V8 の光が自動で付く）。使う側は共通の
 * `DelayedSkeleton` で包み、出す・消すの間（0.3秒以内なら出さない・
 * 出したら最低0.4秒）を通す。
 */
import { Skeleton } from '@/components/shared/skeleton'
import styles from './list-v8.module.css'

/* 追加・編集画面の骨組み。題と入力欄の並び（CLS 0）。 */
export function TagFormSkeleton() {
  return (
    <div className={styles.formSkeleton} role="status">
      <span className="sr-only">読み込んでいます</span>
      <Skeleton height={20} width={180} />
      <Skeleton height={36} width="100%" />
      <Skeleton height={36} width="100%" />
      <Skeleton height={96} width="100%" />
      <Skeleton height={36} width={200} />
    </div>
  )
}

export function TagRowsSkeleton({ rows = 5, narrow = [] as number[], designNode }: { rows?: number; narrow?: number[]; designNode?: string }) {
  return (
    <div className={styles.skeletonRows} role="status" data-design-node={designNode}>
      <span className="sr-only">読み込んでいます</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className={styles.skeletonRow}>
          <Skeleton circle width={24} height={24} />
          <Skeleton height={12} className={styles.skeletonBar} />
          {narrow.map((maxWidth, index) => (
            <Skeleton key={index} height={12} className={styles.skeletonFixedBar} width={`min(${maxWidth}px, 100%)`} />
          ))}
        </div>
      ))}
    </div>
  )
}
