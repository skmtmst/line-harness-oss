'use client'
import { formFileKind, formFileKinds, FORM_DOCUMENT_SCAN_NOTE, type FormInputBlock } from '@line-crm/shared'
import { Field } from './form-controls'
import { TextField } from './text-field'
import Checkbox from './checkbox'
export default function FormFileSettings({ block, onChange }: { block: FormInputBlock; onChange: (patch: Partial<FormInputBlock>) => void }) {
  const kinds = formFileKinds(block)
  const identity = formFileKind(block) === 'identity'
  return <>
    <Field label="受け取る種類（いくつでも）" note={FORM_DOCUMENT_SCAN_NOTE}>
      {([{ kind: 'image', label: '写真（JPG・PNG・HEICなど）' }, { kind: 'pdf', label: 'PDF' }, { kind: 'identity', label: '本人確認書類（免許証・保険証など）' }] as const).map(option =>
        <Checkbox key={option.kind} checked={kinds.includes(option.kind)} onCheckedChange={checked => onChange({ fileKinds: checked ? [...kinds, option.kind] : kinds.filter(kind => kind !== option.kind) })}>{option.label}</Checkbox>)}
    </Field>
    {identity ? <Checkbox checked={block.fileBothSides ?? false} onCheckedChange={checked => onChange({ fileBothSides: checked })}>表と裏の2枚</Checkbox> : null}
    {!(identity && block.fileBothSides) ? <Field label="枚数の上限" note="1〜10枚"><TextField aria-label="枚数の上限" type="number" min={1} max={10} value={block.fileMaxCount ?? 1} onChange={e => onChange({ fileMaxCount: Number(e.target.value) })} /></Field> : null}
    {identity ? <p>本人確認を含む質問の添付はオーナー・管理者だけが見られ、保存期限で自動で消えます。</p> : null}
  </>
}
