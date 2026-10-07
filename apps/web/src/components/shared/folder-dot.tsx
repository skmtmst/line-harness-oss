import type { ReactNode } from 'react'
import styles from './folder-dot.module.css'

/*
 * ★V8 一覧の行の名前の前に置く「フォルダの色の丸」（2026-10-07 オーナー決定）。
 * 表に「フォルダ」列を置かず、左のフォルダの列と同じ色の丸で、どのフォルダかを見せる。
 * 色だけで意味を伝えないよう、読み上げと title に「フォルダ：〇〇」を持たせる。
 * 未分類（フォルダ無し）は色の無い輪で、名前の頭の位置をそろえる。
 */
export interface FolderDotFolder {
  name: string
  /** フォルダの色（#RRGGBB）。無いフォルダは薄い灰の丸。 */
  color?: string | null
}

export function FolderDot({ folder }: { folder?: FolderDotFolder | null }) {
  const label = `フォルダ：${folder?.name ?? '未分類'}`
  return (
    <span
      className={folder ? styles.dot : `${styles.dot} ${styles.unfiled}`}
      style={folder?.color ? { backgroundColor: folder.color } : undefined}
      role="img"
      aria-label={label}
      title={label}
      data-folder-dot={folder ? 'filed' : 'unfiled'}
    />
  )
}

/**
 * 丸＋名前の1行。名前は1行のまま省略する（全文は呼ぶ側の title で見せる）。
 * `dot={false}` は丸を置かず名前だけを返す（丸の無い絵の板。例：1152 の板でまだ丸を描いていない一覧）。
 */
export function FolderDotName({ folder, dot = true, children }: { folder?: FolderDotFolder | null; dot?: boolean; children: ReactNode }) {
  if (!dot) return <>{children}</>
  return (
    <span className={styles.line}>
      <FolderDot folder={folder} />
      <span className={styles.name}>{children}</span>
    </span>
  )
}

export default FolderDot
