'use client'

/*
 * ★V8 物を作る・直す画面の「どのフォルダに入れるか」を選ぶ欄（Pencil V8.pen 共通部品
 * dLffh「選ぶ欄/開いた/フォルダ（作れる）」・iBuZH「選ぶ欄/開いた/フォルダ（名前を入れる）」。
 * オーナー 2026-10-08）。
 *
 * - 開いた中身は StFE7 の形（shared/select-menu）。各行の前にフォルダの色の点。
 *   一番下に区切りの線と「＋ 新しいフォルダを作る」（緑・600）。
 * - 押すと同じ板が「新しいフォルダ」に替わる：名前の欄（自動で焦点）・横の色ボタン・［やめる］［作って選ぶ］。
 *   Enter で作る（日本語の変換中は作らない）。Esc・［やめる］で一覧へ戻る。
 * - 作ると、その画面のフォルダの受け口（onCreate）で作り、一覧に足して、そのフォルダを選んで閉じる。
 *   作っている間は押せない。失敗したら板の中に理由と［もう一度試す］。入れた名前は残す。
 * - onCreate を渡さない（閲覧のみ・フォルダを作る権限が無い）ときは「＋ 新しいフォルダを作る」を出さない。
 * - 一覧の絞り込みの「フォルダ：すべて」には使わない（作る・直す画面の置き場だけ）。
 *
 * 画面ごとに作り方を書かない。各画面は自分の種類のフォルダの受け口を onCreate に渡すだけ。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Select, { type SelectCreateContext, type SelectProps } from './select'
import { isImeComposing } from './ime'
import { japaneseDetailOf } from './api-error-message'
import styles from './folder-select.module.css'
import FolderColorButton from './folder-color-button'
import { FOLDER_SELECT_COLORS } from '@line-crm/shared'
export { FOLDER_SELECT_COLORS } from '@line-crm/shared'

/** 選べるフォルダ1つ。value は画面が保存に使う値（多くは id。名前で持つ画面は名前）。 */
export interface FolderSelectFolder {
  value: string
  label: string
  /** フォルダの色（#RRGGBB）。無いフォルダは灰の点。 */
  color?: string | null
}

export type FolderSelectCreate = (name: string, color: string | null) => Promise<FolderSelectFolder>

export interface FolderSelectProps extends Pick<SelectProps, 'aria-label' | 'label' | 'className' | 'disabled' | 'error' | 'id' | 'name' | 'size' | 'width' | 'defaultOpen'> {
  folders: ReadonlyArray<FolderSelectFolder>
  value: string
  onChange: (value: string) => void
  /**
   * 「未分類」（フォルダに入れない）の行。既定は value '' の「未分類」。
   * null で出さない。label を変えたいとき（「（選ばない）」など）は渡す。
   */
  unfiled?: { value: string; label: string } | null
  /**
   * 新しいフォルダを作る受け口。作れたフォルダを返す。失敗は Error（message を板に出す）。
   * 渡さないと「＋ 新しいフォルダを作る」を出さない（閲覧のみ・権限なし）。
   */
  onCreate?: FolderSelectCreate
  /** false のときは色のボタンを出さず、作成時に null を渡す。 */
  colors?: boolean
}

function Dot({ color }: { color?: string | null }) {
  return <span className={styles.dot} style={color ? { backgroundColor: color } : undefined} data-folder-select-dot="" />
}

/** API の答え（{ success, data } / { success: false, error }）を、作れたフォルダか Error に直す。 */
/** 受け口が { success: false, error } で答えたとき。reason は板に出す理由（日本語のときだけ）。 */
export class FolderCreateError extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(reason)
    this.name = 'FolderCreateError'
    this.reason = /[ぁ-んァ-ヶ一-龠]/u.test(reason) ? reason : ''
  }
}

export function folderCreateResult<T>(
  response: { success: true; data: T } | { success: false; error: string },
  toFolder: (data: T) => FolderSelectFolder,
): FolderSelectFolder {
  if (!response.success) throw new FolderCreateError(response.error ?? '')
  return toFolder(response.data)
}

/** 板に出す理由。API の答え（同じ名前がある など）を日本語で出し、英語・内部の文は出さない。 */
function reasonOf(caught: unknown): string {
  const detail = caught instanceof FolderCreateError ? caught.reason : japaneseDetailOf(caught)
  return detail || 'フォルダを作れませんでした。通信を確かめて、もう一度試してください'
}

/**
 * 各画面のフォルダの受け口を onCreate の形にする。
 * call：その画面の種類のフォルダを作る API。toFolder：答えを選択肢に直す。onCreated：画面の一覧に足す。
 */
export function folderCreator<T>(
  call: (name: string, color: string | null) => Promise<{ success: true; data: T } | { success: false; error: string }>,
  toFolder: (data: T) => FolderSelectFolder,
  onCreated?: (data: T) => void,
): FolderSelectCreate {
  return async (name, color) => {
    const response = await call(name, color)
    const folder = folderCreateResult(response, toFolder)
    if (response.success) onCreated?.(response.data)
    return folder
  }
}

/** 汎用フォルダ（api.folders）の答えを選択肢に直す。value は id。 */
export const folderById = (folder: { id: string; name: string; color?: string | null }): FolderSelectFolder => ({ value: folder.id, label: folder.name, color: folder.color ?? null })
/** 名前で保存する画面（テンプレートのリッチ・クーポン・リサーチ、友だち追加）。value は名前。 */
export const folderByName = (folder: { name: string; color?: string | null }): FolderSelectFolder => ({ value: folder.name, label: folder.name, color: folder.color ?? null })

/**
 * 別の入口（統括のひな形など）が渡す口から名前と色で作る。
 * 口が無い・閲覧のみなら作らせない。
 */
export function hostFolderCreate(host: {
  createFolder?: FolderSelectCreate
  readOnly?: boolean
}): FolderSelectCreate | undefined {
  const create = host.createFolder
  if (!create || host.readOnly) return undefined
  return (name, color) => create(name, color)
}

export default function FolderSelect({
  folders,
  value,
  onChange,
  unfiled = { value: '', label: '未分類' },
  onCreate,
  colors = true,
  ...selectProps
}: FolderSelectProps) {
  // 作ったフォルダは、画面が一覧を読み直す前でも選べて名前が出るよう、ここでも持つ。
  const [created, setCreated] = useState<FolderSelectFolder[]>([])
  const all = useMemo(() => {
    const known = new Set(folders.map((folder) => folder.value))
    return [...folders, ...created.filter((folder) => !known.has(folder.value))]
  }, [folders, created])
  const options = [
    ...(unfiled ? [{ value: unfiled.value, label: unfiled.label, leading: <Dot /> as ReactNode }] : []),
    ...all.map((folder) => ({ value: folder.value, label: folder.label, leading: <Dot color={folder.color} /> as ReactNode })),
  ]
  return (
    <Select
      {...selectProps}
      value={value}
      onChange={onChange}
      options={options}
      // 絵（dLffh）は開いた中身の上に「フォルダ」。閉じたボタンに頭を付けたい画面は label を渡す。
      menuHeading="フォルダ"
      createAction={onCreate ? {
        label: '新しいフォルダを作る',
        render: (context) => (
          <FolderCreatePanel
            context={context}
            colors={colors}
            onCreate={async (name, color) => {
              const folder = await onCreate(name, color)
              setCreated((current) => [...current.filter((item) => item.value !== folder.value), folder])
              return folder
            }}
          />
        ),
      } : undefined}
    />
  )
}

function FolderCreatePanel({
  context,
  colors,
  onCreate,
}: {
  context: SelectCreateContext
  colors: boolean
  onCreate: FolderSelectCreate
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(FOLDER_SELECT_COLORS[0].value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const trimmed = name.trim()
  const submit = async () => {
    if (!trimmed || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const folder = await onCreate(trimmed, colors ? color : null)
      context.finish(folder.value)
    } catch (caught) {
      // 入れた名前は残す（もう一度試す・直して作る）。
      setError(reasonOf(caught))
      inputRef.current?.focus()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div
      className={styles.panel}
      role="group"
      aria-label="新しいフォルダ"
      aria-busy={busy || undefined}
      onKeyDown={(event) => {
        // Esc は一覧へ戻るだけ。窓（ダイアログ）の中に置いても、窓まで閉じない（後ろの聞き手へ渡さない）。
        if (event.key !== 'Escape' || isImeComposing(event)) return
        event.preventDefault()
        event.stopPropagation()
        event.nativeEvent.stopImmediatePropagation()
        if (!busyRef.current) context.back()
      }}
    >
      <div className={styles.heading} aria-hidden="true">新しいフォルダ</div>
      <div className={styles.nameRow}>
        <input
          ref={inputRef}
          type="text"
          className={styles.field}
          value={name}
          maxLength={100}
          placeholder="フォルダ名"
          aria-label="新しいフォルダの名前"
          aria-invalid={error ? true : undefined}
          // 作っている間は直せない（焦点は残す。disabled にすると焦点が外れて板が閉じる）。
          readOnly={busy}
          onChange={(event) => {
            setName(event.target.value)
            if (error) setError('')
          }}
          onKeyDown={(event) => {
            // 変換を確定する Enter で書きかけの名前を作らない。
            if (event.key !== 'Enter' || isImeComposing(event)) return
            event.preventDefault()
            void submit()
          }}
        />
        {colors ? (
          <FolderColorButton compact value={color} onChange={(next) => setColor(next ?? FOLDER_SELECT_COLORS[0].value)} disabled={busy} />
        ) : null}
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.actions}>
        <button type="button" className={styles.cancel} disabled={busy} onClick={context.back}>やめる</button>
        <button type="button" className={styles.primary} disabled={busy || !trimmed} onClick={() => void submit()}>
          {busy ? '作っています…' : error ? 'もう一度試す' : '作って選ぶ'}
        </button>
      </div>
    </div>
  )
}
