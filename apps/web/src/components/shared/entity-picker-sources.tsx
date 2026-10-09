'use client'

/*
 * 作ってあるものを選ぶ窓（EntityPicker）の、種類ごとの決まり。
 * - 名前・印・作る画面へのリンク・フォルダの読み込み口（一覧と同じ API）
 * - 候補の変換（API の行 → EntityPickerItem）
 * - 中身の見本（テンプレート＝LINE のトークのスマホ、回答フォーム＝お客さまのスマホ）。
 *   見本の無い種類（シナリオ・タグなど）は見本の列を出さない。
 * データは今の画面が読んでいる行をそのまま渡す。窓を開いたときだけフォルダ・見本を読む。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import dynamic from 'next/dynamic'
import {
  Bell, BookOpen, CalendarDays, ClipboardList, FileText, LayoutGrid, Tag as TagIcon, UserRound, Workflow, type LucideIcon,
} from 'lucide-react'
import type { FormLayout } from '@line-crm/shared'
import { api } from '@/lib/api'
import * as accountContext from '@/contexts/account-context'
import FlexPreview from '@/components/flex-preview'
import LinePreview, { LinePreviewMessage } from './line-preview'
import ListState from './list-state'
import { buildTemplatePreview, EMPTY_TEMPLATE_REFERENCES } from '@/components/templates/message-template-editor'
import { EntityPickerDialog, EntityPickerField, type EntityPickerCategory, type EntityPickerFolder, type EntityPickerItem } from './entity-picker'

const FormPhone = dynamic(() => import('@/v8/form-edit/phone').then((mod) => mod.FormPhone), { ssr: false, loading: () => <ListState kind="loading" /> })

export type EntityKind = 'template' | 'form' | 'scenario' | 'tag' | 'rich_menu' | 'booking_menu' | 'event' | 'reminder' | 'staff' | 'webhook' | 'common_action'

type KindDef = {
  noun: string
  icon: LucideIcon
  createHref?: string
  createLabel?: string
  /** フォルダの読み込み口。無い種類はフォルダの列を出さない。 */
  folders?: (accountId?: string) => Promise<EntityPickerFolder[]>
  unit?: string
}

async function genericFolders(kind: string, accountId?: string): Promise<EntityPickerFolder[]> {
  const res = await api.folders.list(kind, accountId)
  if (!res?.success) throw new Error('folders')
  return res.data.map((folder) => ({ id: folder.id, name: folder.name, color: folder.color ?? null }))
}

export const ENTITY_KINDS: Record<EntityKind, KindDef> = {
  template: { noun: 'テンプレート', icon: FileText, createHref: '/templates/edit', createLabel: 'テンプレートを作る', folders: (id) => genericFolders('template', id) },
  form: { noun: '回答フォーム', icon: ClipboardList, createHref: '/form-submissions/edit', createLabel: '回答フォームを作る', folders: (id) => genericFolders('form', id) },
  scenario: { noun: 'シナリオ', icon: Workflow, createHref: '/scenarios/new', createLabel: 'シナリオを作る', folders: (id) => genericFolders('scenario', id) },
  tag: {
    noun: 'タグ', icon: TagIcon, createHref: '/tags/new', createLabel: 'タグを作る', unit: '件',
    folders: async (id) => {
      const res = await api.tagGroups.list(id)
      if (!res?.success) throw new Error('folders')
      return res.data.map((group) => ({ id: group.id, name: group.name, color: group.color ?? null }))
    },
  },
  rich_menu: { noun: 'リッチメニュー', icon: LayoutGrid, createHref: '/rich-menus/new', createLabel: 'リッチメニューを作る', folders: (id) => genericFolders('rich_menu', id) },
  booking_menu: { noun: '予約メニュー', icon: BookOpen, createHref: '/booking/menus/new', createLabel: '予約メニューを作る' },
  event: { noun: 'イベント', icon: CalendarDays, createHref: '/events/new', createLabel: 'イベントを作る', folders: (id) => genericFolders('event', id) },
  reminder: { noun: 'リマインダ', icon: Bell, createHref: '/reminders/new', createLabel: 'リマインダを作る', folders: (id) => genericFolders('reminder', id) },
  staff: { noun: 'スタッフ', icon: UserRound, createHref: '/booking/menus?tab=staff', createLabel: 'スタッフを登録する' },
  webhook: { noun: '送信先', icon: Workflow, folders: (id) => genericFolders('webhook', id) },
  common_action: { noun: '共通アクション', icon: Workflow, createHref: '/common-actions', createLabel: '共通アクションを作る', folders: (id) => genericFolders('common_action', id) },
}

/** 今の画面が持っている行。名前・フォルダ・更新日の呼び方の違いをここで吸収する。 */
export type EntityLike = {
  id: string
  name?: string | null
  title?: string | null
  label?: string | null
  folderId?: string | null
  folder_id?: string | null
  groupId?: string | null
  updatedAt?: string | null
  updated_at?: string | null
  isActive?: boolean | null
  messageType?: string | null
}

function updatedLabel(value?: string | null) {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return `${new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit' }).format(date)} 更新`
}

export const TEMPLATE_CATEGORIES: EntityPickerCategory[] = [
  { id: 'text', label: 'テキスト' }, { id: 'flex', label: 'カード' }, { id: 'carousel', label: 'カルーセル' },
  { id: 'image', label: '画像' }, { id: 'imagemap', label: 'リッチメッセージ' }, { id: 'video', label: '動画' },
]

/** 行を窓の候補へ。`meta` を渡すと右の補足を差し替える。 */
export function toPickerItems(kind: EntityKind, rows: ReadonlyArray<EntityLike>, meta?: (row: EntityLike) => string | undefined): EntityPickerItem[] {
  return rows.map((row) => {
    const folderId = kind === 'tag' ? (row.groupId === undefined ? undefined : row.groupId ?? null)
      : row.folderId !== undefined ? row.folderId ?? null : row.folder_id !== undefined ? row.folder_id ?? null : undefined
    const category = kind === 'template' && row.messageType ? row.messageType : undefined
    return {
      id: row.id,
      name: row.name ?? row.title ?? row.label ?? '（名前なし）',
      folderId,
      category,
      categoryLabel: category ? TEMPLATE_CATEGORIES.find((c) => c.id === category)?.label ?? 'そのほか' : undefined,
      meta: meta ? meta(row) : row.isActive === false ? '停止中' : updatedLabel(row.updatedAt ?? row.updated_at),
    }
  })
}

/**
 * 上のバーで選んでいるアカウント。Provider の外（部品の試験など）では null。
 * 試験の差し替えで useOptionalAccount が無いときは useAccount を使う。
 */
type AccountValue = ReturnType<typeof accountContext.useAccount>
function useMaybeAccount(): AccountValue | null {
  let hook: (() => AccountValue | null) | undefined
  try { hook = accountContext.useOptionalAccount } catch { hook = undefined }
  if (typeof hook !== 'function') { try { hook = accountContext.useAccount } catch { hook = undefined } }
  return typeof hook === 'function' ? hook() ?? null : null
}

/** 窓を開いたときにフォルダを読む。読めなくても選べる（すべてから選ぶ）。 */
export function useEntityFolders(kind: EntityKind, accountId?: string | null) {
  const [folders, setFolders] = useState<EntityPickerFolder[] | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const started = useRef<string | null>(null)
  const load = useCallback(() => {
    const def = ENTITY_KINDS[kind]
    const key = `${kind}:${accountId ?? ''}`
    if (!def.folders || started.current === key) return
    started.current = key
    setFailed(false)
    Promise.resolve().then(() => def.folders!(accountId ?? undefined))
      .then((rows) => setFolders(rows))
      .catch(() => { started.current = null; setFailed(true) })
  }, [kind, accountId])
  return { folders, failed, load }
}

/** テンプレートの中身の見本（LINE のトーク画面のスマホ）。 */
export function TemplatePreviewPhone({ templateId, accountName }: { templateId: string | null; accountName?: string }) {
  const [state, setState] = useState<{ id: string; type: string; content: string } | 'loading' | 'error' | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!templateId) { setState(null); return }
    let current = true
    setState('loading')
    Promise.resolve().then(() => api.templates.get(templateId))
      .then((res) => {
        if (!current) return
        if (!res?.success) throw new Error('template')
        setState({ id: templateId, type: res.data.messageType, content: res.data.messageContent })
      })
      .catch(() => { if (current) setState('error') })
    return () => { current = false }
  }, [templateId, attempt])
  const name = accountName || '公式アカウント'
  return <LinePreview fit title="中身の見本" accountName={name} empty={!templateId ? '候補を選ぶと LINE での見え方が出ます' : false}>
    {state === 'loading' ? <ListState kind="loading" />
      : state === 'error' ? <ListState kind="error" error={new Error('template')} onRetry={() => setAttempt((value) => value + 1)} />
      : state === null ? null
      : state.type === 'flex' || state.type === 'carousel' ? <FlexPreview content={state.content} />
      : state.type === 'text' ? <LinePreviewMessage accountName={name} avatar={name.slice(0, 1)} time="10:00">{buildTemplatePreview(state.content, EMPTY_TEMPLATE_REFERENCES).content || '（本文なし）'}</LinePreviewMessage>
      : <LinePreviewMessage accountName={name} avatar={name.slice(0, 1)} time="10:00">{`${TEMPLATE_CATEGORIES.find((c) => c.id === state.type)?.label ?? 'メッセージ'}を送ります`}</LinePreviewMessage>}
  </LinePreview>
}

/** 回答フォームの中身の見本（お客さまのスマホ・LINE で開いた時）。 */
export function FormPreviewPhone({ formId, accountId, accountName }: { formId: string | null; accountId?: string | null; accountName?: string }) {
  const [state, setState] = useState<FormLayout | 'loading' | 'error' | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!formId || !accountId) { setState(null); return }
    let current = true
    setState('loading')
    Promise.resolve().then(() => api.forms.get(formId, accountId))
      .then((res) => { if (!current) return; if (!res?.success) throw new Error('form'); setState(res.data.layout) })
      .catch(() => { if (current) setState('error') })
    return () => { current = false }
  }, [formId, accountId, attempt])
  if (!formId) return <p className="text-ink-secondary text-xs">候補を選ぶと、お客さまのスマホでの見え方が出ます。</p>
  if (state === 'loading' || state === null) return <ListState kind="loading" />
  if (state === 'error') return <ListState kind="error" error={new Error('form')} onRetry={() => setAttempt((value) => value + 1)} />
  return <FormPhone layout={state} pageIndex={0} accountName={accountName || '公式アカウント'} bookingMenus={[]} />
}

type KindFieldBase = {
  kind: EntityKind
  label: string
  options: ReadonlyArray<EntityLike>
  /** 右の補足を差し替える（既定は更新日・停止中）。 */
  meta?: (row: EntityLike) => string | undefined
  /** フォルダの読み込み先のアカウント（既定は上のバーで選んでいるアカウント）。 */
  accountId?: string | null
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  invalid?: boolean
  description?: string
  id?: string
  /** 中身の見本を出さない（狭い所・中身の無い種類）。 */
  noPreview?: boolean
  /** 誤りの欄へ移るときに［選ぶ］ボタンをつかむ。 */
  buttonRef?: Ref<HTMLButtonElement>
  /** 欄の下の誤り・説明の id。 */
  describedBy?: string
}

/**
 * 種類を渡すだけで使える欄。名前・印・作る画面・フォルダ・中身の見本は種類から決める。
 * 保存する値（ID）は今と同じ形で返す。
 */
export function EntityKindField(props: KindFieldBase & ({ multiple?: false; value: string | null | undefined; onChange: (id: string) => void; clearable?: boolean } | { multiple: true; value: string[]; onChange: (ids: string[]) => void; allowEmpty?: boolean })) {
  const { kind, label, options, meta, placeholder, disabled, readOnly, invalid, description, id, noPreview, buttonRef, describedBy } = props
  const account = useMaybeAccount()
  const accountId = props.accountId ?? account?.selectedAccountId ?? null
  const accountName = account?.selectedAccount?.name
  const def = ENTITY_KINDS[kind]
  const items = useMemo(() => toPickerItems(kind, options, meta), [kind, options, meta])
  const hasFolderInfo = items.some((item) => item.folderId !== undefined)
  const { folders, failed, load } = useEntityFolders(kind, accountId)
  const common = {
    label, noun: def.noun, icon: def.icon, items, folders: hasFolderInfo ? folders : undefined, foldersFailed: hasFolderInfo && failed,
    onOpen: hasFolderInfo ? load : undefined, placeholder, disabled, readOnly, invalid, description, id, buttonRef, describedBy,
    createHref: def.createHref, createLabel: def.createLabel,
  }
  if (props.multiple) {
    return <EntityPickerField {...common} multiple value={props.value} onChange={props.onChange} unit={def.unit} allowEmpty={props.allowEmpty ?? true} />
  }
  const preview: ((item: EntityPickerItem | null) => ReactNode) | undefined = noPreview ? undefined
    : kind === 'template' ? (item) => <TemplatePreviewPhone templateId={item?.id ?? null} accountName={accountName} />
    : kind === 'form' ? (item) => <FormPreviewPhone formId={item?.id ?? null} accountId={accountId} accountName={accountName} />
    : undefined
  const categories = kind === 'template' ? TEMPLATE_CATEGORIES.filter((c) => items.some((item) => item.category === c.id)) : undefined
  return <EntityPickerField {...common} value={props.value} onChange={props.onChange} clearable={props.clearable} preview={preview} categories={categories && categories.length > 1 ? categories : undefined} />
}

/** 欄を使わず窓だけを開く（「テンプレートを選択」ボタンから本文へ入れる など）。 */
export function EntityKindDialog({ kind, options, initialId = '', confirmLabel, accountId: givenAccountId, onConfirm, onCancel }: {
  kind: EntityKind
  options: ReadonlyArray<EntityLike>
  initialId?: string
  confirmLabel?: string
  accountId?: string | null
  onConfirm: (id: string) => void
  onCancel: () => void
}) {
  const account = useMaybeAccount()
  const accountId = givenAccountId ?? account?.selectedAccountId ?? null
  const def = ENTITY_KINDS[kind]
  const items = useMemo(() => toPickerItems(kind, options), [kind, options])
  const { folders, failed, load } = useEntityFolders(kind, accountId)
  const hasFolderInfo = items.some((item) => item.folderId !== undefined)
  useEffect(() => { if (hasFolderInfo) load() }, [hasFolderInfo, load])
  const preview = kind === 'template' ? (item: EntityPickerItem | null) => <TemplatePreviewPhone templateId={item?.id ?? null} accountName={account?.selectedAccount?.name} />
    : kind === 'form' ? (item: EntityPickerItem | null) => <FormPreviewPhone formId={item?.id ?? null} accountId={accountId} accountName={account?.selectedAccount?.name} />
    : undefined
  const categories = kind === 'template' ? TEMPLATE_CATEGORIES.filter((c) => items.some((item) => item.category === c.id)) : []
  return <EntityPickerDialog title={`${def.noun}を選ぶ`} items={items} folders={hasFolderInfo ? folders : undefined} foldersFailed={hasFolderInfo && failed}
    categories={categories.length > 1 ? categories : undefined} initialId={initialId} preview={preview} confirmLabel={confirmLabel}
    createHref={def.createHref} createLabel={def.createLabel} designNode="dJZ7Q" onConfirm={onConfirm} onCancel={onCancel} />
}
