'use client'

/*
 * ★V8 テンプレート「カルーセルを作る・編集」（Pencil `J60utH`）。
 *
 * 外枠はテンプレートの作る画面と同じ（src/v8/template-edit/frame）。左に段「名前とフォルダ」「カード」（札で選ぶ・つまんで並べ替え）
 * 「カード N の中身」（画像・タイトル・本文・ボタン最大3つ）と案内の帯、絵に無い「押せる回数」は下に。
 * 右の列に「気をつけること」と「届き方」。下の帯はキャンセル・下書きを保存・保存して公開。
 * 読み込み・保存（作成だけ済んだあとのやり直しは作り直さない）・公開（使用先があれば確認の窓 cuR8I）・離れる確認は
 * 今の V8（app/templates/carousel/carousel-v8.tsx）と同じ。組み立てと保存は carousel-core の写し。
 * ボタンの「動きを実行する」の中身は今の部品（InlineActionList）を窓で開いて決める。
 * 受け付ける URL：`/templates/carousel`・`?id=<テンプレート>`・`?visual=1`（見本の3枚で開く。撮影用）。
 */
import { Suspense, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, Copy, ImageIcon, Plus, Send, Trash2, TriangleAlert } from 'lucide-react'
import type { Folder, MediaItem } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { isForbiddenOrRateLimited, loadFailureNotice } from '@/components/shared/api-error-message'
import InlineActionList, { useActionOptions } from '@/components/auto-replies/inline-action-list'
import { readInlineActions, type InlineAction } from '@/components/auto-replies/draft-fields'
import { ACTION_KINDS } from '@/components/scenarios/action-editor'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import LinePreview from '@/components/shared/line-preview'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import FolderSelect, { folderById, folderCreator, hostFolderCreate } from '@/components/shared/folder-select'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { TemplateEditFrame } from '../template-edit/frame'
import type { TemplateEditHost } from '../template-edit/host'
import MediaPickerDialog from '../template-edit/media-picker'
import te from '../template-edit/edit.module.css'
import {
  MAX_ACTIONS, MAX_COLUMNS, TEXT_MAX_WITH_IMAGE, TEXT_MAX_WITHOUT_IMAGE, TITLE_MAX,
  buildCarouselContent, carouselSnapshot, emptyChoice, emptyPanel, saveCarousel, visualPanels, type Panel,
} from './carousel-core'
import styles from './question-new.module.css'
import own from './carousel.module.css'

/** 札の名前：タイトルの（）書きを外した短い名前（絵：「夏の定番セット（送料込み）」→「夏の定番セット」）。 */
export function chipName(title: string): string {
  return title.replace(/[（(][^）)]*[）)]\s*$/, '').trim() || title.trim()
}

/** 「動きを実行する」の中身の1行（絵：「タグ「夏セット興味」を付ける」）。 */
export function inlineActionsText(actions: InlineAction[], tags: Array<{ id: string; name: string }>): string {
  if (actions.length === 0) return '何もしない（決める）'
  const first = actions[0]
  const config = (first.config ?? {}) as Record<string, unknown>
  let text = first.actionType === 'notify_staff' ? '担当者へ通知' : ACTION_KINDS.find((kind) => kind.type === first.actionType)?.label ?? '動き'
  if (first.actionType === 'tag') {
    const ids = Array.isArray(config.tagIds) ? (config.tagIds as unknown[]).map(String) : []
    const tag = tags.find((item) => item.id === ids[0])
    const verb = config.op === 'remove' ? '外す' : '付ける'
    if (tag) text = `タグ「${tag.name}」を${verb}${ids.length > 1 ? ` ほか${ids.length - 1}つ` : ''}`
  }
  return actions.length > 1 ? `${text} ほか${actions.length - 1}` : text
}

/** 保存してある本文（LINE のカルーセルの列）をカードの形に戻す。壊れていれば投げる。 */
export function panelsFromContent(messageContent: string, storedActions: Record<string, Record<string, unknown[]>> | null = null): Panel[] {
  const parsed = JSON.parse(messageContent) as unknown
  const columns = Array.isArray(parsed) ? parsed : ((parsed as { columns?: unknown })?.columns ?? [])
  if (!Array.isArray(columns)) return []
  return columns.map((c, i) => {
    const col = c as Partial<Panel>
    return {
      thumbnailImageUrl: col.thumbnailImageUrl ?? '',
      title: col.title ?? '',
      text: col.text ?? '',
      actions: Array.isArray(col.actions) && col.actions.length > 0
        ? (col.actions as unknown as Array<Record<string, unknown>>).map((a, ai) => {
          const isUri = a.type === 'uri' || typeof a.uri === 'string'
          return {
            label: (a.label as string) ?? '',
            kind: isUri ? ('uri' as const) : ('action' as const),
            uri: (a.uri as string) ?? '',
            actions: readInlineActions((storedActions?.[String(i)]?.[String(ai)] as unknown[]) ?? null),
          }
        })
        : [emptyChoice()],
    }
  })
}

/** 統括の編集（host.initialContent）：保存してあるカルーセルをカードに戻す。読めなければ null。 */
function hostCarouselInitial(host: TemplateEditHost | undefined) {
  const content = host?.initialContent
  if (!content || content.kind !== 'carousel') return null
  try {
    const panels = panelsFromContent(content.messageContent)
    return panels.length ? { name: content.name, panels, tapLimitMode: content.tapLimitMode, tapLimitText: content.tapLimitText ?? '' } : null
  } catch {
    return null
  }
}

function Carousel({ host }: { host?: TemplateEditHost }) {
  const router = useRouter()
  const { selectedAccountId, selectedAccount } = useAccount()
  const params = useSearchParams()
  /* 統括の入口（host）では店のテンプレートを読まない（新しく作るだけ）。 */
  const id = host ? null : params.get('id')
  const visual = params.get('visual') === '1'
  usePageTitle(host ? 'テンプレート' : id ? 'カルーセルを編集' : 'カルーセルを作る')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: 'テンプレート', href: '/templates' }])

  const [hostInitial] = useState(() => hostCarouselInitial(host))
  const [name, setName] = useState(hostInitial ? hostInitial.name : visual ? '夏の定番5点' : '')
  const [panels, setPanels] = useState<Panel[]>(() => hostInitial ? hostInitial.panels : visual ? visualPanels() : [emptyPanel()])
  const [selected, setSelected] = useState(0)
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const savingRef = useRef(false)
  const [folderId, setFolderId] = useState<string | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [templateAccountId, setTemplateAccountId] = useState<string | null>(null)
  const [tapLimitMode, setTapLimitMode] = useState<'none' | 'once'>(hostInitial ? hostInitial.tapLimitMode : 'none')
  const [tapLimitText, setTapLimitText] = useState(hostInitial ? hostInitial.tapLimitText : '')
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null)
  const [snapshotTaken, setSnapshotTaken] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [urlOpen, setUrlOpen] = useState(false)
  const [actionsFor, setActionsFor] = useState<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [publishCheck, setPublishCheck] = useState<{ id: string; usageCount: number } | null>(null)
  const [publishError, setPublishError] = useState('')
  const [canMutate] = useState(() => (typeof window === 'undefined' ? true : isOwnerOrAdmin()))
  const actionOptions = useActionOptions()

  const folderAccountId = id ? templateAccountId : selectedAccountId
  useEffect(() => {
    setFolders([])
    if (!folderAccountId || host) return
    let cancelled = false
    void api.folders.list('template', folderAccountId).then((res) => {
      if (!cancelled && res.success) setFolders(res.data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [folderAccountId])

  useEffect(() => {
    if (!id) return
    const markLoadFailed = (caught?: unknown) => {
      setLoadFailed(true)
      setError(isForbiddenOrRateLimited(caught) ? loadFailureNotice(caught, 'カルーセル') : '読み込めませんでした。開き直してください。')
    }
    void api.templates.get(id)
      .then((res) => {
        if (!res.success) { markLoadFailed(); return }
        setName(res.data.name)
        setTemplateAccountId(res.data.accountId ?? null)
        setFolderId(res.data.folderId ?? null)
        setTapLimitMode(res.data.carouselTapLimitMode === 'once' ? 'once' : 'none')
        setTapLimitText(res.data.carouselTapLimitText ?? '')
        const storedActions = (res.data.carouselActions ?? null) as Record<string, Record<string, unknown[]>> | null
        try {
          const loaded = panelsFromContent(res.data.messageContent, storedActions)
          if (loaded.length > 0) setPanels(loaded)
        } catch {
          setError('いまの中身を読み取れませんでした。保存すると上書きされます。')
        }
      })
      .catch((caught: unknown) => markLoadFailed(caught))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (loading || snapshotTaken) return
    setSavedSnapshot(carouselSnapshot({ name, panels, folderId, tapLimitMode, tapLimitText }))
    setSnapshotTaken(true)
  }, [loading, snapshotTaken, name, panels, folderId, tapLimitMode, tapLimitText])
  const dirty = savedSnapshot !== null && savedSnapshot !== carouselSnapshot({ name, panels, folderId, tapLimitMode, tapLimitText })
  const { leaveTarget, confirmLeave, cancelLeave, guarded, disarm } = useUnsavedGuard({ dirty, busy: saving || publishing })

  const update = (index: number, patch: Partial<Panel>) => setPanels((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  const moveTo = (from: number, to: number) => {
    if (from === to || to < 0 || to >= panels.length) return
    setPanels((prev) => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
    setSelected(to)
  }
  const duplicatePanel = (index: number) => setPanels((prev) => prev.length >= MAX_COLUMNS ? prev : [...prev.slice(0, index + 1), { ...prev[index], actions: [...prev[index].actions] }, ...prev.slice(index + 1)])
  const removePanel = (index: number) => {
    setPanels((prev) => prev.filter((_, j) => j !== index))
    setSelected((current) => Math.max(0, Math.min(current === index ? index - 1 : current > index ? current - 1 : current, panels.length - 2)))
  }
  const textMaxFor = (panel: Panel) => (panel.title.trim() || panel.thumbnailImageUrl.trim() ? TEXT_MAX_WITH_IMAGE : TEXT_MAX_WITHOUT_IMAGE)

  /** 保存する。できたらテンプレートの id（URL の id または作成済み）を返す。 */
  const saveNow = async (): Promise<string | null> => {
    if (savingRef.current) return null
    if (loadFailed) { setError('読み込めませんでした。開き直してください。'); return null }
    if (!id && !createdId && !selectedAccountId) { setError('上のバーでLINE公式アカウントを選んでください'); return null }
    if (!name.trim()) { setError('名前を入力してください'); return null }
    savingRef.current = true
    setSaving(true)
    setError('')
    setSaveFailed(false)
    try {
      const res = await saveCarousel({ templateId: id ?? createdId, selectedAccountId, name, panels, folderId, tapLimitMode, tapLimitText })
      if (!res.ok) {
        if (res.createdId) setCreatedId(res.createdId)
        setError(res.error)
        setSaveFailed(true)
        return null
      }
      /* 作成だけ済んだあとのやり直しが「作り直し」にならないよう覚える。 */
      if (!id) setCreatedId(res.id)
      setSavedSnapshot(carouselSnapshot({ name, panels, folderId, tapLimitMode, tapLimitText }))
      return res.id
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const publishNow = async (templateId: string, detail?: { publishedVersion: number; draftRevision: number }) => {
    const got = detail ? { success: true as const, data: detail } : await api.templates.get(templateId)
    if (!got.success || !got.data) { setPublishError('いまの状態を読み込めませんでした。もう一度お試しください。'); return false }
    try {
      const res = await api.templates.publish(templateId, { expectedVersion: got.data.publishedVersion ?? 0, expectedDraftRevision: got.data.draftRevision ?? 0 })
      if (!res.success) { setPublishError(res.error || '公開できませんでした。もう一度お試しください。'); return false }
    } catch (caught) {
      setPublishError(caught instanceof ApiError && caught.status === 409 ? '他の人が先に更新したため、公開を止めました。画面を読み直して、もう一度お試しください。' : '公開できませんでした。もう一度お試しください。')
      return false
    }
    return true
  }
  /* 保存して公開。使用先があるときは確認の窓を出してから公開する（cuR8I）。 */
  const publishSaved = async (templateId: string) => {
    setPublishing(true)
    setPublishError('')
    try {
      const detail = await api.templates.get(templateId)
      if (!detail.success || !detail.data) { setPublishError('いまの状態を読み込めませんでした。一覧の詳細から公開してください。'); return }
      const usedBy = detail.data.usedBy
      const usageCount = usedBy ? Object.values(usedBy).reduce((total, items) => total + (Array.isArray(items) ? items.length : 0), 0) : 0
      if (usageCount > 0) { setPublishCheck({ id: templateId, usageCount }); return }
      if (await publishNow(templateId, detail.data)) { disarm(); router.push('/templates') }
    } finally {
      setPublishing(false)
    }
  }
  /* 統括の入口：中身を組み立てて呼ぶ側へ渡す。選択肢は URL を開くだけ（押したら動く選択肢は配った先で動かせない）。 */
  const hostSave = (distribute: boolean) => {
    if (!host) return
    if (!name.trim()) { setError('名前を入力してください'); return }
    if (panels.some((p) => p.actions.some((a) => a.label.trim() && a.kind === 'action'))) { setError('統括のカルーセルのボタンは「URLを開く」だけにしてください'); return }
    if (panels.some((p) => !p.text.trim())) { setError('すべてのカードに本文を入力してください'); return }
    setError('')
    disarm()
    host.onSave({ kind: 'carousel', name: name.trim(), messageContent: buildCarouselContent(panels, 'hq'), tapLimitMode, tapLimitText: tapLimitText.trim() || null }, distribute)
  }
  const onSaveDraft = async () => { if (host) { hostSave(false); return } if (await saveNow()) { disarm(); router.push('/templates') } }
  const onPublish = async () => { if (host) { hostSave(true); return } const savedId = await saveNow(); if (savedId) await publishSaved(savedId) }

  const panel = panels[selected] ?? panels[0]
  const selectedIndex = panels[selected] ? selected : 0

  if (host ? host.readOnly : !canMutate) {
    return (
      <TemplateEditFrame boardId="J60utH" title="カルーセル" description="カルーセルの作成・変更はオーナーと管理者だけができます" side={null}>
        <p className={styles.note}>一覧で中身を確認できます。</p>
        <Link href="/templates" className={styles.back}>一覧へ戻る</Link>
      </TemplateEditFrame>
    )
  }

  const busy = saving || publishing || Boolean(host?.busy)
  const onChipKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowLeft' && event.altKey) { event.preventDefault(); moveTo(index, index - 1) }
    if (event.key === 'ArrowRight' && event.altKey) { event.preventDefault(); moveTo(index, index + 1) }
  }
  const onDrop = (event: DragEvent, index: number) => {
    event.preventDefault()
    if (dragIndex !== null) moveTo(dragIndex, index)
    setDragIndex(null)
  }
  /* 届き方：アイコンと横に並ぶカード（いま開いているカードを先頭に、次のカードの端を見せる）。 */
  const sender = host ? '公式アカウント' : selectedAccount?.name ?? '公式アカウント'
  const shown = panels.slice(selectedIndex, selectedIndex + 2)
  const phone = (
    <LinePreview title={null} note="カルーセルの見え方（横にスワイプして見えます）" accountName={sender} caption="配信日 10:00">
      <div className={own.talkRow}>
        <span className={own.avatar} aria-hidden="true">{sender.slice(0, 1)}</span>
        <div className={own.slides}>
          {shown.map((item, index) => (
            <div key={index} className={own.slide} data-peek={index > 0 || undefined}>
              {/^https?:\/\//.test(item.thumbnailImageUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.thumbnailImageUrl} alt="" className={own.slideImage} />
              ) : <span className={own.slideImage}>{chipName(item.title)}</span>}
              {index === 0 ? (
                <>
                  <span className={own.slideBody}>
                    <span className={own.slideTitle}>{item.title || '（タイトル）'}</span>
                    <span className={own.slideText}>{item.text}</span>
                  </span>
                  {item.actions.map((action, ai) => <span key={ai} className={own.slideButton}>{action.label || '（ボタン）'}</span>)}
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      {panels.length > 1 ? <p className={own.swipe}><span>横にスワイプして見えます</span></p> : null}
    </LinePreview>
  )

  return (
    <>
      <TemplateEditFrame
        boardId="J60utH"
        title={id ? 'カルーセルを編集' : 'カルーセルを作る'}
        description={`横にめくるカード。最大 ${MAX_COLUMNS} 枚`}
        side={(
          <>
            <section className={te.sideCard}>
              <h2 className={te.sideTitle}>気をつけること</h2>
              <div className={own.stats}>
                <div className={own.stat}><span>カードの数</span><strong>{`${panels.length} / ${MAX_COLUMNS}`}</strong></div>
                <div className={own.stat}><span>画像</span><strong>{`${panels.length}枚とも同じ比率`}</strong></div>
                <div className={own.stat}><span>押された数</span><strong>ボタンごとに数える</strong></div>
              </div>
            </section>
            <h2 className={te.previewHead}>届き方</h2>
            <div className={te.phone}>{phone}</div>
          </>
        )}
        footerActions={(
          <>
            <Button type="button" onClick={() => (host ? host.onCancel() : guarded(() => router.push('/templates')))} disabled={busy}>キャンセル</Button>
            <Button type="button" onClick={() => void onSaveDraft()} disabled={busy || loadFailed} busy={saving && !publishing}>下書きを保存</Button>
            <Button type="button" variant="primary" onClick={() => void onPublish()} disabled={busy || loadFailed} busy={publishing || Boolean(host?.busy)}><Send size={15} aria-hidden="true" />{host ? host.primaryLabel ?? '保存して配る' : '保存して公開'}</Button>
          </>
        )}
      >
        {host?.notice}
        {error ? <Notice tone="danger" message={error} /> : null}
        {publishError ? <Notice tone="danger" message={publishError} /> : null}
        {saveFailed ? <Notice tone="warn" message="入力した内容はそのまま残っています。もう一度保存を押してください。" /> : null}
        {loading ? <ListState kind="loading" title="カルーセルを読み込んでいます" /> : (
          <>
            <section className={styles.card} aria-labelledby="cr-name">
              <h2 className={styles.cardTitle} id="cr-name">名前とフォルダ</h2>
              <div className={styles.row}>
                <label className={`${styles.field} ${styles.grow}`}>
                  <span className={styles.label}>テンプレート名</span>
                  <input className={styles.input} value={name} placeholder="例：夏の定番5点" onChange={(event) => setName(event.target.value)} />
                </label>
                <div className={`${styles.field} ${styles.folder}`}>
                  <span className={styles.pickLabel}>フォルダ</span>
                  <FolderSelect
                    size="full"
                    aria-label="フォルダ"
                    value={host ? host.folder : folderId ?? ''}
                    onChange={host ? host.onFolderChange : (value) => setFolderId(value || null)}
                    folders={host ? host.folders : folders.map(folderById)}
                    colors={!host}
                    onCreate={host
                      ? hostFolderCreate(host)
                      : canMutate && folderAccountId
                        ? folderCreator((name, color) => api.folders.create({ kind: 'template', name, color, accountId: folderAccountId }), folderById, (created) => setFolders((current) => [...current, created]))
                        : undefined}
                  />
                </div>
              </div>
            </section>

            <section className={styles.card} aria-labelledby="cr-cards">
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle} id="cr-cards">カード</h2>
                <p className={styles.note}>左から順に出ます。つまんで並べ替えられます。</p>
              </div>
              <div className={own.chipRow}>
                {panels.map((item, index) => (
                  <button
                    key={index}
                    type="button"
                    className={own.chip}
                    aria-pressed={index === selectedIndex}
                    draggable
                    title={`${item.title || `カード ${index + 1}`}（つまんで並べ替え・Alt＋← → でも動かせます）`}
                    onClick={() => setSelected(index)}
                    onKeyDown={(event) => onChipKey(event, index)}
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => onDrop(event, index)}
                  >
                    {`${index + 1} ${chipName(item.title) || `カード ${index + 1}`}`}
                  </button>
                ))}
                <Button type="button" variant="text" disabled={panels.length >= MAX_COLUMNS} onClick={() => { setPanels((prev) => [...prev, emptyPanel()]); setSelected(panels.length) }}>
                  <Plus size={15} aria-hidden="true" />カードを足す
                </Button>
                <span className={own.count}>{`${panels.length} / ${MAX_COLUMNS} 枚`}</span>
              </div>
            </section>

            {panel ? (
              <section className={styles.card} aria-labelledby="cr-panel">
                <h2 className={styles.cardTitle} id="cr-panel">{`カード ${selectedIndex + 1} の中身`}</h2>
                <div className={own.panelRow}>
                  <div className={own.imageCol}>
                    <button type="button" className={own.imageBox} onClick={() => (host ? setUrlOpen(true) : setPickerOpen(true))} title="登録メディアから画像を選ぶ（1040 × 1040px または横1024 × 縦678px）">
                      {/^https?:\/\//.test(panel.thumbnailImageUrl.trim()) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={panel.thumbnailImageUrl} alt="" className={own.imageThumb} />
                      ) : (
                        <>
                          <ImageIcon className={own.imageIcon} aria-hidden="true" />
                          <span>登録メディアから選ぶ</span>
                        </>
                      )}
                    </button>
                    <button type="button" className={own.linkButton} onClick={() => setUrlOpen((open) => !open)}>{urlOpen ? 'URL の欄を閉じる' : 'URL で入れる'}</button>
                  </div>
                  <div className={own.textCol}>
                    <label className={styles.field}>
                      <span className={styles.label}>{`タイトル（${TITLE_MAX}文字まで）`}</span>
                      <input className={styles.input} value={panel.title} onChange={(event) => update(selectedIndex, { title: event.target.value })} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>{panel.title.trim() || panel.thumbnailImageUrl.trim() ? `本文（タイトルか画像があると${TEXT_MAX_WITH_IMAGE}文字まで）` : `本文（${TEXT_MAX_WITHOUT_IMAGE}文字まで）`}</span>
                      <input className={styles.input} value={panel.text} onChange={(event) => update(selectedIndex, { text: event.target.value })} />
                    </label>
                    {[...panel.title].length > TITLE_MAX || [...panel.text].length > textMaxFor(panel) ? (
                      <p className={own.over} role="alert">{`タイトル ${[...panel.title].length} / ${TITLE_MAX}・本文 ${[...panel.text].length} / ${textMaxFor(panel)} 文字。多すぎる分を減らしてください。`}</p>
                    ) : null}
                  </div>
                </div>
                {urlOpen ? (
                  <label className={styles.field}>
                    <span className={styles.label}>画像の URL</span>
                    <input className={styles.input} type="url" value={panel.thumbnailImageUrl} placeholder="https://example.com/a.png" onChange={(event) => update(selectedIndex, { thumbnailImageUrl: event.target.value })} />
                  </label>
                ) : null}

                <span className={styles.pickLabel}>{`ボタン（最大 ${MAX_ACTIONS} つ）`}</span>
                <div className={own.buttonHead} aria-hidden="true">
                  <span className={own.colLabel}>ボタンの文字</span>
                  <span className={own.colKind}>押したら</span>
                  <span>中身</span>
                </div>
                {panel.actions.map((action, ai) => {
                  const setAction = (patch: Partial<typeof action>) => update(selectedIndex, { actions: panel.actions.map((a, j) => (j === ai ? { ...a, ...patch } : a)) })
                  return (
                    <div key={ai} className={own.buttonRow}>
                      <input className={`${styles.input} ${own.colLabel}`} value={action.label} placeholder="ボタンの文字" aria-label={`カード${selectedIndex + 1}のボタン${ai + 1}の文字`} onChange={(event) => setAction({ label: event.target.value })} />
                      <span className={own.colKind}>
                        <Select size="full" aria-label={`カード${selectedIndex + 1}のボタン${ai + 1}の動き`} value={action.kind} onChange={(value) => setAction({ kind: value as 'uri' | 'action' })} options={host ? [{ value: 'uri', label: 'URLを開く' }] : [{ value: 'uri', label: 'URLを開く' }, { value: 'action', label: '動きを実行する' }]} />
                      </span>
                      {action.kind === 'uri' ? (
                        <input className={`${styles.input} ${own.colBody}`} type="url" value={action.uri} placeholder="https://example.com" aria-label={`カード${selectedIndex + 1}のボタン${ai + 1}のURL`} onChange={(event) => setAction({ uri: event.target.value })} />
                      ) : (
                        <button type="button" className={`${styles.pick} ${own.colBody}`} onClick={() => setActionsFor(ai)} title="押されたときの動きを決める">
                          <span className={styles.pickText}>{inlineActionsText(action.actions, actionOptions.tags)}</span>
                          <ChevronDown className={styles.pickIcon} aria-hidden="true" />
                        </button>
                      )}
                      {panel.actions.length > 1 ? (
                        <button type="button" className={own.iconButton} aria-label={`カード${selectedIndex + 1}のボタン${ai + 1}を外す`} title="このボタンを外す" onClick={() => update(selectedIndex, { actions: panel.actions.filter((_, j) => j !== ai) })}>
                          <Trash2 className={own.icon} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  )
                })}
                <div className={own.toolRow}>
                  <Button type="button" variant="text" disabled={panel.actions.length >= MAX_ACTIONS} onClick={() => update(selectedIndex, { actions: [...panel.actions, emptyChoice()] })}><Plus size={15} aria-hidden="true" />ボタンを足す</Button>
                  <span className={own.spacer} />
                  <Button type="button" variant="text" disabled={panels.length >= MAX_COLUMNS} title={panels.length >= MAX_COLUMNS ? `カードは${MAX_COLUMNS}枚までです` : undefined} onClick={() => duplicatePanel(selectedIndex)}><Copy size={15} aria-hidden="true" />このカードを複製</Button>
                  <Button type="button" variant="text" disabled={panels.length <= 1} title={panels.length <= 1 ? 'カードは1枚必要です' : undefined} onClick={() => removePanel(selectedIndex)}><Trash2 size={15} aria-hidden="true" />このカードを消す</Button>
                </div>
                <p className={own.info}><TriangleAlert className={own.icon} aria-hidden="true" />画像は全部のカードに入れるか、全部入れないかにします。1枚だけ違うと、高さがそろわず崩れます。</p>
              </section>
            ) : null}

            {/* 絵に無いが今ある設定：押せる回数（「動きを実行する」ボタンだけが対象）。統括の入口は URL だけなので出さない。 */}
            {host ? null : <section className={styles.card} aria-labelledby="cr-limit">
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle} id="cr-limit">押せる回数</h2>
                <p className={styles.note}>「動きを実行する」ボタンだけが対象です。URLを開くボタンはLINEの外へ出るので数えられません。</p>
              </div>
              <div className={styles.seg} role="radiogroup" aria-label="押せる回数">
                <button type="button" role="radio" aria-checked={tapLimitMode === 'none'} className={styles.segButton} onClick={() => setTapLimitMode('none')}>何度でも押せる</button>
                <button type="button" role="radio" aria-checked={tapLimitMode === 'once'} className={styles.segButton} onClick={() => setTapLimitMode('once')}>1人につき1回だけ</button>
              </div>
              {tapLimitMode === 'once' ? (
                <label className={styles.field}>
                  <span className={styles.label}>2回目に押されたときの返事<span className={styles.optional}>空なら何も返さない</span></span>
                  <input className={styles.input} value={tapLimitText} placeholder="例：こちらはすでに受け付けています。" onChange={(event) => setTapLimitText(event.target.value)} />
                </label>
              ) : null}
            </section>}
          </>
        )}
      </TemplateEditFrame>

      <Dialog open={actionsFor !== null && Boolean(panel?.actions[actionsFor ?? 0])} size="large" title="押されたときの動き" onCancel={() => setActionsFor(null)}>
        {actionsFor !== null && panel?.actions[actionsFor] ? (
          <InlineActionList
            actions={panel.actions[actionsFor].actions}
            onChange={(next) => update(selectedIndex, { actions: panel.actions.map((a, j) => (j === actionsFor ? { ...a, actions: next } : a)) })}
            tags={actionOptions.tags}
            fields={actionOptions.fields}
            marks={actionOptions.marks}
            scenarios={actionOptions.scenarios}
            vars={actionOptions.vars}
          />
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={publishCheck !== null}
        title="この内容を公開しますか？"
        description={`このテンプレートは ${publishCheck?.usageCount ?? 0}か所で使われています。公開すると、使っている場所へ新しい内容が届きます。`}
        confirmLabel="公開する"
        busy={publishing}
        error={publishError || undefined}
        designNode="cuR8I"
        onConfirm={async () => {
          if (!publishCheck) return
          setPublishing(true)
          setPublishError('')
          try {
            if (await publishNow(publishCheck.id)) { setPublishCheck(null); disarm(); router.push('/templates') }
          } finally {
            setPublishing(false)
          }
        }}
        onCancel={() => setPublishCheck(null)}
      />
      <MediaPickerDialog
        open={pickerOpen}
        accountId={folderAccountId}
        kind="image"
        onClose={() => setPickerOpen(false)}
        onSelect={(item: MediaItem) => { update(selectedIndex, { thumbnailImageUrl: item.url }); setPickerOpen(false) }}
      />
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="カルーセルの変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </>
  )
}

/** `host` を渡すと統括のテンプレートの入口から使う（template-edit/host.ts）。ボタンは URL を開くだけ。 */
export default function CarouselV8({ host }: { host?: TemplateEditHost } = {}) {
  return (
    <Suspense fallback={<ListState kind="loading" title="カルーセルを読み込んでいます" />}>
      <Carousel host={host} />
    </Suspense>
  )
}
