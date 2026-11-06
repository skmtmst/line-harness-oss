'use client'

import { Folder } from 'lucide-react'
import { EntityPickerField } from '@/components/shared/entity-picker'

export type TemplateFolderOption = { value: string; label: string; count: number | null; depth?: number }
export type TemplateFolderStatus = 'loading' | 'ready' | 'error'

/** 増えるフォルダは共通の選ぶ窓へ渡し、確定するまで元の絞り込みを保つ。 */
export default function TemplateFolderSelect({ value, options, onChange, status }: {
  value: string; options: TemplateFolderOption[]; onChange: (value: string) => void; status: TemplateFolderStatus
}) {
  const statusLabel = status === 'loading' ? 'フォルダを読み込み中' : status === 'error' ? 'フォルダを読み込めません' : undefined
  return <div data-template-folder-select aria-busy={status === 'loading' || undefined}>
    <EntityPickerField label="テンプレートのフォルダ" ariaLabel="テンプレートのフォルダ" noun="フォルダ" title="テンプレートのフォルダを選ぶ" icon={Folder} valuePrefix="フォルダ"
      value={status === 'ready' ? JSON.stringify(value) : ''} onChange={id=>onChange(JSON.parse(id) as string)} disabled={status !== 'ready'} placeholder={statusLabel}
      items={options.map(option=>({id:JSON.stringify(option.value),name:`${option.label} ${option.count ?? '—'}`,meta:option.depth ? '下のフォルダ' : undefined}))} />
  </div>
}
