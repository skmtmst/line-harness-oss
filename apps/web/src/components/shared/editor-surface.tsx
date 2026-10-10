'use client'

import { CreatePage } from '@/components/templates'
import Card from './card'
import Button from './button'
import Dialog, { type DialogProps } from './dialog'
import Notice from './notice'
import InlineSettings from './inline-settings'

/** 作る・編集は同じ箱。小さい物だけ窓にし、それ以外は作る型を使う。 */
export default function EditorSurface({ surface = 'dialog', ...props }: DialogProps & { surface?: 'page' | 'dialog' | 'inline' }) {
  if (surface === 'dialog') return <Dialog {...props} />
  if (!props.open) return null
  const actions = props.footer ?? <>
    <Button disabled={props.busy} onClick={props.onCancel}>{props.cancelLabel ?? 'キャンセル'}</Button>
    {props.onConfirm ? <Button variant="primary" busy={props.busy} disabled={props.confirmDisabled} onClick={props.onConfirm}>{props.confirmLabel ?? '保存する'}</Button> : null}
  </>
  if (surface === 'inline') return <InlineSettings open title={props.title} onClose={props.onCancel} footer={actions}>
    {props.error ? <Notice tone="danger">{props.error}</Notice> : null}
    {props.children}
  </InlineSettings>
  return <CreatePage title={props.title} description={props.description} footerActions={actions}>
    {props.error ? <Notice tone="danger">{props.error}</Notice> : null}
    <Card variant="form" padding="roomy" layout="vertical">{props.children}</Card>
  </CreatePage>
}
