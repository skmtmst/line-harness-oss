'use client'

import { useMemo, useRef, useState } from 'react'
import { newBlockId, type FormBlock, type FormInputType, type FormLayout, type FormOptions, type FormSection } from '@line-crm/shared'
import type { FormDefinition } from '@/lib/hq-templates-api'
import BlockEditor, { BLOCK_MENU } from './block-editor'
import FormPreview from './form-preview'
import OptionsDialog from './options-dialog'
import { EMPTY_REFS, type FormRefs } from './form-refs'
import { normalizeSectionName } from './section-name'
import Notice from '@/components/shared/notice'
import StickyBar from '@/components/shared/sticky-bar'
import { Field, inputClass } from '@/components/shared/form-controls'
import {
  formJumpsInto,
  makeFormBlock,
  takenFormAnswerNames,
  uniqueFormCopyName,
} from './form-definition-operations'
import { validateFormLayoutForSave } from './form-definition-validation'
import {
  hqFormDefinitionToEditor,
  hqFormEditorToDefinition,
  hqFormPortableReferenceError,
  type HqFormEditorValue,
} from './hq-form-definition-adapter'

const HEADER_TAB = -1

/**
 * The HQ authoring surface uses the same block editors, preview and options
 * dialog as `/form-submissions/edit`. Store-only IDs are hidden and also
 * rejected by the serializer/Worker, so a template can never silently lose a
 * setting during distribution.
 */
export default function HqFormDefinitionEditor({
  definition,
  refs = EMPTY_REFS,
  saving = false,
  error = '',
  notice = '',
  onCancel,
  onSave,
}: {
  definition: FormDefinition
  refs?: FormRefs
  saving?: boolean
  error?: string
  notice?: string
  onCancel: () => void
  onSave: (definition: FormDefinition) => void | Promise<void>
}) {
  const initial = useMemo(() => hqFormDefinitionToEditor(definition), [definition])
  const [value, setValue] = useState<HqFormEditorValue>(initial)
  const [tab, setTab] = useState(0)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const [localError, setLocalError] = useState('')
  const undoStack = useRef<FormLayout[]>([])
  const redoStack = useRef<FormLayout[]>([])

  // Only references that the cross-account adapter can resolve are offered.
  // Emptying the other lists keeps the canonical controls visible without
  // allowing an account-bound ID to enter an HQ definition.
  const portableRefs: FormRefs = useMemo(() => ({
    tags: refs.tags,
    scenarios: refs.scenarios,
    friendFields: [],
    reminders: [],
    templates: [],
  }), [refs])

  const setLayout = (next: FormLayout | ((previous: FormLayout) => FormLayout)) => {
    setValue(current => {
      const resolved = typeof next === 'function' ? next(current.layout) : next
      undoStack.current = [...undoStack.current.slice(-49), current.layout]
      redoStack.current = []
      return { ...current, layout: resolved }
    })
  }
  const layout = value.layout
  const blocks = tab === HEADER_TAB ? layout.header : (layout.sections[tab]?.blocks ?? [])
  const setBlocks = (next: FormBlock[]) => setLayout(previous => tab === HEADER_TAB
    ? { ...previous, header: next }
    : { ...previous, sections: previous.sections.map((section, index) => index === tab ? { ...section, blocks: next } : section) })
  const selectedIndex = blocks.findIndex(block => block.id === selectedBlockId)

  const addBlock = (kind: string, type?: FormInputType) => {
    const count = layout.header.concat(layout.sections.flatMap(section => section.blocks))
      .filter(block => block.kind === 'input').length
    const block = makeFormBlock(kind, type, count)
    setBlocks([...blocks, block])
    setSelectedBlockId(block.id)
    setShowAddMenu(false)
  }
  const patchBlock = (id: string, patch: Partial<FormBlock>) => setBlocks(
    blocks.map(block => block.id === id ? { ...block, ...patch } as FormBlock : block),
  )
  const moveBlock = (delta: number) => {
    const destination = selectedIndex + delta
    if (selectedIndex < 0 || destination < 0 || destination >= blocks.length) return
    const next = [...blocks]
    const [block] = next.splice(selectedIndex, 1)
    next.splice(destination, 0, block)
    setBlocks(next)
  }
  const duplicateBlock = () => {
    if (selectedIndex < 0) return
    const source = blocks[selectedIndex]
    const copy = source.kind === 'input'
      ? { ...source, id: newBlockId(), name: uniqueFormCopyName(source.name, takenFormAnswerNames(layout)) }
      : { ...source, id: newBlockId() }
    const next = [...blocks]
    next.splice(selectedIndex + 1, 0, copy)
    setBlocks(next)
    setSelectedBlockId(copy.id)
  }
  const removeBlock = () => {
    if (selectedIndex < 0) return
    setBlocks(blocks.filter((_, index) => index !== selectedIndex))
    setSelectedBlockId(null)
  }
  const addSection = () => {
    const section: FormSection = { id: newBlockId('s'), name: `セクション${layout.sections.length + 1}`, blocks: [] }
    setLayout(previous => ({ ...previous, sections: [...previous.sections, section] }))
    setTab(layout.sections.length)
  }
  const renameSection = (index: number) => {
    const current = layout.sections[index]
    const name = current ? normalizeSectionName(window.prompt('ページの名前', current.name)) : null
    if (name === null) return
    setLayout(previous => ({ ...previous, sections: previous.sections.map((section, i) => i === index ? { ...section, name } : section) }))
  }
  const duplicateSection = (index: number) => {
    const source = layout.sections[index]
    if (!source) return
    const taken = takenFormAnswerNames(layout)
    const copy: FormSection = {
      id: newBlockId('s'), name: `${source.name}のコピー`,
      blocks: source.blocks.map(block => {
        if (block.kind !== 'input') return { ...block, id: newBlockId() }
        const name = uniqueFormCopyName(block.name, taken); taken.add(name)
        return { ...block, id: newBlockId(), name }
      }),
    }
    setLayout(previous => ({ ...previous, sections: [...previous.sections.slice(0, index + 1), copy, ...previous.sections.slice(index + 1)] }))
    setTab(index + 1)
  }
  const removeSection = (index: number) => {
    if (layout.sections.length <= 1) return
    const target = layout.sections[index]
    if (!target) return
    const branchCount = formJumpsInto(layout, target.id)
    if ((target.blocks.length || branchCount) && !window.confirm(`このページのブロック${target.blocks.length}個を外します。${branchCount ? ` 分岐${branchCount}件は「次へ進む」に戻ります。` : ''}`)) return
    setLayout(previous => ({
      ...previous,
      sections: previous.sections.filter((_, i) => i !== index).map(section => ({
        ...section,
        blocks: section.blocks.map(block => block.kind === 'input' && block.choices
          ? { ...block, choices: block.choices.map(choice => choice.jumpToSectionId === target.id ? { ...choice, jumpToSectionId: null } : choice) }
          : block),
      })),
    }))
    setTab(Math.max(0, index - 1))
  }
  const undo = () => {
    const previous = undoStack.current.pop(); if (!previous) return
    setValue(current => { redoStack.current.push(current.layout); return { ...current, layout: previous } })
  }
  const redo = () => {
    const next = redoStack.current.pop(); if (!next) return
    setValue(current => { undoStack.current.push(current.layout); return { ...current, layout: next } })
  }
  const save = async () => {
    setLocalError('')
    if (!value.name.trim()) { setLocalError('フォーム名を入力してください'); return }
    const validation = validateFormLayoutForSave(layout) ?? hqFormPortableReferenceError(value)
    if (validation) { setLocalError(validation); return }
    await onSave(hqFormEditorToDefinition(value))
  }

  return <div>
    {(localError || error) && <Notice className="mb-4" tone="error" message={localError || error} />}
    {notice && <Notice className="mb-4" tone="success" message={notice} />}
    <div className="mb-4 grid gap-4 rounded-card border border-hairline bg-canvas p-4 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="フォーム名" htmlFor="hq-form-name" required><input id="hq-form-name" value={value.name} onChange={event => setValue(current => ({ ...current, name: event.target.value }))} className={inputClass} /></Field>
      <Field label="公開状態"><p className="rounded-control border border-hairline bg-canvas-sunken px-3 py-2 text-sm">配布先へ非公開の下書きとして保存</p></Field>
      <Field label="回答したときに付けるタグ" htmlFor="hq-form-tag"><select id="hq-form-tag" value={value.onSubmitTagId} onChange={event => setValue(current => ({ ...current, onSubmitTagId: event.target.value }))} className={inputClass}><option value="">— 付けない —</option>{portableRefs.tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></Field>
      <Field label="回答用URL"><p className="rounded-control border border-hairline bg-canvas-sunken px-3 py-2 text-sm text-ink-faint">配布先で発行</p></Field>
    </div>
    <div className="grid gap-4 xl:grid-cols-[minmax(320px,26rem)_minmax(0,1fr)]">
      <section className="xl:sticky xl:top-4 xl:self-start"><h2 className="mb-1 text-xs font-medium text-ink-secondary">お客さまに見える形</h2><FormPreview layout={layout} sectionIndex={tab === HEADER_TAB ? 0 : tab} /></section>
      <section className="min-w-0">
        <div className="flex flex-wrap items-center gap-1 border-b border-hairline pb-2">
          <button type="button" onClick={() => setTab(HEADER_TAB)} className={`rounded-control px-3 py-1.5 text-sm ${tab === HEADER_TAB ? 'bg-accent-soft text-accent' : ''}`}>共通ヘッダ</button>
          {layout.sections.map((section, index) => <span key={section.id} className="flex items-center"><button type="button" onClick={() => setTab(index)} onDoubleClick={() => renameSection(index)} className={`rounded-control px-3 py-1.5 text-sm ${tab === index ? 'bg-accent-soft text-accent' : ''}`}>{section.name}</button>{tab === index && <><button type="button" onClick={() => duplicateSection(index)} className="px-1 text-xs text-ink-faint">複製</button>{layout.sections.length > 1 && <button type="button" onClick={() => removeSection(index)} className="px-1 text-xs text-danger">削除</button>}</>}</span>)}
          <button type="button" onClick={addSection} className="rounded-control px-2 py-1.5 text-sm font-bold text-accent">＋</button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="text-sm font-bold">ブロック設定</span><div className="flex flex-wrap items-center gap-1">
          <button type="button" onClick={undo} className="rounded-control px-2 py-1 text-xs">元に戻す</button><button type="button" onClick={redo} className="rounded-control px-2 py-1 text-xs">やり直す</button>
          <button type="button" onClick={() => moveBlock(-1)} disabled={selectedIndex < 0} className="rounded-control px-2 py-1 text-xs disabled:opacity-40">上に移動</button><button type="button" onClick={() => moveBlock(1)} disabled={selectedIndex < 0} className="rounded-control px-2 py-1 text-xs disabled:opacity-40">下に移動</button>
          <button type="button" onClick={duplicateBlock} disabled={selectedIndex < 0} className="rounded-control px-2 py-1 text-xs disabled:opacity-40">複製</button><button type="button" onClick={removeBlock} disabled={selectedIndex < 0} className="rounded-control px-2 py-1 text-xs text-danger disabled:opacity-40">削除</button>
          <div className="relative"><button type="button" onClick={() => setShowAddMenu(open => !open)} className="rounded-control bg-accent-deep px-3 py-1.5 text-xs text-on-accent">＋ ブロックを追加（12種）</button>{showAddMenu && <div className="absolute right-0 z-20 mt-1 w-48 rounded-card border border-hairline bg-canvas py-1 shadow-lg">{BLOCK_MENU.map(item => <button type="button" key={`${item.kind}-${item.type ?? ''}`} onClick={() => addBlock(item.kind, item.type)} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-canvas-sunken">{item.label}</button>)}</div>}</div>
          <button type="button" onClick={() => setShowOptions(true)} className="rounded-control border border-hairline px-3 py-1.5 text-xs">オプション設定</button>
        </div></div>
        <div className="space-y-3">{blocks.length === 0 ? <p className="rounded-card border border-dashed border-hairline bg-canvas p-8 text-center text-sm text-ink-faint">「ブロックを追加」から作ってください</p> : blocks.map((block, index) => <BlockEditor key={block.id} block={block} index={index} sections={layout.sections} refs={portableRefs} selected={block.id === selectedBlockId} onSelect={() => setSelectedBlockId(block.id)} onChange={patch => patchBlock(block.id, patch)} />)}</div>
        <div className="mt-4 rounded-card border border-hairline bg-canvas p-4"><Field label="説明" htmlFor="hq-form-description"><textarea id="hq-form-description" rows={2} value={value.description} onChange={event => setValue(current => ({ ...current, description: event.target.value }))} className={`${inputClass} resize-y`} /></Field></div>
      </section>
    </div>
    <StickyBar actions={<div className="flex gap-2"><button type="button" onClick={onCancel} className="rounded-control border border-hairline px-4 py-2 text-sm">やめる</button><button type="button" disabled={saving} onClick={() => void save()} className="rounded-control bg-accent-deep px-4 py-2 text-sm text-on-accent disabled:opacity-40">{saving ? '保存中...' : 'フォームを保存'}</button></div>} />
    {showOptions && <OptionsDialog value={layout.options} refs={portableRefs} onChange={(options: FormOptions) => setLayout(previous => ({ ...previous, options }))} onClose={() => setShowOptions(false)} onSave={async () => { await save(); setShowOptions(false) }} />}
  </div>
}

