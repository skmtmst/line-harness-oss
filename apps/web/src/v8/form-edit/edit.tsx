'use client'

/*
 * 回答フォームの編集（★V8）。板：中身 m1cWEy・1152 ITBAB・予約を入れるブロック ijxur・
 * 答え終わったあと XXFT4・受付と見た目 tpRRT・競合 J1pdB・この版を公開 Z9wXm。
 *
 * 作る型（CreatePage）に、上の3つのタブ・左の段・右の「回答用URL」と
 * 「お客さまに見える形」（スマホ）を載せる。データの読み書き・保存・公開・
 * 競合・試しのURLは今までの画面（app/form-submissions/edit/page.tsx）と同じ。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Copy, FlaskConical, Smartphone, Upload } from 'lucide-react'
import {
  emptyLayout,
  formThemeContrastError,
  newBlockId,
  normalizeFormTheme,
  validateFormForPublish,
  type FormBlock,
  type FormLayout,
  type FormOptions,
  type FormSection,
} from '@line-crm/shared'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import Notice from '@/components/shared/notice'
import { SaveConflictBand, SaveConflictCompareDialog, useSaveConflict } from '@/components/shared/save-conflict'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import { Tabs } from '@/components/shared/tabs'
import { notifyToast } from '@/components/shared/toast'
import { classifyApiFailure, describeApiFailure } from '@/components/shared/api-error-message'
import { validateFormLayoutForSave } from '@/components/forms/form-definition-validation'
import { normalizeSectionName } from '@/components/forms/section-name'
import { takenFormAnswerNames, uniqueFormCopyName } from '@/components/forms/form-definition-operations'
import { EMPTY_REFS, type FormRefs } from '@/components/forms/form-refs'
import { api, ApiError, bookingApi, fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useDraftAutosave } from '@/v8/autosave/use-draft-autosave'
import {
  conflictMessage,
  conflictTitle,
  describeConflictDiff,
  describePublishChanges,
  firstInputBlockId,
  formSavedContentMatches,
  ogImageUrlError,
  readPage,
  readTab,
  type ConflictSide,
  type EditTab,
  type FormSavedContent,
} from './model'
import { ContentTab } from './content-tab'
import { AfterTab } from './after-tab'
import { AppearanceTab } from './appearance-tab'
import { FormPhone } from './phone'
import styles from './edit.module.css'

const TAB_ITEMS: { key: EditTab; label: string }[] = [
  { key: 'content', label: '中身' },
  { key: 'after', label: '答え終わったあと' },
  { key: 'appearance', label: '受付と見た目' },
]

/** 板の印（撮影と見比べのため）。1152 は ITBAB。 */
const TAB_NODE: Record<EditTab, string> = { content: 'm1cWEy', after: 'XXFT4', appearance: 'tpRRT' }

type Snapshot = {
  name: string
  description: string
  isActive: boolean
  onSubmitTagId: string
  ogTitle: string
  ogDescription: string
  ogImageUrl: string
  layout: FormLayout
}

function FormEditInner() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const { selectedAccount, selectedAccountId } = useAccount()
  const narrow = useNarrowViewport()

  /* 友だちに配るURL。LIFF のURLにパスを足すと、LIFFアプリの同じパスへ転送される。 */
  const liffId = selectedAccount?.liffId ?? null
  const answerUrl = liffId ? `https://liff.line.me/${liffId}/forms/${id}` : null

  const [editTab, setEditTab] = useState<EditTab>(() => readTab(params.get('tab')))
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  usePageTitle(name || '回答フォーム編集')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [submitCount, setSubmitCount] = useState(0)
  const [onSubmitTagId, setOnSubmitTagId] = useState('')
  const [ogTitle, setOgTitle] = useState('')
  const [ogDescription, setOgDescription] = useState('')
  const [ogImageUrl, setOgImageUrl] = useState('')
  const [layout, setLayoutState] = useState<FormLayout>(emptyLayout)
  const [page, setPage] = useState(0)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [refs, setRefs] = useState<FormRefs>(EMPTY_REFS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [formLoaded, setFormLoaded] = useState(false)
  const [formLoadFailed, setFormLoadFailed] = useState<'missing' | 'forbidden' | 'error' | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const savedSnapshot = useRef<string | null>(null)
  /** 読み込んだ時点の編集の版(#723)。読み込みと保存成功のときだけ入れ替える。 */
  const [contentRevision, setContentRevision] = useState<number | null>(null)
  /* 保存の直前に読む版。自動保存のあと描き直す前に手の保存が走っても、新しい版で送る。 */
  const contentRevisionRef = useRef<number | null>(null)
  contentRevisionRef.current = contentRevision
  const [publishedVersionId, setPublishedVersionId] = useState<string | null>(null)
  const [publishedContentRevision, setPublishedContentRevision] = useState<number | null>(null)
  const [testToken, setTestToken] = useState<string | null>(null)
  const [testBusy, setTestBusy] = useState(false)
  const [testError, setTestError] = useState('')
  const [showPublish, setShowPublish] = useState(false)
  /*
   * ほかの人が先に保存していたとき（409）。入力は捨てない。
   * 帯・比べる窓・読み直しは共通の save-conflict（動きの点検 16 番）。
   */
  const saveConflict = useSaveConflict<ConflictSide>({
    // 「違いを比べる」。最新を取って比べるだけで、画面は書き換えない。
    fetchLatest: async () => {
      if (!id || !selectedAccountId) return null
      const res = await api.forms.get(id, selectedAccountId)
      if (!res.success) return null
      return { name: res.data.name, description: res.data.description ?? '', layout: res.data.layout ?? emptyLayout() }
    },
    reload: () => reloadAfterConflict(),
  })
  const conflict = saveConflict.conflict
  const clearConflict = saveConflict.clear
  const [previewOpen, setPreviewOpen] = useState(false)
  /** 最初の読み込みで ?page= を当てたか（読み直しでページを戻さない）。 */
  const pageFromUrl = useRef(false)

  // 元に戻す / やり直す。
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

  /** フォーム本体の読み込み。初回と、競合で「最新を読み込んで続ける」を押したとき。 */
  const loadForm = useCallback(async () => {
    if (!id || !selectedAccountId) return false
    const res = await api.forms.get(id, selectedAccountId)
    if (!res.success) return false
    const nextLayout = res.data.layout ?? emptyLayout()
    const loaded: Snapshot = {
      name: res.data.name,
      description: res.data.description ?? '',
      isActive: res.data.isActive,
      onSubmitTagId: res.data.onSubmitTagId ?? '',
      ogTitle: res.data.ogTitle ?? '',
      ogDescription: res.data.ogDescription ?? '',
      ogImageUrl: res.data.ogImageUrl ?? '',
      layout: nextLayout,
    }
    setName(loaded.name)
    setDescription(loaded.description)
    setIsActive(loaded.isActive)
    setSubmitCount(res.data.submitCount ?? 0)
    setOnSubmitTagId(loaded.onSubmitTagId)
    setOgTitle(loaded.ogTitle)
    setOgDescription(loaded.ogDescription)
    setOgImageUrl(loaded.ogImageUrl)
    setLayoutState(nextLayout)
    setContentRevision(res.data.contentRevision ?? null)
    setPublishedVersionId(res.data.publishedVersionId ?? null)
    setPublishedContentRevision(res.data.publishedContentRevision ?? null)
    clearConflict()
    if (!pageFromUrl.current) {
      pageFromUrl.current = true
      const index = readPage(params.get('page'), nextLayout.sections.length)
      setPage(index)
      setSelectedBlockId(params.get('block') ?? firstInputBlockId(nextLayout.sections[index]?.blocks ?? []))
    }
    savedSnapshot.current = JSON.stringify(loaded)
    setFormLoaded(true)
    return true
  }, [id, selectedAccountId, params, clearConflict])

  const reloadAfterConflict = async () => {
    setError('')
    setNotice('')
    try {
      await loadForm()
      setNotice('最新の内容を読み込みました')
    } catch {
      setError('読み込みに失敗しました。もう一度読み込んでください。')
    }
  }

  useEffect(() => {
    setFormLoadFailed(null)
    void (async () => {
      try {
        // 参照一覧は選んでいる公式アカウントに絞る（別アカウントのタグ等を混ぜない）。
        const tagPath = selectedAccountId ? `/api/tags?lineAccountId=${encodeURIComponent(selectedAccountId)}` : '/api/tags'
        const accountFilter = selectedAccountId ? { accountId: selectedAccountId } : undefined
        const [tagRes, ffRes, scenarioRes, reminderRes, templateRes] = await Promise.all([
          fetchApi<{ success: boolean; data: Array<{ id: string; name: string }> }>(tagPath),
          selectedAccountId ? api.friendFields.list(selectedAccountId, undefined, { suppressFeatureDisabledEvent: true }) : Promise.resolve({ success: true as const, data: [] }),
          api.scenarios.list(accountFilter),
          api.reminders.list(accountFilter),
          api.templates.list(undefined, selectedAccountId ?? undefined),
        ])
        setRefs({
          tags: tagRes.success ? tagRes.data.map((t) => ({ id: t.id, name: t.name })) : [],
          friendFields: ffRes.success ? ffRes.data.map((f) => ({ id: f.id, name: f.name, ecIsMaster: f.ecIsMaster })) : [],
          scenarios: scenarioRes.success ? scenarioRes.data.map((s) => ({ id: s.id, name: s.name })) : [],
          reminders: reminderRes.success ? reminderRes.data.map((r) => ({ id: r.id, name: r.name })) : [],
          templates: templateRes.success ? templateRes.data.map((t) => ({ id: t.id, name: t.name, type: t.messageType })) : [],
          bookingMenus: [],
          bookingMenuStaff: {},
        })
        // 「予約を入れる」欄のメニュー選び。本体の読み込みを待たせない。読めなくても欄は置ける。
        if (selectedAccountId) {
          bookingApi
            .listMenus(selectedAccountId)
            .then((menuRes) => {
              const bookingMenus = (menuRes.menus ?? [])
                .filter((m) => m.is_active === 1)
                .map((m) => ({ id: m.id, name: m.name, durationMinutes: m.duration_minutes }))
              setRefs((prev) => ({ ...prev, bookingMenus }))
            })
            .catch(() => {})
        }
        const ok = await loadForm()
        if (!ok && id && selectedAccountId) setFormLoadFailed('missing')
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 404) setFormLoadFailed('missing')
        else if (classifyApiFailure(caught) === 'forbidden') setFormLoadFailed('forbidden')
        else {
          setError('読み込みに失敗しました。もう一度読み込んでください。')
          setFormLoadFailed('error')
        }
      } finally {
        setLoading(false)
      }
    })()
    // loadForm は params を読むが、読み込み直すのは id・アカウント・再試行のときだけ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reloadKey, selectedAccountId])

  // 「予約を入れる」欄の担当選び。欄のメニューが決まったものだけ読む。
  useEffect(() => {
    if (!selectedAccountId) return
    const menuIds = new Set<string>()
    for (const section of layout.sections) {
      for (const b of section.blocks) {
        if (b.kind === 'input' && b.type === 'booking' && b.booking?.menuId) menuIds.add(b.booking.menuId)
      }
    }
    const missing = [...menuIds].filter((menuId) => refs.bookingMenuStaff?.[menuId] === undefined)
    if (missing.length === 0) return
    let cancelled = false
    void (async () => {
      const entries = await Promise.all(
        missing.map(async (menuId) => {
          try {
            const res = await bookingApi.listMenuStaff(selectedAccountId, menuId)
            return [menuId, res.staff.map((s) => ({ id: s.id, name: s.display_name }))] as const
          } catch {
            return [menuId, []] as const
          }
        }),
      )
      if (cancelled) return
      setRefs((prev) => ({ ...prev, bookingMenuStaff: { ...(prev.bookingMenuStaff ?? {}), ...Object.fromEntries(entries) } }))
    })()
    return () => {
      cancelled = true
    }
  }, [selectedAccountId, layout, refs.bookingMenuStaff])

  /* ---------------- ページとブロック ---------------- */

  const blocks = useMemo(() => layout.sections[page]?.blocks ?? [], [layout, page])
  const setBlocks = (next: FormBlock[]) =>
    setLayout((prev) => ({ ...prev, sections: prev.sections.map((s, i) => (i === page ? { ...s, blocks: next } : s)) }))

  const selectPage = (index: number) => {
    setPage(index)
    setSelectedBlockId(firstInputBlockId(layout.sections[index]?.blocks ?? []))
  }

  const addSection = () => {
    const section: FormSection = { id: newBlockId('s'), name: `ページ${layout.sections.length + 1}`, blocks: [] }
    setLayout((prev) => ({ ...prev, sections: [...prev.sections, section] }))
    setPage(layout.sections.length)
    setSelectedBlockId(null)
  }

  const renameSection = (index: number, next: string) => {
    const normalized = normalizeSectionName(next)
    if (normalized === null) return false
    setLayout((prev) => ({ ...prev, sections: prev.sections.map((s, i) => (i === index ? { ...s, name: normalized } : s)) }))
    return true
  }

  const duplicateSection = (index: number) => {
    const source = layout.sections[index]
    if (!source) return
    const taken = takenFormAnswerNames(layout)
    const copy: FormSection = {
      id: newBlockId('s'),
      name: `${source.name}のコピー`,
      blocks: source.blocks.map((b) => {
        if (b.kind !== 'input') return { ...b, id: newBlockId() }
        const copyName = uniqueFormCopyName(b.name, taken)
        taken.add(copyName)
        return { ...b, id: newBlockId(), name: copyName }
      }),
    }
    setLayout((prev) => ({ ...prev, sections: [...prev.sections.slice(0, index + 1), copy, ...prev.sections.slice(index + 1)] }))
    setPage(index + 1)
    setSelectedBlockId(null)
  }

  /** ページを消す。そのページへ飛ばしていた選択肢は「次へ進む」に戻す。 */
  const removeSection = (index: number) => {
    if (layout.sections.length <= 1) return
    const target = layout.sections[index]
    if (!target) return
    setLayout((prev) => ({
      ...prev,
      sections: prev.sections
        .filter((_, i) => i !== index)
        .map((s) => ({
          ...s,
          blocks: s.blocks.map((b) =>
            b.kind === 'input' && b.choices
              ? { ...b, choices: b.choices.map((c) => (c.jumpToSectionId === target.id ? { ...c, jumpToSectionId: null } : c)) }
              : b,
          ),
        })),
    }))
    setPage(Math.max(0, index - 1))
    setSelectedBlockId(null)
  }

  const addBlock = (block: FormBlock) => {
    setBlocks([...blocks, block])
    setSelectedBlockId(block.id)
  }

  const patchBlock = (blockId: string, patch: Partial<FormBlock>) =>
    setBlocks(blocks.map((b) => (b.id === blockId ? ({ ...b, ...patch } as FormBlock) : b)))

  const moveBlock = (blockId: string, to: number) => {
    const from = blocks.findIndex((b) => b.id === blockId)
    if (from < 0 || to < 0 || to >= blocks.length || from === to) return
    const next = [...blocks]
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)
    setBlocks(next)
  }

  const duplicateBlock = (blockId: string) => {
    const index = blocks.findIndex((b) => b.id === blockId)
    if (index < 0) return
    const source = blocks[index]
    // 回答キーが重なると片方の答えが消える。既存の名前と突き合わせて一意にする。
    const copy: FormBlock = source.kind === 'input'
      ? { ...source, id: newBlockId(), name: uniqueFormCopyName(source.name, takenFormAnswerNames(layout)) }
      : { ...source, id: newBlockId() }
    const next = [...blocks]
    next.splice(index + 1, 0, copy)
    setBlocks(next)
    setSelectedBlockId(copy.id)
  }

  const removeBlock = (blockId: string) => {
    setBlocks(blocks.filter((b) => b.id !== blockId))
    if (selectedBlockId === blockId) setSelectedBlockId(null)
  }

  const inputCount = layout.sections.reduce((n, s) => n + s.blocks.filter((b) => b.kind === 'input').length, layout.header.filter((b) => b.kind === 'input').length)

  const patchOptions = (next: Partial<FormOptions>) => setLayout((prev) => ({ ...prev, options: { ...prev.options, ...next } }))

  /* ---------------- 未保存の確認 ---------------- */

  const current: Snapshot = { name, description, isActive, onSubmitTagId, ogTitle, ogDescription, ogImageUrl, layout }
  const currentSnapshot = JSON.stringify(current)
  const dirty = savedSnapshot.current !== null && currentSnapshot !== savedSnapshot.current

  const discardChanges = useCallback(() => {
    const snapshot = savedSnapshot.current
    if (!snapshot) return
    const saved = JSON.parse(snapshot) as Snapshot
    setName(saved.name)
    setDescription(saved.description)
    setIsActive(saved.isActive)
    setOnSubmitTagId(saved.onSubmitTagId)
    setOgTitle(saved.ogTitle)
    setOgDescription(saved.ogDescription)
    setOgImageUrl(saved.ogImageUrl)
    setLayoutState(saved.layout)
    undoStack.current = []
    redoStack.current = []
    setSelectedBlockId(null)
  }, [])

  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving, onDiscard: discardChanges })

  /** タブを替える。URL の ?tab= も合わせる（画面の中の移動なので離脱の確認は出さない）。 */
  const changeTab = (next: EditTab) => {
    setEditTab(next)
    if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') return
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', next)
      window.history.replaceState(window.history.state, '', url.toString())
    } catch {
      /* URL を書けない環境（試験）では画面だけ替える */
    }
  }

  /* ---------------- 保存・公開 ---------------- */

  /** 保存を断る理由（無ければ null）。自動保存の「通せる形か」にも同じものを使う。 */
  const saveProblem = (publishAfter: boolean): { message: string; name?: boolean } | null => {
    if (!selectedAccountId) return { message: 'LINE公式アカウントを選んでください' }
    if (!name.trim()) return { message: 'フォーム名を入力してください', name: true }
    const allBlocks = layout.header.concat(layout.sections.flatMap((s) => s.blocks))
    if (allBlocks.find((b) => b.kind === 'input' && !b.label.trim())) return { message: 'タイトルが空のブロックがあります' }
    // 回答キーが重なると片方の答えが消える。保存の直前にも止める。
    const seenNames = new Set<string>()
    const dup = allBlocks.find((b) => {
      if (b.kind !== 'input') return false
      if (seenNames.has(b.name)) return true
      seenNames.add(b.name)
      return false
    })
    if (dup) return { message: '回答キーが重なっています。複製した入力欄を確認してください' }
    const layoutError = validateFormLayoutForSave(layout)
    if (layoutError) return { message: layoutError }
    const ogImageError = ogImageUrlError(ogImageUrl)
    if (ogImageError) return { message: ogImageError }
    // 文字と背景の差が 4.5:1 未満の組み合わせは保存できない（保存APIも同じ検査をする）。
    const contrastError = formThemeContrastError(normalizeFormTheme(layout.options?.theme))
    if (contrastError) return { message: contrastError }
    // 公開に進むときだけ、公開前の検査（分岐の循環・消えた行き先など）を通す。
    if (publishAfter) {
      const publishError = validateFormForPublish(layout)
      if (publishError) return { message: publishError }
    }
    if (contentRevisionRef.current === null) return { message: '読み込みが終わっていません。少し待ってから、もう一度お試しください' }
    return null
  }

  /*
   * 自動保存と手の保存が重なると、同じ版を2回送って競合に見える。
   * 送っている途中の保存を待ち、最新の版で送る。
   */
  const saveInFlight = useRef<Promise<unknown> | null>(null)

  /**
   * 保存する。silent は自動保存：保存中の印・赤い帯・トーストを出さない（失敗は保存の帯に出る）。
   * 競合（409）だけは自動でも帯を出す（このまま書くと相手の変更が消えるため）。
   */
  const save = async (publishAfter = false, { silent = false }: { silent?: boolean } = {}): Promise<boolean> => {
    const problem = saveProblem(publishAfter)
    if (problem) {
      if (silent) return false
      setError(problem.message)
      setNameError(problem.name ? problem.message : null)
      return false
    }
    if (!silent) setNameError(null)
    if (!selectedAccountId) return false
    while (saveInFlight.current) await saveInFlight.current.catch(() => undefined)
    const expectedRevision = contentRevisionRef.current
    if (expectedRevision === null) return false
    if (!silent) {
      setSaving(true)
      setError('')
      setNotice('')
    }
    // 送った中身。409 のときに「自分の再送か」を確かめるために残す。
    const sentContent: FormSavedContent = {
      name: name.trim(),
      description: description.trim() || null,
      layout,
      onSubmitTagId: onSubmitTagId || null,
      // 未公開の下書きは publish API が成功するまで受付中にしない。
      isActive: publishedVersionId ? isActive : false,
      ogTitle: ogTitle.trim() || null,
      ogDescription: ogDescription.trim() || null,
      ogImageUrl: ogImageUrl.trim() || null,
    }
    const confirmOwnSave = async (): Promise<number | null> => {
      try {
        const latest = await api.forms.get(id, selectedAccountId)
        if (!latest.success) return null
        const actual: FormSavedContent = {
          name: latest.data.name,
          description: latest.data.description,
          layout: latest.data.layout,
          onSubmitTagId: latest.data.onSubmitTagId,
          isActive: latest.data.isActive,
          ogTitle: latest.data.ogTitle,
          ogDescription: latest.data.ogDescription,
          ogImageUrl: latest.data.ogImageUrl,
        }
        return formSavedContentMatches(sentContent, actual) ? latest.data.contentRevision : null
      } catch {
        return null
      }
    }
    let reconciledOwnSave = false
    let settle: () => void = () => {}
    saveInFlight.current = new Promise<void>((resolve) => { settle = resolve })
    try {
      let res: Awaited<ReturnType<typeof api.forms.update>>
      try {
        res = await api.forms.update(id, selectedAccountId, { ...sentContent, expectedContentRevision: expectedRevision })
      } catch (updateError) {
        if (!(updateError instanceof ApiError) || updateError.status !== 409) throw updateError
        const ownRevision = await confirmOwnSave()
        if (ownRevision === null) throw updateError
        reconciledOwnSave = true
        res = { success: true, data: { id, contentRevision: ownRevision, updatedAt: '' } }
      }
      if (!res.success) {
        if (!silent) setError(res.error)
        return false
      }
      contentRevisionRef.current = res.data.contentRevision
      setContentRevision(res.data.contentRevision)
      clearConflict()
      if (publishAfter) {
        const published = await api.forms.publish(id, selectedAccountId, res.data.contentRevision)
        if (!published.success) {
          setError(published.error)
          return false
        }
        setPublishedVersionId(published.data.id)
        setPublishedContentRevision(published.data.contentRevision)
        setIsActive(true)
        const message = published.data.replayed ? 'この版は公開済みです' : 'この版を公開しました'
        setNotice(message)
        notifyToast(message)
        savedSnapshot.current = JSON.stringify({ ...current, isActive: true })
      } else {
        if (!silent) {
          setNotice(publishedVersionId ? '下書きを保存しました。公開中の内容は変わっていません' : '下書きを保存しました')
          notifyToast('下書きを保存しました')
        }
        savedSnapshot.current = reconciledOwnSave
          ? JSON.stringify({
              name: sentContent.name,
              description: sentContent.description ?? '',
              isActive: sentContent.isActive,
              onSubmitTagId: sentContent.onSubmitTagId ?? '',
              ogTitle: sentContent.ogTitle ?? '',
              ogDescription: sentContent.ogDescription ?? '',
              ogImageUrl: sentContent.ogImageUrl ?? '',
              layout: sentContent.layout,
            })
          : currentSnapshot
      }
      return true
    } catch (e) {
      // ほかの人が先に保存していた（409）。入力はそのまま残し、読み直すかは運用者が決める。
      if (e instanceof ApiError && e.status === 409) {
        const data = e.data as { updatedAt?: unknown } | null
        const updatedAt = typeof data?.updatedAt === 'string' ? data.updatedAt : ''
        saveConflict.mark(updatedAt)
        setError(conflictMessage(updatedAt))
        return false
      }
      if (silent) return false
      setError(describeApiFailure(e, '保存', {
        forbidden: 'このLINEアカウントや権限では保存できません。選んでいるアカウントと権限を確認してください。',
      }))
      return false
    } finally {
      saveInFlight.current = null
      settle()
      if (!silent) setSaving(false)
    }
  }

  /*
   * 入力が止まって2秒で下書きへ静かに保存する（一斉配信と同じ）。保存先は
   * 下書きなので、公開中の内容は変わらない。閲覧のみの人には動かさない。
   */
  const role = useStaffRole()
  const autosave = useDraftAutosave({
    fingerprint: currentSnapshot,
    dirty,
    active: role === null || canManageRole(role),
    enabled: formLoaded && !loading && !conflict && saveProblem(false) === null,
    paused: leaveTarget !== null || saving || showPublish,
    save: () => save(false, { silent: true }),
  })

  /* 公開前の試し：試し合言葉を取って試しURLを作る。試しは保存済みの下書きに出る。 */
  const startTest = async () => {
    if (!selectedAccountId || testBusy) return
    setTestBusy(true)
    setTestError('')
    try {
      const res = await api.forms.issueTestToken(id, selectedAccountId)
      if (!res.success) throw new Error(res.error)
      setTestToken(res.data.token)
    } catch {
      setTestError('試し合言葉を作れませんでした。もう一度お試しください。')
    } finally {
      setTestBusy(false)
    }
  }
  const testUrl = answerUrl && testToken ? `${answerUrl}${answerUrl.includes('?') ? '&' : '?'}test_token=${encodeURIComponent(testToken)}` : null

  const copyAnswerUrl = () => {
    if (!answerUrl) return
    void navigator.clipboard
      .writeText(answerUrl)
      .then(() => notifyToast('URLをコピーしました'))
      .catch(() => setNotice(`コピーできませんでした。URL：${answerUrl}`))
  }

  /* ---------------- 対象が無いとき ---------------- */

  if (!id) {
    return <TargetMissing kind="unspecified" title="編集する回答フォームが指定されていません" description="一覧から編集するフォームを選び直してください。" backHref="/form-submissions" backLabel="回答フォーム一覧へ戻る" />
  }
  if (!loading && !selectedAccountId) {
    return <ListState kind="empty" title="LINE公式アカウントを選んでください" description="選ぶとフォームを編集できます。" />
  }
  if (!loading && formLoadFailed === 'missing') {
    return <TargetMissing kind="not-found" title="このフォームは見つかりません" description="削除されたか、リンクが古くなっています。一覧から選び直してください。" accountName={selectedAccount?.name} backHref="/form-submissions" backLabel="回答フォーム一覧へ戻る" />
  }
  if (!loading && formLoadFailed === 'error' && !formLoaded) {
    return (
      <TargetMissing
        kind="error"
        title="フォームを読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => {
          setLoading(true)
          setReloadKey((k) => k + 1)
        }}
      />
    )
  }
  if (!loading && formLoadFailed === 'forbidden' && !formLoaded) {
    return <TargetMissing kind="not-found" title="このフォームを開く権限がありません" description="選んでいるアカウントでは開けません。アカウントを選び直すか、管理者に権限を確認してください。" accountName={selectedAccount?.name} backHref="/form-submissions" backLabel="回答フォーム一覧へ戻る" />
  }

  /* ---------------- 画面 ---------------- */

  const statusLine = !publishedVersionId
    ? '下書き・まだ公開していません'
    : dirty || (publishedContentRevision !== null && contentRevision !== null && publishedContentRevision !== contentRevision)
      ? '下書き・公開中の版と違うところがあります'
      : '公開中の版と同じです'

  const savedSide: ConflictSide | null = (() => {
    if (!savedSnapshot.current) return null
    const saved = JSON.parse(savedSnapshot.current) as Snapshot
    return { name: saved.name, description: saved.description, layout: saved.layout }
  })()
  const publishChanges = describePublishChanges(savedSide, { name, description, layout })

  const phone = (
    <FormPhone layout={layout} pageIndex={page} accountName={selectedAccount?.name ?? '公式アカウント'} bookingMenus={refs.bookingMenus ?? []} />
  )

  const preview = (
    <div className={styles.rail} data-fe-rail>
      <Button className={styles.previewOpen} onClick={() => setPreviewOpen(true)}>
        <Smartphone size={15} aria-hidden="true" />
        LINEでの見え方を見る
      </Button>
      <section className={styles.urlBox} aria-label="回答用URL">
        <h2 className={styles.urlTitle}>回答用URL</h2>
        {answerUrl ? (
          <>
            <div className={styles.urlRow}>
              {/* 見せるのは短い形（絵どおり）。全文は title とコピーで渡す。 */}
              <span className={styles.urlValue} title={answerUrl}>{`https://liff.line.me/…/forms/${id}`}</span>
              <Button onClick={copyAnswerUrl}>
                <Copy size={15} aria-hidden="true" />
                コピー
              </Button>
            </div>
            <p className={styles.urlNote}>友だちに配るURLです。LINEの中で開きます。</p>
            <div className={styles.urlTest}>
              <Button onClick={() => void startTest()} disabled={testBusy} busy={testBusy} busyLabel="用意しています..." title="保存済みの下書きをお客さま画面で開きます。試しの回答は集計に入りません">
                <FlaskConical size={15} aria-hidden="true" />
                <span className={styles.testWide}>公開前に試す（試しのURLを作る）</span>
                <span className={styles.testNarrow}>公開前に試す</span>
              </Button>
            </div>
            {testError ? <p role="alert" className={styles.urlError}>{testError}</p> : null}
            {testUrl ? (
              <a href={testUrl} target="_blank" rel="noreferrer" className={styles.urlLink}>試しのURLを開く</a>
            ) : null}
          </>
        ) : (
          <p className={styles.urlNote}>回答用URLを発行する設定がまだありません。LINEアカウント設定を確認してください。</p>
        )}
      </section>
      <div className={styles.phoneArea}>{phone}</div>
    </div>
  )

  const footerActions = (
    <>
      <Button href="/form-submissions">キャンセル</Button>
      <Button onClick={() => void save(false).then((ok) => { if (ok) autosave.markSaved() })} disabled={saving} busy={saving} busyLabel="保存中…" title="フォームを保存（公開中の内容は変わりません）">
        下書きを保存
      </Button>
      {conflict ? (
        <Button variant="primary" onClick={() => void saveConflict.compare()} disabled={saveConflict.compareBusy || saving}>
          比べてから保存
        </Button>
      ) : (
        <Button variant="primary" onClick={() => setShowPublish(true)} disabled={saving}>
          <Upload size={15} aria-hidden="true" />
          この版を公開
        </Button>
      )}
    </>
  )

  /* 競合の帯（J1pdB）。左右の列の上に横いっぱいで出す。型の「狭い板の切り替え」の置き場を借りる。 */
  const conflictBand = conflict ? (
    <div className={styles.bandSlot} data-fe-band>
      <SaveConflictBand
        designNode="J1pdB"
        title={conflictTitle(conflict.updatedAt, name)}
        compareBusy={saveConflict.compareBusy}
        onCompare={() => void saveConflict.compare()}
        onReload={() => void saveConflict.reloadLatest()}
      />
    </div>
  ) : undefined

  return (
    <CreatePage
      boardId={narrow ? 'ITBAB' : conflict ? 'J1pdB' : TAB_NODE[editTab]}
      title={name || 'フォーム名未設定'}
      identity={(
        <Link href="/form-submissions" className={styles.backLink}>
          <ArrowLeft size={14} aria-hidden="true" />
          回答フォームへ
        </Link>
      )}
      steps={(
        <div className={styles.tabs}>
          {/* 型は説明をタブの下へ置くので、絵どおり題の下・タブの上に出すためここに置く。 */}
          <p className={styles.status}>{statusLine}</p>
          <Tabs label="編集する内容" items={TAB_ITEMS.map((t) => ({ label: t.label, current: editTab === t.key, onClick: () => changeTab(t.key) }))} />
        </div>
      )}
      preview={preview}
      previewToggle={conflictBand}
      footerActions={footerActions}
      status={autosave.label
        ? <span aria-live="polite" data-autosave-status>{autosave.label}</span>
        : dirty ? '保存していない変更があります' : undefined}
    >
      <div className={styles.root} data-fe-root>
        {!conflict && error ? <Notice tone="danger" message={error} onClose={() => setError('')} /> : null}
        {notice ? <Notice tone="success" message={notice} onClose={() => setNotice('')} /> : null}
        {loading || !formLoaded ? (
          <p className={styles.loading}>読み込み中...</p>
        ) : editTab === 'content' ? (
          <ContentTab
            layout={layout}
            page={page}
            blocks={blocks}
            refs={refs}
            selectedBlockId={selectedBlockId}
            inputCount={inputCount}
            accountId={selectedAccountId}
            onSelectPage={selectPage}
            onAddPage={addSection}
            onRenamePage={renameSection}
            onDuplicatePage={duplicateSection}
            onRemovePage={removeSection}
            onSelectBlock={setSelectedBlockId}
            onAddBlock={addBlock}
            onPatchBlock={patchBlock}
            onMoveBlock={moveBlock}
            onDuplicateBlock={duplicateBlock}
            onRemoveBlock={removeBlock}
          />
        ) : editTab === 'after' ? (
          <AfterTab options={layout.options} refs={refs} onSubmitTagId={onSubmitTagId} onChangeOptions={patchOptions} onChangeSubmitTag={setOnSubmitTagId} />
        ) : (
          <AppearanceTab
            options={layout.options}
            accountId={selectedAccountId}
            name={name}
            nameError={nameError}
            description={description}
            ogTitle={ogTitle}
            ogDescription={ogDescription}
            ogImageUrl={ogImageUrl}
            onChangeOptions={patchOptions}
            onChangeName={(next) => {
              setName(next)
              if (next.trim()) setNameError(null)
            }}
            onChangeDescription={setDescription}
            onChangeOgTitle={setOgTitle}
            onChangeOgDescription={setOgDescription}
            onChangeOgImageUrl={setOgImageUrl}
          />
        )}
      </div>

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="フォームへの変更" onConfirm={confirmLeave} onCancel={cancelLeave} />

      <Dialog
        open={showPublish}
        title="この版を公開する"
        description="公開すると、配っている URL を開いた人に新しい内容が出ます。"
        busy={saving}
        error={error || undefined}
        designNode="Z9wXm"
        designWidth={640}
        designTop={220}
        footer={<></>}
        onCancel={() => setShowPublish(false)}
      >
        <div className={styles.publishBody}>
          <div className={styles.changes}>
            <p className={styles.changesTitle}>変わること</p>
            {publishChanges.length === 0 ? (
              <p className={styles.changeLine}>保存した下書きをそのまま公開します</p>
            ) : (
              publishChanges.map((line, index) => (
                <p key={index} className={styles.changeLine} data-kind={line.kind}>
                  {line.kind === 'add' ? '＋ ' : line.kind === 'remove' ? '－ ' : '・ '}
                  {line.text}
                </p>
              ))
            )}
          </div>
          <ul className={styles.publishNotes}>
            <li>・すでに集まった回答（{submitCount.toLocaleString('ja-JP')}件）は消えません。消した質問の答えも残ります。</li>
            <li>・公開するまで、いまの版がそのまま使われます。</li>
          </ul>
          {/* 絵の操作は真ん中（下の帯と同じ）。窓の既定の右寄せの帯は使わない。 */}
          <div className={styles.publishActions}>
            <Button onClick={() => setShowPublish(false)} disabled={saving}>キャンセル</Button>
            <Button
              variant="primary"
              disabled={saving}
              busy={saving}
              busyLabel="公開しています…"
              onClick={() => {
                void (async () => {
                  const ok = await save(true)
                  if (ok) setShowPublish(false)
                })()
              }}
            >
              <Upload size={15} aria-hidden="true" />
              この版を公開
            </Button>
          </div>
        </div>
      </Dialog>

      <SaveConflictCompareDialog
        open={saveConflict.compareOpen}
        busy={saveConflict.compareBusy}
        error={saveConflict.compareError}
        {...(saveConflict.latest
          ? describeConflictDiff({ name, description, layout }, saveConflict.latest)
          : { lines: null, omitted: 0 })}
        onReload={() => void saveConflict.reloadLatest()}
        onCancel={saveConflict.closeCompare}
      />

      <Dialog open={previewOpen} title="LINEでの見え方" description="お客さまのスマホに出る形です。" onCancel={() => setPreviewOpen(false)}>
        <div className={styles.phoneDialog}>{phone}</div>
      </Dialog>
    </CreatePage>
  )
}

export default function FormEditV8() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<p>読み込み中...</p>}>
      <FormEditInner />
    </Suspense>
  )
}
