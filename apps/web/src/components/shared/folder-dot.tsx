
'use client'

import { Children, isValidElement, useContext, type ReactNode } from 'react'
import { ListFolderContext } from './list-folder-context'
import { FOLDER_SELECT_COLORS } from '@line-crm/shared'
import TruncatedText from './truncated-text'
import Checkbox from './checkbox'
import styles from './folder-dot.module.css'

/**
 * フォルダの見せる色。色が空のフォルダ（色の仕組みより前に作ったもの）は、名前から9色の1つを決まった形で選ぶ
 * （2026-10-09 オーナー「フォルダで色がつくように」）。左の列と表の丸が同じ色になるよう、どちらもこれを使う。
 */
/* 同じ名前はいつも同じ色（：色の無いフォルダが灰色の丸ばかりで、列と行の丸で見分けがつかなかった）。 */
export function folderDisplayColor(folder: { name: string; color?: string | null }): string {
  if (folder.color) return folder.color
  let hash = 0
  for (const char of folder.name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return FOLDER_SELECT_COLORS[hash % FOLDER_SELECT_COLORS.length].value
}

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

function nameText(node: ReactNode): string {
  return Children.toArray(node).map((child): string => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    if (isValidElement<{ children?: ReactNode; title?: string; value?: string }>(child)) {
      if (child.type === TruncatedText) return child.props.value ?? ''
      return child.props.title ?? nameText(child.props.children)
    }
    return ''
  }).join('').trim()
}

/**
 * 丸＋名前の1行。名前は1行のまま省略する（全文は呼ぶ側の title で見せる）。
 * フォルダを使う一覧は畳んだ幅でも丸を出す。機能の無い一覧は型が丸を外す。
 */
export function FolderDotName({ folder, nameCarriesDot, children, annotation, selection }: { folder?: FolderDotFolder | null; dot?: boolean; nameCarriesDot?: boolean; children: ReactNode; annotation?: ReactNode; selection?: ReactNode }) {
  /* nameCarriesDot：名前そのものが色の丸を持つ札（統括のタグ ）。丸を二重に置かない（古い dot={false} は  で効かないまま）。 */
  const listHasFolders = useContext(ListFolderContext)
  const hasFolders = nameCarriesDot ? false : listHasFolders ?? (folder !== undefined)
  const parts = Children.toArray(children)
  const selectionNodes = parts.filter(child => isValidElement(child) && child.type === Checkbox)
  const name = parts.filter(child => !isValidElement(child) || child.type !== Checkbox)
  return (
    <span className={styles.line} data-list-name="" data-has-annotation={annotation ? true : undefined} title={nameText(name)}>
      {selection}{selectionNodes}
      {hasFolders ? <FolderDot folder={folder} /> : null}
      {typeof children === 'string' ? <TruncatedText className={styles.name} value={children} /> : <span className={styles.name}>{name}</span>}
      {annotation}
    </span>
  )
}

export default FolderDot
