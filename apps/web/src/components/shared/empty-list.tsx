import type { ReactNode } from 'react'
import { Plus, SearchX } from 'lucide-react'
import Button from './button'
import styles from './empty-list.module.css'

/**
 * 一覧が0件のときの1枚（★V8 修正案 D-2「空の一覧は次の一歩へ導く」・2026-10-07 オーナー採用）。
 *
 * 絵：V8.pen の修正案 `L4WRy` の中の `gIaJZ`。表の場所の中央に、
 * 線の印1つ（44px の角丸の薄い灰の箱）・題1行・説明1行・主ボタン1つ。イラストは使わない。
 *
 * - まだ1件も無い：題「まだ〇〇がありません」・説明「何をする場所か」・主ボタン「最初の〇〇を作る」。
 * - 絞り込み・検索で0件（`filtered`）：題「条件に合うものがありません」・副ボタン「条件を外す」。
 *   0件の絞り込みに作るボタンを出すと、保存したものが消えたと読まれるので出さない。
 * - 閲覧のみの人（`canCreate` が false）には作るボタンを出さず、説明だけにする。
 *
 * 各一覧は題・説明・ボタン名だけを渡す。箱・余白・文字の大きさを画面側で書かない。
 */
export interface EmptyListCreate {
  /** 例「最初のシナリオを作る」。 */
  label: string
  onClick?: () => void
  href?: string
}

export interface EmptyListProps {
  /** その一覧の印（lucide の線の印）。絞り込みで0件のときは使わない。 */
  icon: ReactNode
  /** 例「まだシナリオがありません」。 */
  title: string
  /** 何をする場所か1行。 */
  description: string
  create?: EmptyListCreate
  /** 作れる人か。false なら作るボタンを出さない（閲覧のみ）。 */
  canCreate?: boolean
  /** 絞り込み・検索の結果が0件。 */
  filtered?: boolean
  /** 「条件を外す」。無ければボタンを出さない。 */
  onClearFilters?: () => void
  /** 絞り込みで0件のときの説明。既定は「絞り込みや検索を外すと、すべて出ます」。 */
  filteredDescription?: string
  /** 作るボタンの代わりに置く操作（見本から作るなど、作り方が別のとき）。 */
  action?: ReactNode
  'data-design-node'?: string
}

export const EMPTY_LIST_FILTERED_TITLE = '条件に合うものがありません'
export const EMPTY_LIST_FILTERED_DESCRIPTION = '絞り込みや検索を外すと、すべて出ます'

export default function EmptyList({
  icon,
  title,
  description,
  create,
  canCreate = true,
  filtered = false,
  onClearFilters,
  filteredDescription,
  action,
  'data-design-node': designNode,
}: EmptyListProps) {
  if (filtered) {
    return (
      <div className={styles.root} data-empty-list="filtered" data-design-node={designNode ?? 'gIaJZ'} role="status">
        <span className={styles.mark} aria-hidden="true"><SearchX /></span>
        <p className={styles.title}>{EMPTY_LIST_FILTERED_TITLE}</p>
        <p className={styles.description}>{filteredDescription ?? EMPTY_LIST_FILTERED_DESCRIPTION}</p>
        {onClearFilters ? (
          <div className={styles.action}>
            <Button type="button" variant="secondary" onClick={onClearFilters}>条件を外す</Button>
          </div>
        ) : null}
      </div>
    )
  }
  const button = !canCreate
    ? null
    : action ?? (create
      ? create.href
        ? <Button href={create.href} variant="primary"><Plus aria-hidden="true" />{create.label}</Button>
        : <Button type="button" variant="primary" onClick={create.onClick}><Plus aria-hidden="true" />{create.label}</Button>
      : null)
  return (
    <div className={styles.root} data-empty-list="first" data-design-node={designNode ?? 'gIaJZ'} role="status">
      <span className={styles.mark} aria-hidden="true">{icon}</span>
      <p className={styles.title}>{title}</p>
      <p className={styles.description}>{description}</p>
      {button ? <div className={styles.action}>{button}</div> : null}
    </div>
  )
}
