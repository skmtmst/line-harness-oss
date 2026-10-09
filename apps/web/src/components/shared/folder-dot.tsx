import type { ReactNode } from 'react'
import { FOLDER_SELECT_COLORS } from '@line-crm/shared'
import styles from './folder-dot.module.css'

/*
 * ★V8 一覧の行の名前の前に置く「フォルダの色の丸」（2026-10-07 オーナー決定）。
 * 表に「フォルダ」列を置かず、左のフォルダの列と同じ色の丸で、どのフォルダかを見せる。
 * 色だけで意味を伝えないよう、読み上げと title に「フォルダ：〇〇」を持たせる。
 * 未分類（フォルダ無し）は色の無い輪で、名前の頭の位置をそろえる。
 */
export interface FolderDotFolder {
  name: string
  /** フォルダの色（#RRGGBB）。無いフォルダは folderDisplayColor が名前から選ぶ。 */
  color?: string | null
}

/**
 * フォルダの見せる色。色を決めていないフォルダは、名前から9色の1つを決まった形で選ぶ
 * （B-136 2026-10-09：色の無いフォルダが灰色の丸ばかりになり、列と行の丸で見分けがつかなかった）。
 * 同じ名前はいつも同じ色。左の列の丸と、行の名前の前の丸は同じこの値を使う。
 */
export function folderDisplayColor(folder: FolderDotFolder): string {
  if (folder.color) return folder.color
  let hash = 0
  for (const char of folder.name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return FOLDER_SELECT_COLORS[hash % FOLDER_SELECT_COLORS.length].value
}

export function FolderDot({ folder }: { folder?: FolderDotFolder | null }) {
  const label = `フォルダ：${folder?.name ?? '未分類'}`
  return (
    <span
      className={folder ? styles.dot : `${styles.dot} ${styles.unfiled}`}
      style={folder ? { backgroundColor: folderDisplayColor(folder) } : undefined}
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
