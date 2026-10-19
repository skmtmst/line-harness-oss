'use client'
import { useEffect, useId, useState } from 'react'
import { Hash, Tag } from 'lucide-react'
import { tapExtrasError, type TapExtras } from '@line-crm/shared'
import ActionList, { type ActionChoice } from '@/components/shared/action-list'
import TagPickerField, { type TagPickerOption } from '@/components/shared/tag-picker-field'
import { TextField } from '@/components/shared/text-field'
import { FieldError } from '@/components/shared/form-controls'

/*
 * ★V8 リサーチの選択肢が選ばれたら行うこと（絵 「行うことを足す」）。
 * 保存の形は今までどおり TapExtras（タグを付ける・スコアを足す）。見せ方だけ共通の「行うこと」の行にする。
 */
type Kind = 'tag' | 'score'
type Item = { id: Kind }

const kindsOf = (value?: TapExtras): Kind[] => [
  ...(value?.tagIds?.length ? ['tag' as const] : []),
  ...(value?.scoreChange != null ? ['score' as const] : []),
]

export default function ChoiceExtrasRows({ name, value, onChange, tags, accountId, error: serverError }: {
  name: string
  value?: TapExtras
  onChange: (next: TapExtras) => void
  tags: readonly TagPickerOption[]
  accountId?: string | null
  error?: string | null
}) {
  const fieldId = useId()
  // 足したばかりで中身が空の行も残すため、行の並びは手元で持つ（保存値から足りない行だけ補う）。
  const [kinds, setKinds] = useState<Kind[]>(() => kindsOf(value))
  useEffect(() => { setKinds((current) => [...current, ...kindsOf(value).filter((kind) => !current.includes(kind))]) }, [value])
  const error = tapExtrasError(value) ?? serverError
  const tagNames = (value?.tagIds ?? []).map((id) => tags.find((tag) => tag.id === id)?.name).filter(Boolean).join('・')
  const choices: ActionChoice<Item>[] = [
    { id: 'tag', label: 'タグを付ける', icon: Tag, make: () => ({ id: 'tag' }), disabled: kinds.includes('tag'), disabledReason: 'タグを付ける行はもうあります' },
    { id: 'score', label: 'スコアを足す', icon: Hash, make: () => ({ id: 'score' }), disabled: kinds.includes('score'), disabledReason: 'スコアを足す行はもうあります' },
  ]
  const setList = (next: Item[]) => {
    const nextKinds = next.map((item) => item.id)
    setKinds(nextKinds)
    if (!nextKinds.includes('tag') && value?.tagIds?.length) onChange({ ...value, tagIds: [] })
    if (!nextKinds.includes('score') && value?.scoreChange != null) onChange({ ...value, scoreChange: null })
  }
  return <div role="group" aria-label={`${name}の押されたときにあわせて行うこと`}>
    <ActionList<Item>
      value={kinds.map((id) => ({ id }))}
      onChange={setList}
      choices={choices}
      reorderable={false}
      idOf={(item) => item.id}
      kindOf={(item) => (item.id === 'tag' ? 'タグを付ける' : 'スコアを足す')}
      iconOf={(item) => (item.id === 'tag' ? Tag : Hash)}
      titleOf={(item) => item.id === 'tag'
        ? (tagNames ? `押した人に「${tagNames}」` : 'タグを選んでください')
        : (value?.scoreChange != null ? `${value.scoreChange > 0 ? '＋' : ''}${value.scoreChange} 点` : '点数を入れてください')}
      renderEditor={(item) => item.id === 'tag'
        ? <TagPickerField label={`${name}の付けるタグ`} value={value?.tagIds ?? []} options={tags.length ? tags : undefined} accountId={accountId} invalid={Boolean(error)} describedBy={error ? `${fieldId}-error` : undefined} onChange={(tagIds) => onChange({ ...value, tagIds })} />
        : <TextField aria-label={`${name}の足すスコア`} type="number" step={1} value={value?.scoreChange ?? ''} invalid={Boolean(error)} aria-describedby={error ? `${fieldId}-error` : undefined} onChange={(event) => onChange({ ...value, scoreChange: event.target.value === '' ? null : Number(event.target.value) })} />}
    />
    <FieldError id={`${fieldId}-error`}>{error}</FieldError>
  </div>
}
