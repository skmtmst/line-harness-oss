'use client'

/*
 * ★V8「クーポンを作る」（絵 S6FEuB）・「リサーチを作る」（絵 EsYo4）。
 *
 * 保存は今の画面（app/templates/asset-editor-v8.tsx・template-asset-editor.tsx）と
 * 同じ口（POST /api/broadcast-message-assets）・同じ形の payload。違いは置き場と
 * 見せ方だけ（BEHAVIOR.md）。リッチメッセージは今の画面のまま（入口が渡す）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { GripVertical, ImagePlus, Plus, Send, X } from 'lucide-react'
import type { Folder, MediaItem } from '@line-crm/shared'
import { api } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Dialog from '@/components/shared/dialog'
import ActionMenu from '@/components/shared/action-menu'
import ReorderHandle, { useReorder } from '@/components/shared/reorder-handle'
import Combobox from '@/components/shared/combobox'
import DateTimeField from '@/components/shared/date-time-field'
import LinePreview from '@/components/shared/line-preview'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import FolderSelect, { folderByName, folderCreator, hostFolderCreate } from '@/components/shared/folder-select'
import { TextField } from '@/components/shared/text-field'
import Toggle from '@/components/shared/toggle'
import { notifyToast } from '@/components/shared/toast'
import InlineActionRowsV8 from '@/components/auto-replies/inline-action-rows-v8'
import { useActionOptions } from '@/components/auto-replies/inline-action-list'
import { toActionPayload, type InlineAction } from '@/components/auto-replies/draft-fields'
import { TemplateEditFrame } from './frame'
import type { TemplateEditHost } from './host'
import MediaPickerDialog from './media-picker'
import styles from './edit.module.css'

export type AssetKind = 'coupon' | 'research'

/* 今の画面と同じ値（template-asset-editor.tsx から写した）。 */
const META: Record<AssetKind, { title: string; heading: string; lead: string; board: string; folder: string }> = {
  coupon: { title: 'クーポン', heading: 'クーポンを作る', lead: '期間・回数・抽選を決めて配る', board: 'S6FEuB', folder: '03_販促・クーポン' },
  research: { title: 'リサーチ', heading: 'リサーチを作る', lead: 'LINEの中で答える短い質問。住所や画像も聞くなら回答フォーム', board: 'EsYo4', folder: '02_健康フォロー' },
}
export const MAX_QUESTIONS = 10
/** LINE のクイックリプライは13件まで。 */
export const MAX_CHOICES = 13
type ResearchFormat = 'single' | 'multiple' | 'free'
const FORMAT_OPTIONS: Array<{ value: ResearchFormat; label: string }> = [
  { value: 'single', label: '1つだけ選ぶ' },
  { value: 'multiple', label: 'いくつでも選ぶ' },
  { value: 'free', label: '自由に書く' },
]
export interface ResearchQuestion { key: string; text: string; format: ResearchFormat; required: boolean; choices: string[] }
const newQuestion = (): ResearchQuestion => ({ key: crypto.randomUUID(), text: '', format: 'single', required: true, choices: ['', ''] })
const visualQuestions = (): ResearchQuestion[] => [
  { key: 'vq-1', text: '来月も定期便を続けたいと思いますか？', format: 'single', required: true, choices: ['続けたい', 'どちらともいえない', '止めたい'] },
  { key: 'vq-2', text: 'よく使っている商品を教えてください', format: 'multiple', required: false, choices: ['フード', 'おやつ', 'ケア用品'] },
  { key: 'vq-3', text: '改善してほしいところがあれば教えてください', format: 'free', required: false, choices: [] },
]

/** 保存してある payload（クーポン・リサーチ）を欄の値に戻す。統括の編集で使う（host.initialContent）。 */
export function assetInitial(payload: Record<string, unknown>) {
  const str = (value: unknown) => (typeof value === 'string' ? value : '')
  const num = (value: unknown, fallback: string) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback)
  const questions = Array.isArray(payload.questions)
    ? payload.questions.flatMap((item): ResearchQuestion[] => {
      if (!item || typeof item !== 'object') return []
      const q = item as Record<string, unknown>
      const format: ResearchFormat = q.format === 'multiple' || q.format === 'free' ? q.format : 'single'
      return [{ key: crypto.randomUUID(), text: str(q.text), format, required: q.required !== false, choices: Array.isArray(q.choices) ? q.choices.map(str) : [] }]
    })
    : []
  return {
    description: str(payload.description),
    couponTitle: str(payload.title),
    imageUrl: str(payload.imageUrl),
    couponOnce: payload.oncePerFriend === false ? 'unlimited' as const : 'once' as const,
    couponVisibility: payload.visibility === 'link' ? 'link' as const : 'friends' as const,
    lottery: payload.lottery === true,
    lotteryRate: num(payload.lotteryRate, '20'),
    winnerLimit: num(payload.winnerLimit, '500'),
    startsAt: str(payload.startsAt),
    endsAt: str(payload.endsAt),
    questions,
  }
}

/** `2026-08-01T00:00` → `8/1`（見本の札に出す短い日付）。 */
function shortDate(value: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(value)
  return m ? `${Number(m[1])}/${Number(m[2])}` : ''
}

export function couponPeriodLine(startsAt: string, endsAt: string, once: boolean): string {
  const period = startsAt || endsAt ? `${shortDate(startsAt) || '未設定'}〜${shortDate(endsAt) || '未設定'}` : '期間 未設定'
  return `${period}・${once ? '1人1回' : '何回でも'}`
}

/**
 * `host` を渡すと、統括のテンプレートの入口から同じ画面を使う（host.ts）。保存は呼ぶ側、主ボタンは［保存して配る］、
 * 店のアカウントに結びつく欄（登録メディア・行うこと・答えてもらう人）は出さない。
 */
export default function TemplateAssetEditor({ kind, visual = false, host }: { kind: AssetKind; visual?: boolean; host?: TemplateEditHost }) {
  const meta = META[kind]
  const router = useRouter()
  const role = useStaffRole()
  const canMutate = host ? !host.readOnly : role === null || canManageRole(role)
  const { selectedAccountId, accounts } = useAccount()
  usePageTitle(host ? 'テンプレート' : meta.heading)
  const actionOptions = useActionOptions()

  /* 統括の編集：保存してある payload から欄を埋める（同じ形で保存し直す）。 */
  const init = host?.initialContent && host.initialContent.kind === kind && 'payload' in host.initialContent ? { name: host.initialContent.name, ...assetInitial(host.initialContent.payload) } : null
  const [name, setName] = useState(init ? init.name : visual ? (kind === 'coupon' ? '夏の20%オフ' : '定期便のご満足度') : '')
  const [folder, setFolder] = useState(visual ? meta.folder : '')
  const [folders, setFolders] = useState<Folder[]>([])
  const [description, setDescription] = useState(init ? init.description : visual ? (kind === 'coupon' ? '会計時にこの画面をご提示ください。他の割引との併用はできません。' : 'いつもありがとうございます。3問だけ聞かせてください。') : '')
  // クーポン
  const [couponTitle, setCouponTitle] = useState(init ? init.couponTitle : visual && kind === 'coupon' ? '夏の20%オフ' : '')
  const [imageUrl, setImageUrl] = useState(init ? init.imageUrl : '')
  const [pickedMedia, setPickedMedia] = useState<MediaItem | null>(null)
  const [imageOpen, setImageOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [couponOnce, setCouponOnce] = useState<'once' | 'unlimited'>(init ? init.couponOnce : 'once')
  const [couponVisibility, setCouponVisibility] = useState<'friends' | 'link'>(init ? init.couponVisibility : 'friends')
  const [lottery, setLottery] = useState(init ? init.lottery : false)
  const [lotteryRate, setLotteryRate] = useState(init ? init.lotteryRate : '20')
  const [winnerLimit, setWinnerLimit] = useState(init ? init.winnerLimit : '500')
  const [couponStartsAt, setCouponStartsAt] = useState(init ? init.startsAt : visual ? '2026-08-01T00:00' : '')
  const [couponEndsAt, setCouponEndsAt] = useState(init ? init.endsAt : visual ? '2026-08-31T23:59' : '')
  const [couponUseActions, setCouponUseActions] = useState<InlineAction[]>([])
  // リサーチ
  const [researchStartsAt, setResearchStartsAt] = useState(init ? init.startsAt : visual ? '2026-10-01T10:00' : '')
  const [researchEndsAt, setResearchEndsAt] = useState(init ? init.endsAt : visual ? '2026-10-15T23:59' : '')
  const [targetTagId, setTargetTagId] = useState('')
  const [questions, setQuestions] = useState<ResearchQuestion[]>(() => (init?.questions.length ? init.questions : visual ? visualQuestions() : [newQuestion()]))
  const [answerActions, setAnswerActions] = useState<InlineAction[]>([])
  const [orderMenu, setOrderMenu] = useState<string | null>(null)
  const orderAnchor = useRef<HTMLButtonElement | null>(null)

  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (host) return
    setPickedMedia(null)
    setImageUrl('')
    // 統括では上のバーのアカウントに結びつかない（編集で読み込んだ画像を消さない）。
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

  const snapshot = useMemo(() => JSON.stringify({
    name, folder, description, couponTitle, imageUrl, pickedMedia, couponOnce, couponVisibility, lottery, lotteryRate, winnerLimit,
    couponStartsAt, couponEndsAt, couponUseActions, researchStartsAt, researchEndsAt, targetTagId, questions, answerActions,
  }), [name, folder, description, couponTitle, imageUrl, pickedMedia, couponOnce, couponVisibility, lottery, lotteryRate, winnerLimit, couponStartsAt, couponEndsAt, couponUseActions, researchStartsAt, researchEndsAt, targetTagId, questions, answerActions])
  const [clean, setClean] = useState(() => snapshot)
  const dirty = snapshot !== clean && !saved
  const { leaveTarget, confirmLeave, cancelLeave, disarm } = useUnsavedGuard({ dirty, busy: saving || publishing })

  const updateQuestion = (index: number, patch: Partial<ResearchQuestion>) =>
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)))
  /*
   * 質問の並べ替え（共通の並び替え）。つまみのドラッグ・上下キー・つまみを押して出る
   * 「上へ／下へ」は同じ入口を通る（押して出す並べ替えは、ドラッグできない人の代わりの操作）。
   */
  const questionOrder = useReorder({
    items: questions,
    idOf: (question) => question.key,
    disabledReason: questions.length < 2 ? '質問が1つのときは並び替えできません' : null,
    onReorder: ({ ids }) => setQuestions((prev) => {
      const byKey = new Map(prev.map((q) => [q.key, q]))
      const next = ids.map((key) => byKey.get(key)).filter((q): q is ResearchQuestion => Boolean(q))
      return next.length === prev.length ? next : prev
    }),
  })

  /** 保存値を組み立てる。足りないときは理由を返す（今の画面と同じ決まり）。 */
  const buildPayload = (): { payload: Record<string, unknown> } | { error: string } => {
    if (kind === 'coupon') {
      if (!couponStartsAt || !couponEndsAt) return { error: '使える期間の開始と終了を入力してください。' }
      if (couponEndsAt <= couponStartsAt) return { error: '使える期間の終了は開始よりあとにしてください。' }
      if (lottery) {
        const rate = Number(lotteryRate)
        const limit = Number(winnerLimit)
        if (!Number.isInteger(rate) || rate < 1 || rate > 100) return { error: '当たる確率は1〜100の整数で入力してください。' }
        if (!Number.isInteger(limit) || limit < 1) return { error: '当選人数の上限は1以上の整数で入力してください。' }
      }
      return {
        payload: {
          ...(couponTitle.trim() ? { title: couponTitle.trim() } : {}),
          description,
          imageUrl,
          imageMediaId: pickedMedia?.id ?? null,
          imageMediaKind: pickedMedia?.kind ?? null,
          startsAt: couponStartsAt,
          endsAt: couponEndsAt,
          oncePerFriend: couponOnce === 'once',
          visibility: couponVisibility,
          lottery,
          ...(lottery ? { lotteryRate: Number(lotteryRate), winnerLimit: Number(winnerLimit) } : {}),
          useActions: couponUseActions.map(toActionPayload),
        },
      }
    }
    if (questions.length === 0) return { error: '質問を1つ以上作ってください。' }
    for (const [index, question] of questions.entries()) {
      if (!question.text.trim()) return { error: `質問 ${index + 1} の本文を入力してください。` }
      if (question.format !== 'free' && question.choices.filter((choice) => choice.trim()).length < 1) {
        return { error: `質問 ${index + 1} の選択肢を1つ以上入力してください。` }
      }
    }
    return {
      payload: {
        description,
        startsAt: researchStartsAt || null,
        endsAt: researchEndsAt || null,
        targetTagId: targetTagId || null,
        questions: questions.map((question) => ({
          text: question.text.trim(),
          format: question.format,
          required: question.required,
          choices: question.format === 'free' ? [] : question.choices.map((choice) => choice.trim()).filter(Boolean),
        })),
        questionCount: questions.length,
        answerActions: answerActions.map(toActionPayload),
      },
    }
  }

  const save = async (): Promise<boolean> => {
    if (host) return false
    if (!selectedAccountId) { setError('上のバーでLINE公式アカウントを選んでください。'); return false }
    if (!name.trim()) { setError(`${meta.title}名を入力してください。`); return false }
    const built = buildPayload()
    if ('error' in built) { setError(built.error); return false }
    setSaving(true)
    setError('')
    try {
      const result = await api.broadcastMessageAssets.create({
        lineAccountId: selectedAccountId,
        kind,
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

  /* 統括の入口：中身を組み立てて呼ぶ側へ渡す（保存・配る・失敗の知らせは呼ぶ側）。 */
  const hostSave = (distribute: boolean) => {
    if (!host) return
    if (!name.trim()) { setError(`${meta.title}名を入力してください。`); return }
    const built = buildPayload()
    if ('error' in built) { setError(built.error); return }
    setError('')
    setClean(snapshot)
    host.onSave({ kind, name: name.trim(), payload: built.payload }, distribute)
  }
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
  const busy = saving || publishing || Boolean(host?.busy)
  const imageSet = /^https?:\/\//.test(imageUrl.trim())

  const sideCard = kind === 'coupon' ? (
    <section className={styles.sideCard}>
      <h2 className={styles.sideTitle}>公開したあとに見られる数</h2>
      <dl className={styles.statList}>
        <div className={styles.statRow}><dt>配った数</dt><dd>—</dd></div>
        <div className={styles.statRow}><dt>使われた数</dt><dd>—</dd></div>
        <div className={styles.statRow}><dt>当選した数</dt><dd>{lottery ? '—' : '抽選なし'}</dd></div>
      </dl>
    </section>
  ) : (
    <section className={styles.sideCard}>
      <h2 className={styles.sideTitle}>回答フォームとの使い分け</h2>
      <p className={styles.sideText}>リサーチはLINEの中で完結する短い質問向けです。住所や画像も聞く場合は回答フォームを使います。</p>
    </section>
  )

  const phone = (
    <LinePreview title={null} note={`${meta.title}の見え方`} caption="配信日 10:00" accountName={sendName}>
      <div className={styles.assetRow}>
        <span className={styles.assetAvatar} aria-hidden="true">{sendName.slice(0, 1)}</span>
        <div className={styles.assetCard}>
          {kind === 'coupon' ? (
            <>
              <div className={styles.assetImage}>
                {imageSet ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl.trim()} alt="" />
                ) : <span>{couponTitle || name || 'クーポン'}</span>}
              </div>
              <div className={styles.assetBody}>
                <p className={styles.assetTitle}>{couponTitle || name || 'クーポン名'}</p>
                <p className={styles.assetSub}>{couponPeriodLine(couponStartsAt, couponEndsAt, couponOnce === 'once')}</p>
              </div>
              <p className={styles.assetAction}>クーポンを使う</p>
            </>
          ) : (
            <>
              <div className={styles.assetBody}>
                <p className={styles.assetTitle}>{`${name || 'リサーチ名'}（${questions.length}問）`}</p>
                <p className={styles.assetSub}>{researchEndsAt ? `${shortDate(researchEndsAt)} まで` : '受付の終わり 未設定'}</p>
              </div>
              <p className={styles.assetAction}>答える</p>
            </>
          )}
        </div>
      </div>
    </LinePreview>
  )

  if (!canMutate) {
    return (
      <TemplateEditFrame
        boardId={meta.board}
        title={meta.heading}
        description={meta.lead}
        band={<p className={styles.readonly} role="status">閲覧のみ：テンプレートの作成・変更はオーナーと管理者だけができます。</p>}
        side={sideCard}
      >
        <Card padding="none" layout="vertical" className={styles.card}>
          <p className={styles.cardNote}>中身の確認は一覧の行を開くと読めます。</p>
        </Card>
      </TemplateEditFrame>
    )
  }

  const nameCard = (
    <Card padding="none" layout="vertical" className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>名前とフォルダ</h2>
      </div>
      <div className={styles.pair}>
        <div className={`${styles.field} ${styles.grow}`}>
          <label htmlFor={`te-${kind}-name`} className={styles.label}>テンプレート名</label>
          <TextField id={`te-${kind}-name`} value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === 'coupon' ? '例：夏の20%オフ' : '例：定期便のご満足度'} aria-required="true" />
        </div>
        <div className={`${styles.field} ${styles.folderField}`}>
          <label htmlFor={`te-${kind}-folder`} className={styles.labelSmall}>フォルダ</label>
          <FolderSelect
            id={`te-${kind}-folder`}
            aria-label="フォルダ"
            value={host ? host.folder : folder}
            onChange={host ? host.onFolderChange : setFolder}
            folders={host ? host.folders : folders.map(folderByName)}
            colors
            onCreate={host
              ? hostFolderCreate(host)
              : canMutate && selectedAccountId
                ? folderCreator((name, color) => api.folders.create({ kind: 'template', name, color, accountId: selectedAccountId }), folderByName, (created) => setFolders((current) => [...current, created]))
                : undefined}
          />
        </div>
      </div>
    </Card>
  )

  return (
    <>
      <TemplateEditFrame
        boardId={meta.board}
        title={meta.heading}
        description={meta.lead}
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
        {saved ? <p role="status" className={styles.readonly}>保存しました。一覧へ戻ると、{meta.title}の一覧に出ています。</p> : null}
        {nameCard}

        {kind === 'coupon' ? (
          <>
            <Card padding="none" layout="vertical" className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>中身</h2>
              </div>
              <div className={styles.couponRow}>
                <button type="button" className={styles.couponImage} onClick={() => setImageOpen(true)} aria-label="クーポンの画像を選ぶ" title="クーポンの画像（任意・1029 × 1029px 推奨）">
                  {imageSet ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl.trim()} alt="" />
                  ) : (
                    <span className={styles.couponImageEmpty}><ImagePlus size={18} aria-hidden="true" />画像を選ぶ</span>
                  )}
                </button>
                <div className={styles.couponFields}>
                  <div className={styles.field}>
                    <label htmlFor="te-coupon-title" className={styles.label}>クーポン名</label>
                    <TextField id="te-coupon-title" value={couponTitle} onChange={(event) => setCouponTitle(event.target.value)} placeholder={name || '例：夏の20%オフ'} />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="te-coupon-desc" className={styles.label}>使うときの説明</label>
                    <TextField id="te-coupon-desc" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="例：会計時にこの画面をご提示ください。" />
                  </div>
                </div>
              </div>
            </Card>

            <Card padding="none" layout="vertical" className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>使える期間と回数</h2>
                <p className={styles.cardNote}>この管理画面の時刻（日本時間）で入ります</p>
              </div>
              <div className={styles.pair}>
                <div className={`${styles.field} ${styles.grow}`}>
                  <label htmlFor="te-coupon-start" className={styles.label}>開始</label>
                  <DateTimeField className={styles.dateBox} id="te-coupon-start" value={couponStartsAt} onChange={setCouponStartsAt} aria-label="使える期間の開始" required />
                </div>
                <span className={styles.tilde} aria-hidden="true">〜</span>
                <div className={`${styles.field} ${styles.grow}`}>
                  <label htmlFor="te-coupon-end" className={styles.label}>終了</label>
                  <DateTimeField className={styles.dateBox} id="te-coupon-end" value={couponEndsAt} onChange={setCouponEndsAt} aria-label="使える期間の終了" required />
                </div>
              </div>
              <div className={styles.typeRow}>
                <span className={styles.labelSmall}>1人が使える回数</span>
                <SegmentedControl
                  aria-label="1人が使える回数"
                  options={[{ value: 'once' as const, label: '1人1回だけ' }, { value: 'unlimited' as const, label: '期間中なら何回でも' }]}
                  value={couponOnce}
                  onChange={setCouponOnce}
                />
              </div>
              <div className={styles.typeRow}>
                <span className={styles.labelSmall}>受け取れる人</span>
                <SegmentedControl
                  aria-label="受け取れる人"
                  options={[{ value: 'friends' as const, label: '友だちだけ' }, { value: 'link' as const, label: 'リンクを知っている人' }]}
                  value={couponVisibility}
                  onChange={setCouponVisibility}
                />
              </div>
            </Card>

            <Card padding="none" layout="vertical" className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>抽選</h2>
              </div>
              <div className={styles.toggleRow}>
                <span className={styles.toggleLabel}>抽選する</span>
                <span className={styles.spacer} />
                <Toggle checked={lottery} label="抽選する" onChange={setLottery} />
              </div>
              {lottery ? (
                <div className={styles.pair}>
                  <div className={`${styles.field} ${styles.grow}`}>
                    <label htmlFor="te-lottery-rate" className={styles.label}>当たる確率（%）</label>
                    <TextField id="te-lottery-rate" type="number" min={1} max={100} value={lotteryRate} onChange={(event) => setLotteryRate(event.target.value)} />
                  </div>
                  <div className={`${styles.field} ${styles.grow}`}>
                    <label htmlFor="te-winner-limit" className={styles.label}>当選人数の上限（人）</label>
                    <TextField id="te-winner-limit" type="number" min={1} value={winnerLimit} onChange={(event) => setWinnerLimit(event.target.value)} />
                  </div>
                </div>
              ) : (
                <p className={styles.cardNote}>抽選しないときは、受け取った人全員に配ります。</p>
              )}
            </Card>

            {host ? null : (
              <Card padding="none" layout="vertical" className={styles.card}>
                <div className={styles.cardHead}>
                  <h2 className={styles.cardTitle}>使われたときに行うこと</h2>
                </div>
                <InlineActionRowsV8 actions={couponUseActions} onChange={setCouponUseActions} {...actionOptions} />
              </Card>
            )}
          </>
        ) : (
          <>
            <Card padding="none" layout="vertical" className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>受付</h2>
              </div>
              <div className={styles.pair}>
                <div className={`${styles.field} ${styles.grow}`}>
                  <label htmlFor="te-research-start" className={styles.label}>受付の開始</label>
                  <DateTimeField className={styles.dateBox} id="te-research-start" value={researchStartsAt} onChange={setResearchStartsAt} aria-label="受付の開始" />
                </div>
                <span className={styles.tilde} aria-hidden="true">〜</span>
                <div className={`${styles.field} ${styles.grow}`}>
                  <label htmlFor="te-research-end" className={styles.label}>受付の終了</label>
                  <DateTimeField className={styles.dateBox} id="te-research-end" value={researchEndsAt} onChange={setResearchEndsAt} aria-label="受付の終了" />
                </div>
              </div>
              <div className={styles.field}>
                <label htmlFor="te-research-greeting" className={styles.label}>はじめのあいさつ</label>
                <TextField id="te-research-greeting" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="例：いつもありがとうございます。3問だけ聞かせてください。" />
              </div>
            </Card>

            <Card padding="none" layout="vertical" className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>質問（上から順に出ます）</h2>
              </div>
              {questionOrder.shown.map((question, index) => (
                <section key={question.key} className={styles.question} aria-label={`問 ${index + 1}`} {...questionOrder.rowProps(question.key)}>
                  <div className={styles.toggleRow}>
                    <ReorderHandle
                      look="bare"
                      className={styles.grip}
                      label={`問 ${index + 1}`}
                      ariaLabel={`問 ${index + 1} の並びを変える。ドラッグ・上下キー・押して上へ／下へ`}
                      aria-haspopup="menu"
                      aria-expanded={orderMenu === question.key}
                      onClick={(event) => { orderAnchor.current = event.currentTarget; setOrderMenu(orderMenu === question.key ? null : question.key) }}
                      {...questionOrder.handle(question.key)}
                      {...questionOrder.handleProps(question.key)}
                    >
                      <GripVertical size={14} aria-hidden="true" />
                    </ReorderHandle>
                    <span className={styles.questionNo}>問 {index + 1}</span>
                    <span className={styles.spacer} />
                    <span className={styles.toggleLabelSmall}>必ず答えてもらう</span>
                    <Toggle checked={question.required} label={`問 ${index + 1} を必ず答えてもらう`} onChange={(checked) => updateQuestion(index, { required: checked })} />
                    <button
                      type="button"
                      className={`${styles.insertChip} ${styles.questionRemove}`}
                      disabled={questions.length <= 1}
                      title={questions.length <= 1 ? '質問は1つ必要です' : `問 ${index + 1} を消す`}
                      aria-label={`問 ${index + 1} を消す`}
                      onClick={() => setQuestions((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))}
                    >
                      消す
                    </button>
                  </div>
                  <div className={styles.pair}>
                    <div className={`${styles.field} ${styles.grow}`}>
                      <label htmlFor={`te-q-${question.key}`} className={styles.label}>質問文</label>
                      <TextField id={`te-q-${question.key}`} value={question.text} onChange={(event) => updateQuestion(index, { text: event.target.value })} placeholder="例：来月も続けたいと思いますか？" aria-required="true" />
                    </div>
                    <div className={`${styles.field} ${styles.formatField}`}>
                      <label htmlFor={`te-qf-${question.key}`} className={styles.labelSmall}>答え方</label>
                      <Select id={`te-qf-${question.key}`} aria-label={`問 ${index + 1} の答え方`} value={question.format} onChange={(value) => updateQuestion(index, { format: value as ResearchFormat })} options={FORMAT_OPTIONS} />
                    </div>
                  </div>
                  {question.format !== 'free' ? (
                    <div className={styles.choiceRow} role="group" aria-label={`問 ${index + 1} の選択肢`}>
                      {question.choices.map((choice, choiceIndex) => (
                        <span key={choiceIndex} className={styles.choice}>
                          <input
                            className={styles.choiceInput}
                            value={choice}
                            placeholder={`選択肢 ${choiceIndex + 1}`}
                            aria-label={`問 ${index + 1} の選択肢 ${choiceIndex + 1}`}
                            onChange={(event) => updateQuestion(index, { choices: question.choices.map((c, i) => (i === choiceIndex ? event.target.value : c)) })}
                          />
                          {question.choices.length > 1 ? (
                            <button
                              type="button"
                              className={styles.choiceRemove}
                              aria-label={`問 ${index + 1} の選択肢 ${choiceIndex + 1} を消す`}
                              onClick={() => updateQuestion(index, { choices: question.choices.filter((_, i) => i !== choiceIndex) })}
                            >
                              <X size={12} aria-hidden="true" />
                            </button>
                          ) : null}
                        </span>
                      ))}
                      {question.choices.length < MAX_CHOICES ? (
                        <button type="button" className={styles.insertChip} onClick={() => updateQuestion(index, { choices: [...question.choices, ''] })}>
                          <Plus size={15} aria-hidden="true" />
                          選択肢を足す
                        </button>
                      ) : (
                        <span className={styles.hint}>選択肢は{MAX_CHOICES}つまでです（LINEの決まり）。</span>
                      )}
                    </div>
                  ) : null}
                </section>
              ))}
              <div>
                <button
                  type="button"
                  className={styles.insertChip}
                  disabled={questions.length >= MAX_QUESTIONS}
                  title={questions.length >= MAX_QUESTIONS ? `質問は${MAX_QUESTIONS}問までです` : `あと${MAX_QUESTIONS - questions.length}問足せます`}
                  onClick={() => setQuestions((prev) => (prev.length >= MAX_QUESTIONS ? prev : [...prev, newQuestion()]))}
                >
                  <Plus size={15} aria-hidden="true" />
                  質問を足す
                </button>
              </div>
            </Card>

            {host ? null : (
            <>
            <Card padding="none" layout="vertical" className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>答え終わったときに行うこと</h2>
              </div>
              <InlineActionRowsV8 actions={answerActions} onChange={setAnswerActions} {...actionOptions} />
            </Card>

            <Card padding="none" layout="vertical" className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>答えてもらう人</h2>
                <p className={styles.cardNote}>タグで絞れます。選ばなければ全員が対象です。</p>
              </div>
              <Combobox
                aria-label="答えてもらう人"
                placeholder="友だち全員"
                value={targetTagId}
                onChange={setTargetTagId}
                options={actionOptions.tags.map((tag) => ({ value: tag.id, label: tag.name }))}
              />
            </Card>
            </>
            )}
          </>
        )}
      </TemplateEditFrame>

      <ActionMenu
        open={orderMenu !== null}
        anchorRef={orderAnchor}
        ariaLabel="質問の並びを変える"
        onClose={() => setOrderMenu(null)}
        items={orderMenu ? questionOrder.menuItems(orderMenu, () => setOrderMenu(null)).map((item) => ({ ...item, id: item.id === 'move-up' ? 'up' : 'down', disabledReason: undefined })) : []}
      />

      <Dialog open={previewOpen} title="LINEでの見え方" cancelLabel="閉じる" onCancel={() => setPreviewOpen(false)}>
        <div className={styles.previewDialog}>{phone}</div>
      </Dialog>

      <Dialog
        open={imageOpen}
        title="クーポンの画像"
        description="任意です。1029 × 1029px がおすすめです。"
        cancelLabel="閉じる"
        onCancel={() => setImageOpen(false)}
      >
        <div className={styles.imageDialog}>
          {host ? null : <Button type="button" onClick={() => setPickerOpen(true)}>登録メディアから選ぶ</Button>}
          {pickedMedia ? <p className={styles.hint}>選択中：{pickedMedia.filename}</p> : null}
          <TextField
            value={imageUrl}
            onChange={(event) => { setImageUrl(event.target.value); setPickedMedia(null) }}
            placeholder="画像URL"
            aria-label="クーポン画像のURL"
          />
          {imageUrl ? <Button type="button" variant="text" onClick={() => { setImageUrl(''); setPickedMedia(null) }}>画像を外す</Button> : null}
        </div>
      </Dialog>

      <MediaPickerDialog
        open={pickerOpen}
        accountId={selectedAccountId}
        kind="image"
        onClose={() => setPickerOpen(false)}
        onSelect={(item) => { setImageUrl(item.url); setPickedMedia(item); setPickerOpen(false) }}
      />

      <UnsavedLeaveDialog open={leaveTarget !== null} subject={`${meta.title}の変更`} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </>
  )
}
