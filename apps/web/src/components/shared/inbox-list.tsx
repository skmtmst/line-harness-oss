import type { HTMLAttributes } from 'react'
import styles from './inbox-list.module.css'

type PartProps = HTMLAttributes<HTMLDivElement>
/** 絞り込みの動きは画面が渡し、受信箱の列の並びはここが持つ。 */
export function InboxListHeader(props: HTMLAttributes<HTMLElement>) { return <section {...props} className={styles.header} /> }
export function InboxListHeadline(props: PartProps) { return <div {...props} className={styles.headline} /> }
export function InboxListSearch(props: PartProps) { return <div {...props} className={styles.search} /> }
export function InboxFilterControls(props: PartProps) { return <div {...props} className={styles.filters} /> }
