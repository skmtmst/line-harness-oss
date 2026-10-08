import type { ComponentProps } from 'react'
import SectionHeader from '@/components/shared/section-header'
import styles from './dashboard.module.css'

/**
 * 段の題（共通の SectionHeader）を絵の高さ 23 の箱に入れる。「？」の当たりで段が伸びないように。
 * 右の列・下の4つの段は狭い幅で題が「…」に切れないよう、入らないときだけ行き先を次の行へ回す（wrap）。
 */
export default function Head(props: ComponentProps<typeof SectionHeader>) {
  return <div className={styles.head}><SectionHeader wrap {...props} /></div>
}
