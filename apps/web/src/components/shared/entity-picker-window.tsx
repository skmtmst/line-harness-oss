'use client'

import type { ReactNode } from 'react'
import Dialog from './dialog'
import styles from './entity-picker.module.css'

export type EntityPickerWindowProps = {
  title: string
  description?: string
  onCancel: () => void
  busy?: boolean
  error?: string
  designNode?: string
  initialFocusId?: string
  /** データ取得を呼ぶ側で管理するときの中身。窓の形は共通のまま。 */
  children: ReactNode
  scrollBody?: boolean
  footer: ReactNode
  band?: ReactNode
}

export default function EntityPickerWindow(props: EntityPickerWindowProps) {
  return <Dialog open dirty={false} title={props.title} description={props.description}
    designNode={props.designNode} designWidth={640} widthPreset="picker" designHeaderPadding="var(--tpl-inbox-tp-head-pad)"
    contentLayout={props.scrollBody ? 'form' : undefined} designContentPadding={props.scrollBody ? '0' : undefined}
    busy={props.busy} initialFocusId={props.initialFocusId} onCancel={props.onCancel}
    footer={<>
      {props.scrollBody ? null : props.children}
      {props.error ? <p className={styles.tpError} role="alert">{props.error}</p> : null}
      {props.band}
      <div className={styles.tpFoot}>{props.footer}</div>
    </>}>{props.scrollBody ? props.children : null}</Dialog>
}
