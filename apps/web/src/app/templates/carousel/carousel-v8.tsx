'use client'

/*
 * ★V8「カルーセルを作る／編集」（Pencil J60utH）。
 *
 * 左に積む白いカード：名前とフォルダ／カード（帯＋選んだ1枚の中身）／押せる回数。
 * 右の欄：「気をつけること」＋届き方（LinePreview の本物のスマホ）。
 * 下の追従バー：キャンセル／下書きを保存／保存して公開。
 *
 * 保存の2段階（作成→postback埋め直し）・再試行・離脱番兵の判断は
 * v7（carousel/page.tsx）と同じ関数を使う。ここにあるのは置き場と見え方だけ。
 */
import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ArrowRight, Copy, Trash2 } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { Folder, MediaItem } from '@line-crm/shared'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Notice from '@/components/shared/notice'
import LinePreview from '@/components/shared/line-preview'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import { Field, inputClass, TextArea } from '@/components/shared/form-controls'
import { isForbiddenOrRateLimited, loadFailureNotice } from '@/components/shared/api-error-message'
import InlineActionList, { useActionOptions } from '@/components/auto-replies/inline-action-list'
import { readInlineActions } from '@/components/auto-replies/draft-fields'
import { useAccount } from '@/contexts/account-context'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import MediaPickerDialog from '@/app/contents/media-picker-dialog'
import EditorV8, { EditorCard } from '../editor-v8'
import styles from '../editor-v8.module.css'
import {
  MAX_ACTIONS,
  MAX_COLUMNS,
  TEXT_MAX_WITH_IMAGE,
  TEXT_MAX_WITHOUT_IMAGE,
  TITLE_MAX,
  carouselSnapshot,
  emptyChoice,
  emptyPanel,
  saveCarousel,
  visualPanels,
  type Panel,
} from './carousel-core'

function CarouselEditorV8Inner() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const params = useSearchParams()
  const id = params.get('id')
  const visual = params.get('visual') === '1'

  const [name, setName] = useState(visual ? '夏の定番5点' : '')
  const [panels, setPanels] = useState<Panel[]>(visual ? visualPanels() : [emptyPanel()])
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
  const [tapLimitMode, setTapLimitMode] = useState<'none' | 'once'>('none')
  const [tapLimitText, setTapLimitText] = useState('')
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null)
  const [snapshotTaken, setSnapshotTaken] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  /** 「保存して公開」の使用先確認窓。 */
  const [publishCheck, setPublishCheck] = useState<{ id: string; usageCount: number } | null>(null)
  const [publishError, setPublishError] = useState('')
  const [canMutateTemplates] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())
  const actionOptions = useActionOptions()

  const folderAccountId = id ? templateAccountId : selectedAccountId
  useEffect(() => {
    setFolders([])
    if (!folderAccountId) return
    let cancelled = false
    void api.folders.list('template', folderAccountId).then((res) => {
      if (!cancelled && res.success) setFolders(res.data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [folderAccountId])

  const markLoadFailed = (caught?: unknown) => {
    setLoadFailed(true)
    setError(isForbiddenOrRateLimited(caught) ? loadFailureNotice(caught, 'カルーセル') : '読み込めませんでした。開き直してください。')
  }

  useEffect(() => {
    if (!id) return
    void api.templates
      .get(id)
      .then((res) => {
        if (!res.success) {
          markLoadFailed()
          return
        }
        setName(res.data.name)
        setTemplateAccountId(res.data.accountId ?? null)
        setFolderId(res.data.folderId ?? null)
        setTapLimitMode(res.data.carouselTapLimitMode === 'once' ? 'once' : 'none')
        setTapLimitText(res.data.carouselTapLimitText ?? '')
        const storedActions = (res.data.carouselActions ?? null) as Record<
          string,
          Record<string, unknown[]>
        > | null
        try {
          const parsed = JSON.parse(res.data.messageContent) as unknown
          const columns = Array.isArray(parsed)
            ? parsed
            : ((parsed as { columns?: unknown })?.columns ?? [])
          if (Array.isArray(columns) && columns.length > 0) {
            setPanels(
              columns.map((c, i) => {
                const col = c as Partial<Panel>
                return {
                  thumbnailImageUrl: col.thumbnailImageUrl ?? '',
                  title: col.title ?? '',
                  text: col.text ?? '',
                  actions:
                    Array.isArray(col.actions) && col.actions.length > 0
                      ? (col.actions as unknown as Array<Record<string, unknown>>).map((a, ai) => {
                          const isUri = a.type === 'uri' || typeof a.uri === 'string'
                          return {
                            label: (a.label as string) ?? '',
                            kind: isUri ? ('uri' as const) : ('action' as const),
                            uri: (a.uri as string) ?? '',
                            actions: readInlineActions(
                              (storedActions?.[String(i)]?.[String(ai)] as unknown[]) ?? null,
                            ),
                          }
                        })
                      : [emptyChoice()],
                }
              }),
            )
          }
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
  const dirty = savedSnapshot !== null &&
    savedSnapshot !== carouselSnapshot({ name, panels, folderId, tapLimitMode, tapLimitText })

  const update = (index: number, patch: Partial<Panel>) =>
    setPanels((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))

  const move = (index: number, direction: -1 | 1) =>
    setPanels((prev) => {
      const to = index + direction
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })

  const duplicatePanel = (index: number) =>
    setPanels((prev) =>
      prev.length >= MAX_COLUMNS
        ? prev
        : [...prev.slice(0, index + 1), { ...prev[index], actions: [...prev[index].actions] }, ...prev.slice(index + 1)],
    )

  const removePanel = (index: number) => {
    setPanels((prev) => prev.filter((_, j) => j !== index))
    setSelected((current) => Math.max(0, Math.min(current === index ? index - 1 : current > index ? current - 1 : current, panels.length - 2)))
  }

  const textMaxFor = (panel: Panel) =>
    panel.title.trim() || panel.thumbnailImageUrl.trim() ? TEXT_MAX_WITH_IMAGE : TEXT_MAX_WITHOUT_IMAGE

  /** 保存する。できたらテンプレートの id（URL の id または作成済み）を返す。 */
  const saveNow = async (): Promise<string | null> => {
    if (savingRef.current) return null
    if (loadFailed) {
      setError('読み込めませんでした。開き直してください。')
      return null
    }
    if (!id && !createdId && !selectedAccountId) {
      setError('上のバーでLINE公式アカウントを選んでください')
      return null
    }
    if (!name.trim()) {
      setError('名前を入力してください')
      return null
    }
    savingRef.current = true
    setSaving(true)
    setError('')
    setSaveFailed(false)
    try {
      const res = await saveCarousel({
        templateId: id ?? createdId,
        selectedAccountId,
        name,
        panels,
        folderId,
        tapLimitMode,
        tapLimitText,
      })
      if (!res.ok) {
        if (res.createdId) setCreatedId(res.createdId)
        setError(res.error)
        setSaveFailed(true)
        return null
      }
      /* 作成だけ済んだあとの再試行が「作り直し」にならないよう覚える。 */
      if (!id) setCreatedId(res.id)
      setSavedSnapshot(carouselSnapshot({ name, panels, folderId, tapLimitMode, tapLimitText }))
      return res.id
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  /**
   * 保存して公開。作成済みなら作成だけ済んだ id へ、そのあと公開口へ。
   * 使用先があるときは確認窓を出してから公開する（Pencil cuR8I）。
   */
  const publishSaved = async (templateId: string) => {
    setPublishing(true)
    setPublishError('')
    try {
      const detail = await api.templates.get(templateId)
      if (!detail.success || !detail.data) {
        setPublishError('いまの状態を読み込めませんでした。一覧の詳細から公開してください。')
        return
      }
      const usedBy = detail.data.usedBy
      const usageCount = usedBy
        ? Object.values(usedBy).reduce((total, items) => total + (Array.isArray(items) ? items.length : 0), 0)
        : 0
      if (usageCount > 0) {
        setPublishCheck({ id: templateId, usageCount })
        return
      }
      const ok = await publishNow(templateId, detail.data)
      if (ok) router.push('/templates')
    } finally {
      setPublishing(false)
    }
  }

  const publishNow = async (templateId: string, detail?: { publishedVersion: number; draftRevision: number }) => {
    const got = detail ? { success: true as const, data: detail } : await api.templates.get(templateId)
    if (!got.success || !got.data) {
      setPublishError('いまの状態を読み込めませんでした。もう一度お試しください。')
      return false
    }
    const current = got.data
    try {
      const res = await api.templates.publish(templateId, {
        expectedVersion: current.publishedVersion ?? 0,
        expectedDraftRevision: current.draftRevision ?? 0,
      })
      if (!res.success) {
        setPublishError(res.error || '公開できませんでした。もう一度お試しください。')
        return false
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setPublishError('他の人が先に更新したため、公開を止めました。画面を読み直して、もう一度お試しください。')
      } else {
        setPublishError('公開できませんでした。もう一度お試しください。')
      }
      return false
    }
    return true
  }

  const onSaveDraft = async () => {
    const savedId = await saveNow()
    if (savedId) router.push('/templates')
  }

  const onPublish = async () => {
    const savedId = await saveNow()
    if (savedId) await publishSaved(savedId)
  }

  const panel = panels[selected] ?? panels[0]
  const selectedIndex = panels[selected] ? selected : 0

  if (!canMutateTemplates) {
    return (
      <div className={styles.page}>
        <header className={styles.head}>
          <Link href="/templates" className={styles.back}>テンプレートへ</Link>
        </header>
        <div role="alert" className={styles.card}>
          <p className={styles.cardTitle}>カルーセルの作成・変更はオーナーと管理者だけができます</p>
          <Link href="/templates" className="text-action text-sm underline">一覧へ戻る</Link>
        </div>
      </div>
    )
  }

  return (
    <>
      <EditorV8
        title={id ? 'カルーセルを編集' : 'カルーセルを作る'}
        lead="横にめくるカード。最大 10 枚"
        designNode="J60utH"
        dirty={dirty}
        dirtySubject="カルーセルの変更"
        saving={saving}
        publishing={publishing}
        saveBlockedReason={loadFailed ? '読み込めませんでした。開き直してください。' : null}
        status="下書き（まだ誰にも送られません）"
        onSaveDraft={() => void onSaveDraft()}
        onPublish={() => void onPublish()}
        error={error || publishError ? (
          <>
            {error ? <Notice tone="danger" message={error} /> : null}
            {publishError ? <Notice tone="danger" message={publishError} /> : null}
            {saveFailed ? (
              <Notice tone="warn" message="入力した内容はそのまま残っています。もう一度保存を押してください。" />
            ) : null}
          </>
        ) : undefined}
        guide={(
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>気をつけること</h2>
            </div>
            <div className={styles.statRow}><span className={styles.statTerm}>カードの数</span><span className={styles.statValue}>{panels.length} / {MAX_COLUMNS}</span></div>
            <div className={styles.statRow}><span className={styles.statTerm}>画像</span><span className={styles.statValue}>全部に同じ比率で</span></div>
            <div className={styles.statRow}><span className={styles.statTerm}>押された数</span><span className={styles.statValue}>ボタンごとに数える</span></div>
            <p className={styles.muted}>ボタンは1枚につき{MAX_ACTIONS}つまで。本文はタイトルか画像があると{TEXT_MAX_WITH_IMAGE}文字まで、両方なければ{TEXT_MAX_WITHOUT_IMAGE}文字までです。</p>
          </section>
        )}
        preview={(
          <>
            <h2 className={styles.previewTitle}>届き方</h2>
            <LinePreview note="カルーセルの見え方（横にスワイプして見えます）" caption="配信日 10:00">
            <div className="rounded-card overflow-hidden bg-canvas text-ink">
              {panel?.thumbnailImageUrl && /^https?:\/\//.test(panel.thumbnailImageUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={panel.thumbnailImageUrl} alt="" className="h-36 w-full object-cover" />
              ) : (
                <div className="bg-canvas-sunken text-ink-faint flex h-36 items-center justify-center text-xs">画像なし</div>
              )}
              <div className="p-4">
                <p className="font-bold">{panel?.title || '（タイトル）'}</p>
                <p className="mt-2 text-sm leading-relaxed">{panel?.text}</p>
                {(panel?.actions ?? []).map((action, index) => (
                  <p key={index} className="border-hairline text-accent-deep mt-2 rounded-control border p-2 text-center text-sm">
                    {action.label || '（ボタン）'}
                  </p>
                ))}
              </div>
            </div>
            {panels.length > 1 ? <p className="text-ink-faint mt-2 text-xs">あと {panels.length - 1} 枚・横にスワイプして見えます</p> : null}
            </LinePreview>
          </>
        )}
      >
        {loading ? (
          <section className={styles.card}>
            <p className={styles.muted}>読み込み中...</p>
          </section>
        ) : (
          <>
            <EditorCard title="名前とフォルダ" note="一覧に出る名前です。友だちには見えません。">
              <div className={styles.fieldRow}>
                <Field label="テンプレート名" htmlFor="cr8-name" required>
                  <input
                    id="cr8-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例：夏の定番5点"
                    className={inputClass}
                  />
                </Field>
                <Field label="フォルダ" htmlFor="cr8-folder">
                  <Select
                    id="cr8-folder"
                    aria-label="フォルダ"
                    value={folderId ?? ''}
                    onChange={(value) => setFolderId(value || null)}
                    options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
                  />
                </Field>
              </div>
            </EditorCard>

            <EditorCard title="カード" note="左から順に出ます。← → で並べ替えられます。">
              <ol className={styles.panelStrip}>
                {panels.map((p, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={styles.panelChip}
                      data-active={i === selectedIndex}
                      aria-pressed={i === selectedIndex}
                      onClick={() => setSelected(i)}
                    >
                      <span className={styles.panelChipIndex}>{i + 1}</span>
                      {p.title || `カード ${i + 1}`}
                    </button>
                  </li>
                ))}
              </ol>
              <div className={styles.addRow}>
                <button
                  type="button"
                  className={styles.toolButton}
                  disabled={panels.length >= MAX_COLUMNS}
                  title={panels.length >= MAX_COLUMNS ? `カードは${MAX_COLUMNS}枚までです` : undefined}
                  onClick={() => setPanels((prev) => [...prev, emptyPanel()])}
                >
                  ＋ カードを足す（{panels.length} / {MAX_COLUMNS} 枚）
                </button>
              </div>
            </EditorCard>

            {panel ? (
              <EditorCard
                title={`カード ${selectedIndex + 1} の中身`}
                note="このカードだけの画像・文・ボタン"
              >
                <div className={styles.subCardTools}>
                  <button
                    type="button"
                    className={styles.toolButton}
                    aria-label={`カード ${selectedIndex + 1} を左へ`}
                    title={selectedIndex === 0 ? 'いちばん左です' : '左へ移動'}
                    disabled={selectedIndex === 0}
                    onClick={() => { move(selectedIndex, -1); setSelected(selectedIndex - 1) }}
                  ><ArrowLeft size={14} /></button>
                  <button
                    type="button"
                    className={styles.toolButton}
                    aria-label={`カード ${selectedIndex + 1} を右へ`}
                    title={selectedIndex === panels.length - 1 ? 'いちばん右です' : '右へ移動'}
                    disabled={selectedIndex === panels.length - 1}
                    onClick={() => { move(selectedIndex, 1); setSelected(selectedIndex + 1) }}
                  ><ArrowRight size={14} /></button>
                  <button
                    type="button"
                    className={styles.toolButton}
                    disabled={panels.length >= MAX_COLUMNS}
                    title={panels.length >= MAX_COLUMNS ? `カードは${MAX_COLUMNS}枚までです` : 'このカードを複製'}
                    onClick={() => duplicatePanel(selectedIndex)}
                  ><Copy size={14} /> このカードを複製</button>
                  <button
                    type="button"
                    className={`${styles.toolButton} ${styles.toolButtonDanger}`}
                    disabled={panels.length <= 1}
                    title={panels.length <= 1 ? 'カードは1枚必要です' : 'このカードを削除'}
                    onClick={() => removePanel(selectedIndex)}
                  ><Trash2 size={14} /> このカードを削除</button>
                </div>

                <Field label="画像" htmlFor={`cr8-panel-image`} note="入れるなら全部のカードに入れてください（1040 × 1040px または横1024 × 縦678px）">
                  <div className={styles.imagePick}>
                    {/^https?:\/\//.test(panel.thumbnailImageUrl.trim()) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={panel.thumbnailImageUrl} alt="" className={styles.imageThumb} />
                    ) : null}
                    <button type="button" className={styles.toolButton} onClick={() => setPickerOpen(true)}>登録メディアから選ぶ</button>
                    <input
                      id="cr8-panel-image"
                      type="url"
                      className={inputClass}
                      value={panel.thumbnailImageUrl}
                      onChange={(e) => update(selectedIndex, { thumbnailImageUrl: e.target.value })}
                      placeholder="https://example.com/a.png"
                    />
                  </div>
                </Field>

                <Field label="タイトル（40文字まで）" htmlFor="cr8-panel-title">
                  <input
                    id="cr8-panel-title"
                    type="text"
                    className={inputClass}
                    value={panel.title}
                    onChange={(e) => update(selectedIndex, { title: e.target.value })}
                  />
                  {[...panel.title].length > TITLE_MAX && (
                    <p className="text-danger mt-1 text-xs">{[...panel.title].length} 文字。{TITLE_MAX}文字までです。</p>
                  )}
                </Field>

                <Field
                  label={panel.title.trim() || panel.thumbnailImageUrl.trim() ? `本文（タイトルか画像があると${TEXT_MAX_WITH_IMAGE}文字まで）` : `本文（${TEXT_MAX_WITHOUT_IMAGE}文字まで）`}
                  htmlFor="cr8-panel-text"
                  required
                >
                  <TextArea
                    id="cr8-panel-text"
                    rows={3}
                    value={panel.text}
                    onChange={(e) => update(selectedIndex, { text: e.target.value })}
                  />
                  <p className={`${styles.countRow} ${[...panel.text].length > textMaxFor(panel) ? 'text-danger' : ''}`}>
                    {[...panel.text].length} / {textMaxFor(panel)}
                  </p>
                </Field>

                <div>
                  <p className={styles.guideTerm}>ボタン（最大 {MAX_ACTIONS} つ）</p>
                  {panel.actions.map((action, ai) => (
                    <div key={ai} className={`${styles.subCard} mt-2`}>
                      <div className={styles.choiceRow}>
                        <input
                          type="text"
                          className={inputClass}
                          value={action.label}
                          onChange={(e) =>
                            update(selectedIndex, {
                              actions: panel.actions.map((a, j) => (j === ai ? { ...a, label: e.target.value } : a)),
                            })
                          }
                          placeholder="ボタンの文字"
                          aria-label={`カード${selectedIndex + 1}のボタン${ai + 1}の文字`}
                        />
                        <SegmentedControl
                          aria-label={`カード${selectedIndex + 1}のボタン${ai + 1}の動き`}
                          options={[
                            { value: 'uri' as const, label: 'URLを開く' },
                            { value: 'action' as const, label: '動きを実行する' },
                          ]}
                          value={action.kind}
                          onChange={(value) =>
                            update(selectedIndex, {
                              actions: panel.actions.map((a, j) => (j === ai ? { ...a, kind: value } : a)),
                            })
                          }
                        />
                        {action.kind === 'uri' ? (
                          <input
                            type="url"
                            className={inputClass}
                            value={action.uri}
                            onChange={(e) =>
                              update(selectedIndex, {
                                actions: panel.actions.map((a, j) => (j === ai ? { ...a, uri: e.target.value } : a)),
                              })
                            }
                            placeholder="https://example.com"
                            aria-label={`カード${selectedIndex + 1}のボタン${ai + 1}のURL`}
                          />
                        ) : (
                          <InlineActionList
                            actions={action.actions}
                            onChange={(next) =>
                              update(selectedIndex, {
                                actions: panel.actions.map((a, j) => (j === ai ? { ...a, actions: next } : a)),
                              })
                            }
                            tags={actionOptions.tags}
                            fields={actionOptions.fields}
                            marks={actionOptions.marks}
                            scenarios={actionOptions.scenarios}
                            vars={actionOptions.vars}
                          />
                        )}
                        {panel.actions.length > 1 ? (
                          <button
                            type="button"
                            className={`${styles.toolButton} ${styles.toolButtonDanger}`}
                            aria-label={`カード${selectedIndex + 1}のボタン${ai + 1}を外す`}
                            onClick={() => update(selectedIndex, { actions: panel.actions.filter((_, j) => j !== ai) })}
                          >外す</button>
                        ) : null}
                      </div>
                      {action.kind === 'action' && action.actions.length === 0 ? (
                        <p className={styles.warn}>何も設定されていません。押されても何も起きません。</p>
                      ) : null}
                    </div>
                  ))}
                  {panel.actions.length < MAX_ACTIONS ? (
                    <div className={styles.addRow}>
                      <button
                        type="button"
                        className={styles.toolButton}
                        onClick={() => update(selectedIndex, { actions: [...panel.actions, emptyChoice()] })}
                      >＋ ボタンを足す</button>
                    </div>
                  ) : null}
                </div>
              </EditorCard>
            ) : null}

            <p className={styles.warn}>
              画像は全部のカードに入れるか、全部入れないかにします。1枚だけ違うと、高さがそろわず崩れます。
            </p>

            <EditorCard title="押せる回数" note="「動きを実行する」ボタンだけが対象です。URLを開くボタンはLINEの外へ出るので数えられません。">
              <RadioCardGroup legend="押せる回数">
                <RadioCard
                  name="tap-limit"
                  value="none"
                  checked={tapLimitMode === 'none'}
                  onChange={() => setTapLimitMode('none')}
                  title="何度でも押せる"
                />
                <RadioCard
                  name="tap-limit"
                  value="once"
                  checked={tapLimitMode === 'once'}
                  onChange={() => setTapLimitMode('once')}
                  title="1人につき1回だけ"
                  note="このカルーセル全体で1回です。どのボタンを押しても、次からは動きません。"
                />
              </RadioCardGroup>
              {tapLimitMode === 'once' && (
                <Field label="2回目に押されたときの返事" htmlFor="cr8-limit-text" note="空にすると、何も返さず黙って何も起きません。">
                  <input
                    id="cr8-limit-text"
                    type="text"
                    className={inputClass}
                    value={tapLimitText}
                    onChange={(e) => setTapLimitText(e.target.value)}
                    placeholder="例：こちらはすでに受け付けています。"
                  />
                </Field>
              )}
            </EditorCard>
          </>
        )}
      </EditorV8>

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
            const ok = await publishNow(publishCheck.id)
            if (ok) {
              setPublishCheck(null)
              router.push('/templates')
            }
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
        onSelect={(item: MediaItem) => {
          update(selectedIndex, { thumbnailImageUrl: item.url })
          setPickerOpen(false)
        }}
      />
    </>
  )
}

export default function CarouselEditorV8() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <CarouselEditorV8Inner />
    </Suspense>
  )
}
