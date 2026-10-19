import React from 'react'
import type { ReminderDraftSettings, ReminderDraftVersion, ReminderPreviewResult, ReminderPublishResult, ReminderValidationResult } from '@line-crm/shared'
import { ReminderEditV8, TargetStageV8, ScheduleStageV8, ConfirmStageV8, DoneStageV8 } from '@/v8/reminders/public/edit/index'
import type { ReminderTestRecipientView } from '@/components/reminders/use-reminder-test-recipient'

// 旧フローの動作試験を現役の描画へつなぐ。値や動きはここに実装しない。
const noop = () => {}
const frame = { boardId: 'YChR6', title: 'リマインダ', identity: null, steps: null, help: null }
const common = { frame, notice: null, busy: false, onSaveDraft: noop, onCancel: noop }
export default ReminderEditV8

export function TargetStage(props: Omit<React.ComponentProps<typeof TargetStageV8>, 'frame' | 'notice' | 'onSaveDraft' | 'onCancel'>) {
  return <TargetStageV8 {...common} {...props} />
}

type PreviewProps = {
  settings: ReminderDraftSettings
  preview: ReminderPreviewResult | null
  previewFailed?: boolean
  onRetryPreview?: () => void
  onNext: () => void
  editHref?: string
}
export function PreviewStage(props: PreviewProps) {
  return <ScheduleStageV8 {...common} reminderId="rem-1" {...props} />
}

type ConfirmProps = {
  draft: ReminderDraftVersion
  settings: ReminderDraftSettings
  validation: ReminderValidationResult | null
  validationFailed?: boolean
  onRetryValidation?: () => void
  onPublish: () => void
  busy: boolean
}
export function ConfirmStage(props: ConfirmProps) {
  return <ConfirmStageV8 {...common} reminderId={props.draft.reminderId} preview={null}
    recipientView={{ kind: 'unset' }} onRecipientRecheck={noop} sentName={null} sentKind={null}
    sendBusy={false} onSend={noop} publishReady={Boolean(props.validation?.valid)} {...props} />
}

type TestProps = {
  draft: ReminderDraftVersion
  recipientName: string | null
  recipientKind?: 'self' | 'registered'
  recipientView: ReminderTestRecipientView
  onRecipientRecheck: () => void
  onConfirm: () => void
  onNext: () => void
}
export function TestStage(props: TestProps) {
  return <ConfirmStageV8 {...common} reminderId={props.draft.reminderId} draft={props.draft}
    settings={props.draft.settings} validation={null} preview={null}
    recipientView={props.recipientView} onRecipientRecheck={props.onRecipientRecheck}
    sentName={props.recipientName} sentKind={props.recipientKind ?? null}
    sendBusy={false} onSend={props.onConfirm} publishReady={false} onPublish={props.onNext} />
}

export function DoneStage(props: {
  draft: ReminderDraftVersion
  published: ReminderPublishResult | null
  preview: ReminderPreviewResult | null
  validation: ReminderValidationResult | null
}) {
  return <DoneStageV8 frame={frame} reminderId={props.draft.reminderId} settings={props.draft.settings}
    published={props.published} preview={props.preview} />
}
