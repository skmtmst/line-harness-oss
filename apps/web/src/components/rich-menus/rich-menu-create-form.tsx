'use client'

import { useMemo, useState, type ReactNode } from 'react'
import Button from '@/components/shared/button'
import { RequiredBadge } from '@/components/shared/form-controls'
import SelectField from '@/components/shared/select-field'
import StepTrail from '@/components/shared/step-trail'
import ConditionBuilder from '@/components/shared/condition-builder'
import { AreaProperties } from './area-properties'
import type { Area } from './canvas-editor'
import {
  createAreaDrafts,
  isAreaActionConfigured,
  saveAreaDraft,
  unsetAreaLabels,
} from './action-drafts'
import { SIZE_DIMENSIONS, TEMPLATES, type RichMenuTemplate } from '@/lib/rich-menu-templates'
import type { SegmentCondition } from '@/lib/segment-condition'
import type { RichMenuAreaIntent } from '@line-crm/shared'

export type RichMenuOption = { id: string; name: string }
export type RichMenuFolderOption = RichMenuOption

export type RichMenuCreateValue = {
  name: string
  chatBarText: string
  size: 'large' | 'compact'
  tabCount: number
  templateKey: string
  folderId: string
  areaDraftsByTemplate: Record<string, Area[]>
  /**
   * N-161: 作成の時点で決める「どのページを最初に見せるか」。
   * ページの orderIndex（0 がトップ）。タブを増やしたあとで減らしたときは
   * 範囲内へ丸める。
   */
  defaultPageIndex: number
  /**
   * N-161: 「公開したら全員の既定メニューにする」か。
   * 出し分け（targetingEnabled）と両立しないため、出し分けを選んだらOFF固定。
   */
  isDefaultForAll: boolean
  /** N-161: 出す相手の条件。有効にするなら targetingCondition が必須。 */
  targetingEnabled: boolean
  targetingCondition: SegmentCondition | null
  /** N-161: 複数の条件に当てはまったときの優先順（0 がいちばん先）。 */
  targetingPriority: number
}

export const STORE_NEW_MENU_INTENTS: RichMenuAreaIntent[] = [
  'url', 'text', 'template', 'form', 'tel', 'postback',
]

/**
 * N-161: 新規作成ではページ切替もここで決める。
 * 統括ひな形（STORE_NEW_MENU_INTENTS）には switch を足さない。
 * 配布形式が切替を保持できないため（hq-rich-menu-create.ts で保存時に断る）。
 */
export const NEW_MENU_INTENTS_WITH_SWITCH: RichMenuAreaIntent[] = [
  ...STORE_NEW_MENU_INTENTS,
  'switch',
]

export function freshRichMenuCreateValue(): RichMenuCreateValue {
  return {
    name: '',
    chatBarText: 'メニュー',
    size: 'large',
    tabCount: 0,
    templateKey: TEMPLATES[0].key,
    folderId: '',
    areaDraftsByTemplate: {},
    defaultPageIndex: 0,
    isDefaultForAll: false,
    targetingEnabled: false,
    targetingCondition: null,
    targetingPriority: 0,
  }
}

const SIZE_TABS: { value: 'large' | 'compact'; label: string; dims: string; hint: string }[] = [
  { value: 'large', label: '大きい', dims: `${SIZE_DIMENSIONS.large.width} × ${SIZE_DIMENSIONS.large.height}px`, hint: '画面をしっかり使う。ボタンを6つまで置ける' },
  { value: 'compact', label: '小さい', dims: `${SIZE_DIMENSIONS.compact.width} × ${SIZE_DIMENSIONS.compact.height}px`, hint: 'トークが隠れにくい。横に並べる形' },
]

const LARGE_TEMPLATE_ORDER = [
  'large-full', 'large-1x2-v', 'large-1x2-h', 'large-1plus2',
  'large-2x2', 'large-2plus1', 'large-2x3',
] as const

const TEMPLATE_LABELS: Record<string, string> = {
  'large-full': '1面',
  'large-1x2-v': '上下2面',
  'large-1x2-h': '左右2面',
  'large-1plus2': '上1・下2',
  'large-2x2': '4面',
  'large-2plus1': '上2・下1',
  'large-2x3': '6面',
}

export function RichMenuTemplatePreview({ template }: { template: RichMenuTemplate }) {
  const dims = SIZE_DIMENSIONS[template.size]
  const inset = dims.width * 0.006
  return (
    <svg viewBox={`0 0 ${dims.width} ${dims.height}`} className="border-hairline bg-canvas-sunken w-full rounded border" role="img" aria-label={`${template.label} の面の分けかた`}>
      {template.areas.length === 0 ? (
        <text x={dims.width / 2} y={dims.height / 2} textAnchor="middle" dominantBaseline="central" fontSize={dims.height / 7} style={{ fill: 'var(--color-ink-faint)' }}>自由に配置</text>
      ) : template.areas.map((area, index) => (
        <g key={index}>
          <rect x={area.x + inset} y={area.y + inset} width={Math.max(0, area.w - inset * 2)} height={Math.max(0, area.h - inset * 2)} rx={dims.width * 0.008} strokeWidth={dims.width * 0.004} style={{ fill: 'var(--color-accent-soft)', stroke: 'var(--color-accent)' }} />
          <text x={area.x + area.w / 2} y={area.y + area.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={dims.height / 8} style={{ fill: 'var(--color-ink-secondary)', fontWeight: 700 }}>{String.fromCharCode(65 + index)}</text>
        </g>
      ))}
    </svg>
  )
}

type Props = {
  value: RichMenuCreateValue
  onChange: (next: RichMenuCreateValue) => void
  folders?: RichMenuFolderOption[]
  tags?: RichMenuOption[]
  templates?: RichMenuOption[]
  forms?: RichMenuOption[]
  trackedLinks?: RichMenuOption[]
  allowedIntents?: RichMenuAreaIntent[]
  disabled?: boolean
  compatibilityError?: string | null
  validationError?: string | null
  /**
   * その場の入力欄エラー（作成画面の保存前検証用）。
   * 渡すと該当の入力欄の下にその場で出し、欄へフォーカスできるよう
   * 欄に id を付ける。ページ最下部の帯には出さない。
   */
  nameError?: string | null
  chatBarTextError?: string | null
  /**
   * N-161: 「最初に見せるページ・出す相手・全員既定」の入力を出すか。
   * 統括ひな形（HQ）はこの3つを保存できないため、そこでは付けない。
   * 出したまま保存先に無いと、入力が黙って捨てられる。
   */
  audienceSetup?: boolean
  imageAction?: ReactNode
  footer?: ReactNode
}

export default function RichMenuCreateForm({
  value,
  onChange,
  folders = [],
  tags = [],
  templates = [],
  forms = [],
  trackedLinks = [],
  allowedIntents = STORE_NEW_MENU_INTENTS,
  disabled = false,
  compatibilityError,
  validationError,
  nameError,
  chatBarTextError,
  audienceSetup = false,
  imageAction,
  footer,
}: Props) {
  const [editingAreaIndex, setEditingAreaIndex] = useState<number | null>(null)
  const [editingArea, setEditingArea] = useState<Area | null>(null)
  const shownTemplates = useMemo(() => {
    const bySize = TEMPLATES.filter((template) => template.size === value.size)
    if (value.size === 'compact') return bySize
    return LARGE_TEMPLATE_ORDER
      .map((key) => bySize.find((template) => template.key === key))
      .filter((template): template is RichMenuTemplate => Boolean(template))
  }, [value.size])
  const template = shownTemplates.find((item) => item.key === value.templateKey) ?? shownTemplates[0]
  const initialAreas = useMemo(() => createAreaDrafts(template), [template])
  const currentAreas = value.areaDraftsByTemplate[template.key] ?? initialAreas
  const unsetLabels = unsetAreaLabels(currentAreas)
  const locked = disabled || Boolean(compatibilityError)
  const patch = (next: Partial<RichMenuCreateValue>) => onChange({ ...value, ...next })

  /*
   * N-161: 作成前はページに実IDがない。切替ボタンの行き先と既定ページは
   * orderIndex（= ここでは文字列化した番号）で持ち、送信時に
   * actionData.targetPageIndex / defaultPageIndex へ写す。
   */
  const createPages = useMemo(
    () => Array.from({ length: value.tabCount + 1 }, (_, index) => ({
      id: String(index),
      name: index === 0 ? 'トップ' : `タブ ${String.fromCharCode(65 + index - 1)}`,
    })),
    [value.tabCount],
  )

  function changeSize(size: 'large' | 'compact') {
    const first = TEMPLATES.find((item) => item.size === size)
    patch({ size, ...(first ? { templateKey: first.key } : {}) })
    setEditingAreaIndex(null)
    setEditingArea(null)
  }

  function selectTemplate(templateKey: string) {
    patch({ templateKey })
    setEditingAreaIndex(null)
    setEditingArea(null)
  }

  function openAreaEditor(index: number) {
    const area = currentAreas[index]
    if (!area || locked) return
    setEditingAreaIndex(index)
    setEditingArea({ ...area, actionData: { ...area.actionData }, tagIds: [...(area.tagIds ?? [])] })
  }

  function saveEditingArea() {
    if (editingAreaIndex === null || !editingArea) return
    onChange({
      ...value,
      areaDraftsByTemplate: {
        ...value.areaDraftsByTemplate,
        [template.key]: saveAreaDraft(currentAreas, editingAreaIndex, editingArea),
      },
    })
    setEditingAreaIndex(null)
    setEditingArea(null)
  }

  return (
    <>
      <section data-design="Head" hidden>
        <p>リッチメニューを作る</p>
        <p>名前と土台のレイアウトを決めます。画像とタップ領域は、作成後の編集画面で設定します。</p>
      </section>
      <StepTrail label="リッチメニュー作成の進み方" items={[{ label: '形とボタン', state: 'current' }, { label: '誰に出すか', state: 'todo' }, { label: '公開のしかた', state: 'todo' }]} />
      {compatibilityError || validationError ? <div role="alert" className="border-danger bg-danger-bg text-danger mt-4 rounded-control border p-3 text-sm">{compatibilityError ?? validationError}</div> : null}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-4">
        <div className="border-hairline bg-canvas rounded-card min-w-0 space-y-4 border p-4 shadow-sm lg:col-span-3">
          <div className="grid gap-3 lg:grid-cols-6">
            <div className="lg:col-span-3">
              <label className="text-ink-secondary mb-1 block text-sm font-medium" htmlFor="rich-menu-name">メニュー名<RequiredBadge /></label>
              <input id="rich-menu-name" value={value.name} aria-label="メニュー名" onChange={(event) => patch({ name: event.target.value })} aria-required="true" aria-invalid={Boolean(nameError)} aria-describedby={nameError ? 'rich-menu-name-error' : undefined} disabled={locked} className="border-hairline rounded-control focus:ring-accent block w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" placeholder="例：メインメニュー" />
              {nameError ? <p id="rich-menu-name-error" role="alert" className="text-danger mt-1 text-xs">{nameError}</p> : <p className="text-ink-faint mt-1 text-xs">管理画面での識別用です。友だちには表示されません。</p>}
            </div>
            <div className="lg:col-span-1">
              <label className="text-ink-secondary mb-1 block text-sm font-medium" htmlFor="rich-menu-folder">フォルダ</label>
              <SelectField id="rich-menu-folder" aria-label="フォルダ" value={value.folderId} disabled={locked || folders.length === 0} onChange={(event) => patch({ folderId: event.target.value })} options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]} />
            </div>
            <div className="lg:col-span-2">
              <label className="text-ink-secondary mb-1 block text-sm font-medium" htmlFor="rich-menu-chat-bar-text">トーク画面下の文言</label>
              <input id="rich-menu-chat-bar-text" value={value.chatBarText} aria-label="メニューを開くボタンの文字" onChange={(event) => patch({ chatBarText: event.target.value })} maxLength={14} aria-required="true" aria-invalid={Boolean(chatBarTextError)} aria-describedby={chatBarTextError ? 'rich-menu-chat-bar-text-error' : undefined} disabled={locked} className="border-hairline rounded-control focus:ring-accent block w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" />
              {chatBarTextError ? <p id="rich-menu-chat-bar-text-error" role="alert" className="text-danger mt-1 text-xs">{chatBarTextError}</p> : <p className="text-ink-faint mt-1 text-xs">14文字以内。メニューを開く前にトーク画面下に表示されます。</p>}
            </div>
          </div>

          <div>
            <span className="text-ink-secondary mb-2 block text-sm font-medium">画像の大きさ</span>
            <div className="flex flex-wrap gap-2">
              {SIZE_TABS.map((item) => <button key={item.value} type="button" disabled={locked} onClick={() => changeSize(item.value)} aria-pressed={value.size === item.value} className={`rounded-control border px-4 py-2 text-left text-sm transition-colors ${value.size === item.value ? 'border-accent bg-accent-soft text-ink' : 'border-transparent text-ink-secondary hover:bg-canvas-sunken'}`}><span className="font-medium whitespace-nowrap">{item.label}</span><span className="text-ink-faint ml-2 text-xs whitespace-nowrap">{item.dims}</span><span className="text-ink-faint text-micro mt-0.5 block">{item.hint}</span></button>)}
            </div>
          </div>

          <div>
            <span className="text-ink-secondary mb-1 block text-sm font-medium">切替タブの数</span>
            <p className="text-ink-faint mb-2 text-xs">タブでほかのメニューへ移れます。切り替えが要らないときは「なし」。</p>
            <div className="flex flex-wrap gap-2">{[0, 1, 2, 3].map((count) => <button key={count} type="button" disabled={locked} aria-pressed={value.tabCount === count} onClick={() => patch({ tabCount: count, defaultPageIndex: Math.min(value.defaultPageIndex, count) })} className={`rounded-control border px-4 py-2 text-xs font-semibold ${value.tabCount === count ? 'border-accent bg-accent-soft text-accent-deep' : 'border-transparent bg-canvas text-ink-secondary'}`}>{count === 0 ? 'なし' : `${count}つ`}</button>)}</div>
          </div>

          <div>
            <span className="text-ink-secondary mb-2 block text-sm font-medium">面の分けかた</span>
            <p className="text-ink-faint mb-3 text-xs">押せるところをいくつに分けるか。あとから編集画面で区切り直せます。</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
              {shownTemplates.map((item) => <label key={item.key} className={`rounded-control border p-2 transition-colors ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${value.templateKey === item.key ? 'border-accent bg-accent-soft' : 'border-hairline hover:bg-canvas-sunken'}`}><input type="radio" name="template" value={item.key} checked={value.templateKey === item.key} disabled={locked} onChange={(event) => selectTemplate(event.target.value)} className="sr-only" /><RichMenuTemplatePreview template={item} /><div className="text-ink mt-1 text-center text-xs font-medium">{TEMPLATE_LABELS[item.key] ?? item.label}</div></label>)}
            </div>
          </div>

          {/*
            N-161: 切替・既定・出し分けを作成の時点で決める。
            ここで決めないと「下書きを作ったのに公開できる形になっていない」
            未完の作業が編集画面へ隠れてしまう。
          */}
          <section className="border-hairline rounded-card space-y-4 border p-4" hidden={!audienceSetup}>
            <h2 className="text-ink text-sm font-bold">最初に見せるページと、出す相手</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {value.tabCount > 0 ? (
                <div>
                  <label className="text-ink-secondary mb-1 block text-sm font-medium" htmlFor="rich-menu-default-page">最初に見せるページ</label>
                  <SelectField
                    id="rich-menu-default-page"
                    aria-label="最初に見せるページ"
                    value={String(value.defaultPageIndex)}
                    disabled={locked}
                    onChange={(event) => patch({ defaultPageIndex: Number(event.target.value) })}
                    options={createPages.map((page) => ({ value: page.id, label: page.name }))}
                  />
                  <p className="text-ink-faint mt-1 text-xs">タブを切り替えていない人が最初に見るページです。</p>
                </div>
              ) : null}
              <div>
                <span className="text-ink-secondary mb-1 block text-sm font-medium">出す相手</span>
                <div className="space-y-2">
                  <label className="flex items-start gap-2 text-sm">
                    <input type="radio" name="create-audience" className="mt-1" checked={!value.targetingEnabled} disabled={locked} onChange={() => patch({ targetingEnabled: false })} />
                    <span><span className="text-ink font-medium">すべての友だち</span><span className="text-ink-faint block text-xs">ほかの出し分けに当てはまらなかった人へ出ます</span></span>
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="radio" name="create-audience" className="mt-1" checked={value.targetingEnabled} disabled={locked} onChange={() => patch({ targetingEnabled: true, isDefaultForAll: false })} />
                    <span><span className="text-ink font-medium">条件に当てはまる友だちだけ</span><span className="text-ink-faint block text-xs">当てはまらない人には、これより下のメニューが出ます</span></span>
                  </label>
                </div>
              </div>
            </div>

            {value.targetingEnabled ? (
              <div className="border-hairline grid gap-4 rounded-control border p-3 sm:grid-cols-2">
                <div>
                  <span className="text-ink-secondary text-xs font-medium">条件</span>
                  <div className="mt-1">
                    <ConditionBuilder
                      value={value.targetingCondition}
                      onChange={(condition) => patch({ targetingCondition: condition })}
                      label="条件"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-ink-secondary text-xs font-medium" htmlFor="create-targeting-priority">出す順番</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      id="create-targeting-priority"
                      aria-label="出す順番"
                      type="number"
                      min={1}
                      disabled={locked}
                      value={value.targetingPriority + 1}
                      onChange={(event) => patch({ targetingPriority: Math.max(0, Number(event.target.value) - 1) })}
                      className="border-hairline rounded-control w-20 border px-3 py-2 text-sm"
                    />
                    <span className="text-ink-secondary text-xs">番目</span>
                  </div>
                  <p className="text-ink-faint mt-1 text-xs">ほかの出し分けにも当てはまる人には、順番が早いメニューが出ます。</p>
                </div>
              </div>
            ) : null}

            <label className={`flex items-start gap-2 text-sm ${value.targetingEnabled ? 'opacity-50' : ''}`}>
              <input
                type="checkbox"
                className="mt-1"
                checked={value.isDefaultForAll}
                disabled={locked || value.targetingEnabled}
                onChange={(event) => patch({ isDefaultForAll: event.target.checked })}
              />
              <span>
                <span className="text-ink font-medium">公開したら「すべての友だち」の既定メニューにする</span>
                <span className="text-ink-faint block text-xs">
                  {value.targetingEnabled
                    ? '出し分けを選んだメニューは全員の既定にはできません。'
                    : '公開のときにLINEの既定へ設定します。ほかに既定のメニューがある場合は入れ替わります。'}
                </span>
              </span>
            </label>
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <section><h2 className="text-ink-secondary text-sm font-medium">トークを開いたとき</h2><p className="text-ink-faint mt-2 text-xs leading-5">メニューを開いた状態・閉じた状態の指定は、下書き保存後の編集画面で設定します。</p></section>
            <section><h2 className="text-ink-secondary text-sm font-medium">画像</h2>{imageAction ?? <Button href="/contents" className="mt-2">登録メディアから選ぶ</Button>}<p className="text-ink-faint mt-2 text-xs">{SIZE_DIMENSIONS.large.width} × {SIZE_DIMENSIONS.large.height}px ／ 1MBまで・JPG・PNG</p><p className="text-ink-faint mt-1 text-micro">選んだ画像は下書きの最初に見せるページへ登録します。</p></section>
          </div>

          <section className="border-hairline bg-canvas-sunken rounded-card border p-4">
            <h2 className="text-ink mb-3 text-sm font-bold">押した面ごとの動き</h2>
            <div className="space-y-2">{currentAreas.map((area, index) => <div key={area.id}><div className="border-hairline bg-canvas flex items-center gap-3 rounded-control border px-3 py-2 text-xs"><strong className="text-ink flex h-6 w-6 items-center justify-center rounded-control border border-hairline">{String.fromCharCode(65 + index)}</strong><span className="text-ink-secondary">{isAreaActionConfigured(area) ? area.label || 'アクション設定済み' : 'アクションを実行'}</span><button type="button" disabled={locked} onClick={() => openAreaEditor(index)} className={`ml-auto font-semibold ${isAreaActionConfigured(area) ? 'text-action' : 'text-danger'}`}>{isAreaActionConfigured(area) ? '設定を変更する' : 'アクションを設定する'}</button></div>{editingAreaIndex === index && editingArea ? <div className="border-hairline bg-canvas mt-2 rounded-control border p-4"><AreaProperties area={editingArea} pages={createPages} tags={tags} templates={templates} forms={forms} trackedLinks={trackedLinks} taps={null} showManagementDetails={false} allowedIntents={allowedIntents} onUpdate={(areaPatch) => setEditingArea((current) => current ? { ...current, ...areaPatch } : current)} /><div className="mt-4 flex justify-end gap-2"><Button type="button" onClick={() => { setEditingAreaIndex(null); setEditingArea(null) }}>キャンセル</Button><Button type="button" variant="primary" onClick={saveEditingArea}>この面の設定を保存</Button></div></div> : null}</div>)}</div>
            <p className={`mt-3 text-xs font-semibold ${unsetLabels.length > 0 ? 'text-danger' : 'text-success'}`}>{currentAreas.length === 0 ? '面を追加し、公開前にそれぞれのアクションを設定してください。' : unsetLabels.length > 0 ? `面 ${unsetLabels.join('、')} のアクションが未設定です。公開すると、その場所を押しても何も起きません。` : 'すべての面にアクションが設定されています。'}</p>
          </section>
        </div>

        <aside className="sticky top-20 space-y-3">
          <section className="bg-info rounded-card p-4 text-on-accent"><h2 className="mb-3 text-center text-sm font-bold">LINEプレビュー</h2><p className="bg-canvas text-ink mb-1 rounded-t-control py-2 text-center text-xs">{value.chatBarText || 'メニュー'}</p><RichMenuTemplatePreview template={template} /></section>
          <section className="bg-warning-bg text-warning rounded-card p-4 text-xs leading-6"><h2 className="font-bold">公開前に見ておくところ</h2><p>・アクションが未設定の面が {unsetLabels.length}つあります</p><p>・画像は1MBまで。超えると登録できません</p><p>・切替メニューの移動先は、公開してからでないと動きません</p></section>
        </aside>
        {footer ? <div className="lg:col-span-4">{footer}</div> : null}
      </div>
    </>
  )
}
