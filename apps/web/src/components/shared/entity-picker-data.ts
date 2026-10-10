'use client'

import { useCallback, useRef, useState } from 'react'
import { Bell, BookOpen, CalendarDays, ClipboardList, FileText, LayoutGrid, Tag as TagIcon, UserRound, Workflow, type LucideIcon } from 'lucide-react'
import { api } from '@/lib/api'
import * as accountContext from '@/contexts/account-context'
import type { EntityPickerCategory, EntityPickerFolder, EntityPickerItem } from './entity-picker'

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
export function useMaybeAccount(): AccountValue | null {
  let hook: (() => AccountValue | null) | undefined
  try { hook = accountContext.useOptionalAccount } catch { hook = undefined }
  if (typeof hook !== 'function') { try { hook = accountContext.useAccount } catch { hook = undefined } }
  return typeof hook === 'function' ? hook() ?? null : null
}

/** 窓を開いたときにフォルダを読む。読めなくても選べる（すべてから選ぶ）。 */
export function useEntityFolders(kind: EntityKind, accountId?: string | null) {
  const scope = `${kind}:${accountId ?? ''}`
  const current = useRef(scope)
  const generation = useRef(0)
  const [result, setResult] = useState<{ scope: string; folders?: EntityPickerFolder[]; failed: boolean }>()
  const started = useRef<string | null>(null)
  if (current.current !== scope) { current.current = scope; generation.current += 1; started.current = null }
  const load = useCallback(() => {
    const def = ENTITY_KINDS[kind]
    if (!def.folders || started.current === scope) return
    started.current = scope
    const token = generation.current
    Promise.resolve().then(() => def.folders!(accountId ?? undefined))
      .then((folders) => { if (current.current === scope && generation.current === token) setResult({ scope, folders, failed: false }) })
      .catch(() => { if (current.current === scope && generation.current === token) { started.current = null; setResult({ scope, failed: true }) } })
  }, [kind, accountId, scope])
  return { folders: result?.scope === scope ? result.folders : undefined, failed: result?.scope === scope && result.failed, load }
}
