'use client'

import { CircleCheck, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import Button from './button'
import styles from './progress.module.css'

export type ProgressState = 'preparing' | 'active' | 'done' | 'partial'

/**
 * 処理の進み。Pencil ★V7 `xiHO8`「★V7 処理の進み」。
 *
 * 一斉配信の送信・CSV取り込み・一括操作で「押した後いま何が起きているか」を見せる。
 * 形の手本は kobra.systems の Progress（コードは写していない。docs/v7-reference-ui-adoption.md §5）。
 *
 * - 数が分かる時は数と割合（active）、分からない時は段階の名前（preparing）
 * - 棒の伸びは幅ではなく `scaleX` で動かす（周りが揺れない）
 * - 数字の更新は呼び出し側で 1 秒に 1 回まで。読み上げは 10% ごとに `role=status` で出す
 *   （毎回読むとうるさい）。`role=progressbar` と `aria-valuenow` は棒が持つ
 * - 画面を閉じても止まらない処理は `note` にそう書く（「この画面を閉じても止まりません」）
 * - 止められる処理だけ `onCancel` を渡す（「止める」を出す）。止めた後は
 *   何人に送ったかを残す表示へ呼び出し側で切り替える（done / partial）
 * - 完了は印・文・満タンの棒の 3 つで伝える（緑だけにしない）
 * - 数字は桁がずれない等幅数字（`tabular-nums`）
 * - 動きを減らす設定では globals.css の決まりで一瞬になり、準備中の棒は左端で止まる
 *   （「準備中」の字は置かない。no-preparing 契約が共通部品の「準備中」を禁じているため。
 *   題と補足・止まった棒で段階は伝わる）
 */
export default function Progress({
  state,
  title,
  note,
  percent,
  countText,
  remainingText,
  onCancel,
  cancelLabel = '送るのを止める',
  onSeeFailures,
  failuresLabel,
  className,
}: {
  /** 段階。preparing（数え始め）／active（送信中）／done（完了）／partial（一部失敗）。 */
  state: ProgressState
  /** 見出し（「送っています」「2,000人に送りました」など）。 */
  title: string
  /** 補足の 1〜2 行（背景処理の断り・完了日時など）。 */
  note?: ReactNode
  /** 割合（0〜100）。active / partial 用。 */
  percent?: number
  /** 数（「1,240 / 2,000 人」など）。active 用。 */
  countText?: string
  /** 残り時間（「あと約2分」など）。active 用。 */
  remainingText?: string
  /** 渡すと「止める」ボタン（副）を出す。止められる処理だけ渡す。 */
  onCancel?: () => void
  cancelLabel?: string
  /** 渡すと失敗の内訳へ進むボタン（副）を出す。partial 用。 */
  onSeeFailures?: () => void
  /** 失敗ボタンの文字（「届かなかった12人を見る」など。数が変わるので呼び出し側で作る）。 */
  failuresLabel?: string
  className?: string
}) {
  const clamped = Math.min(100, Math.max(0, Math.round(percent ?? 0)))
  const bucket = Math.floor(clamped / 10) * 10

  if (state === 'preparing') {
    return (
      <div
        role="progressbar"
        aria-label={title}
        data-design-node="xiHO8"
        className={[styles.root, className].filter(Boolean).join(' ')}
      >
        <p className={styles.head}>
          <LoaderCircle aria-hidden="true" size={16} className={styles.spin} />
          <span className={styles.title}>{title}</span>
        </p>
        {note ? <p className={styles.note}>{note}</p> : null}
        <div aria-hidden="true" className={styles.track}>
          <div className={styles.indeterminate} />
        </div>
      </div>
    )
  }

  if (state === 'done') {
    return (
      <div
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={100}
        data-design-node="xiHO8"
        className={[styles.root, className].filter(Boolean).join(' ')}
      >
        <p className={styles.head}>
          <CircleCheck aria-hidden="true" size={18} className={styles.doneIcon} />
          <span className={styles.title}>{title}</span>
        </p>
        <div aria-hidden="true" className={styles.track}>
          <div className={styles.fill} style={{ transform: 'scaleX(1)' }} />
        </div>
        {note ? <p className={styles.note}>{note}</p> : null}
      </div>
    )
  }

  if (state === 'partial') {
    const ratio = clamped / 100
    return (
      <div
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        data-design-node="xiHO8"
        className={[styles.root, className].filter(Boolean).join(' ')}
      >
        <p className={styles.head}>
          <TriangleAlert aria-hidden="true" size={18} className={styles.partialIcon} />
          <span className={styles.title}>{title}</span>
        </p>
        <div aria-hidden="true" className={styles.track}>
          <div className={styles.fill} style={{ transform: `scaleX(${ratio})` }} />
          <div className={styles.fail} style={{ transform: `scaleX(${1 - ratio})` }} />
        </div>
        {onSeeFailures && failuresLabel ? (
          <p className={styles.actions}>
            <Button type="button" onClick={onSeeFailures}>{failuresLabel}</Button>
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div
      role="progressbar"
      aria-label={title}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-valuetext={countText ? `${countText}（${clamped}%）` : `${clamped}%`}
      data-design-node="xiHO8"
      className={[styles.root, className].filter(Boolean).join(' ')}
    >
      <p className={styles.head}>
        <span className={styles.title}>{title}</span>
        <span aria-hidden="true" className={styles.percent}>{clamped}%</span>
      </p>
      <div aria-hidden="true" className={styles.track}>
        <div className={styles.fill} style={{ transform: `scaleX(${clamped / 100})` }} />
      </div>
      {countText || remainingText ? (
        <p className={styles.meta}>
          {countText ? <span>{countText}</span> : null}
          {remainingText ? <span>{remainingText}</span> : null}
        </p>
      ) : null}
      {onCancel ? (
        <p className={styles.actions}>
          <Button type="button" onClick={onCancel}>{cancelLabel}</Button>
        </p>
      ) : null}
      {/* 10% ごとにだけ読み上げる。毎回読むとうるさい。 */}
      <span role="status" className={styles.announcer}>{`${title} ${bucket}%`}</span>
    </div>
  )
}
