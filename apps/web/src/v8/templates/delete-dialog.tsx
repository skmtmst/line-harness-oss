'use client'

import type { ComponentProps } from 'react'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Notice from '@/components/shared/notice'
import OperationTargetSummary, { type OperationAccountTarget } from '@/components/shared/operation-target-summary'

type Props = Pick<ComponentProps<typeof ConfirmDialog>,
  'open' | 'title' | 'description' | 'busy' | 'error' | 'onConfirm' | 'onCancel' | 'confirmDisabled' | 'confirmLockedReason'> & { targetAccounts?: OperationAccountTarget[] }

export default function TemplateDeleteDialog({ targetAccounts, ...props }: Props) {
  return <ConfirmDialog {...props} destructive confirmLabel="削除する" designNode="V6JFnd"
    titleIcon={false} confirmIcon={false} contentLayout="form" designLayout="stacked"
    confirmPlacement="start" actionWidthReserve="idle"
    confirmDisabledReason={props.confirmDisabled ? 'アカウントが切り替わりました。削除するテンプレートを選び直してください。' : undefined}>
    {targetAccounts ? <OperationTargetSummary accounts={targetAccounts} /> : null}
    <Notice tone="warn" role="alert" appearance="soft" message="削除は元に戻せません。" />
    {props.confirmDisabled ? <Notice tone="warn" role="alert" message="アカウントが切り替わりました。削除するテンプレートを選び直してください。" /> : null}
  </ConfirmDialog>
}
