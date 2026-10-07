import type { ComponentProps } from 'react'
import SectionHeader from '@/components/shared/section-header'
import styles from './dashboard.module.css'

/** 段の題（共通の SectionHeader）を絵の高さ 23 の箱に入れる。「？」の当たりで段が伸びないように。 */
export default function Head(props: ComponentProps<typeof SectionHeader>) {
  return <div className={styles.head}><SectionHeader {...props} /></div>
}
