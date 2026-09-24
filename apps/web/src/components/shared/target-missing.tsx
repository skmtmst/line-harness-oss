import type { ReactNode } from 'react'
import { CloudOff, FileSearch, List, RotateCw, SearchX } from 'lucide-react'
import Button from './button'
import styles from './target-missing.module.css'

/**
 * ★V7「開き先がない」（設計ノード `x5cgUH`）。
 *
 * 詳細・編集・結果の画面で、開く対象が無いときの1枚。3つの状態を
 * 言い分ける（いまは37画面が赤い字だけ・ピンクの箱・灰色の文だけ・
 * 枠つきの箱とばらばらだった）。
 *
 * - `unspecified` … URL に id が無い（FileSearch の印）
 * - `not-found` … 取得して見つからない（404・空。SearchX の印）
 * - `error` … 取得に失敗（CloudOff の印。`onRetry` で再取得）
 *
 * 見出しは「何が」＋「どうなっているか」の1文
 * （「編集するテンプレートが指定されていません」など）。英語・id は
 * 出さない。ボタンは副（枠）1つだけ。`unspecified` と `not-found` は
 * `backHref`＋`backLabel` で一覧へ戻し、`error` は `onRetry` で
 * もう一度読み込む。赤・ピンク・主ボタン（緑の塗り）は使わない。
 *
 * 対象が無いときは、この部品だけを出す。その画面の KPI・タブ・
 * 右の案内カード・下の固定バーなど、対象が無いと意味のない部品は
 * 呼び出し側で出さない（設計の決まり）。
 */
export type TargetMissingKind = 'unspecified' | 'not-found' | 'error'

const ICONS = {
  unspecified: FileSearch,
  'not-found': SearchX,
  error: CloudOff,
} as const

export type TargetMissingProps = {
  kind: TargetMissingKind
  /** 「何が」＋「どうなっているか」の1文。 */
  title: string
  /** 1〜2文。次にすることを書く。 */
  description: string
  /** 戻り先の一覧（`unspecified`・`not-found`）。今のリンク先を使う。 */
  backHref?: string
  /** 「◯◯の一覧へ戻る」。 */
  backLabel?: string
  /** もう一度読み込む（`error`）。 */
  onRetry?: () => void
  /** 読み直している間。二度押しを止める。 */
  retrying?: boolean
  /**
   * いまの LINE アカウント名（`not-found` のみ・任意）。
   * 渡すと説明のあとに「いまの LINE アカウントは「◯◯」です。」を足す
   * （別アカウントのものを開いた人が気づけるように）。
   */
  accountName?: string
  className?: string
}

export default function TargetMissing({
  kind,
  title,
  description,
  backHref,
  backLabel,
  onRetry,
  retrying = false,
  accountName,
  className,
}: TargetMissingProps) {
  const Icon = ICONS[kind]
  const rootClass = [styles.root, className].filter(Boolean).join(' ')
  const showBack = (kind === 'unspecified' || kind === 'not-found') && backHref && backLabel
  const showRetry = kind === 'error' && onRetry
  const accountLine =
    kind === 'not-found' && accountName ? `いまの LINE アカウントは「${accountName}」です。` : null

  // ボタンは1つだけ（設計の決まり）。両方渡されたら戻るを優先する。
  let action: ReactNode = null
  if (showBack) {
    action = (
      <Button href={backHref} variant="secondary">
        <List aria-hidden="true" size={16} />
        {backLabel}
      </Button>
    )
  } else if (showRetry) {
    action = (
      <Button type="button" variant="secondary" onClick={onRetry} disabled={retrying}>
        <RotateCw aria-hidden="true" size={16} />
        {retrying ? '読み込んでいます' : 'もう一度読み込む'}
      </Button>
    )
  }

  return (
    <div
      className={rootClass}
      data-target-missing={kind}
      // 読み込めなかったことだけ、その場で読ませる。
      role={kind === 'error' ? 'alert' : undefined}
    >
      <div className={styles.mark}>
        <Icon aria-hidden="true" size={20} />
      </div>
      <p className={styles.title}>{title}</p>
      <p className={styles.description}>
        {description}
        {accountLine ? <span> {accountLine}</span> : null}
      </p>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}
