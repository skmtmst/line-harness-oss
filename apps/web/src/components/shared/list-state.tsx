import React from 'react'
import type { ReactNode } from 'react'
import { Inbox, Loader, Lock, TriangleAlert } from 'lucide-react'
import Button from './button'
import { STATE_TEXT } from './not-connected'
import styles from './list-state.module.css'

/**
 * 一覧に中身を出せないときの1枚。
 *
 * **「1件も無い」と「読み込めなかった」を言い分けるための部品。**
 * 一覧はどれも `items.length === 0` だけを見て「ありません」と出していた。
 * 読み込みに失敗したときも同じ文が出るので、運用する人からは
 * 「登録したものが消えた」ように見える（PR #216 で3画面を直したが、
 * 直し方が画面ごとにばらばらだった）。ここに寄せる。
 *
 * 設計: `BDOJu` データがありません ／ `sZE9Q` 読み込んでいます ／
 *       `OLMp0` 表示できませんでした（★V6 4-2-C `yKEdO` で3つ並べてある）
 *
 * **`forbidden` に対応する設計の部品は無い。** 設計は「権限不足とエラーは
 * 今までどおり」としか決めていない（`docs/v6-design-review-handoff.md`）。
 * 見た目は `BDOJu` と同じ枠のまま、絵と文言だけ変えている。
 * 専用の部品が描かれたら、ここを合わせ直す。
 */
export type ListStateKind = 'loading' | 'empty' | 'error' | 'forbidden'

/** 設計 `hqTfD` / `u2ArlH` / `ZAkSe`。24px の線画。 */
const ICONS: Record<ListStateKind, typeof Inbox> = {
  loading: Loader,
  empty: Inbox,
  error: TriangleAlert,
  forbidden: Lock,
}

/**
 * 状態ごとの言葉。**画面側からも読めるように出す。**
 *
 * 一覧の外（帯や表の中）で同じ事故を伝える画面がある。そこで文言を
 * 書き直すと、**同じ事故が画面によって違う言葉になる**（リマインダは
 * 「リマインダの読み込みに失敗しました。もう一度お試しください。」で、
 * ほかは「表示できませんでした」だった）。ここから引く。
 */
export const PRESETS: Record<ListStateKind, { title: string; description: string }> = {
  loading: { title: '読み込んでいます', description: 'このまま少しお待ちください。' },
  empty: { title: 'データがありません', description: '条件を変えるか、新しく作成してください。' },
  error: { title: '表示できませんでした', description: '再読み込みしても直らない場合はエラー報告へ。' },
  forbidden: { title: '表示する権限がありません', description: '見るには権限が要ります。オーナーか管理者に追加を依頼してください。' },
}

export default function ListState({
  kind,
  title,
  description,
  action,
  onRetry,
  retrying = false,
  className,
}: {
  kind: ListStateKind
  /** 設計どおりの文言で足りないとき（「まだタグがありません」など）だけ渡す。 */
  title?: string
  description?: string
  /** 作成導線つきの空状態（設計 `fRgeK`）。押せる操作が画面の他所にあるなら渡さない。 */
  action?: ReactNode
  /** もう一度読み込む。`error` のときだけ押し口を出す。 */
  onRetry?: () => void
  /** 読み直している間。二度押しを止める。 */
  retrying?: boolean
  className?: string
}) {
  const preset = PRESETS[kind]
  const danger = kind === 'error'
  const Icon = ICONS[kind]

  // className は先に組む。JSX の中で足すと、直書きを数える仕掛け
  // （`scripts/design-debt.mjs`）から中身が見えなくなる。
  const rootClass = [styles.root, className].filter(Boolean).join(' ')
  const iconClass = [styles.icon, danger && styles.iconDanger, kind === 'loading' && styles.spin]
    .filter(Boolean)
    .join(' ')
  const titleClass = [styles.title, danger && styles.titleDanger].filter(Boolean).join(' ')

  return (
    <div
      className={rootClass}
      data-list-state={kind}
      // 読み込み中は読み上げにも伝える。エラーと権限不足はその場で読ませる。
      aria-busy={kind === 'loading' || undefined}
      role={danger || kind === 'forbidden' ? 'alert' : undefined}
    >
      <Icon aria-hidden="true" size={24} className={iconClass} />
      <p className={titleClass}>{title ?? preset.title}</p>
      <p className={styles.description}>{description ?? preset.description}</p>
      {danger && onRetry ? (
        <div className={styles.action}>
          <Button type="button" onClick={onRetry} disabled={retrying}>
            {retrying ? STATE_TEXT.loading : STATE_TEXT.retry}
          </Button>
        </div>
      ) : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}
