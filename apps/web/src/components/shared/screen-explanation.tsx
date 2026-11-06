'use client'

import type { ReactNode } from 'react'
import { PageExplanationTip } from './page-explanation'
import styles from './screen-explanation.module.css'

/** 題の段。画面全体の説明は題の右の「？」の吹き出しに入れ、帯では出さない。 */
export default function ScreenExplanation({ title, children, titleClassName }: { title: ReactNode; children?: ReactNode; screenKey?: string; titleClassName?: string; panelClassName?: string }) {
  return <div className={`${styles.titleRow} ${titleClassName ?? ''}`}>{title}{children ? <PageExplanationTip extra={children} /> : null}</div>
}
