'use client'

/*
 * ★V8「リッチメッセージを作る」（絵 EFV8l・機能追加 F-4）。
 *
 * 1枚の画像を面に分けて、押した面ごとに動く。形（面の分け方）・画像・面ごとの動きを決める。
 * 保存は今の画面（app/templates/asset-editor-v8.tsx・template-asset-editor.tsx）と同じ口
 * （POST /api/broadcast-message-assets、kind=rich_message）・同じ形の payload。
 * 形・面の座標・動きの組み立ては template-asset-editor.tsx から写した（src/v8 は @/app を読めない）。
 * 外枠・名前とフォルダの箱・右の列はクーポン・リサーチ（asset.tsx）と同じ。動きは BEHAVIOR.md。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ImagePlus, Send } from 'lucide-react'
import type { Folder, MediaItem, TemplateImagemapUpload } from '@line-crm/shared'
import { api } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import LinePreview from '@/components/shared/line-preview'
import Select from '@/components/shared/select'
import FolderSelect, { folderByName, folderCreator, hostFolderCreate } from '@/components/shared/folder-select'
import { TextField } from '@/components/shared/text-field'
import { notifyToast } from '@/components/shared/toast'
import { japaneseDetailOf } from '@/components/shared/api-error-message'
import InlineActionRowsV8, { actionRowTitle } from '@/components/auto-replies/inline-action-rows-v8'
import { useActionOptions } from '@/components/auto-replies/inline-action-list'
import { newActionKey, toActionPayload, type InlineAction } from '@/components/auto-replies/draft-fields'
import { TemplateEditFrame } from './frame'
import MediaPickerDialog from './media-picker'
import type { TemplateEditHost } from './host'
import styles from './edit.module.css'
import rich from './rich.module.css'

/* ── 形と面（template-asset-editor.tsx と同じ値） ── */
export interface RichArea { label: string; x: number; y: number; width: number; height: number }
export interface RichShape { value: string; label: string; rows: string[][]; areas: RichArea[] }

export function buildAreas(rows: string[][]): RichArea[] {
  const height = 100 / rows.length
  return rows.flatMap((labels, rowIndex) => {
    const width = 100 / labels.length
    return labels.map((label, colIndex) => ({
      label,
      x: Math.round(colIndex * width * 100) / 100,
      y: Math.round(rowIndex * height * 100) / 100,
      width: Math.round(width * 100) / 100,
      height: Math.round(height * 100) / 100,
    }))
  })
}

const shape = (value: string, label: string, rows: string[][]): RichShape => ({ value, label, rows, areas: buildAreas(rows) })
export const RICH_SHAPES: RichShape[] = [
  shape('1', '1面', [['A']]),
  shape('2v', '上下2面', [['A'], ['B']]),
  shape('2h', '左右2面', [['A', 'B']]),
  shape('3', '上1・下2', [['A'], ['B', 'C']]),
  shape('4', '4面', [['A', 'B'], ['C', 'D']]),
  shape('6', '6面', [['A', 'B', 'C'], ['D', 'E', 'F']]),
]

/** 面の場所の呼び名（「A 上」「B 左下」など）。座標から決める。 */
export function areaPlace(area: RichArea, all: RichArea[]): string {
  const rows = new Set(all.map((a) => a.y)).size
  const cols = all.filter((a) => a.y === area.y).length
  const v = rows === 1 ? '' : area.y === 0 ? '上' : '下'
  const right = area.x + area.width >= 99.9
  const h = cols === 1 ? '' : area.x === 0 ? '左' : right ? '右' : '中'
  return `${h}${v}` || '全体'
}

export type AreaActionKind = 'none' | 'uri' | 'actions'
export interface AreaDraft { kind: AreaActionKind; uri: string; actions: InlineAction[] }
export const emptyAreaDraft = (): AreaDraft => ({ kind: 'none', uri: '', actions: [] })
export const areaDraftConfigured = (draft: AreaDraft | undefined): boolean => Boolean(draft && draft.kind !== 'none')

const AREA_KIND_OPTIONS = [
  { value: 'none', label: '未設定' },
  { value: 'uri', label: 'URLを開く' },
  { value: 'actions', label: '動きを実行する' },
]
/* 統括（host）：動きの中身（タグ・シナリオ等）は配った先の ID に直せないので、URL だけ。 */
const HOST_AREA_KIND_OPTIONS = AREA_KIND_OPTIONS.filter((option) => option.value !== 'actions')

/** 見本の中身（?visual=1）。絵 EFV8l：上下2面・上は URL・下は動き。 */
function visualAreas(): Record<string, AreaDraft> {
  return {
    A: { kind: 'uri', uri: 'https://nen.example/summer', actions: [] },
    B: { kind: 'actions', uri: '', actions: [{ key: newActionKey(), actionType: 'tag', config: { op: 'add', tagIds: [] }, onFailure: 'continue' }] },
  }
}

/** 保存値（payload）を組み立てる。足りないときは理由を返す（今の画面と同じ決まり）。 */
export function buildRichPayload(input: {
  imageUrl: string
  pickedMedia: MediaItem | null
  shape: RichShape
  areas: Record<string, AreaDraft>
}): { payload: Record<string, unknown> } | { error: string } {
  if (!input.imageUrl.trim()) return { error: '画像を設定してください。' }
  for (const area of input.shape.areas) {
    const draft = input.areas[area.label]
    if (draft?.kind === 'uri' && !draft.uri.trim()) return { error: `面 ${area.label} のURLを入力してください。` }
  }
  return {
    payload: {
      imageUrl: input.imageUrl.trim(),
      imageMediaId: input.pickedMedia?.id ?? null,
      imageMediaKind: input.pickedMedia?.kind ?? null,
      shape: input.shape.value,
      tapAreas: input.shape.areas.map((area) => {
        const draft = input.areas[area.label] ?? emptyAreaDraft()
        return {
          label: area.label,
          x: area.x,
          y: area.y,
          width: area.width,
          height: area.height,
          actionType: draft.kind === 'uri' ? 'uri' : draft.kind === 'actions' ? 'postback' : 'none',
          ...(draft.kind === 'uri' ? { uri: draft.uri.trim() } : {}),
          ...(draft.kind === 'actions' ? { actions: draft.actions.map(toActionPayload) } : {}),
        }
      }),
    },
  }
}

/** 統括の編集で読み込んだリッチメッセージを、画面の値に戻す。形が分からなければ面の数から選ぶ。 */
function richInitial(host: TemplateEditHost | undefined) {
  const content = host?.initialContent
  if (!content || content.kind !== 'rich_message') return null
  const payload = content.payload
  const taps = Array.isArray(payload.tapAreas) ? payload.tapAreas as Array<Record<string, unknown>> : []
  const shape = RICH_SHAPES.find((candidate) => candidate.value === payload.shape)
    ?? RICH_SHAPES.find((candidate) => candidate.areas.length === taps.length)
    ?? RICH_SHAPES[0]
  const areas: Record<string, AreaDraft> = {}
  shape.areas.forEach((area, index) => {
    const tap = taps.find((item) => item.label === area.label) ?? taps[index]
    if (tap?.actionType === 'uri' && typeof tap.uri === 'string') areas[area.label] = { kind: 'uri', uri: tap.uri, actions: [] }
  })
  const imageUrl = typeof payload.imageUrl === 'string' ? payload.imageUrl : typeof payload.baseUrl === 'string' ? `${payload.baseUrl}/1040` : ''
  return { name: content.name, shape: shape.value, areas, imageUrl, uploaded: { media: content.media, payload } as TemplateImagemapUpload }
}

/**
 * `host` を渡すと、統括のテンプレート（g8d6ai）から同じ画面を使う（host.ts）。保存は呼ぶ側、主ボタンは［保存して配る］。
 * 画像は統括の置き場へ送って LINE の5サイズを作る（host.uploadRichImage）。登録メディア・画像の URL・動きを実行するは出さない。
 */
export default function TemplateRichEditor({ visual = false, host }: { visual?: boolean; host?: TemplateEditHost }) {
  const router = useRouter()
  const role = useStaffRole()
  const canMutate = host ? !host.readOnly : role === null || canManageRole(role)
  const { selectedAccountId, accounts } = useAccount()
  usePageTitle(host ? 'テンプレート' : 'リッチメッセージを作る')
  const actionOptions = useActionOptions()

  /* 統括の編集（host.initialContent）：保存してある画像（5サイズ）・形・面の URL から始める。 */
  const [hostInitial] = useState(() => richInitial(host))
  const [name, setName] = useState(hostInitial ? hostInitial.name : visual ? '夏のキャンペーン告知' : '')
  const [folder, setFolder] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [imageUrl, setImageUrl] = useState(hostInitial?.imageUrl ?? '')
  const [pickedMedia, setPickedMedia] = useState<MediaItem | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [shapeValue, setShapeValue] = useState(hostInitial ? hostInitial.shape : visual ? '2v' : '3')
  const [pendingShape, setPendingShape] = useState<string | null>(null)
  const [areas, setAreas] = useState<Record<string, AreaDraft>>(() => (hostInitial ? hostInitial.areas : visual ? visualAreas() : {}))
  const [actionsFor, setActionsFor] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  /* 統括：送った画像（5サイズ）と、その payload（baseUrl・baseSize など）。 */
  const [uploaded, setUploaded] = useState<TemplateImagemapUpload | null>(hostInitial?.uploaded ?? null)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const shapeDef = RICH_SHAPES.find((candidate) => candidate.value === shapeValue) ?? RICH_SHAPES[3]
  const pendingShapeDef = pendingShape ? RICH_SHAPES.find((candidate) => candidate.value === pendingShape) : undefined
  const droppingLabels = pendingShapeDef
    ? shapeDef.areas
      .filter((area) => !pendingShapeDef.areas.some((next) => next.label === area.label))
      .filter((area) => areaDraftConfigured(areas[area.label]))
      .map((area) => area.label)
    : []

  /* アカウントを替えたら、前のアカウントの登録メディアは外す。 */
  useEffect(() => {
    if (host) return
    setPickedMedia(null)
    setImageUrl('')
    // 統括では上のバーのアカウントに結びつかない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId])

  /* フォルダはアカウントの置き場一覧から選ぶ（保存値はフォルダ名のまま。今と同じ）。 */
  useEffect(() => {
    setFolders([])
    if (!selectedAccountId || host) return
    let cancelled = false
    void api.folders.list('template', selectedAccountId)
      .then((res) => { if (!cancelled && res.success) setFolders(res.data) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [selectedAccountId])

  const snapshot = useMemo(() => JSON.stringify({ name, folder, imageUrl, pickedMedia, shapeValue, areas }), [name, folder, imageUrl, pickedMedia, shapeValue, areas])
  const [clean, setClean] = useState(() => snapshot)
  const dirty = snapshot !== clean && !saved
  const { leaveTarget, confirmLeave, cancelLeave, disarm } = useUnsavedGuard({ dirty, busy: saving || publishing })

  const updateArea = (label: string, patch: Partial<AreaDraft>) =>
    setAreas((prev) => ({ ...prev, [label]: { ...(prev[label] ?? emptyAreaDraft()), ...patch } }))

  /* 面を減らすとき、消える面に設定があれば確かめる（黙って捨てない）。 */
  const requestShape = (value: string) => {
    const next = RICH_SHAPES.find((candidate) => candidate.value === value)
    if (!next || value === shapeValue) return
    const removed = shapeDef.areas.filter((area) => !next.areas.some((n) => n.label === area.label))
    if (removed.some((area) => areaDraftConfigured(areas[area.label]))) {
      setPendingShape(value)
      return
    }
    setShapeValue(value)
  }
  const confirmShapeChange = () => {
    if (!pendingShapeDef) return
    const kept = new Set(pendingShapeDef.areas.map((area) => area.label))
    setAreas((prev) => Object.fromEntries(Object.entries(prev).filter(([label]) => kept.has(label))))
    setShapeValue(pendingShapeDef.value)
    setPendingShape(null)
  }

  const save = async (): Promise<boolean> => {
    if (!selectedAccountId) { setError('上のバーでLINE公式アカウントを選んでください。'); return false }
    if (!name.trim()) { setError('リッチメッセージ名を入力してください。'); return false }
    const built = buildRichPayload({ imageUrl, pickedMedia, shape: shapeDef, areas })
    if ('error' in built) { setError(built.error); return false }
    setSaving(true)
    setError('')
    try {
      const result = await api.broadcastMessageAssets.create({
        lineAccountId: selectedAccountId,
        kind: 'rich_message',
        name: name.trim(),
        payload: { ...built.payload, folder },
      })
      if (!result.success) {
        setError(result.error || '保存できませんでした。')
        return false
      }
      setSaved(true)
      setClean(snapshot)
      return true
    } catch {
      setError('保存できませんでした。通信状態を確認して、もう一度お試しください。')
      return false
    } finally {
      setSaving(false)
    }
  }
  /* 統括：中身を組み立てて呼ぶ側へ渡す（保存・配るは呼ぶ側）。 */
  const hostSave = (distribute: boolean) => {
    if (!host) return
    if (!name.trim()) { setError('リッチメッセージ名を入力してください。'); return }
    if (!uploaded) { setError('画像を選んでください。'); return }
    const built = buildRichPayload({ imageUrl, pickedMedia: null, shape: shapeDef, areas })
    if ('error' in built) { setError(built.error); return }
    const { imageMediaId: _id, imageMediaKind: _kind, ...rest } = built.payload
    void _id; void _kind
    setError('')
    host.onSave({ kind: 'rich_message', name: name.trim(), payload: { ...uploaded.payload, ...rest }, media: uploaded.media }, distribute)
  }
  const uploadImage = async (file: File) => {
    if (!host?.uploadRichImage) return
    setUploading(true)
    setError('')
    try {
      const result = await host.uploadRichImage(file)
      const url = typeof result.payload.imageUrl === 'string' ? result.payload.imageUrl : typeof result.payload.baseUrl === 'string' ? `${result.payload.baseUrl}/1040` : ''
      setUploaded(result)
      setImageUrl(url)
    } catch (cause) {
      setError(japaneseDetailOf(cause) || '画像を送れませんでした。PNG・JPEG（8MB まで）を選び直してください。')
    } finally {
      setUploading(false)
    }
  }
  const openImage = () => (host ? fileInput.current?.click() : setPickerOpen(true))
  const onSaveDraft = async () => {
    if (host) { hostSave(false); return }
    if (await save()) notifyToast('下書きを保存しました')
  }
  const onPublish = async () => {
    if (host) { hostSave(true); return }
    setPublishing(true)
    try {
      if (await save()) {
        disarm()
        router.push('/templates')
      }
    } finally {
      setPublishing(false)
    }
  }

  const sendName = host ? '公式アカウント' : accounts.find((account) => account.id === selectedAccountId)?.name ?? '公式アカウント'
  const blocked = saved ? '保存しました。一覧へ戻ってください。' : null
  const busy = saving || publishing || uploading || Boolean(host?.busy)
  const imageSet = /^https?:\/\//.test(imageUrl.trim())
  const unsetAreas = shapeDef.areas.filter((area) => !areaDraftConfigured(areas[area.label]))
  const actionsSummary = (draft: AreaDraft) => {
    if (draft.actions.length === 0) return '動きを選ぶ'
    const first = actionRowTitle(draft.actions[0], actionOptions)
    return draft.actions.length > 1 ? `${first} ほか${draft.actions.length - 1}件` : first
  }
  const editingArea = actionsFor ? (areas[actionsFor] ?? emptyAreaDraft()) : null

  const sideCard = (
    <section className={styles.sideCard}>
      <h2 className={styles.sideTitle}>リッチメニューとの違い</h2>
      <p className={styles.sideText}>リッチメッセージはトークに1回流れて、過去のやり取りに残ります。リッチメニューは画面の下に常に出ます。</p>
    </section>
  )

  /* 届き方：トークに流れる正方形の画像。面の線は見本だけ（友だちには見えない）。 */
  const phone = (
    <LinePreview note="リッチメッセージの見え方" caption="配信日 10:00" accountName={sendName}>
      <div className={styles.assetRow}>
        <span className={styles.assetAvatar} aria-hidden="true">{sendName.slice(0, 1)}</span>
        <div className={rich.phoneImage}>
          {imageSet ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl.trim()} alt="" />
          ) : null}
          {shapeDef.rows.map((row, rowIndex) => (
            <div key={rowIndex} className={rich.phoneRow}>
              {row.map((label) => (
                <span key={label} className={rich.phoneArea} data-image={imageSet || undefined}>
                  {imageSet ? null : `面 ${label}`}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </LinePreview>
  )

  if (!canMutate) {
    return (
      <TemplateEditFrame
        boardId="EFV8l"
        title="リッチメッセージを作る"
        description="1枚の画像を面に分けて、押した面ごとに動く"
        band={<p className={styles.readonly} role="status">閲覧のみ：テンプレートの作成・変更はオーナーと管理者だけができます。</p>}
        side={sideCard}
      >
        <Card padding="none" layout="vertical" className={styles.card}>
          <p className={styles.cardNote}>中身の確認は一覧の行を開くと読めます。</p>
        </Card>
      </TemplateEditFrame>
    )
  }

  return (
    <>
      <TemplateEditFrame
        boardId={host ? 'g8d6ai' : 'EFV8l'}
        title="リッチメッセージを作る"
        description="1枚の画像を面に分けて、押した面ごとに動く"
        side={(
          <>
            <div className={styles.previewToggle}>
              <Button type="button" onClick={() => setPreviewOpen(true)}>LINEでの見え方を見る</Button>
            </div>
            {sideCard}
            <h2 className={styles.previewHead}>届き方</h2>
            <div className={styles.phone}>{phone}</div>
          </>
        )}
        footerActions={(
          <>
            {host ? <Button type="button" onClick={host.onCancel}>キャンセル</Button> : <Button href="/templates">キャンセル</Button>}
            <Button type="button" onClick={() => void onSaveDraft()} disabled={busy || Boolean(blocked)} title={blocked ?? undefined} busy={saving && !publishing} busyLabel="保存中…">
              下書きを保存
            </Button>
            <Button type="button" variant="primary" onClick={() => void onPublish()} disabled={busy || Boolean(blocked)} title={blocked ?? undefined} busy={publishing || Boolean(host?.busy)} busyLabel="保存中…">
              {host ? null : <Send size={15} aria-hidden="true" />}
              {host ? host.primaryLabel ?? '保存する' : '保存して公開'}
            </Button>
          </>
        )}
      >
        {host?.notice}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        {saved ? <p role="status" className={styles.readonly}>保存しました。一覧へ戻ると、リッチメッセージの一覧に出ています。</p> : null}

        <Card padding="none" layout="vertical" className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>名前とフォルダ</h2>
          </div>
          <div className={styles.pair}>
            <div className={`${styles.field} ${styles.grow}`}>
              <label htmlFor="te-rich-name" className={styles.label}>テンプレート名</label>
              <TextField id="te-rich-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例：夏のキャンペーン告知" aria-required="true" />
            </div>
            <div className={`${styles.field} ${styles.folderField}`}>
              <label htmlFor="te-rich-folder" className={styles.labelSmall}>フォルダ</label>
              <FolderSelect
                id="te-rich-folder"
                aria-label="フォルダ"
                value={host ? host.folder : folder}
                onChange={host ? host.onFolderChange : setFolder}
                folders={host ? host.folders : folders.map(folderByName)}
                colors={!host}
                onCreate={host
                  ? hostFolderCreate(host)
                  : canMutate && selectedAccountId
                    ? folderCreator((name, color) => api.folders.create({ kind: 'template', name, color, accountId: selectedAccountId }), folderByName, (created) => setFolders((current) => [...current, created]))
                    : undefined}
              />
            </div>
          </div>
        </Card>

        <Card padding="none" layout="vertical" className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>面の分け方</h2>
            <p className={styles.cardNote}>選んだ形に合わせて、下の設定が増えます</p>
          </div>
          <div className={rich.shapeRow} role="group" aria-label="面の分け方">
            {RICH_SHAPES.map((candidate) => (
              <button
                key={candidate.value}
                type="button"
                className={rich.shape}
                aria-pressed={shapeValue === candidate.value}
                onClick={() => requestShape(candidate.value)}
              >
                <span className={rich.shapeGlyph} aria-hidden="true">
                  {candidate.rows.map((row, rowIndex) => (
                    <span key={rowIndex} className={rich.shapeGlyphRow}>
                      {row.map((label) => <span key={label} className={rich.shapeGlyphArea} />)}
                    </span>
                  ))}
                </span>
                <span className={rich.shapeLabel}>{candidate.label}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card padding="none" layout="vertical" className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>画像</h2>
            <p className={styles.cardNote}>1040 × 1040px（正方形）がおすすめ</p>
          </div>
          <div className={rich.imageRow}>
            <button type="button" className={rich.imageBox} onClick={openImage} disabled={uploading} aria-label="リッチメッセージの画像を選ぶ">
              {imageSet ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl.trim()} alt="" />
              ) : (
                <span className={styles.couponImageEmpty}><ImagePlus size={18} aria-hidden="true" />画像を選ぶ</span>
              )}
            </button>
            <div className={rich.imageSide}>
              <Button type="button" onClick={openImage} disabled={uploading} busy={uploading} busyLabel="画像を送っています…">
                <ImagePlus size={15} aria-hidden="true" />
                {host ? '画像を選ぶ' : '登録メディアから選ぶ'}
              </Button>
              <p className={styles.cardNote}>面の線は画像の上に重ねて表示されます。友だちには線は見えません。</p>
              {pickedMedia ? <p className={styles.hint}>選択中：{pickedMedia.filename}</p> : null}
              {host ? (
                /* 統括：PNG・JPEG（8MB まで）を送ると、配った先で使う5サイズを作る。URL の直書きは置かない（サイズを作れない）。 */
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg"
                  hidden
                  aria-label="リッチメッセージの画像のファイル"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void uploadImage(file)
                  }}
                />
              ) : (
              <TextField
                value={imageUrl}
                onChange={(event) => { setImageUrl(event.target.value); setPickedMedia(null) }}
                placeholder="または画像のURL（https://…）"
                aria-label="画像のURL"
              />
              )}
            </div>
          </div>
        </Card>

        <Card padding="none" layout="vertical" className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>押した面ごとの動き</h2>
          </div>
          <div className={rich.areaHead} aria-hidden="true">
            <span className={rich.areaColChip}>面</span>
            <span className={rich.areaColKind}>押したら</span>
            <span className={rich.areaColBody}>中身</span>
          </div>
          {shapeDef.areas.map((area) => {
            const draft = areas[area.label] ?? emptyAreaDraft()
            return (
              <div key={area.label} className={rich.areaRow} role="group" aria-label={`面 ${area.label}`}>
                <span className={rich.areaChip} data-unset={draft.kind === 'none' || undefined}>{`${area.label} ${areaPlace(area, shapeDef.areas)}`}</span>
                <div className={rich.areaKind}>
                  <Select
                    aria-label={`面 ${area.label} を押したら`}
                    value={draft.kind}
                    onChange={(value) => updateArea(area.label, { kind: value as AreaActionKind })}
                    options={host ? HOST_AREA_KIND_OPTIONS : AREA_KIND_OPTIONS}
                  />
                </div>
                <div className={rich.areaBody}>
                  {draft.kind === 'uri' ? (
                    <TextField
                      type="url"
                      value={draft.uri}
                      onChange={(event) => updateArea(area.label, { uri: event.target.value })}
                      placeholder="https://example.com"
                      aria-label={`面 ${area.label} のURL`}
                    />
                  ) : draft.kind === 'actions' ? (
                    <button type="button" className={rich.actionPick} onClick={() => setActionsFor(area.label)} aria-haspopup="dialog">
                      <span className={rich.actionPickText}>{actionsSummary(draft)}</span>
                      <ChevronDown size={14} aria-hidden="true" />
                    </button>
                  ) : (
                    <p className={rich.areaNone}>押しても何も起きません</p>
                  )}
                </div>
              </div>
            )
          })}
          {unsetAreas.length > 0 ? (
            <p className={rich.warn}>
              {unsetAreas.map((area) => `面 ${area.label}`).join('・')}の動きが未設定です。そのまま送ると、押しても何も起きません。
            </p>
          ) : null}
        </Card>
      </TemplateEditFrame>

      <Dialog
        open={actionsFor !== null}
        title={actionsFor ? `面 ${actionsFor} を押したときの動き` : '面を押したときの動き'}
        description="上から順に行います。"
        cancelLabel="閉じる"
        onCancel={() => setActionsFor(null)}
      >
        {actionsFor && editingArea ? (
          <InlineActionRowsV8 actions={editingArea.actions} onChange={(next) => updateArea(actionsFor, { actions: next })} {...actionOptions} />
        ) : null}
      </Dialog>

      <Dialog open={previewOpen} title="LINEでの見え方" cancelLabel="閉じる" onCancel={() => setPreviewOpen(false)}>
        <div className={styles.previewDialog}>{phone}</div>
      </Dialog>

      <ConfirmDialog
        open={pendingShape !== null}
        title="面の分け方を変えますか？"
        description={`${droppingLabels.map((label) => `面 ${label}`).join('・')}の動きは消えます。`}
        confirmLabel="変える"
        onConfirm={confirmShapeChange}
        onCancel={() => setPendingShape(null)}
      />

      <MediaPickerDialog
        open={pickerOpen}
        accountId={selectedAccountId}
        kind="image"
        onClose={() => setPickerOpen(false)}
        onSelect={(item) => { setImageUrl(item.url); setPickedMedia(item); setPickerOpen(false) }}
      />

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="リッチメッセージの変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </>
  )
}
