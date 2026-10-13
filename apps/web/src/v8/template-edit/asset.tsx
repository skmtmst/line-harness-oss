'use client'

import { SettingsFormRow } from '@/components/shared/settings-form-card'
import Toggle from '@/components/shared/toggle'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import { createPageReturnHref } from '@/components/shared/create-page'
import { notifySaved } from '@/components/shared/toast'
import { useFeatureAccess } from '@/lib/use-feature-access'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import { GripVertical, Plus, Send, X } from 'lucide-react'
import { tapExtrasError, type TapExtras, type Folder, type MediaItem } from '@line-crm/shared'
import { tapExtraSaveError } from '@/lib/tap-actions'
import { api } from '@/lib/api'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import TapExtrasField from '@/components/shared/tap-extras-field'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import Card from '@/components/shared/card'
import ActionMenu from '@/components/shared/action-menu'
import ReorderHandle, { useReorder } from '@/components/shared/reorder-handle'
import Combobox from '@/components/shared/combobox'
import DateTimeField from '@/components/shared/date-time-field'
import LinePreview from '@/components/shared/line-preview'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import FolderSelect, { folderByName, folderCreator, hostFolderCreate } from '@/components/shared/folder-select'
import { TextField } from '@/components/shared/text-field'
import { SettingCheckbox } from '@/components/shared/checkbox'
import InlineActionRowsV8 from '@/components/auto-replies/inline-action-rows-v8'
import { useActionOptions } from '@/components/auto-replies/inline-action-list'
import { readInlineActions, toActionPayload, type InlineAction } from '@/components/auto-replies/draft-fields'
import { TemplateEditFrame } from './frame'
import type { TemplateEditHost } from './host'
import MediaPickerDialog from '@/components/shared/media-picker-dialog'
import MediaSlot from '@/components/shared/media-slot'
import { FieldError, Field } from '@/components/shared/form-controls'
import { useFormErrors } from '@/lib/use-form-errors'
import { uploadToMediaLibrary } from '@/components/shared/media-library-upload'
import styles from './edit.module.css'
import { emptyValue } from '@/components/shared/empty-value'
import NumberInput from '@/components/shared/number-field'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import ImageFrame from '@/components/shared/image-frame'
import EntitySelect, { entityOptionMetadata } from '@/components/shared/entity-select'
import { SettingsFormRow } from '@/components/shared/settings-form-card'

/*
 * ★V8「クーポンを作る」（絵 S6FEuB）・「リサーチを作る」（絵 EsYo4）。
 *
 * 保存は今の画面（app/templates/asset-editor-v8.tsx・template-asset-editor.tsx）と
 * 同じ口（POST /api/broadcast-message-assets）・同じ形の payload。違いは置き場と
 * 見せ方だけ（BEHAVIOR.md）。リッチメッセージは今の画面のまま（入口が渡す）。
 */

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
export interface ResearchQuestion { key: string; text: string; format: ResearchFormat; required: boolean; choices: string[]; choiceTapExtras?: TapExtras[] }
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
      return [{ key: crypto.randomUUID(), text: str(q.text), format, choiceTapExtras: Array.isArray(q.choiceTapExtras) ? q.choiceTapExtras as TapExtras[] : [], required: q.required !== false, choices: Array.isArray(q.choices) ? q.choices.map(str) : [] }]
    })
    : []
  return {
    tapExtras: payload.tapExtras as TapExtras | undefined,
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
  const period = startsAt || endsAt ? `${shortDate(startsAt) || emptyValue('unconfigured')}〜${shortDate(endsAt) || emptyValue('unconfigured')}` : '期間 未設定'
  return `${period}・${once ? '1人1回' : '何回でも'}`
}

/**
 * `host` を渡すと、統括のテンプレートの入口から同じ画面を使う（host.ts）。保存は呼ぶ側、主ボタンは［保存して配る］、
 * 店のアカウントに結びつく欄（登録メディア・行うこと・答えてもらう人）は出さない。
 */
export default function TemplateAssetEditor({ kind, visual = false, host }: { kind: AssetKind; visual?: boolean; host?: TemplateEditHost }) {
  const saveErrors = useSaveFormErrors()
  const meta = META[kind]
  const router = useRouter()
  const role = useStaffRole()
  const featureAccess = useFeatureAccess('templates')
  const canMutate = host ? !host.readOnly : featureAccess
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
  const [tapExtras, setTapExtras] = useState<TapExtras | undefined>(init?.tapExtras)
  const [pickedMedia, setPickedMedia] = useState<MediaItem | null>(null)
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
  const [targetTagId, setTargetTagId] = useState(() => host?.initialContent && 'payload' in host.initialContent && typeof host.initialContent.payload.targetTagId === 'string' ? host.initialContent.payload.targetTagId : '')
  const [questions, setQuestions] = useState<ResearchQuestion[]>(() => (init?.questions.length ? init.questions : visual ? visualQuestions() : [newQuestion()]))
  const [answerActions, setAnswerActions] = useState<InlineAction[]>(() => readInlineActions(host?.initialContent && 'payload' in host.initialContent ? host.initialContent.payload.answerActions as unknown[] | undefined : undefined))
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
    tapExtras, name, folder, description, couponTitle, imageUrl, pickedMedia, couponOnce, couponVisibility, lottery, lotteryRate, winnerLimit,
    couponStartsAt, couponEndsAt, couponUseActions, researchStartsAt, researchEndsAt, targetTagId, questions, answerActions,
  }), [tapExtras, name, folder, description, couponTitle, imageUrl, pickedMedia, couponOnce, couponVisibility, lottery, lotteryRate, winnerLimit, couponStartsAt, couponEndsAt, couponUseActions, researchStartsAt, researchEndsAt, targetTagId, questions, answerActions])
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

  /*
   * 保存で落ちた欄（B-139）：帯ではなく欄を赤くし、真下に理由を出して1つ目へ移る。
   * 組み立て（buildPayload）の決まりと同じ中身を欄ごとに持つ。
   */
  const fields = useFormErrors()
  fields.define('name', 'テンプレート名', () => (name.trim() ? null : `${meta.title}名を入力してください`), { required: true })
  if (kind === 'coupon') {
    fields.define('tapExtras', 'ボタンの追加処理', () => tapExtrasError(tapExtras))
    fields.define('start', '使える期間の開始', () => (couponStartsAt ? null : '開始を入力してください'), { required: true })
    fields.define('end', '使える期間の終了', () => (!couponEndsAt ? '終了を入力してください' : couponStartsAt && couponEndsAt <= couponStartsAt ? '終了は開始よりあとにしてください' : null), { required: true })
    if (lottery) {
      fields.define('rate', '当たる確率', () => { const rate = Number(lotteryRate); return Number.isInteger(rate) && rate >= 1 && rate <= 100 ? null : '1〜100の整数で入力してください' }, { required: true })
      fields.define('limit', '当選人数の上限', () => { const limit = Number(winnerLimit); return Number.isInteger(limit) && limit >= 1 ? null : '1以上の整数で入力してください' }, { required: true })
    }
  } else {
    questions.forEach((question, index) => {
      fields.define(`q-${question.key}`, `質問 ${index + 1} の本文`, () => (question.text.trim() ? null : '質問文を入力してください'), { required: true })
      if (question.format !== 'free') fields.define(`qc-${question.key}`, `質問 ${index + 1} の選択肢`, () => (question.choices.some((choice) => choice.trim()) ? null : '選択肢を1つ以上入力してください'), { required: true })
      if (question.format !== 'free') question.choices.forEach((_, ci) => fields.define(`extra-${question.key}-${ci}`, `質問 ${index + 1} の選択肢 ${ci + 1} の追加処理`, () => tapExtrasError(question.choiceTapExtras?.[ci])))
    })
  }
  const fieldProps = (key: string, id: string) => ({ ...fields.bind(key), invalid: fields.invalid(key), 'aria-describedby': fields.invalid(key) ? `${id}-error` : undefined })

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
          tapExtras,
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
          choiceTapExtras: question.format === 'free' ? [] : question.choices.flatMap((choice, ci) => choice.trim() ? [question.choiceTapExtras?.[ci] ?? {}] : []),
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

  const save = async (): Promise<string | false> => {
    if (host) return false
    if (!selectedAccountId) { setError('上のバーでLINE公式アカウントを選んでください。'); return false }
    if (fields.submit().length > 0) { setError(''); return false }
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
      return result.data.id
    } catch (caught) {
      const extraError = tapExtraSaveError(caught)
      if (extraError) {
        if (kind === 'coupon') fields.fail('tapExtras', extraError)
        else fields.setServerErrors(Object.fromEntries(questions.flatMap(q => q.choices.map((_, ci) => [`extra-${q.key}-${ci}`, extraError]))))
        return false
      }
      setError('保存できませんでした。通信状態を確認して、もう一度お試しください。')
      return false
    } finally {
      setSaving(false)
    }
  }

  /* 統括の入口：中身を組み立てて呼ぶ側へ渡す（保存・配る・失敗の知らせは呼ぶ側）。 */
  const hostSave = (distribute: boolean) => {
    if (!host) return
    if (fields.submit().length > 0) { setError(''); return }
    const built = buildPayload()
    if ('error' in built) { setError(built.error); return }
    setError('')
    setClean(snapshot)
    host.onSave({ kind, name: name.trim(), payload: built.payload }, distribute)
  }
  const onSaveDraft = async () => {
    if (host) { hostSave(false); return }
    const savedId = await save()
    if (savedId) { notifySaved('下書きを保存しました'); disarm(); router.push(createPageReturnHref('/templates', savedId)) }
  }
  const onPublish = async () => {
    if (host) { hostSave(true); return }
    setPublishing(true)
    try {
      const savedId = await save()
      if (savedId) {
        disarm()
        router.push(createPageReturnHref('/templates', savedId))
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
        <div className={styles.statRow}><dt>配った数</dt><dd>{emptyValue('unknown')}</dd></div>
        <div className={styles.statRow}><dt>使われた数</dt><dd>{emptyValue('unknown')}</dd></div>
        <div className={styles.statRow}><dt>当選した数</dt><dd>{lottery ? emptyValue('unknown') : '抽選なし'}</dd></div>
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
      <SaveErrorScope errors={saveErrors}><TemplateEditFrame
        boardId={meta.board}
        title={meta.heading}
        description={meta.lead}
        band={<ReadOnlyNotice>閲覧のみ：テンプレートの作成・変更はオーナーと管理者だけができます。</ReadOnlyNotice>}
        side={sideCard}
      >
        <Card layout="vertical" contentPadding="var(--tpl-section-pad)" gap="var(--polish-space-card)">
          <p className={styles.cardNote}>中身の確認は一覧の行を開くと読めます。</p>
        </Card>
      </TemplateEditFrame></SaveErrorScope>
    )
  }

  const nameCard = (
    <Card layout="vertical" contentPadding="var(--tpl-section-pad)" gap="var(--polish-space-card)">
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>名前とフォルダ</h2>
      </div>
      <SettingsFormRow layout="name-folder">
