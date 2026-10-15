'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { MousePointerClick } from 'lucide-react'
import { Field } from '@/components/shared/form-controls'
import { EntityPickerSummary } from '@/components/shared/entity-picker'
import InlineSettings from '@/components/shared/inline-settings'
import { useSaveErrorReveal } from '@/components/shared/save-form-errors'

/** 編集する時だけ全設定を開き、保存する質問の形は変えない。 */
export default function QuestionChoiceBehavior({ children, index, summary }: {
  children: ReactNode
  index: number
  summary: string
}) {
  const [open, setOpen] = useState(false)
  useSaveErrorReveal(['behavior', 'url', 'tel', 'mail', 'userMessage', 'user_message',
    'hideUserMessage', 'hide_user_message', 'repeatReply', 'repeat_reply']
    .map(name => `choices.${index}.${name}`), useCallback(() => setOpen(true), []))
  return <>
    <Field label="押されたら" optional={false}>
      <EntityPickerSummary label={`選択肢 ${index + 1} の動き`} noun="動き" name={summary} icon={MousePointerClick}
        ariaLabel={`選択肢 ${index + 1} の動きを変える`} onOpen={() => setOpen(current => !current)} />
    </Field>
    <InlineSettings open={open} flow="column" title={`選択肢 ${index + 1} の動き`} onClose={() => setOpen(false)}>
      {children}
    </InlineSettings>
  </>
}
