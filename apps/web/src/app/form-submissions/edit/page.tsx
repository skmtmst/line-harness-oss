'use client'

/**
 * 回答フォーム編集（設計 V2 6-3-1）。
 *
 * 作りは「左に出来上がり・右に設定」。ブロックを足す・並べ替える作業は、
 * 出来上がりを見ながらでないと決められないので、プレビューを常に横に置く。
 *
 * 上のタブは、共通ヘッダ（全ページの先頭に出る部分）と、ページ（セクション）。
 * ページを分けると、選択肢に「この人はこっちのページへ」という分岐が付く。
 *
 * `name`（回答データの見出し）は作ったあと変えない。ここを変えると、
 * それまでの回答と結びつかなくなる。画面には出すだけで、編集させない。
 */

import SelectField from '@/components/shared/select-field'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  emptyLayout,
  newBlockId,
  type FormBlock,
  type FormInputType,
  type FormLayout,
  type FormOptions,
  type FormSection,
} from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import { Field, inputClass } from '@/components/shared/form-controls'
import BlockEditor, { BLOCK_MENU } from '@/components/forms/block-editor'
import FormPreview from '@/components/forms/form-preview'
import OptionsDialog from '@/components/forms/options-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { EMPTY_REFS, type FormRefs } from '@/components/forms/form-refs'
import { usePageTitle } from '@/components/shell/page-chrome'

/** 共通ヘッダを指す番号。セクションの添字と混ぜないために -1 を使う。 */
const HEADER_TAB = -1

function makeBlock(kind: string, type?: FormInputType, count = 0): FormBlock {
  const id = newBlockId()
  switch (kind) {
    case 'heading':
      return { id, kind: 'heading', text: '見出し', level: 2 }
    case 'text':
      return { id, kind: 'text', text: '' }
    case 'image':
      return { id, kind: 'image', mediaUrl: '', size: 'normal' }
    case 'button':
      return { id, kind: 'button', label: 'ボタン', url: '', style: 'default' }
    default:
      return {
        id,
        kind: 'input',
        type: type ?? 'text',
        // 回答データの見出しは英数字で作る。日本語のままだと、受け渡しの
        // 途中で化けることがある。
        name: `q${count + 1}_${id.slice(2)}`,
        label: '',
        required: false,
        ...(type === 'radio' || type === 'checkbox' || type === 'select'
          ? {
              choiceMode: 'tag' as const,
              choices: [
                { id: newBlockId('c'), label: '選択肢1' },
                { id: newBlockId('c'), label: '選択肢2' },
              ],
            }
          : {}),
      }
  }
}

/**
 * そのページへ飛ばしている選択肢の数。
 *
 * ページを消すと、この分岐は行き先を失って「次へ進む」に戻る。消す前に
 * 何本つなぎ直すのかを言うために数える。**数え漏らしを作らないよう、
 * 全ページの入力ブロックを見る**（自分自身のページも数える。消えるまでは
 * 分岐として生きているため）。
 */
function jumpsInto(layout: FormLayout, sectionId: string): number {
  let count = 0
  for (const section of layout.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'input' || !block.choices) continue
      count += block.choices.filter((c) => c.jumpToSectionId === sectionId).length
    }
  }
  return count
}

function FormEditInner() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const { selectedAccount, selectedAccountId } = useAccount()

  /**
   * 友だちに配るURL。
   *
   * LIFF のURLにパスを足すと、LIFFアプリの同じパスへ転送される。回答画面は
   * `/forms/:id` に置いてあるので、この形でそのまま開く。
   * アカウントに LIFF を登録していないと作れないため、そのときは案内を出す。
   */
  const liffId = selectedAccount?.liffId ?? null
  const answerUrl = liffId ? `https://liff.line.me/${liffId}/forms/${id}` : null

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [submitCount, setSubmitCount] = useState(0)
  const [onSubmitTagId, setOnSubmitTagId] = useState('')
  const [layout, setLayoutState] = useState<FormLayout>(emptyLayout)
  const [tab, setTab] = useState(0)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [refs, setRefs] = useState<FormRefs>(EMPTY_REFS)
  const [showOptions, setShowOptions] = useState(false)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // 元に戻す / やり直す。並べ替えは失敗しても取り返せるようにする。
  const undoStack = useRef<FormLayout[]>([])
  const redoStack = useRef<FormLayout[]>([])

  const setLayout = useCallback((next: FormLayout | ((prev: FormLayout) => FormLayout)) => {
    setLayoutState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next
      undoStack.current = [...undoStack.current.slice(-49), prev]
      redoStack.current = []
      return resolved
    })
  }, [])

  const undo = () => {
    const prev = undoStack.current.pop()
    if (!prev) return
    setLayoutState((current) => {
      redoStack.current = [...redoStack.current, current]
      return prev
    })
  }

  const redo = () => {
    const next = redoStack.current.pop()
    if (!next) return
    setLayoutState((current) => {
      undoStack.current = [...undoStack.current, current]
      return next
    })
  }

  useEffect(() => {
    void (async () => {
      try {
        const [tagRes, ffRes, scenarioRes, reminderRes, templateRes] = await Promise.all([
          api.tags.list(),
          selectedAccountId ? api.friendFields.list(selectedAccountId) : Promise.resolve({ success: true as const, data: [] }),
          api.scenarios.list(),
          api.reminders.list(),
          api.templates.list(),
        ])
        setRefs({
          tags: tagRes.success ? tagRes.data.map((t) => ({ id: t.id, name: t.name })) : [],
          friendFields: ffRes.success
            ? ffRes.data.map((f) => ({ id: f.id, name: f.name, ecIsMaster: f.ecIsMaster }))
            : [],
          scenarios: scenarioRes.success
            ? scenarioRes.data.map((s) => ({ id: s.id, name: s.name }))
            : [],
          reminders: reminderRes.success
            ? reminderRes.data.map((r) => ({ id: r.id, name: r.name }))
            : [],
          templates: templateRes.success
            ? templateRes.data.map((t) => ({ id: t.id, name: t.name, type: t.messageType }))
            : [],
        })

        if (!id || !selectedAccountId) return
        const res = await api.forms.get(id, selectedAccountId)
        if (res.success) {
          setName(res.data.name)
          setDescription(res.data.description ?? '')
          setIsActive(res.data.isActive)
          setSubmitCount(res.data.submitCount ?? 0)
          setOnSubmitTagId(res.data.onSubmitTagId ?? '')
          // layout はサーバ側が必ず作って返す（古いフォームは fields から）
          setLayoutState(res.data.layout ?? emptyLayout())
        }
      } catch {
        setError('読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    })()
  }, [id, selectedAccountId])

  // いま編集している並び（共通ヘッダ か セクション）
  const blocks = useMemo(
    () => (tab === HEADER_TAB ? layout.header : (layout.sections[tab]?.blocks ?? [])),
    [layout, tab],
  )

  const setBlocks = (next: FormBlock[]) =>
    setLayout((prev) =>
      tab === HEADER_TAB
        ? { ...prev, header: next }
        : {
            ...prev,
            sections: prev.sections.map((s, i) => (i === tab ? { ...s, blocks: next } : s)),
          },
    )

  const selectedIndex = blocks.findIndex((b) => b.id === selectedBlockId)

  const addBlock = (kind: string, type?: FormInputType) => {
    const inputCount = layout.sections.reduce(
      (n, s) => n + s.blocks.filter((b) => b.kind === 'input').length,
      layout.header.filter((b) => b.kind === 'input').length,
    )
    const block = makeBlock(kind, type, inputCount)
    setBlocks([...blocks, block])
    setSelectedBlockId(block.id)
    setShowAddMenu(false)
  }

  const patchBlock = (blockId: string, patch: Partial<FormBlock>) =>
    setBlocks(blocks.map((b) => (b.id === blockId ? ({ ...b, ...patch } as FormBlock) : b)))

  const moveBlock = (delta: number) => {
    if (selectedIndex < 0) return
    const to = selectedIndex + delta
    if (to < 0 || to >= blocks.length) return
    const next = [...blocks]
    const [row] = next.splice(selectedIndex, 1)
    next.splice(to, 0, row)
    setBlocks(next)
  }

  const duplicateBlock = () => {
    if (selectedIndex < 0) return
    const source = blocks[selectedIndex]
    const copy: FormBlock =
      source.kind === 'input'
        ? { ...source, id: newBlockId(), name: `${source.name}_copy` }
        : { ...source, id: newBlockId() }
    const next = [...blocks]
    next.splice(selectedIndex + 1, 0, copy)
    setBlocks(next)
    setSelectedBlockId(copy.id)
  }

  const removeBlock = () => {
    if (selectedIndex < 0) return
    setBlocks(blocks.filter((_, i) => i !== selectedIndex))
    setSelectedBlockId(null)
  }

  // ---- ページ（セクション） ----
  const addSection = () => {
    const section: FormSection = {
      id: newBlockId('s'),
      name: `セクション${layout.sections.length + 1}`,
      blocks: [],
    }
    setLayout((prev) => ({ ...prev, sections: [...prev.sections, section] }))
    setTab(layout.sections.length)
  }

  const renameSection = (index: number) => {
    const current = layout.sections[index]
    const next = window.prompt('ページの名前', current.name)
    if (next === null) return
    setLayout((prev) => ({
      ...prev,
      sections: prev.sections.map((s, i) => (i === index ? { ...s, name: next } : s)),
    }))
  }

  const duplicateSection = (index: number) => {
    const source = layout.sections[index]
    const copy: FormSection = {
      id: newBlockId('s'),
      name: `${source.name}のコピー`,
      blocks: source.blocks.map((b) =>
        b.kind === 'input'
          ? { ...b, id: newBlockId(), name: `${b.name}_copy` }
          : { ...b, id: newBlockId() },
      ),
    }
    setLayout((prev) => ({
      ...prev,
      sections: [...prev.sections.slice(0, index + 1), copy, ...prev.sections.slice(index + 1)],
    }))
    setTab(index + 1)
  }

  /*
   * ページの削除。**ブラウザの `confirm()` は使わない。**
   * 何個のブロックが消えるのか、どの分岐がつなぎ直されるのかを本文で読ませる。
   *
   * **`destructive` は付けない。** ここで消えるのは画面上の下書きだけで、
   * 「元に戻す」で戻せるし、保存するまで保存済みのフォームは変わらない。
   * 戻せる操作に赤い窓を出すと、本当に戻せない操作と見分けがつかなくなる。
   */
  const [removeSectionIndex, setRemoveSectionIndex] = useState<number | null>(null)
  const removeSectionTarget =
    removeSectionIndex === null ? null : (layout.sections[removeSectionIndex] ?? null)

  const removeSection = (index: number) => {
    if (layout.sections.length <= 1) return
    const target = layout.sections[index]
    if (!target) return
    setRemoveSectionIndex(null)
    setLayout((prev) => ({
      ...prev,
      // 消えるページへ飛ばしていた選択肢は、行き先を外して「次へ進む」に戻す
      sections: prev.sections
        .filter((_, i) => i !== index)
        .map((s) => ({
          ...s,
          blocks: s.blocks.map((b) =>
            b.kind === 'input' && b.choices
              ? {
                  ...b,
                  choices: b.choices.map((c) =>
                    c.jumpToSectionId === target.id ? { ...c, jumpToSectionId: null } : c,
                  ),
                }
              : b,
          ),
        })),
    }))
    setTab(Math.max(0, index - 1))
  }

  const askRemoveSection = (index: number) => {
    if (layout.sections.length <= 1) return
    // 中身が無いページは、消えるものが無いので確認しない。
    if ((layout.sections[index]?.blocks.length ?? 0) === 0) {
      removeSection(index)
      return
    }
    setRemoveSectionIndex(index)
  }

  const save = async () => {
    if (!selectedAccountId) {
      setError('LINE公式アカウントを選んでください')
      return
    }
    if (!name.trim()) {
      setError('フォーム名を入力してください')
      return
    }
    const unnamed = layout.header
      .concat(layout.sections.flatMap((s) => s.blocks))
      .find((b) => b.kind === 'input' && !b.label.trim())
    if (unnamed) {
      setError('タイトルが空のブロックがあります')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')
    try {
      const res = await api.forms.update(id, selectedAccountId, {
        name: name.trim(),
        description: description.trim() || null,
        layout,
        onSubmitTagId: onSubmitTagId || null,
        isActive,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setNotice('保存しました')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  if (!id) {
    return (
      <div>

        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          フォームが指定されていません。
          <Link href="/form-submissions" className="text-accent ml-1 hover:underline">
            一覧へ戻る
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <nav className="text-ink-faint mb-2 text-xs" data-design="Crumb">
        <Link href="/form-submissions" className="hover:underline">
          回答フォーム
        </Link>
        <span className="mx-1.5">/</span>
        <span>{name || '（名前なし）'}</span>
      </nav>

      <div data-design="Head">
        <Header
          title="回答フォーム編集"
          description="ブロックを積んでフォームを作ります。選択肢ごとにタグを付けたり、答えを友だち情報へ入れたりできます。"
          action={
            <div className="flex flex-wrap gap-2">
              {/* 設計にあるが、まだ作っていないもの。並びから消すと「この画面には
                  その機能が無い」ように見えるので、押せない状態で置いておく。
                  デザイン設定は、フォームの見た目をこのアプリのデザインに
                  そろえる方針にしたため、色やフォントを選ぶ画面は作っていない。 */}
              {['マニュアル', '下書き保存', 'デザイン設定'].map((label) => (
                <button
                  key={label}
                  disabled
                  title="準備中です"
                  className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => setShowOptions(true)}
                className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-2 text-sm font-medium"
              >
                オプション設定
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
              >
                {saving ? '保存中...' : 'フォームを保存'}
              </button>
            </div>
          }
        />
      </div>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <>
          <div
            data-design="Meta"
            className="bg-canvas rounded-card border-hairline mb-4 grid gap-4 border p-4 sm:grid-cols-2 xl:grid-cols-5"
          >
            <Field label="フォーム名" htmlFor="fm-name" required>
              <input
                id="fm-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="公開状態" htmlFor="fm-active">
              <SelectField id="fm-active" value={isActive ? '1' : '0'} onChange={(e) => setIsActive(e.target.value === '1')} options={[{ value: "1", label: "公開中" }, { value: "0", label: "停止中" }]} className={inputClass} />
            </Field>

            <Field
              label="回答したときに付けるタグ"
              htmlFor="fm-tag"
              note="このフォームに答えた人を、あとから絞り込めます。"
            >
              <SelectField
                id="fm-tag"
                value={onSubmitTagId}
                onChange={(e) => setOnSubmitTagId(e.target.value)}
                options={[{ value: '', label: '— 付けない —' }, ...refs.tags.map((t) => ({ value: t.id, label: t.name }))]}
              />
            </Field>

            <Field
              label="回答用URL"
              note={
                answerUrl
                  ? '友だちに配るURLです。LINEの中で開きます。'
                  : 'このアカウントに LIFF を登録すると、配れるURLが出ます。'
              }
            >
              {answerUrl ? (
                <div className="flex items-center gap-1">
                  <input
                    readOnly
                    value={answerUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className={`${inputClass} text-xs`}
                  />
                  <button
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(answerUrl)
                        .then(() => setNotice('URLをコピーしました'))
                        .catch(() => window.prompt('コピーしてください:', answerUrl))
                    }}
                    className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control shrink-0 border px-2 py-2 text-xs whitespace-nowrap"
                  >
                    コピー
                  </button>
                </div>
              ) : (
                <p className="text-ink-faint rounded-control border-hairline border px-3 py-2 text-sm">
                  —
                </p>
              )}
            </Field>

            <div>
              <p className="text-ink-faint text-xs">回答</p>
              <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
                {submitCount}
                <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
              </p>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(320px,26rem)_minmax(0,1fr)]">
            {/* ---- 出来上がり ---- */}
            <section data-design="Preview" className="xl:sticky xl:top-4 xl:self-start">
              <h2 className="text-ink-secondary mb-2 text-xs font-medium">出来上がり</h2>
              <FormPreview layout={layout} sectionIndex={tab === HEADER_TAB ? 0 : tab} />
            </section>

            {/* ---- 設定 ---- */}
            <section className="min-w-0">
              {/* タブ */}
              <div className="border-hairline flex flex-wrap items-center gap-1 border-b pb-2">
                <button
                  onClick={() => setTab(HEADER_TAB)}
                  className={`rounded-control px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
                    tab === HEADER_TAB
                      ? 'bg-accent-soft text-accent'
                      : 'text-ink-secondary hover:bg-canvas-sunken'
                  }`}
                >
                  共通ヘッダ
                </button>

                {layout.sections.map((section, i) => (
                  <span key={section.id} className="flex items-center">
                    <button
                      onClick={() => setTab(i)}
                      onDoubleClick={() => renameSection(i)}
                      title="ダブルクリックで名前を変えられます"
                      className={`rounded-control px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
                        tab === i
                          ? 'bg-accent-soft text-accent'
                          : 'text-ink-secondary hover:bg-canvas-sunken'
                      }`}
                    >
                      {section.name}
                    </button>
                    {tab === i && (
                      <span className="flex items-center">
                        <button
                          onClick={() => duplicateSection(i)}
                          className="text-ink-faint hover:text-ink px-1 text-xs"
                          title="このページを複製"
                        >
                          複製
                        </button>
                        {layout.sections.length > 1 && (
                          <button
                            onClick={() => askRemoveSection(i)}
                            className="text-danger px-1 text-xs"
                            title="このページを削除"
                          >
                            削除
                          </button>
                        )}
                      </span>
                    )}
                  </span>
                ))}

                <button
                  onClick={addSection}
                  className="text-accent hover:bg-accent-soft rounded-control px-2 py-1.5 text-sm font-bold"
                  title="ページを足す"
                >
                  ＋
                </button>
              </div>

              {/* ツールバー */}
              <div
                data-design="Blocks"
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="text-ink text-sm font-bold">ブロック設定</span>
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    onClick={undo}
                    className="text-ink-secondary hover:bg-canvas-sunken rounded-control px-2 py-1 text-xs"
                  >
                    元に戻す
                  </button>
                  <button
                    onClick={redo}
                    className="text-ink-secondary hover:bg-canvas-sunken rounded-control px-2 py-1 text-xs"
                  >
                    やり直す
                  </button>
                  <button
                    onClick={() => moveBlock(-1)}
                    disabled={selectedIndex < 0}
                    className="text-ink-secondary hover:bg-canvas-sunken rounded-control px-2 py-1 text-xs disabled:opacity-40"
                  >
                    上に移動
                  </button>
                  <button
                    onClick={() => moveBlock(1)}
                    disabled={selectedIndex < 0}
                    className="text-ink-secondary hover:bg-canvas-sunken rounded-control px-2 py-1 text-xs disabled:opacity-40"
                  >
                    下に移動
                  </button>
                  <button
                    onClick={duplicateBlock}
                    disabled={selectedIndex < 0}
                    className="text-ink-secondary hover:bg-canvas-sunken rounded-control px-2 py-1 text-xs disabled:opacity-40"
                  >
                    複製
                  </button>
                  <button
                    onClick={removeBlock}
                    disabled={selectedIndex < 0}
                    className="text-danger hover:bg-danger-bg rounded-control px-2 py-1 text-xs disabled:opacity-40"
                  >
                    削除
                  </button>

                  <div className="relative">
                    <button
                      onClick={() => setShowAddMenu((v) => !v)}
                      className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-3 py-1.5 text-xs font-medium"
                    >
                      ＋ ブロックを追加
                    </button>
                    {showAddMenu && (
                      <>
                        {/* 外を押したら閉じる */}
                        <button
                          className="fixed inset-0 z-10 cursor-default"
                          onClick={() => setShowAddMenu(false)}
                          aria-label="閉じる"
                        />
                        <div className="bg-canvas rounded-card border-hairline absolute right-0 z-20 mt-1 w-48 border py-1 shadow-lg">
                          {['飾り', '入力'].map((group) => (
                            <div key={group}>
                              <p className="text-ink-faint px-3 py-1 text-[11px]">{group}</p>
                              {BLOCK_MENU.filter((m) => m.group === group).map((m) => (
                                <button
                                  key={`${m.kind}-${m.type ?? ''}`}
                                  onClick={() => addBlock(m.kind, m.type)}
                                  className="text-ink hover:bg-canvas-sunken block w-full px-3 py-1.5 text-left text-sm"
                                >
                                  {m.label}
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* ブロック。設計では「一覧」と「選んだものの設定」が別の枠だが、
                  ここでは1枚のブロックに設定をそのまま出している。1つずつ
                  選び直さないと中身が見えないと、2つの質問の差（片方だけ
                  タグを付ける等）を見比べられないため。 */}
              <div data-design="Inspector" className="space-y-3">
                {blocks.length === 0 ? (
                  <p className="text-ink-faint bg-canvas rounded-card border-hairline border border-dashed p-8 text-center text-sm">
                    「ブロックを追加」から作ってください
                  </p>
                ) : (
                  blocks.map((block, index) => (
                    <BlockEditor
                      key={block.id}
                      block={block}
                      index={index}
                      sections={layout.sections}
                      refs={refs}
                      selected={block.id === selectedBlockId}
                      onSelect={() => setSelectedBlockId(block.id)}
                      onChange={(patch) => patchBlock(block.id, patch)}
                    />
                  ))
                )}
              </div>

              <div className="bg-canvas rounded-card border-hairline mt-4 space-y-4 border p-4">
                <Field
                  label="説明"
                  htmlFor="fm-desc"
                  note="回答の一覧で、フォームの覚え書きに使います。"
                >
                  <textarea
                    id="fm-desc"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className={`${inputClass} resize-y`}
                  />
                </Field>

                {error && <p className="text-danger text-sm">{error}</p>}
                {notice && <p className="text-success text-sm">{notice}</p>}
              </div>
            </section>
          </div>
        </>
      )}

      {/*
        ページを消す前の確認。**「元に戻す」で戻せるので `destructive` は付けない。**
        保存するまで、保存済みのフォームと集まった回答は変わらない。
      */}
      <ConfirmDialog
        open={removeSectionTarget !== null}
        title={removeSectionTarget ? `ページ「${removeSectionTarget.name}」を削除しますか？` : ''}
        description="このページと、中に置いたブロックを画面から外します。保存するまで、保存済みのフォームは変わりません。"
        confirmLabel="削除する"
        onConfirm={() => {
          if (removeSectionIndex !== null) removeSection(removeSectionIndex)
        }}
        onCancel={() => setRemoveSectionIndex(null)}
      >
        {removeSectionTarget && (
          <ul className="text-ink-secondary space-y-1 text-xs leading-5">
            <li>
              ・消えること: このページのブロック
              <span className="tabular-nums">{removeSectionTarget.blocks.length}</span>
              個が一緒に外れます。
            </li>
            {/* 行き先を失った分岐は「次へ進む」に戻る。何本つなぎ直すのかを先に言う。 */}
            {jumpsInto(layout, removeSectionTarget.id) > 0 && (
              <li>
                ・つなぎ直すこと: このページへ飛ばしていた選択肢
                <span className="tabular-nums">{jumpsInto(layout, removeSectionTarget.id)}</span>
                件は、行き先が外れて「次へ進む」に戻ります。
              </li>
            )}
            <li>・残ること: すでに集まった回答は消えません。</li>
            <li>・戻せます: 上の「元に戻す」で戻せます。保存するまで保存済みのフォームは変わりません。</li>
          </ul>
        )}
      </ConfirmDialog>

      {showOptions && (
        <OptionsDialog
          value={layout.options}
          refs={refs}
          onChange={(options: FormOptions) => setLayout((prev) => ({ ...prev, options }))}
          onClose={() => setShowOptions(false)}
        />
      )}
    </div>
  )
}

export default function FormEditPage() {
  usePageTitle('回答フォーム編集')
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <FormEditInner />
    </Suspense>
  )
}
