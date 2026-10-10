"use client"

import ActionList from './action-list'
import { EntityPickerField } from './entity-picker'
import { TextField } from './text-field'

type Effect = { kind: 'tag' | 'score'; ids?: string[]; score?: number | null }
/** 既存のタグ・スコアの保存値に戻す。2つの独立した効果なので順番は固定。 */
export default function TapSideEffects({ tags, tagIds, score, onChange }: {
  tags: { id: string; name: string }[]; tagIds: string[]; score: number | null | undefined; onChange: (next: { tagIds: string[]; scoreChange: number | null }) => void
}) {
  const value: Effect[] = [...(tagIds.length ? [{ kind: 'tag' as const, ids: tagIds }] : []), ...(score !== null && score !== undefined ? [{ kind: 'score' as const, score }] : [])]
  return <ActionList<Effect> value={value} idOf={item => item.kind} reorderable={false}
    titleOf={item => item.kind === 'tag' ? (item.ids ?? []).map(id => tags.find(tag => tag.id === id)?.name ?? '設定済みのタグ').join('・') : `${item.score ?? 0} 点`}
    kindOf={item => item.kind === 'tag' ? 'タグを付ける' : 'スコアを足す'}
    onChange={next => onChange({ tagIds: next.find(item => item.kind === 'tag')?.ids ?? [], scoreChange: next.find(item => item.kind === 'score')?.score ?? null })}
    choices={[
      ...(!tagIds.length ? [{ id: 'tag', label: 'タグを付ける', make: (): Effect => ({ kind: 'tag', ids: [] }), picker: { title: 'タグを選ぶ', items: tags, multiple: true, apply: (item: Effect, ids: string[]) => ({ ...item, ids }) } }] : []),
      ...(score === null || score === undefined ? [{ id: 'score', label: 'スコアを足す', make: (): Effect => ({ kind: 'score', score: 0 }) }] : []),
    ]}
    renderEditor={(item, update) => item.kind === 'tag'
      ? <EntityPickerField label="タグを付ける" noun="タグ" items={tags} multiple value={item.ids ?? []} onChange={ids => update({ ...item, ids })} />
      : <TextField type="number" aria-label="スコアを足す" value={String(item.score ?? '')} onChange={event => update({ ...item, score: event.target.value === '' ? null : Number(event.target.value) })} />} />
}
