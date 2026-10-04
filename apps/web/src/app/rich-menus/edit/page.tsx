'use client'

import DateTimeField from '@/components/shared/date-time-field'
import Select from '@/components/shared/select'
import Checkbox from '@/components/shared/checkbox'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import TargetMissing from '@/components/shared/target-missing'
import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { api, ApiError, describeSaveFailure } from '@/lib/api'
import { CanvasEditor, type Area } from '@/components/rich-menus/canvas-editor'
import { AreaProperties, intentOf } from '@/components/rich-menus/area-properties'
import type { RichMenuAreaTapCount, RichMenuTargetPreview, RichMenuScheduleInput } from '@/lib/api'
import ConditionBuilder from '@/components/shared/condition-builder'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import StickyBar from '@/components/shared/sticky-bar'
import type { SegmentCondition } from '@/lib/segment-condition'
import { usePageTitle } from '@/components/shell/page-chrome'
import { RICH_MENU_DIMENSIONS, type MediaItem } from '@line-crm/shared'
import MediaPickerDialog from '@/app/contents/media-picker-dialog'
import { datetimeLocalJstToUtcIso } from '@/lib/jst-datetime'
import { useScheduleSubmit } from './schedule-submit'
import { ManualPublishAttempt } from './manual-publish-attempt'
import {
  DEFAULT_PUBLISH_PLAN,
  clearPublishPlanDraft,
  loadPublishPlanDraft,
  savePublishPlanDraft,
  type PublishPlanInput,
} from './publish-plan-draft'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { PublishHistorySection } from './publish-history'
import { PublishProgressSection } from './publish-progress-section'
import { PrepublishCheckSection } from './prepublish-check-section'
import { TestApplySection } from './test-apply-section'
import { formatDateTime, formatNumber } from '@/lib/format'

/**
 * 保存されている条件を読む。
 *
 * 壊れた JSON は「条件なし」として扱う。ここで落とすと編集画面が開かなくなり、
 * 直すこともできなくなる。画面には「条件なし」に見えるが、保存し直すまで
 * 元の値は消えない。
 */
function parseStoredCondition(raw: string | null): SegmentCondition | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as SegmentCondition
  } catch {
    return null
  }
}

/*
 * 下書きとして送る面の形。persistDraft と同じ投影を使い、
 * 「保存済みの形」と「いま画面上にある形」の差分だけを未保存とみなす。
 * 画像はアップロード時点で保存済みなので署名には入れない。
 */
function projectAreaForDraft(a: Area) {
  return {
    id: a.id,
    boundsX: a.boundsX,
    boundsY: a.boundsY,
    boundsWidth: a.boundsWidth,
    boundsHeight: a.boundsHeight,
    actionType: a.actionType,
    actionData: a.actionData,
    intent: a.intent ?? null,
    label: a.label ?? null,
    tagIds: a.tagIds ?? null,
    scoreChange: a.scoreChange ?? null,
    templateId: a.templateId ?? null,
    formId: a.formId ?? null,
    trackedLinkId: a.trackedLinkId ?? null,
  }
}

function draftSignatureOf(fields: {
  name: string
  chatBarText: string
  isDefaultForAll: boolean
  targetingEnabled: boolean
  targetingPriority: number
  targetingCondition: SegmentCondition | null
  folderId: string
  pages: Page[]
}): string {
  return JSON.stringify({
    name: fields.name,
    chatBarText: fields.chatBarText,
    isDefaultForAll: fields.isDefaultForAll,
    targetingEnabled: fields.targetingEnabled,
    targetingPriority: fields.targetingPriority,
    targetingCondition: fields.targetingCondition ? JSON.stringify(fields.targetingCondition) : null,
    folderId: fields.folderId || null,
    pages: fields.pages.map((p, i) => ({
      id: p.id,
      name: p.name,
      orderIndex: i,
      areas: p.areas.map(projectAreaForDraft),
    })),
  })
}

type Page = {
  id: string
  orderIndex: number
  name: string
  aliasId: string
  lineRichmenuId: string | null
  imageR2Key: string | null
  imageContentType: string | null
  areas: Area[]
}

type Group = {
  id: string
  accountId: string
  name: string
  chatBarText: string
  size: 'large' | 'compact'
  defaultPageId: string | null
  isDefaultForAll: boolean
  status: 'draft' | 'published'
  publishingAt: string | null
  targetingCondition: string | null
  targetingPriority: number
  targetingEnabled: boolean
  /** 159: フォルダ。分けていなければ null。 */
  folderId: string | null
  /** M951: 読んだときの版。保存時に送り返し、古ければ 409 で止まる。 */
  version: number
  pages: Page[]
}

/** 右パネルのプルダウンに出す選択肢。 */
type PickerOption = { id: string; name: string }

const SIZE_LABEL: Record<Group['size'], string> = {
  large: `${RICH_MENU_DIMENSIONS.large.width}×${RICH_MENU_DIMENSIONS.large.height}`,
  compact: `${RICH_MENU_DIMENSIONS.compact.width}×${RICH_MENU_DIMENSIONS.compact.height}`,
}

/**
 * 画像エラーのサーバ原文（英語）を日本語に写す。利用者が次の一手を
 * 分かるように、形式・寸法・容量不足だけを定型文にする。
 */
function imageUploadErrorText(err: unknown): string {
  const fallback = '画像を読み込めませんでした。もう一度お試しください。'
  if (!(err instanceof ApiError)) return fallback
  const message = err.status === 400 && err.message && !/^API error: /.test(err.message)
    ? err.message
    : ''
  if (!message) return fallback
  if (message.includes('content-type must be image/png or image/jpeg')
    || message.includes('unrecognized image format')) {
    return '画像の形式はPNGかJPEGにしてください。'
  }
  if (message.includes('exceeds 1MB limit')) {
    return '画像が大きすぎます。1MB以下の画像を選んでください。'
  }
  if (message.includes('dimensions ')) {
    return `画像の大きさが合いません。${SIZE_LABEL.large}（大）か${SIZE_LABEL.compact}（小）の画像を選んでください。`
  }
  if (message.includes('does not match group size')) {
    return 'このページの大きさと画像の大きさが合いません。ページの大きさに合わせた画像を選んでください。'
  }
  return message
}

/**
 * 取り下げの部分的失敗文（英語の原文）を日本語の定型文に写す。
 * IDなどの内部語は出さず、種類ごとに1行へまとめる。
 */
function unpublishWarningText(warning: string): string {
  if (warning.startsWith('delete alias ')) return '切り替え設定の一部を取り下げきれていません'
  if (warning.startsWith('delete richmenu ')) return 'メニュー本体の一部を取り下げきれていません'
  if (warning.startsWith('default lookup/clear')) return '標準表示の解除を確認できませんでした'
  return '一部を取り下げきれていません'
}

/**
 * 読み込み失敗を利用者の言葉へ写す（U096）。
 *
 * 「見つからない」「権限がない」「通信に失敗した」で運用者の次の手が
 * 違うので、主文を言い分ける。生のエラー文（`API error: 404` など）は
 * 別で畳んで出す。
 */
function describeLoadFailure(raw: string | null): {
  kind: 'not-found' | 'forbidden' | 'error'
  title: string
  detail: string
} {
  const message = raw ?? ''
  if (/API error: 404|not found|見つかりません/i.test(message)) {
    return {
      kind: 'not-found',
      title: 'このリッチメニューは見つかりません',
      detail: '削除されたか、別のLINEアカウントのものか、リンクが古くなっています。一覧から選び直してください。',
    }
  }
  if (/API error: 403|権限|forbidden/i.test(message)) {
    return {
      kind: 'forbidden',
      title: 'このリッチメニューを表示する権限がありません',
      detail: '権限のある人に確認するか、別のLINEアカウントを選んでください。',
    }
  }
  if (/API error: 5\d\d|Failed to fetch|NetworkError|fetch/i.test(message)) {
    return {
      kind: 'error',
      title: '通信できませんでした',
      detail: '通信の状態を確認して、もう一度読み込んでください。',
    }
  }
  return {
    kind: 'error',
    title: 'リッチメニューを表示できませんでした',
    detail: '時間をおいて読み込み直すか、一覧から選び直してください。',
  }
}

/**
 * 取得結果の形を確かめる。形違いの応答をそのまま `Group` に断定すると、
 * 後の `pages.map` などで落ちる。
 */
function isGroupResponse(value: unknown): value is Group {
  if (!value || typeof value !== 'object') return false
  return 'id' in value && typeof value.id === 'string'
    && 'name' in value && typeof value.name === 'string'
    && 'pages' in value && Array.isArray(value.pages)
}

export default function RichMenuEditPage() {
  return (
    <Suspense
      fallback={
        <div>
          <p className="text-sm text-ink-faint">読み込み中...</p>
        </div>
      }
    >
      <RichMenuEditPageInner />
    </Suspense>
  )
}

function RichMenuEditPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const groupId = searchParams.get('id') ?? ''
  const editorStep = searchParams.get('step')
  usePageTitle(editorStep === 'targeting' ? '誰に出すか' : editorStep === 'publish' ? '公開のしかた' : 'メニューを作る')

  if (!groupId) {
    /*
      U096: 「id クエリパラメータが必要です」は技術の言葉で、何を
      選び直せばよいかが主文から読めなかった。やることを主文にし、
      戻る操作をそばに置く。開き先がない3種は ★V7 TargetMissing。
    */
    return (
      <div>
        <TargetMissing
          kind="unspecified"
          title="編集するリッチメニューが指定されていません"
          description="一覧から編集するリッチメニューを選び直してください。"
          backHref="/rich-menus"
          backLabel="リッチメニュー一覧へ戻る"
        />
      </div>
    )
  }
  return <Editor groupId={groupId} editorStep={editorStep} router={router} />
}

function Editor({
  groupId,
  editorStep,
  router,
}: {
  groupId: string
  editorStep: string | null
  router: ReturnType<typeof useRouter>
}) {
  const [group, setGroup] = useState<Group | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activePageId, setActivePageId] = useState<string | null>(null)

  // フォーム編集用 (group が読めたら反映)
  const [name, setName] = useState('')
  const [chatBarText, setChatBarText] = useState('')
  const [pages, setPages] = useState<Page[]>([])
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  // isDefaultForAll はこの画面では編集しない (ON/OFF は「友だちに表示」モーダルから)。
  // ただし persistDraft で送信値を一致させるため、現在値を保持する。
  const [isDefaultForAll, setIsDefaultForAll] = useState(false)
  // 出し分け（149）。条件の形は一斉配信・シナリオと同じもの。
  const [targetingEnabled, setTargetingEnabled] = useState(false)
  const [targetingPriority, setTargetingPriority] = useState(0)
  const [targetingCondition, setTargetingCondition] = useState<SegmentCondition | null>(null)
  const [folderId, setFolderId] = useState('')
  const [folders, setFolders] = useState<PickerOption[]>([])

  /*
   * 公開のしかた（STEP3）の入力。工程の行き来（STEP1/2/3）で工程の部品が
   * 付け替わっても消えないよう、工程をまたぐここで持つ。予約の保存が
   * 成功した時点の入力を publishBaseline に写し、そこから変えた間だけ
   * 未保存として扱う。「保存せずに移る」を選んだときだけ初期値へ戻す。
   *
   * 入力はメニューIDごとに localStorage へ下書きとして残す
   * （publish-plan-draft.ts）。サーバーの下書きpayloadに公開予定の欄が
   * 無いためで、再読込・タブ終了で消えない。復元した下書きはまだ予約や
   * 公開として保存されていないので、初期値との差分として未保存扱いにする。
   */
  const [publishPlan, setPublishPlan] = useState<PublishPlanInput>(DEFAULT_PUBLISH_PLAN)
  const [publishBaseline, setPublishBaseline] = useState<PublishPlanInput>(DEFAULT_PUBLISH_PLAN)
  const publishPlanRestoredFor = useRef<string | null>(null)
  useEffect(() => {
    if (publishPlanRestoredFor.current === groupId) return
    publishPlanRestoredFor.current = groupId
    setPublishPlan(loadPublishPlanDraft(groupId) ?? DEFAULT_PUBLISH_PLAN)
    setPublishBaseline(DEFAULT_PUBLISH_PLAN)
  }, [groupId])
  /** 公開入力の更新。下書き（localStorage）へも同じ内容を書く。 */
  const updatePublishPlan = (patch: Partial<PublishPlanInput>) => {
    setPublishPlan((prev) => {
      const next = { ...prev, ...patch }
      savePublishPlanDraft(groupId, next)
      return next
    })
  }
  /** 公開入力を初期値へ戻し、下書きも消す。明示破棄と公開・予約の成功で使う。 */
  const resetPublishPlan = () => {
    clearPublishPlanDraft(groupId)
    setPublishPlan(DEFAULT_PUBLISH_PLAN)
    setPublishBaseline(DEFAULT_PUBLISH_PLAN)
  }

  // ボタンの設定で選ぶもの（タグ・テンプレート・回答フォーム・計測リンク）。
  // メニュー本体とは別に、開いたとき1回だけ読む。
  const [tags, setTags] = useState<PickerOption[]>([])
  const [templates, setTemplates] = useState<PickerOption[]>([])
  const [forms, setForms] = useState<PickerOption[]>([])
  const [trackedLinks, setTrackedLinks] = useState<PickerOption[]>([])
  // ボタンごとに押された回数。取れなくても編集はできるので、失敗しても止めない。
  const [tapsByArea, setTapsByArea] = useState<Map<string, RichMenuAreaTapCount>>(new Map())

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [unpublishing, setUnpublishing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [imageVersion, setImageVersion] = useState(0)
  /** 登録メディアから画像を選ぶ窓（N-193）。 */
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)

  /*
   * 確認の窓。**ブラウザの `confirm()` は使わない。**
   * 見た目がブラウザ任せで設計の確認窓（`J6x4Q` / `H2S1T4`）と違ううえ、
   * 画像比較にも写らない。何が止まって何が残るのかを本文で読ませる。
   *
   * 開いている窓は1つだけ。`ConfirmDialog` を3つ並べるより、どれが開いて
   * いるかを1か所で見たほうが、二重に開く形を作りにくい。
   */
  /*
   * N-162: 読み込み・保存が終わった時点の「保存済みの形」を署名で持つ。
   * 署名と今の入力が違う間だけ離脱確認を出す。保存・公開の成功は
   * reload() 経由で署名が更新されるので、保存直後には警告が出ない。
   */
  const [baselineSignature, setBaselineSignature] = useState<string | null>(null)
  const [confirmKind, setConfirmKind] = useState<'removePage' | 'publish' | 'unpublish' | 'deleteGroup' | 'duplicate' | null>(null)
  /** 消す前に打ち込んでもらう名前。**打ち間違いを止めるための二重確認。** */
  const [deleteTyped, setDeleteTyped] = useState('')
  const [deleting, setDeleting] = useState(false)
  /** N-154: 複製の実行中。二度押しで2件作らないよう止める。 */
  const [duplicating, setDuplicating] = useState(false)
  /** 押した時点のページ。窓を開けたまま別のページに切り替えても、対象は動かさない。 */
  const [removePageTarget, setRemovePageTarget] = useState<Page | null>(null)
  const [confirmError, setConfirmError] = useState('')
  /** 登録・取り下げの結果。`alert()` の代わりに画面へ残す。 */
  const [notice, setNotice] = useState('')
  /*
   * 公開予約の保存。1操作の Idempotency-Key を応答が確定するまで持ち続ける
   * (押し直しで同じ予約が2件にならないようにする)。中身は schedule-submit.ts。
   */
  const scheduleSubmit = useScheduleSubmit({
    groupId: group?.id ?? '',
    persistDraft: () => persistDraft(),
    onSaving: setSaving,
    onSaved: (message) => {
      setError(null)
      setNotice(message)
      /*
       * 予約の保存は下書き保存も済ませてから行う。保存できた時点の内容を
       * 「保存済み」の基準にし、公開入力も予約した内容を基準にする。
       * ここで基準を動かさないと、全部保存済みなのに離脱確認が出る。
       */
      setBaselineSignature(draftSignatureOf({
        name,
        chatBarText,
        isDefaultForAll,
        targetingEnabled,
        targetingPriority,
        targetingCondition,
        folderId,
        pages,
      }))
      setPublishBaseline(publishPlan)
      // 予約できた入力はサーバーへ保存済み。下書きとして残すと、
      // 開き直したとき予約済みの内容が「未保存の入力」として復活する。
      clearPublishPlanDraft(groupId)
    },
    onFailed: (message) => {
      setNotice('')
      setError(message)
    },
  })
  /**
   * 下見で押したときに「何が起きるか」。
   *
   * ここも `alert()` だった。**押した瞬間しか読めず、消えると確かめ直せない。**
   * 画面に残せば、区画を押しながら設定と見比べられる。
   */
  const [previewMessage, setPreviewMessage] = useState('')
  const [targetPreview, setTargetPreview] = useState<RichMenuTargetPreview | null>(null)
  const [targetPreviewLoading, setTargetPreviewLoading] = useState(false)
  const [targetPreviewError, setTargetPreviewError] = useState('')

  /*
   * N-156: staff/viewer には人数の合計だけを出す。条件の内訳・上位メニュー名・
   * 個人の情報を返す preview-targets は owner/admin 専用なので、staff は
   * audience-summary（集計だけ）へ切り替える。
   */
  const [staffRole, setStaffRole] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void api.staff.me()
      .then((res) => {
        if (!cancelled && res.success) setStaffRole(res.data.role)
      })
      .catch(() => {
        // 取れなくても画面は出す。操作側はサーバが 403 で止める。
      })
    return () => { cancelled = true }
  }, [])
  const aggregateOnly = staffRole === 'staff' || staffRole === 'viewer'
  const canOperate = staffRole === 'owner' || staffRole === 'admin'

  /*
   * N-162: 保存済み署名との差分がある間だけ離脱確認を出す。
   * busy 中は確認窓を足さない（保存の返事を待っている最中に重ねない）。
   * 画像はアップロード時点で保存済み・プレビュー表示は dirty に含めない。
   */
  /*
   * 下書きの署名に加えて、STEP3 の公開入力も未保存の対象にする。
   * 公開入力は下書きとは別の基準（予約が保存できた時点の入力）と比べる。
   */
  const publishDirty = JSON.stringify(publishPlan) !== JSON.stringify(publishBaseline)
  const dirty = baselineSignature !== null && (publishDirty || draftSignatureOf({
    name,
    chatBarText,
    isDefaultForAll,
    targetingEnabled,
    targetingPriority,
    targetingCondition,
    folderId,
    pages,
  }) !== baselineSignature)
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({
    dirty,
    busy: saving || publishing || unpublishing || deleting || busy,
  })
  /*
   * 「保存せずに移る」を選んだときだけ、公開入力を初期値へ戻す。
   * 取消・Escape（cancelLeave）では触らず、入力はそのまま残る。
   * 実際の遷移では画面ごと外れるが、確認の選択として明示しておく。
   */
  const confirmLeaveAndDiscard = () => {
    resetPublishPlan()
    confirmLeave()
  }
  /*
   * N-162: 離脱確認の窓は step 1/2/3 のどこにいても出す。
   * targeting/publish は早期 return で別ツリーになるため、ここで要素化して
   * 全経路へ差し込む。step 1 だけに置くと、dirty 中のリンクが黙って止まり
   * 「保存せずに移る」を選ぶ手段がなくなる。
   */
  const leaveConfirmDialog = (
    <UnsavedLeaveDialog open={leaveTarget !== null} subject="メニューへの変更" onConfirm={confirmLeaveAndDiscard} onCancel={cancelLeave} />
  )

  const closeConfirm = () => {
    if (publishing || unpublishing || duplicating) return
    setConfirmKind(null)
    setRemovePageTarget(null)
    setConfirmError('')
  }

  const fileInput = useRef<HTMLInputElement>(null)
  // LINEへの公開は結果が届くまで同じ鍵で再試行する。成功後の次の公開だけ新しい鍵にする。
  const publishAttempt = useRef(new ManualPublishAttempt())

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.richMenuGroups.get(groupId)
      if (!res.success) throw new Error(res.error ?? '取得失敗')
      if (!isGroupResponse(res.data)) throw new Error('取得失敗')
      const g = res.data
      setGroup(g)
      setName(g.name)
      setChatBarText(g.chatBarText)
      setIsDefaultForAll(g.isDefaultForAll)
      setTargetingEnabled(g.targetingEnabled)
      setTargetingPriority(g.targetingPriority)
      setTargetingCondition(parseStoredCondition(g.targetingCondition))
      setFolderId(g.folderId ?? '')
      setPages(g.pages)
      setBaselineSignature(draftSignatureOf({
        name: g.name,
        chatBarText: g.chatBarText,
        isDefaultForAll: g.isDefaultForAll,
        targetingEnabled: g.targetingEnabled,
        targetingPriority: g.targetingPriority,
        targetingCondition: parseStoredCondition(g.targetingCondition),
        folderId: g.folderId ?? '',
        pages: g.pages,
      }))
      void api.richMenuGroups
        .tapStats(g.accountId)
        .then((res) => {
          if (res.success) {
            setTapsByArea(new Map(res.data.byArea.map((a) => [a.areaId, a])))
          }
        })
        .catch(() => {
          // 数が出ないだけ。編集は続けられる。
        })
      setActivePageId((prev) =>
        prev && g.pages.some((p) => p.id === prev) ? prev : (g.pages[0]?.id ?? null),
      )
      setSelectedAreaId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => {
    reload()
  }, [reload])

  const reloadTargetPreview = useCallback(async () => {
    if (!group) return
    setTargetPreviewLoading(true)
    setTargetPreviewError('')
    try {
      if (aggregateOnly) {
        // N-156: staff は集計だけ。保存途中の条件ではなく、保存済みの条件で数える。
        const response = await api.richMenuGroups.audienceSummary(group.id)
        if (!response.success) throw new Error(response.error)
        setTargetPreview({
          matched: response.data.targeted,
          overlap: response.data.excluded,
          effective: response.data.effective,
          higherMenus: [],
          priority: targetingPriority,
        })
        return
      }
      const response = await api.richMenuGroups.previewTargets(
        group.id,
        targetingEnabled ? targetingCondition : null,
      )
      if (!response.success) throw new Error(response.error)
      setTargetPreview(response.data)
    } catch {
      setTargetPreview(null)
      setTargetPreviewError('対象人数を確認できませんでした。条件は保存できます。')
    } finally {
      setTargetPreviewLoading(false)
    }
  }, [group, targetingCondition, targetingEnabled, aggregateOnly, targetingPriority])

  useEffect(() => {
    if (editorStep !== 'targeting' && editorStep !== 'publish') return
    const timer = window.setTimeout(() => void reloadTargetPreview(), 250)
    return () => window.clearTimeout(timer)
  }, [editorStep, reloadTargetPreview])

  // 選択肢は片方が落ちても残りを出す。1つ取れなくても編集自体は続けられる。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [tagRes, tplRes, formRes, linkRes, folderRes] = await Promise.allSettled([
        // R23: このメニューのアカウントのタグだけを候補にする（別アカウントの同名混入防止）。
        api.tags.list(group?.accountId ? { accountId: group.accountId } : undefined),
        // m18r: テンプレートもこのメニューのアカウントだけ（流入リンク #914 と同じ形）。
        api.templates.list(undefined, group?.accountId ?? undefined),
        group?.accountId
          ? api.forms.list(group.accountId)
          : Promise.resolve({ success: true as const, data: [] }),
        api.trackedLinks.list(),
        api.folders.list('rich_menu'),
      ])
      if (cancelled) return
      if (tagRes.status === 'fulfilled' && tagRes.value.success) {
        setTags(tagRes.value.data.map((t) => ({ id: t.id, name: t.name })))
      }
      if (tplRes.status === 'fulfilled' && tplRes.value.success) {
        setTemplates(tplRes.value.data.map((t) => ({ id: t.id, name: t.name })))
      }
      if (formRes.status === 'fulfilled' && formRes.value.success) {
        setForms(formRes.value.data.map((f) => ({ id: f.id, name: f.name })))
      }
      if (folderRes.status === 'fulfilled' && folderRes.value.success) {
        setFolders(folderRes.value.data.map((f) => ({ id: f.id, name: f.name })))
      }
      if (linkRes.status === 'fulfilled' && linkRes.value.success) {
        setTrackedLinks(linkRes.value.data.map((l) => ({ id: l.id, name: l.name })))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [group?.accountId])

  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0] ?? null
  const selectedArea =
    activePage?.areas.find((a) => a.id === selectedAreaId) ?? null

  function updatePage(pageId: string, patch: Partial<Page>) {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, ...patch } : p)))
  }

  function updateArea(pageId: string, areaId: string, patch: Partial<Area>) {
    setPages((prev) =>
      prev.map((p) =>
        p.id === pageId
          ? {
              ...p,
              areas: p.areas.map((a) => (a.id === areaId ? { ...a, ...patch } : a)),
            }
          : p,
      ),
    )
  }

  function addArea(pageId: string, area: Area) {
    setPages((prev) =>
      prev.map((p) => (p.id === pageId ? { ...p, areas: [...p.areas, area] } : p)),
    )
    setSelectedAreaId(area.id)
  }

  function deleteArea(pageId: string, areaId: string) {
    setPages((prev) =>
      prev.map((p) =>
        p.id === pageId ? { ...p, areas: p.areas.filter((a) => a.id !== areaId) } : p,
      ),
    )
    setSelectedAreaId(null)
  }

  function addPage() {
    const nextOrder = pages.length
    const newPage: Page = {
      id: `tmp-${Math.random().toString(36).slice(2, 10)}`,
      orderIndex: nextOrder,
      name: `ページ ${nextOrder + 1}`,
      aliasId: '',
      lineRichmenuId: null,
      imageR2Key: null,
      imageContentType: null,
      areas: [],
    }
    setPages([...pages, newPage])
    setActivePageId(newPage.id)
    setSelectedAreaId(null)
  }

  /**
   * このページを消せない理由。空なら消せる。
   *
   * 参照を残したまま消すと、LINE 登録のときに `target page not found` で
   * 落ちる。理由は窓の中に並べて、押し口は出さない。
   */
  function removePageBlockers(target: Page): string[] {
    const reasons: string[] = []
    if (pages.length <= 1) {
      reasons.push('リッチメニューには最低1ページ必要です。これが最後の1ページなので削除できません。')
    }
    const referrers = pages
      .filter((p) => p.id !== target.id)
      .filter((p) =>
        p.areas.some(
          (a) =>
            a.actionType === 'richmenuswitch' &&
            (a.actionData as { targetPageId?: string }).targetPageId === target.id,
        ),
      )
    if (referrers.length > 0) {
      reasons.push(
        `${referrers.map((p) => `「${p.name}」`).join('、')}のタブ切替ボタンが、このページを行き先にしています。先に行き先を変えてから削除してください。`,
      )
    }
    return reasons
  }

  function askRemovePage(target: Page) {
    setConfirmError('')
    setRemovePageTarget(target)
    setConfirmKind('removePage')
  }

  function removePage(target: Page) {
    if (removePageBlockers(target).length > 0) return
    const remaining = pages
      .filter((p) => p.id !== target.id)
      .map((p, i) => ({ ...p, orderIndex: i }))
    setPages(remaining)
    if (activePageId === target.id) {
      setActivePageId(remaining[0]?.id ?? null)
    }
    setSelectedAreaId(null)
    setConfirmKind(null)
    setRemovePageTarget(null)
  }

  async function persistDraft(): Promise<void> {
    // M951: 読んだときの版を付けて保存する。別画面・別タブで先に保存
    // されていたら 409 になり、上書きせず読み直しを促す。
    const version = group?.version
    if (version === undefined) {
      throw new Error('メニューを読み込めていません。一覧から開き直してください。')
    }
    const res = await api.richMenuGroups.update(groupId, {
      expectedVersion: version,
      name,
      chatBarText,
      isDefaultForAll,
      targetingEnabled,
      targetingPriority,
      targetingCondition: targetingCondition ? JSON.stringify(targetingCondition) : null,
      folderId: folderId || null,
      pages: pages.map((p, i) => ({
        // 既存 page (UUID) は id を渡す。新規 page (`tmp-*` プレフィックス) は
        // id を渡さず Worker 側で新 UUID を発行させる。
        ...(p.id.startsWith('tmp-') ? {} : { id: p.id }),
        name: p.name,
        orderIndex: i,
        areas: p.areas.map(projectAreaForDraft),
      })),
    })
    if (!res.success) throw new Error(res.error ?? '保存失敗')
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      await persistDraft()
      await reload()
      setSaved(true)
    } catch (e) {
      // WRITE-01: 権限不足・所属違い・機能オフの理由が見えるようにする。
      // 内部文（API error: 5xx 等）は画面へ出さない。
      // R205: Worker が英語で返す既知の検証文は日本語へ写す。
      const raw = e instanceof Error ? e.message : ''
      setError(
        /targetingPriority/.test(raw)
          ? '出す順番は1以上の整数で入力してください。小数は使えません。'
          : describeSaveFailure(e),
      )
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    // 二度押しを受け付けない。窓のボタンも `busy` で止まるが、
    // 二重の登録が走ると LINE 側に同じメニューが2つ出る。
    if (publishing || unpublishing || saving || busy) return
    const idempotencyKey = publishAttempt.current.begin()
    if (!idempotencyKey) return
    setPublishing(true)
    setError(null)
    setConfirmError('')
    setNotice('')
    // #502中: 下書き保存の成否で文言を分ける。保存済みなのに
    // 「保存されていません」と出すと、利用者が再入力してしまう。
    let draftSaved = false
    try {
      await persistDraft()
      draftSaved = true
      const res = await api.richMenuGroups.publish(groupId, idempotencyKey)
      // 失敗を握りつぶさない。返事を見ずに閉じると、登録できていないのに
      // 終わったように見える。
      if (!res.success) throw new Error(res.error ?? 'publish failed')
      publishAttempt.current.succeed()
      setConfirmKind(null)
      /*
       * R204: 公開＝LINEへの登録。実際に友だちの画面が変わるのは
       * 「全員の既定」にしている場合だけなので、設定に合わせて言い分ける。
       * メニュー項目の名前（一覧の「表示先」）は実際の表記にそろえる。
       */
      setNotice(
        isDefaultForAll
          ? 'LINEへの登録が終わり、すべての友だちの既定メニューになりました。'
          : targetingEnabled
            ? 'LINEへの登録が終わりました。条件に当てはまる人の画面には、その人に関係する出来事（友だち追加・タグ付けなど）が起きたタイミングで順次出ます。'
            : 'LINEへの登録が終わりました。友だちのトーク画面に出すには、一覧の「表示先」から操作してください。',
      )
      // 「いますぐ出す」で使い切った公開入力の下書きは残さない。
      resetPublishPlan()
      await reload()
    } catch (e) {
      // 生のAPIエラーは出さない。運用者が次にすることだけを窓に書く。
      // R203: ただし入力検査の日本語メッセージ（「ページ…の『…』: URLの形が…」）
      // は直し方が書いてあるので、そのまま見せる。
      const raw = e instanceof Error ? e.message : ''
      const isValidationMessage = /[ぁ-んァ-ヶ一-龠]/u.test(raw) && raw !== 'publish failed'
      setConfirmError(
        /targetingPriority/.test(raw)
          ? '出す順番は1以上の整数で入力してください。小数は使えません。'
          : isValidationMessage
            ? raw
            : draftSaved
              ? 'LINEへ登録できませんでした。下書きは保存済みです。LINEへの登録だけもう一度お試しください。'
              : 'LINEへ登録できませんでした。下書きは保存されていません。しばらくおいてから、もう一度お試しください。',
      )
    } finally {
      setPublishing(false)
      publishAttempt.current.finish()
    }
  }

  async function handleUnpublish() {
    if (publishing || unpublishing || saving || busy) return
    setUnpublishing(true)
    setError(null)
    setConfirmError('')
    setNotice('')
    try {
      const res = await api.richMenuGroups.unpublish(groupId)
      if (!res.success) throw new Error(res.error ?? 'unpublish failed')
      const warnings = res.data?.warnings ?? []
      setConfirmKind(null)
      // 原文（英語・IDつき）をそのまま出さず、日本語の定型文へ写して重複をまとめる。
      const warningTexts = [...new Set(warnings.map(unpublishWarningText))]
      setNotice(
        warningTexts.length > 0
          ? `LINE上のメニュー登録を取り下げました。ただし、${warningTexts.join(' / ')}。`
          : 'LINE上のメニュー登録を取り下げました。もう一度「LINEに登録」すれば元に戻せます。',
      )
      await reload()
    } catch {
      // M953: LINE 側の削除に失敗したときは draft 確定にならず published の
      // まま残る。メニューが LINE 上に残っていることを明示し、この窓のまま
      // もう一度取り下げられるようにする（窓は閉じない）。
      setConfirmError('LINE上のメニューを取り下げできませんでした。メニューはLINE上に残っています。最新の状態を確認して、もう一度お試しください。')
    } finally {
      setUnpublishing(false)
    }
  }

  /**
   * 消す押し口。**ブラウザの `alert()` と `prompt()` を使わない。**
   *
   * 見た目がブラウザ任せで設計の確認窓と違ううえ、**画像比較に写らない**ので
   * 確認と失敗の絵をそもそも撮れない。理由も窓の中に出して、押した場所から
   * 動かさない。
   */
  function handleDelete() {
    if (!group) return
    if (group.status === 'published') {
      setError('このリッチメニューはLINEに登録中です。先に「LINEから取り下げ」をしてから削除してください。')
      return
    }
    setDeleteTyped('')
    setConfirmError('')
    setConfirmKind('deleteGroup')
  }

  async function runDelete() {
    if (!group) return
    if (deleteTyped !== group.name) {
      setConfirmError('名前が一致しません。上の名前をそのまま打ち込んでください。')
      return
    }
    setDeleting(true)
    setConfirmError('')
    try {
      const res = await api.richMenuGroups.delete(groupId)
      if (!res.success) throw new Error(res.error ?? '削除できませんでした')
      // 消えたメニューの公開入力下書きを残さない。
      clearPublishPlanDraft(groupId)
      router.push('/rich-menus')
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : '削除できませんでした。しばらくおいてから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  /*
   * N-154: 編集画面からも複製できる。下書きを先に保存してから複製する
   * と、画面に見えている内容と複製される内容がずれない。
   */
  async function runDuplicate() {
    if (!group || duplicating) return
    setDuplicating(true)
    setConfirmError('')
    try {
      await persistDraft()
      const res = await api.richMenuGroups.duplicate(group.id, crypto.randomUUID())
      if (!res.success) throw new Error(res.error ?? '複製できませんでした')
      /*
       * R232: 画面遷移しても確認窓の状態は残る（同じページでクエリだけ変わる）。
       * 閉じてから移る。残ったままだと「コピーをさらに複製する？」に見えて、
       * もう一度押すと不要なコピーが増える。
       */
      setConfirmKind(null)
      setNotice(`「${group.name}」の下書きを複製しました。この画面はコピーの編集です。`)
      router.push(`/rich-menus/edit?id=${res.data.id}`)
    } catch (e) {
      setConfirmError(e instanceof Error && e.message !== '複製できませんでした'
        ? e.message
        : '複製できませんでした。しばらくおいてから、もう一度お試しください。')
    } finally {
      setDuplicating(false)
    }
  }

  async function handleImageUpload(pageId: string, file: File) {
    if (pageId.startsWith('tmp-')) {
      // **内部語を出さない。** 押し口の名前は画面に出ている言葉で書く。
      setError('先に「下書きを保存」でページを保存してから、画像を選んでください。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.richMenuGroups.uploadImage(groupId, pageId, file)
      updatePage(pageId, {
        imageR2Key: res.data.imageR2Key,
        imageContentType: res.data.imageContentType,
      })
      setImageVersion((v) => v + 1)
    } catch (e) {
      setError(imageUploadErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 登録メディアから選んだ画像をこのページの画像にする（N-193）。
   * 認証と監査を通る取得口から受け取り、既存のアップロード経路へ流す。
   * 形式・寸法・容量の検査はアップロードと同じ場所で行う。
   */
  async function handleMediaPick(item: MediaItem) {
    setMediaPickerOpen(false)
    if (!activePage || !group) return
    if (activePage.id.startsWith('tmp-')) {
      setError('先に「下書きを保存」でページを保存してから、画像を選んでください。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const blob = await api.media.download(item.id, group.accountId)
      const file = new File([blob], item.filename, {
        type: item.mimeType || blob.type || 'image/png',
      })
      const res = await api.richMenuGroups.uploadImage(groupId, activePage.id, file)
      updatePage(activePage.id, {
        imageR2Key: res.data.imageR2Key,
        imageContentType: res.data.imageContentType,
      })
      setImageVersion((v) => v + 1)
    } catch (e) {
      setError(imageUploadErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div>
        <p className="text-sm text-ink-faint">読み込み中...</p>
      </div>
    )
  }
  if (!group) {
    /*
      U096: 生の `API error: 404` などを主文にしない。削除済み・権限なし・
      通信失敗を言い分け、技術情報は補助の詳細へ畳む。
      開き先がない3種は ★V7 TargetMissing（設計 `x5cgUH`）へ寄せる。
    */
    const failure = describeLoadFailure(error)
    if (failure.kind === 'forbidden') {
      return (
        <div>
          <ListState
            kind="forbidden"
            title={failure.title}
            description={failure.detail}
            action={<Button href="/rich-menus">リッチメニュー一覧へ戻る</Button>}
          />
        </div>
      )
    }
    if (failure.kind === 'not-found') {
      return (
        <div>
          <TargetMissing
            kind="not-found"
            title={failure.title}
            description={failure.detail}
            backHref="/rich-menus"
            backLabel="リッチメニュー一覧へ戻る"
          />
        </div>
      )
    }
    return (
      <div>
        <TargetMissing
          kind="error"
          title={failure.title}
          description={failure.detail}
          onRetry={() => void reload()}
        />
        {error ? (
          <details className="mt-2 text-xs text-ink-faint">
            <summary className="cursor-pointer">技術情報</summary>
            <p className="mt-1 break-all">{error}</p>
          </details>
        ) : null}
      </div>
    )
  }

  // richmenuswitch の遷移先候補は「保存済み page (UUID) のみ」に絞る。
  // 未保存 page (tmp-*) は persistDraft 時に id が新 UUID に置き換わるので、
  // ここで targetPageId に出してしまうと publish で `target page not found`
  // で失敗する。
  const pagesForSelect = pages
    .filter((p) => !p.id.startsWith('tmp-'))
    .map((p) => ({ id: p.id, name: p.name }))
  const imageUrl = activePage?.imageR2Key
    ? `${api.richMenuGroups.imageUrl(activePage.imageR2Key)}?v=${imageVersion}`
    : null

  /*
   * 人数プレビューが「保存済みの条件」か「いま編集中の未保存条件」か。
   * previewTargets には編集中の条件を渡しているので、保存済みと違う間は
   * 人数が未保存の条件で計算されていると画面に書いて区別する。
   * （staff は集計APIで常に保存済み条件を数えるが、条件の編集自体が
   * できないため差分は起きない）
   */
  const savedCondition = parseStoredCondition(group.targetingCondition)
  const previewUnsaved =
    JSON.stringify(targetingEnabled ? targetingCondition : null)
    !== JSON.stringify(group.targetingEnabled ? savedCondition : null)
  /*
   * 条件をONにしたのに条件が空なら、STEP2 と同じく「誰にも出しません」の
   * 0人でそろえる。空条件をAPIへ渡すと全員として数えられ、画面の案内と
   * 食い違って見える（RICHMENU-03 と同じ扱い）。
   */
  const conditionEmpty = targetingEnabled && !targetingCondition

  if (editorStep === 'targeting') {
    return (
      <>
      <TargetingStep
        group={group}
        targetingEnabled={targetingEnabled}
        targetingPriority={targetingPriority}
        targetingCondition={targetingCondition}
        savedCondition={savedCondition}
        previewUnsaved={previewUnsaved}
        tags={tags}
        preview={targetPreview}
        previewLoading={targetPreviewLoading}
        previewError={targetPreviewError}
        saving={saving}
        onTargetingEnabled={setTargetingEnabled}
        onTargetingPriority={setTargetingPriority}
        onTargetingCondition={setTargetingCondition}
        onRefresh={() => void reloadTargetPreview()}
        onSave={() => void handleSave()}
        saveError={error}
        saveNotice={notice}
        readOnly={aggregateOnly}
      />
      {leaveConfirmDialog}
      </>
    )
  }

  if (editorStep === 'publish') {
    return (
      <>
      <PublishStep
        group={group}
        pages={pages}
        preview={targetPreview}
        saving={saving}
        publishing={publishing}
        publish={publishPlan}
        onPublishChange={updatePublishPlan}
        conditionEmpty={conditionEmpty}
        previewUnsaved={previewUnsaved}
        isDefaultForAll={isDefaultForAll}
        targetingEnabled={targetingEnabled}
        saveError={error}
        saveNotice={notice}
        onSave={() => void handleSave()}
        onPublishNow={() => void handlePublish()}
        onSchedule={scheduleSubmit}
        canOperate={canOperate}
        onChanged={() => void reload()}
      />
      {leaveConfirmDialog}
      </>
    )
  }

  {/* ★V7: 左右の余白と幅は共通の枠が持つ。画面側の `p-6 max-w-7xl mx-auto` を外し、ほかの画面と同じ幅いっぱいにした。 */}
  return (
    <div className="flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <nav data-design="Crumb" className="text-ink-faint text-xs">
        <Link href="/rich-menus" className="hover:underline">
          リッチメニュー
        </Link>
        <span className="mx-1.5">/</span>
        <span>{name || '(無名)'}</span>
      </nav>

      <StepHeader active={1} groupId={group.id} />

      {/* 登録・取り下げの結果。`alert()` と違い、押したあとも読み返せる。 */}
      {notice && (
        <Notice tone="success" message={notice} className="mb-4" />
      )}

      {error && (
        <Notice tone="danger" message={error} className="mb-4" />
      )}

      {/* タブバー */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {pages.map((p) => {
          const active = p.id === activePageId
          return (
            <Button variant="primary" className={(`px-3 py-1.5 rounded-control text-sm font-medium transition-colors ${
                active
                  ? 'bg-accent-deep text-on-accent'
                  : 'bg-shell text-ink-secondary hover:bg-shell-gray'
              }`) + ' border-0 h-auto whitespace-normal'} key={p.id} onClick={() => {
                setActivePageId(p.id)
                setSelectedAreaId(null)
              }}>
              {p.name}
              {active && <span className="ml-1 text-xs opacity-80">編集中</span>}
              {p.id.startsWith('tmp-') && (
                <span className="ml-1 text-xs opacity-70">(未保存)</span>
              )}
            </Button>
          )
        })}
        <Button variant="secondary" className="px-3 py-1.5 font-medium hover:bg-surface-pearl h-auto whitespace-normal" onClick={addPage}>
          ＋ ページを追加する
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* 中央: キャンバス */}
        <section>
          <div className="mb-3">
            <h2 className="text-ink text-sm font-semibold">タップできる場所</h2>
            <p className="text-ink-faint mt-0.5 text-xs">
              エリアをクリックすると、右側で動きを設定できます。画像の上を区切って、タップしたときの動きをエリアごとに決めます。
            </p>
          </div>
          {activePage ? (
            <CanvasEditor
              areas={activePage.areas}
              size={group.size}
              imageUrl={imageUrl}
              selectedAreaId={selectedAreaId}
              onSelectArea={setSelectedAreaId}
              onAddArea={(area) => addArea(activePage.id, area)}
              onUpdateArea={(id, patch) => updateArea(activePage.id, id, patch)}
              onDeleteArea={(id) => deleteArea(activePage.id, id)}
              preview={preview}
              onPreviewAction={(area) => {
                // プレビューは「押すと何が起きるか」を確かめるためのもの。
                // 実際に送ったり電話をかけたりはせず、起きることを文で見せる。
                setPreviewMessage('')
                const data = area.actionData as {
                  uri?: string
                  tel?: string
                  text?: string
                  targetPageId?: string
                }
                const nameOf = (list: PickerOption[], id: string | null | undefined) =>
                  list.find((o) => o.id === id)?.name ?? '(未選択)'
                switch (intentOf(area)) {
                  case 'url':
                    if (area.trackedLinkId) {
                      setPreviewMessage(`計測リンクを開きます：${nameOf(trackedLinks, area.trackedLinkId)}`)
                    } else if (data.uri) {
                      window.open(data.uri, '_blank')
                    } else {
                      setPreviewMessage('URLがまだ設定されていません。右の設定で入れてください。')
                    }
                    break
                  case 'tel':
                    setPreviewMessage(data.tel ? `電話をかけます：${data.tel}` : '電話番号がまだ設定されていません。')
                    break
                  case 'text':
                    setPreviewMessage(data.text ? `「${data.text}」を送ります。` : '送る文がまだ設定されていません。')
                    break
                  case 'template':
                    setPreviewMessage(`テンプレートを送ります：${nameOf(templates, area.templateId)}`)
                    break
                  case 'form':
                    setPreviewMessage(`回答フォームを開きます：${nameOf(forms, area.formId)}`)
                    break
                  case 'switch': {
                    const targetId = data.targetPageId
                    if (targetId && pages.some((p) => p.id === targetId)) {
                      setActivePageId(targetId)
                      setSelectedAreaId(null)
                    } else {
                      setPreviewMessage('切り替え先のページがまだ設定されていません。')
                    }
                    break
                  }
                  default:
                    // **中身をそのまま出さない。** `actionData` は機械が読む値で、
                    // 運用者に見せる言葉ではない。
                    setPreviewMessage('この区画の動きは、下見では試せません。')
                }
              }}
            />
          ) : (
            <p className="text-sm text-ink-faint">ページがありません</p>
          )}

          {/*
            下見で押したときに起きること。**`alert()` と違い、押したあとも
            読み返せる。** 区画を押しながら右の設定と見比べられる。
          */}
          {previewMessage && (
            <Notice tone="info" message={previewMessage} className="mt-3" />
          )}
        </section>

        {/* 右パネル */}
        <aside className="space-y-5">
            {selectedAreaId && (
              <p className="text-ink-faint text-xs">
                タップしたときに何が起きるかを決めます。
              </p>
            )}
          {/* メニュー設定 */}
          <section className="bg-canvas border border-hairline rounded-control shadow-card p-5 space-y-4">
            <h2 className="text-ink text-sm font-semibold">基本設定</h2>
            <p className="text-ink-faint text-xs">
              サイズ {SIZE_LABEL[group.size]} ・{' '}
              {group.status === 'published' ? 'LINE 登録済み' : '下書き'}
            </p>
            <label className="block">
              <span className="text-ink-secondary text-xs font-medium">メニュー名</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-full border border-hairline rounded-control px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <p className="mt-1 text-[11px] text-ink-faint">管理画面でだけ使う名前 (友だちには見えない)</p>
            </label>
            <label className="block">
              <span className="text-ink-secondary text-xs font-medium">フォルダ</span>
              <Select
                aria-label="フォルダ"
                value={folderId}
                onChange={(value) => setFolderId(value)}
                options={[{ value: '', label: '未分類' }, ...folders.map((f) => ({ value: f.id, label: f.name }))]}
              />
            </label>
            <label className="block">
              <span className="text-ink-secondary text-xs font-medium">メニューバーの文字</span>
              <input
                value={chatBarText}
                onChange={(e) => setChatBarText(e.target.value)}
                maxLength={14}
                className="mt-1 block w-full border border-hairline rounded-control px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <p className="mt-1 text-[11px] text-ink-faint">14 文字以内 (友だちのトーク画面でメニューを開く前に表示)</p>
            </label>
          </section>

          {/* ページ設定 (画像 upload 含む、常時表示) */}
          {activePage && (
            <section className="bg-canvas border border-hairline rounded-control shadow-card p-5 space-y-4">
              <h2 className="text-ink text-sm font-semibold">タブ（メニューの切り替え）</h2>
              <p className="text-ink-faint text-xs leading-relaxed">
                1つのメニューの中でタブを分けられます。タブのボタンを押すと別の面に切り替わります。タブは2〜3つまでを推奨します。多いと押されなくなります。
              </p>
              <label className="block">
                <span className="text-xs font-medium text-ink-secondary">ページ名</span>
                <input
                  value={activePage.name}
                  onChange={(e) =>
                    updatePage(activePage.id, { name: e.target.value })
                  }
                  className="mt-1 block w-full border border-hairline rounded-control px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </label>
              <div>
                <span className="text-xs font-medium text-ink-secondary">画像</span>
                {activePage.imageR2Key ? (
                  <p className="mt-1 text-xs text-ink-secondary">✓ アップロード済み</p>
                ) : (
                  <p className="mt-1 text-xs text-ink-faint">未設定</p>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleImageUpload(activePage.id, file)
                    e.target.value = ''
                  }}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="secondary" className="px-3 py-1.5 text-xs font-medium hover:bg-surface-pearl disabled:opacity-50 h-auto whitespace-normal" onClick={() => fileInput.current?.click()} disabled={busy || activePage.id.startsWith('tmp-')}>
                    {activePage.imageR2Key ? '画像を差し替え' : '画像を選択'}
                  </Button>
                  {/*
                    隣の「画像を選択」と同じ見た目。ただし hover の色だけは
                    生の gray-50 ではなく既存トークン canvas-sunken（同じ
                    薄い灰）を使い、raw-colors の基準を超えないようにする。
                    枠線は隣と揃えるため gray-300 のまま（border-hairline を
                    素の button に書くと direct-secondary-button の借金に
                    数えられる）。
                  */}
                  <Button variant="secondary" className="px-3 py-1.5 text-xs font-medium disabled:opacity-50 h-auto whitespace-normal" onClick={() => setMediaPickerOpen(true)} disabled={busy || activePage.id.startsWith('tmp-')}>
                    登録メディアから選ぶ
                  </Button>
                </div>
                <p className="mt-1.5 text-[11px] text-ink-faint">
                  PNG / JPEG, {SIZE_LABEL[group.size]}, 1MB 以下
                </p>
                {activePage.id.startsWith('tmp-') && (
                  <p className="mt-1 text-[11px] text-status-warn-deep">
                    新規ページは「下書き保存」してから画像をアップロードしてください
                  </p>
                )}
              </div>
              <p className="text-[11px] text-ink-faint pt-3 border-t border-divider-soft">
                中央のキャンバスでドラッグして tap 領域 (areas) を追加・編集できます。
              </p>
            </section>
          )}

          {/* 誰に出すか（149） */}
          <section className="bg-canvas border border-hairline rounded-control shadow-card p-5 space-y-4">
            <div>
              <h2 className="text-ink text-sm font-semibold">誰に出すか</h2>
              <p className="text-ink-faint mt-0.5 text-xs leading-relaxed">
                条件に当てはまった友だちに、このメニューを自動で出します。タグが付いた時点で
                切り替わるので、あとから当てはまった人にも出ます。
              </p>
            </div>

            <Checkbox
              checked={targetingEnabled}
              onCheckedChange={setTargetingEnabled}
              description="切ると、このメニューは条件で配られなくなります。すでに見えている人からはすぐには消えません。"
            >
              条件で出し分ける
            </Checkbox>

            {targetingEnabled && (
              <>
                {group.status !== 'published' && (
                  <p className="rounded-control bg-warning-bg p-2 text-[11px] text-warning">
                    このメニューはまだ LINE に登録されていません。登録するまで、条件に
                    当てはまっても出せません。
                  </p>
                )}

                <label className="block">
                  <span className="text-ink-secondary text-xs font-medium">出す順番</span>
                  <span className="text-ink-faint block text-[11px]">
                    一覧で上にあるメニューが優先されます。現在は
                    {targetingPriority + 1}番目です。
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={targetingPriority + 1}
                    onChange={(e) =>
                      setTargetingPriority(Math.max(0, (parseInt(e.target.value, 10) || 1) - 1))
                    }
                    className="border-hairline rounded-control focus:ring-accent mt-1 block w-24 border px-2 py-1 text-sm focus:ring-2 focus:outline-none"
                  />
                </label>

                <ConditionBuilder
                  value={targetingCondition}
                  onChange={setTargetingCondition}
                  label="このメニューを出す友だち"
                />

                {!targetingCondition && (
                  <p className="text-[11px] text-status-warn-deep">
                    条件が空です。このままだと誰にも出しません。条件を1つ以上足してください。
                  </p>
                )}
              </>
            )}
          </section>

          {/* 選択中エリア (area が選択されている時のみ追加表示) */}
          {selectedArea && activePage && (
            <section className="bg-canvas border border-hairline rounded-control shadow-card p-5">
              <AreaProperties
                area={selectedArea}
                pages={pagesForSelect}
                tags={tags}
                templates={templates}
                forms={forms}
                trackedLinks={trackedLinks}
                taps={
                  tapsByArea.has(selectedArea.id)
                    ? {
                        count: tapsByArea.get(selectedArea.id)!.taps,
                        viaTrackedLink: tapsByArea.get(selectedArea.id)!.viaTrackedLink,
                      }
                    : null
                }
                onUpdate={(patch) =>
                  updateArea(activePage.id, selectedArea.id, patch)
                }
                onDelete={() => deleteArea(activePage.id, selectedArea.id)}
              />
            </section>
          )}
        </aside>
      </div>

      {/* N-154: 複製は消える操作ではないので、危険な操作とは分けて置く。 */}
      {canOperate ? (
        <section className="mt-10 bg-canvas border border-hairline rounded-control shadow-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="text-sm font-medium text-ink">このメニューを複製</div>
              <div className="text-xs text-ink-secondary mt-0.5">
                名前・ページ・ボタン・画像・出し分けの設定を写した下書きを新しく作ります。LINE上の表示は変わりません。
              </div>
            </div>
            <Button
              type="button"
              onClick={() => {
                setConfirmError('')
                setConfirmKind('duplicate')
              }}
              disabled={saving || publishing || unpublishing || busy || duplicating}
              className="shrink-0"
            >
              複製する
            </Button>
          </div>
        </section>
      ) : null}

      {/* ─────────── 危険な操作 (画面最下部に分離) ─────────── */}
      <section className="mt-10 bg-danger-bg border border-status-danger-border rounded-control shadow-card p-5">
        <h2 className="text-sm font-semibold text-danger mb-1">危険な操作</h2>
        <p className="text-xs text-danger mb-4">
          以下の操作は元に戻せません。誤操作を避けるため、別セクションにまとめています。
        </p>
        <div className="space-y-3">
          {group.status === 'published' && (
            <div className="flex items-start justify-between gap-4 bg-canvas border border-status-danger-border rounded-control p-4">
              <div className="flex-1">
                <div className="text-sm font-medium text-ink">LINE から取り下げ</div>
                <div className="text-xs text-ink-secondary mt-0.5">
                  LINE 公式アカウント上のメニュー登録 (alias / richmenu / 全員のデフォルト設定) を解除します。
                  友だちのトーク画面からメニューが消えます。下書きに戻すので、再登録すれば復旧できます。
                </div>
              </div>
              <button
                onClick={() => {
                  setConfirmError('')
                  setConfirmKind('unpublish')
                }}
                disabled={saving || publishing || unpublishing || busy}
                className="shrink-0 px-3 py-2 text-sm font-medium border border-status-danger-border text-danger bg-canvas rounded-control hover:bg-danger-bg disabled:opacity-50 transition-colors"
              >
                {unpublishing ? '取り下げ中...' : 'LINE から取り下げ'}
              </button>
            </div>
          )}
          {activePage && pages.length > 1 && (
            <div className="flex items-start justify-between gap-4 bg-canvas border border-status-danger-border rounded-control p-4">
              <div className="flex-1">
                <div className="text-sm font-medium text-ink">
                  ページ「{activePage.name}」を削除
                </div>
                <div className="text-xs text-ink-secondary mt-0.5">
                  現在表示中のページを削除します。他のページから「タブ切替」でこのページを参照している場合は事前に解除が必要です。
                </div>
              </div>
              <button
                onClick={() => askRemovePage(activePage)}
                className="shrink-0 px-3 py-2 text-sm font-medium border border-status-danger-border text-danger bg-canvas rounded-control hover:bg-danger-bg transition-colors"
              >
                ページを削除する
              </button>
            </div>
          )}
          <div className="flex items-start justify-between gap-4 bg-canvas border border-status-danger-border rounded-control p-4">
            <div className="flex-1">
              <div className="text-sm font-medium text-ink">
                このリッチメニュー全体を削除
              </div>
              <div className="text-xs text-ink-secondary mt-0.5">
                {group.status === 'published'
                  ? '⚠ 先に「LINE から取り下げ」を実行してください。LINE 上のメニューが残ったままだと友だちに表示され続けます。'
                  : '管理画面と DB から完全に削除します。元には戻せません。'}
              </div>
            </div>
            <button
              onClick={handleDelete}
              className="shrink-0 px-3 py-2 text-sm font-medium text-on-accent rounded-control transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-danger)' }}
            >
              削除する
            </button>
          </div>
        </div>
      </section>

      {/*
        ページの削除。**`destructive` は付けない。** ここで消えるのは画面上の
        下書きだけで、保存するまで保存済みのメニューは変わらない。保存前なら
        画面を開き直せば戻る。戻せる操作に赤い窓を出すと、本当に戻せない操作
        （下の「このリッチメニュー全体を削除」）と見分けがつかなくなる。
      */}
      <ConfirmDialog
        open={confirmKind === 'removePage' && removePageTarget !== null}
        title={removePageTarget ? `ページ「${removePageTarget.name}」を削除しますか？` : ''}
        description={
          removePageTarget && removePageBlockers(removePageTarget).length > 0
            ? 'このページはいま削除できません。理由を直してから、もう一度お試しください。'
            : 'このページを編集画面から外します。保存するまで、保存済みのメニューは変わりません。'
        }
        confirmLabel="削除する"
        error={confirmError}
        // 消せないときは押し口ごと出さない。
        onConfirm={
          removePageTarget && removePageBlockers(removePageTarget).length === 0
            ? () => removePage(removePageTarget)
            : undefined
        }
        onCancel={closeConfirm}
      >
        {removePageTarget && (
          <ul className="text-ink-secondary space-y-1 text-xs leading-5">
            {removePageBlockers(removePageTarget).map((reason) => (
              <li key={reason} className="text-danger font-semibold">
                ・{reason}
              </li>
            ))}
            <li>
              ・消えること: このページに置いたボタン
              <span className="tabular-nums">{removePageTarget.areas.length}</span>
              個も一緒に外れます。
            </li>
            {/*
              `rich_menu_area_taps` には外部キーを張っていない
              （`packages/db/schema.sql`）。ボタンを消しても、押された記録は残る。
            */}
            <li>・残ること: これまでに押された回数の記録は残ります。</li>
            <li>・戻せます: 保存する前なら、この画面を開き直せば元に戻ります。</li>
          </ul>
        )}
      </ConfirmDialog>

      {/*
        消す前に名前を打ち込んでもらう。**押し間違いだけでは消えない。**
        以前はブラウザの `prompt()` で聞いていたので、設計の窓と形が違い、
        画像比較にも写らなかった。
      */}
      <ConfirmDialog
        open={confirmKind === 'deleteGroup'}
        title={group ? `「${group.name}」を削除しますか？` : ''}
        description="このリッチメニューと、中のページ・ボタンをすべて削除します。この操作は取り消せません。"
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={confirmError}
        onCancel={closeConfirm}
        onConfirm={() => void runDelete()}
      >
        <label className="block text-xs">
          <span className="text-ink-secondary font-semibold">
            確かめるため、リッチメニュー名「{group?.name}」を打ち込んでください
          </span>
          <input
            value={deleteTyped}
            onChange={(e) => setDeleteTyped(e.target.value)}
            aria-label="削除を確かめるリッチメニュー名"
            className="border-hairline rounded-control text-ink mt-1 w-full border px-3 py-2 text-sm"
          />
        </label>
      </ConfirmDialog>

      {/*
        LINE への登録。**`destructive` は付けない。**「LINEから取り下げ」で
        元に戻せる。
      */}
      <ConfirmDialog
        open={confirmKind === 'publish'}
        title="このリッチメニューをLINEに登録しますか？"
        description="いまの編集内容を保存してから、LINE公式アカウントへ登録します。"
        confirmLabel="LINEに登録する"
        busy={publishing}
        error={confirmError}
        onConfirm={() => void handlePublish()}
        onCancel={closeConfirm}
      >
        {/*
        R204: aside と公開成功案内と同じく、確認窓でも設定別に出る人を言う。
        全設定共通の「出ません／友だちに表示を実行」では、全員既定・条件ありの
        場合と矛盾する。言い回しは成功案内とそろえる。
      */}
      <ul className="text-ink-secondary space-y-1 text-xs leading-5">
          <li>・出る人: {isDefaultForAll
            ? '個別に指定した人を除く、すべての友だちの既定メニューになります。'
            : targetingEnabled
              ? (targetingCondition
                ? '条件に当てはまる人の画面に、その人に関係する出来事（友だち追加・タグ付けなど）が起きたタイミングで順次出ます。'
                : 'いまの条件では誰にも出ません（今0人）。条件を決めるか、「条件で出し分ける」をオフにしてください。')
              : 'この操作だけでは、友だちのトーク画面には出ません。出すには登録後に一覧の「表示先」から操作してください。'}</li>
          <li>・戻せます: 登録したあとでも「LINEから取り下げ」で下書きに戻せます。</li>
        </ul>
      </ConfirmDialog>

      {/*
        LINE からの取り下げ。**`destructive` は付けない。**
        もう一度登録すれば元に戻せる。
      */}
      <ConfirmDialog
        open={confirmKind === 'unpublish'}
        title="このリッチメニューをLINEから取り下げますか？"
        description="LINE公式アカウント上のメニュー登録（alias / richmenu）を解除し、下書きに戻します。"
        confirmLabel="取り下げる"
        busy={unpublishing}
        error={confirmError}
        onConfirm={() => void handleUnpublish()}
        onCancel={closeConfirm}
      >
        <ul className="text-ink-secondary space-y-1 text-xs leading-5">
          <li>・止まること: いまこのメニューを見ている友だちのトーク画面から、メニューが消えます。</li>
          <li>・残ること: 編集した中身はこの管理画面に残ります。消えるのはLINE側の登録だけです。</li>
          <li>・残ること: これまでに押された回数の記録は残ります。</li>
          <li>・戻せます: もう一度「LINEに登録」すれば、また出せます。</li>
        </ul>
      </ConfirmDialog>

      {/* N-154: 複製。写すもの・写さないものを読み合わせてから作る。 */}
      <ConfirmDialog
        open={confirmKind === 'duplicate'}
        title={group ? `「${group.name}」を複製しますか？` : ''}
        description="いまの編集内容を保存してから、下書きとして新しく作ります。"
        confirmLabel="下書きとして複製する"
        busy={duplicating}
        error={confirmError}
        onConfirm={() => void runDuplicate()}
        onCancel={closeConfirm}
      >
        <ul className="text-ink-secondary space-y-1 text-xs leading-5">
          <li>・写るもの: 名前・トークバー文言・ページ・ボタン・画像・出し分けの設定・フォルダ</li>
          <li>・写らないもの: LINEへの登録状態・公開予約・LINE側のメニューID。複製は常に下書きです。</li>
          <li>・元のメニューは変わりません。</li>
        </ul>
      </ConfirmDialog>

      {/*
        N-162: 未保存の変更がある間だけ、画面を離れる操作に確認を出す。
        保存成功後は署名が更新されて dirty が外れるので、確認は出ない。
      */}
      {leaveConfirmDialog}

      <MediaPickerDialog
        open={mediaPickerOpen}
        accountId={group.accountId}
        kind="image"
        onClose={() => setMediaPickerOpen(false)}
        onSelect={(item) => void handleMediaPick(item)}
      />

      <StickyBar actions={(
        <div className="flex items-center gap-2">
          <Checkbox
            className="mr-2"
            checked={preview}
            onCheckedChange={setPreview}
          >
            プレビュー
          </Checkbox>
          <Button variant="secondary" className="px-4 py-2 font-medium hover:bg-surface-pearl disabled:opacity-50 h-auto whitespace-normal" onClick={handleSave} disabled={saving || publishing || unpublishing || busy} busy={saving} done={saved}>
            下書きを保存する
          </Button>
          {/* #702: 共有Buttonのprimaryはaccent-deep＋白文字(5.44:1)。生のLINE緑だと2.78:1で落ちる。 */}
          <Button
            variant="primary"
            onClick={() => {
              setConfirmError('')
              setConfirmKind('publish')
            }}
            disabled={saving || publishing || unpublishing || busy} busy={publishing} busyLabel="LINE 登録中...">
            {group.status === 'published'
                ? 'LINE に再登録する'
                : 'LINE に登録する'}
          </Button>
        </div>
      )} />
    </div>
  )
}

function StepHeader({ active, groupId }: { active: 1 | 2 | 3; groupId: string }) {
  const router = useRouter()
  const steps = [
    { number: 1, label: '形とボタン', href: `/rich-menus/edit?id=${groupId}` },
    { number: 2, label: '誰に出すか', href: `/rich-menus/edit?id=${groupId}&step=targeting` },
    { number: 3, label: '公開のしかた', href: `/rich-menus/edit?id=${groupId}&step=publish` },
  ]
  /*
   * N-162: ステップ移動は同じ編集画面の中で起き、入力は消えない。
   * Link(a[href]) のままだと離脱確認のクリック捕捉に載ってしまうので、
   * 画面内の段階移動だけ router.push で行う。
   */
  return (
    <div className="border-hairline bg-canvas mb-6 grid grid-cols-3 overflow-hidden rounded-card border">
      {steps.map((step) => (
        <button
          key={step.number}
          type="button"
          onClick={() => router.push(step.href)}
          className={`flex min-w-0 items-center justify-center gap-3 border-r px-4 py-4 last:border-r-0 ${
            step.number === active ? 'bg-accent/5 text-accent-deep' : 'text-ink-secondary'
          }`}
        >
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-pill text-xs font-medium ${
            step.number === active ? 'bg-accent-deep text-on-accent' : 'bg-canvas-sunken text-ink-faint'
          }`}>{step.number}</span>
          <span className="min-w-0">
            <span className="block text-xs font-medium tracking-wider">STEP {step.number}</span>
            <span className="block truncate text-sm font-semibold">{step.label}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

function MetricValue({ metric }: { metric: RichMenuTargetPreview['matched'] | undefined }) {
  if (!metric || metric.state === 'unavailable' || metric.value === null) {
    return <span title={metric?.reason ?? '未取得'}>— <small className="text-ink-faint text-xs">（未取得）</small></span>
  }
  return <>{formatNumber(metric.value)}人</>
}

function TargetingStep({
  group,
  targetingEnabled,
  targetingPriority,
  targetingCondition,
  savedCondition,
  previewUnsaved = false,
  tags,
  preview,
  previewLoading,
  previewError,
  saving,
  onTargetingEnabled,
  onTargetingPriority,
  onTargetingCondition,
  onRefresh,
  onSave,
  saveError = null,
  saveNotice = '',
  readOnly = false,
}: {
  group: Group
  targetingEnabled: boolean
  targetingPriority: number
  targetingCondition: SegmentCondition | null
  /** 保存済みの条件。編集中の条件が保存済みかどうかの言い分けに使う。 */
  savedCondition: SegmentCondition | null
  /** 人数がまだ保存していない条件で数えられているとき true。 */
  previewUnsaved?: boolean
  tags: PickerOption[]
  preview: RichMenuTargetPreview | null
  previewLoading: boolean
  previewError: string
  saving: boolean
  onTargetingEnabled: (value: boolean) => void
  onTargetingPriority: (value: number) => void
  onTargetingCondition: (value: SegmentCondition | null) => void
  onRefresh: () => void
  onSave: () => void
  /** R205: 下書き保存の結果。この画面だけだと失敗が見えなかった。 */
  saveError?: string | null
  saveNotice?: string
  /** N-156: staffは集計だけ見る。条件の編集は owner/admin の仕事。 */
  readOnly?: boolean
}) {
  // N-162: ステップ移動は画面内の段階移動なので a[href] ではなく router.push で行う。
  const router = useRouter()
  const [conditionEditorOpen, setConditionEditorOpen] = useState(false)
  const firstRule = targetingCondition?.rules[0]
  const selectedTagName = firstRule?.type.startsWith('tag_')
    ? tags.find((tag) => tag.id === firstRule.value)?.name
    : null
  /*
   * DEEP-27: 編集中の条件が未保存なのに「保存済み」と出ると、保存した
   * つもりで画面を離れてしまう。保存済みの条件と同じかどうかで言い分ける。
   */
  const conditionUnsaved =
    JSON.stringify(targetingCondition ?? null) !== JSON.stringify(savedCondition ?? null)
  const conditionSummary = selectedTagName
    ? `タグ「${selectedTagName}」を含む`
    : targetingCondition
      ? `${conditionUnsaved ? '条件' : '保存済み条件'} ${targetingCondition.rules.length}件`
      : conditionUnsaved
        ? '保存済みの条件を外しています'
        : '条件がまだありません'
  /*
   * RICHMENU-03: 条件をONにしたのに条件が空だと、保存できず誰にも出ない
   * （STEP1 の注意と同じ）。人数APIは空条件を全員として数えるため、
   * 数字が「誰にも出ない」案内と食い違って見える。対象の説明だけを
   * STEP1 と揃え、数え方そのものは変えない。
   */
  const conditionEmpty = targetingEnabled && !targetingCondition
  return (
    <div data-design-node="kQ1bs" className="pb-24">
      <nav className="text-ink-faint mb-2 text-xs"><Link href="/rich-menus">リッチメニュー</Link><span className="mx-1.5">/</span>{group.name}</nav>
      <StepHeader active={2} groupId={group.id} />
      {/* R205: 下書き保存の結果はどの工程でも同じ位置に出す。 */}
      {saveNotice ? <Notice tone="success" message={saveNotice} className="mb-4" /> : null}
      {saveError ? <Notice tone="danger" message={saveError} className="mb-4" /> : null}

      <div className="grid gap-5 xl:grid-cols-3">
        <section className="border-hairline bg-canvas rounded-card border p-6 shadow-card xl:col-span-2">
          <h2 className="text-ink text-base font-bold">このメニューを出す相手</h2>
          <div className="mt-4">
            <RadioCardGroup legend="出す相手の選択" className="grid gap-3 sm:grid-cols-2">
              <RadioCard
                name="audience"
                value="all"
                checked={!targetingEnabled}
                disabled={readOnly}
                onChange={() => onTargetingEnabled(false)}
                title="すべての友だち"
                note="ほかのメニューに当てはまらなかった人に出る、いちばん下の受け皿になります"
              />
              <RadioCard
                name="audience"
                value="targeted"
                checked={targetingEnabled}
                disabled={readOnly}
                onChange={() => onTargetingEnabled(true)}
                title="条件に当てはまる友だちだけ"
                note="当てはまらない人には、これより下のメニューが出ます"
              />
            </RadioCardGroup>
          </div>

          {targetingEnabled ? (
            <div className="border-hairline mt-5 rounded-card border p-4">
              <div className="flex items-center justify-between gap-3"><div><p className="text-ink text-sm font-semibold">条件</p><p className="text-ink-secondary mt-1 text-xs">{conditionSummary}{conditionUnsaved ? '（未保存）' : ''}</p></div>{readOnly ? null : <Button type="button" onClick={() => setConditionEditorOpen((open) => !open)}>{conditionEditorOpen ? '編集を閉じる' : '条件を編集'}</Button>}</div>
              {conditionEditorOpen && !readOnly ? <div className="mt-4"><ConditionBuilder value={targetingCondition} onChange={onTargetingCondition} label="条件" /></div> : null}
            </div>
          ) : null}

          <div className="border-hairline mt-5 grid gap-4 border-t pt-5 sm:grid-cols-3">
            <div><p className="text-ink-faint text-xs">いま当てはまる人</p><p className="text-ink mt-1 text-2xl font-semibold">{conditionEmpty ? '0人' : previewLoading ? '確認中…' : <MetricValue metric={preview?.matched} />}</p></div>
            <div>
              <label className="text-ink-faint text-xs" htmlFor="targeting-priority">出す順番</label>
              <div className="mt-1 flex items-center gap-2"><input id="targeting-priority" aria-label="出す順番" type="number" min={1} step={1} value={targetingPriority + 1} disabled={readOnly} onChange={(event) => onTargetingPriority(Math.max(0, Number(event.target.value) - 1))} className="border-hairline rounded-control w-20 border px-3 py-2 text-lg font-bold" /><span className="text-ink-secondary text-sm">番目</span></div>
              {/* R205: 小数はサーバで弾かれる。欄の近くに制限を書く。 */}
              <p className="text-ink-faint mt-1 text-[11px]">1以上の整数（小数は使えません）</p>
            </div>
            <div><p className="text-ink-faint text-xs">実際にこのメニューが出る人</p><p className="text-ink mt-1 text-2xl font-semibold">{conditionEmpty ? '0人' : <MetricValue metric={preview?.effective} />}</p></div>
          </div>
          {previewUnsaved && !conditionEmpty ? (
            <p className="text-ink-faint mt-2 text-xs">人数はまだ保存していない条件で数えています</p>
          ) : null}
          {conditionEmpty ? (
            <Notice tone="warn" className="mt-4">条件が空です。このままだと誰にも出しません。条件を1つ以上足してください。</Notice>
          ) : preview?.overlap.value ? <Notice tone="warn" className="mt-4">このうち {formatNumber(preview.overlap.value)}人 は上の「{preview.higherMenus[0] ?? '優先メニュー'}」にも当てはまるため、そちらが出ます。</Notice> : null}
          {previewError ? <p className="text-danger mt-3 text-xs" role="alert">{previewError}</p> : null}
          <Button type="button" onClick={onRefresh} className="mt-3">人数をもう一度確認</Button>
        </section>

        <aside className="space-y-4">
          <section className="border-hairline bg-canvas rounded-card border p-5">
            <h2 className="text-ink text-sm font-bold">利用できる条件軸</h2>
            <p className="text-ink-faint mt-1 text-xs">友だち一覧の詳細検索と同じ条件を使います</p>
            <p className="text-ink-secondary mt-4 text-xs font-medium">標準互換（15軸）</p>
            <div className="text-ink-secondary mt-2 flex flex-wrap gap-1.5 text-xs">{['名前','個別メモ','ステータスメッセージ','友だち登録日','タグ','友だち情報','シナリオ','イベント予約','カレンダー予約','共通情報','リマインダ','回答フォーム','最終反応日','その他','対応マーク'].map((label) => <span key={label} className="bg-canvas-sunken rounded-mini px-2 py-1">{label}</span>)}</div>
            <p className="text-ink-secondary mt-4 text-xs font-medium">この画面だけの軸（6軸）</p>
            <div className="text-ink-secondary mt-2 flex flex-wrap gap-1.5 text-xs">{['担当者','流入経路','配信状況','予約状況','購入履歴','ブロック状態'].map((label) => <span key={label} className="bg-canvas-sunken rounded-mini px-2 py-1">{label}</span>)}</div>
          </section>
          <Notice tone="info"><strong className="block text-xs">条件はここだけの話ではありません</strong><span className="text-xs">一度作った条件は保存した検索として、配信や自動応答でも呼び出せます。</span></Notice>
        </aside>
      </div>

      <StickyBar actions={<div className="flex w-full items-center justify-between gap-3"><span className="text-ink-faint text-xs">{group.status === 'published' ? 'LINE登録済み' : '下書き（まだ誰にも出ていません）'}</span><div className="flex gap-2"><Button onClick={() => router.push(`/rich-menus/edit?id=${group.id}`)}>前へ：形とボタン</Button>{readOnly ? null : <Button onClick={onSave} disabled={saving} busy={saving}>下書きを保存する</Button>}<Button variant="primary" onClick={() => router.push(`/rich-menus/edit?id=${group.id}&step=publish`)}>次へ：公開のしかた</Button></div></div>} />
    </div>
  )
}

function PublishStep({
  group,
  pages,
  preview,
  saving,
  publishing,
  publish,
  onPublishChange,
  conditionEmpty = false,
  previewUnsaved = false,
  isDefaultForAll = false,
  targetingEnabled = false,
  saveError = null,
  saveNotice = '',
  onSave,
  onPublishNow,
  onSchedule,
  canOperate = true,
  onChanged,
}: {
  group: Group
  pages: Page[]
  preview: RichMenuTargetPreview | null
  saving: boolean
  publishing: boolean
  /*
   * 公開方法・日時・戻し先は親（編集画面全体の状態）で持つ。
   * ここで useState すると、工程の行き来で部品が外れるたびに入力が
   * 消え、「いますぐ出す」へ黙って戻る（RICHMENU-06）。
   */
  publish: PublishPlanInput
  onPublishChange: (patch: Partial<PublishPlanInput>) => void
  /** 条件をONにしたのに条件が空。STEP2と同じく 0人＋誰にも出さない案内にする。 */
  conditionEmpty?: boolean
  /** 人数がまだ保存していない条件で数えられているとき true。 */
  previewUnsaved?: boolean
  /** R204: 実際の公開効果の説明に使う、編集中（まだ保存前も含む）の対象設定。 */
  isDefaultForAll?: boolean
  targetingEnabled?: boolean
  /** R205: 下書き保存の結果をこのステップでも出す。 */
  saveError?: string | null
  saveNotice?: string
  onSave: () => void
  onPublishNow: () => void
  onSchedule: (input: RichMenuScheduleInput) => Promise<void>
  /** N-151/N-152: 履歴・再試行・照合・テスト適用は owner/admin の操作口。 */
  canOperate?: boolean
  /** 再試行・修復・テスト適用で状態が変わったとき、親が読み直す。 */
  onChanged?: () => void
}) {
  // N-162: ステップ移動は画面内の段階移動なので a[href] ではなく router.push で行う。
  const router = useRouter()
  const adminTheme = useAdminTheme()
  const v8 = adminTheme === 'v8'
  const { mode, startsAt, endsAt, restoreGroupId } = publish
  const [restoreMenus, setRestoreMenus] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    void api.richMenuGroups.list(group.accountId).then((response) => {
      if (!response.success) return
      setRestoreMenus(response.data.filter((item) => item.id !== group.id && item.status === 'published').map((item) => ({ id: item.id, name: item.name })))
    })
  }, [group.accountId, group.id])

  const [schedules, setSchedules] = useState<Array<{
    id: string
    mode: 'scheduled' | 'period'
    startsAt: string
    endsAt: string | null
    restoreGroupId: string | null
    restoreDefaultState: 'captured' | 'no_default' | null
    status: string
    attemptCount: number
    nextRetryAt: string | null
    lastErrorCode: string | null
    createdAt: string
  }>>([])
  const [schedulesNotice, setSchedulesNotice] = useState('')
  const [schedulesError, setSchedulesError] = useState('')
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void api.richMenuGroups.listSchedules(group.id).then((response) => {
      if (cancelled) return
      if (!response.success) {
        setSchedulesError('予約一覧を取得できませんでした。時間をおいて開き直してください。')
        return
      }
      setSchedulesError('')
      setSchedules(response.data)
    }).catch(() => {
      if (!cancelled) setSchedulesError('予約一覧を取得できませんでした。時間をおいて開き直してください。')
    })
    return () => { cancelled = true }
  }, [group.id])

  const refreshSchedules = useCallback(() => {
    void api.richMenuGroups.listSchedules(group.id).then((response) => {
      if (!response.success) {
        setSchedulesError('予約一覧を取得できませんでした。時間をおいて開き直してください。')
        return
      }
      setSchedulesError('')
      setSchedules(response.data)
    }).catch(() => {
      setSchedulesError('予約一覧を取得できませんでした。時間をおいて開き直してください。')
    })
  }, [group.id])

  const cancelSchedule = useCallback(async (scheduleId: string) => {
    setCancellingId(scheduleId)
    setSchedulesNotice('')
    try {
      const response = await api.richMenuGroups.cancelSchedule(group.id, scheduleId)
      if (!response.success) throw new Error(response.error)
      setSchedulesNotice('予約を取り消しました。')
      refreshSchedules()
    } catch {
      setSchedulesNotice('予約を取り消せませんでした。実行が始まっている可能性があります。')
      refreshSchedules()
    } finally {
      setCancellingId(null)
    }
  }, [group.id, refreshSchedules])

  const unconfiguredAreas = pages.reduce((count, page) => count + page.areas.filter((area) => !area.label).length, 0)
  const imageReady = pages.length > 0 && pages.every((page) => page.imageR2Key)
  const submit = () => {
    if (mode === 'now') {
      onPublishNow()
      return
    }
    if (!startsAt || (mode === 'period' && !endsAt)) return
    void onSchedule({
      mode,
      startsAt: datetimeLocalJstToUtcIso(startsAt),
      endsAt: mode === 'period' ? datetimeLocalJstToUtcIso(endsAt) : null,
      restoreGroupId: mode === 'period' ? restoreGroupId || null : null,
    }).then(() => refreshSchedules()).catch(() => refreshSchedules())
  }

  /*
   * R204残差: 「いますぐ出す」の注記も aside・確認窓・完了文と同じく設定別にする。
   * 全枝共通の「保存したらすぐ、条件に当てはまる人のトーク画面に出ます」では、
   * 条件あり（順次）・条件空（今0人）・登録のみ（登録だけ）と矛盾する。
   * 実現されていない即時は言わない。「すぐ」は全員の既定のときだけ。
   */
  const nowNote = isDefaultForAll
    ? '保存したらすぐ、個別に指定した人を除くすべての友だちの既定メニューになります'
    : targetingEnabled && conditionEmpty
      ? 'いまの条件では誰にも出ません（今0人）。条件を決めてから出してください'
      : targetingEnabled
        ? '保存するとLINEに登録され、条件に当てはまる人の画面に出来事のタイミングで順次出ます'
        : 'LINEへの登録だけで、友だちの画面は変わりません。出す相手は一覧の「表示先」で決めてください'

  const body = (<>
      <nav className="text-ink-faint mb-2 text-xs"><Link href="/rich-menus">リッチメニュー</Link><span className="mx-1.5">/</span>{group.name}</nav>
      <StepHeader active={3} groupId={group.id} />
      {/* R205: 下書き保存の結果はどの工程でも同じ位置に出す。 */}
      {saveNotice ? <Notice tone="success" message={saveNotice} className="mb-4" /> : null}
      {saveError ? <Notice tone="danger" message={saveError} className="mb-4" /> : null}
      <div className="grid gap-5 xl:grid-cols-3">
        <section className="border-hairline bg-canvas rounded-card border p-6 shadow-card xl:col-span-2">
          <h2 className="text-ink text-base font-bold">いつ出すか</h2>
          <div className="mt-4">
            <RadioCardGroup legend="公開時期の選択" className="grid gap-3">
              {[
                ['now', 'いますぐ出す', nowNote],
                ['scheduled', '日時を決めて出す', '指定した時刻にLINEへ登録する予約です。誰の画面に出るかは「公開すると何が変わるか」で確認してください'],
                ['period', '期間を決める', '指定した期間だけLINEに登録し、終わったら切り替えを予約します。誰の画面に出るかは「公開すると何が変わるか」で確認してください'],
              ].map(([value, label, note]) => (
                <RadioCard
                  key={value}
                  name="publish-mode"
                  value={value}
                  checked={mode === value}
                  onChange={(next) => onPublishChange({ mode: next as PublishPlanInput['mode'] })}
                  title={label}
                  note={note}
                />
              ))}
            </RadioCardGroup>
          </div>
          {mode !== 'now' ? (
            <div className="border-hairline mt-5 grid gap-4 border-t pt-5 sm:grid-cols-2">
              <span className="text-ink-secondary text-xs font-semibold">出しはじめ<DateTimeField aria-label="出しはじめ" value={startsAt} onChange={(v) => onPublishChange({ startsAt: v })} className="mt-1" /></span>
              {mode === 'period' ? <span className="text-ink-secondary text-xs font-semibold">出しおわり<DateTimeField aria-label="出しおわり" value={endsAt} onChange={(v) => onPublishChange({ endsAt: v })} className="mt-1" /></span> : null}
              {mode === 'period' ? <label className="text-ink-secondary text-xs font-semibold sm:col-span-2">終わったらどうする<Select aria-label="終わったらどうする" value={restoreGroupId} onChange={(value) => onPublishChange({ restoreGroupId: value })} options={[{ value: '', label: '前のメニューに戻す（実行開始時に確定）' }, ...restoreMenus.map((item) => ({ value: item.id, label: item.name }))]} className="mt-1" /><span className="text-ink-faint mt-1 block text-xs">{restoreGroupId ? '終了時に選んだメニューへ戻します。' : '「前のメニューに戻す」は実行開始の直前、そのときに表示中のメニューに確定します。表示中のメニューが無い場合は終了時に表示を外します。'}</span></label> : null}
            </div>
          ) : null}

          <div className="border-hairline mt-6 border-t pt-5">
            <h2 className="text-ink text-sm font-bold">公開前チェック</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {conditionEmpty ? (
                <li className="text-warning">⚠ 条件が空です。このままだと誰にも出しません（0人）。STEP2「誰に出すか」で条件を足してください。</li>
              ) : (
                <li className="text-success">✓ 誰に出すかが決まっています（<MetricValue metric={preview?.matched} />{previewUnsaved ? '・未保存の条件で計算' : ''}）</li>
              )}
              <li className={imageReady ? 'text-success' : 'text-warning'}>{imageReady ? '✓' : '⚠'} 画像が登録されています{imageReady ? '' : '（未設定のページがあります）'}</li>
              <li className={unconfiguredAreas === 0 ? 'text-success' : 'text-warning'}>{unconfiguredAreas === 0 ? '✓ すべてのボタン名が設定されています' : `⚠ ボタン名が未設定の場所が ${unconfiguredAreas}件 あります`}</li>
              {!conditionEmpty && preview?.overlap.value ? <li className="text-warning">⚠ 上の「{preview.higherMenus[0] ?? '優先メニュー'}」と {formatNumber(preview.overlap.value)}人 が重なっています</li> : null}
            </ul>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="border-hairline bg-canvas rounded-card border p-5"><h2 className="text-ink text-sm font-semibold">このメニューの設定</h2><dl className="mt-4 space-y-3 text-xs"><div><dt className="text-ink-faint">誰に出るか</dt><dd className="text-ink mt-1 font-semibold">{conditionEmpty ? '0人' : <MetricValue metric={preview?.effective} />}{previewUnsaved && !conditionEmpty ? <span className="text-ink-faint ml-1 font-normal">（未保存の条件）</span> : null}</dd></div><div><dt className="text-ink-faint">形</dt><dd className="text-ink mt-1 font-semibold">{group.size === 'large' ? '大' : '小'}・切替あり {pages.length}枚</dd></div><div><dt className="text-ink-faint">終わったら</dt><dd className="text-ink mt-1 font-semibold">{mode === 'period' ? restoreMenus.find((item) => item.id === restoreGroupId)?.name ?? '前のメニューに戻す' : '指定なし'}</dd></div></dl></section>
          {v8 ? (
            <section aria-label="いまの状態" className="border-hairline bg-canvas rounded-card border p-5">
              <h2 className="text-ink text-sm font-semibold">いまの状態</h2>
              <dl className="mt-4 space-y-3 text-xs">
                <div className="flex items-baseline justify-between gap-3"><dt className="text-ink-faint">状態</dt><dd className="text-ink font-semibold">{group.status === 'published' ? '公開中' : '下書き'}</dd></div>
                <div className="flex items-baseline justify-between gap-3"><dt className="text-ink-faint">出す相手</dt><dd className="text-ink text-right font-semibold">{isDefaultForAll ? 'すべての友だち' : targetingEnabled ? '条件に合う人' : '—'}</dd></div>
                <div className="flex items-baseline justify-between gap-3"><dt className="text-ink-faint">出る人</dt><dd className="text-ink font-semibold">{conditionEmpty ? '0人' : <MetricValue metric={preview?.effective} />}</dd></div>
              </dl>
            </section>
          ) : null}
          {/*
            R204: 「公開」は LINE への登録。全員の画面が変わるのは
            isDefaultForAll（全員の既定）のときだけ。条件で出し分ける設定は、
            その人の出来事（友だち追加・タグ付け）が起きたときに順次切り替わる。
            どちらでもない公開は登録だけで、表示は一覧の「表示先」から行う。
          */}
          <Notice tone="info"><h2 className="text-sm font-bold">公開すると何が変わるか</h2>
            {isDefaultForAll ? (
              <p className="mt-2 text-xs">このアカウントの既定メニューになります。個別に別のメニューを指定されている人以外の、すべての友だちのトーク画面に出ます。</p>
            ) : targetingEnabled && conditionEmpty ? (
              <p className="mt-2 text-xs">出す条件が空のため、公開しても今は誰の画面にも出ません。前の工程で条件を決めるか、一覧の「表示先」から出す相手を選んでください。</p>
            ) : targetingEnabled ? (
              <p className="mt-2 text-xs">LINEに登録されます。条件にいま当てはまる <MetricValue metric={preview?.effective} /> のメニューは、その人に関係する出来事（友だち追加・タグ付けなど）が起きたタイミングで順次切り替わります。すぐ全員に出るわけではありません。</p>
            ) : (
              <p className="mt-2 text-xs">LINEへの登録だけでは、友だちのトーク画面は変わりません。公開のあと、一覧の「表示先」で出す相手を決めてください。</p>
            )}
            <p className="mt-2 text-xs">LINEへの反映は数分かかることがあります。</p>
          </Notice>
          {/* N-152: 全員へ出す前に、自分のLINEだけで見え方を確かめる。 */}
          {canOperate ? <TestApplySection groupId={group.id} /> : null}
          {/* O-1: 公開の前の確認。プレビューだけでは公開できない。 */}
          {canOperate ? <PrepublishCheckSection groupId={group.id} /> : null}
        </aside>
      </div>
      <section aria-label="公開予約の一覧" className="border-hairline bg-canvas rounded-card mt-5 border p-6">
        <h2 className="text-ink text-sm font-bold">公開予約の一覧</h2>
        {schedulesNotice ? <p role="status" className="text-ink mt-2 text-xs">{schedulesNotice}</p> : null}
        {schedulesError ? <p role="alert" className="text-danger mt-2 text-xs">{schedulesError}</p> : null}
        {!schedulesError ? (schedules.length === 0 ? (
          <p className="text-ink-faint mt-2 text-xs">まだ公開予約はありません。日時を決めて予約するとここに出ます。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {schedules.map((item) => (
              <li key={item.id} className="border-hairline flex flex-wrap items-center justify-between gap-2 rounded-mini border px-3 py-2 text-xs">
                <span className="text-ink">
                  {formatDateTime(item.startsAt)} 開始
                  {item.mode === 'period' && item.endsAt ? ` 〜 ${formatDateTime(item.endsAt)}` : ''}
                  {' ・ '}
                  {item.status === 'scheduled' ? '予約中'
                    : item.status === 'publishing' ? '公開処理中'
                    : item.status === 'published' ? '期間公開中'
                    : item.status === 'restoring' ? '復元処理中'
                    : item.status === 'completed' ? '完了'
                    : item.status === 'cancelled' ? '取消済み'
                    : item.status === 'failed' ? '失敗・要対応' : item.status}
                  {item.status === 'failed' && item.lastErrorCode ? `（${item.lastErrorCode.slice(0, 40)}）` : ''}
                  {item.nextRetryAt ? ` ・ 次回 ${formatDateTime(item.nextRetryAt)}` : ''}
                  {item.mode === 'period' ? (item.restoreGroupId ? ` ・ 戻し先 ${restoreMenus.find((menu) => menu.id === item.restoreGroupId)?.name ?? item.restoreGroupId}` : item.restoreDefaultState === 'captured' ? ' ・ 戻し先確定済み（切替前の表示へ戻す）' : item.restoreDefaultState === 'no_default' ? ' ・ 戻し先なし（終了時に表示を外す）' : ' ・ 戻し先は実行開始時に確定') : ''}
                </span>
                {item.status === 'scheduled' ? (
                  <Button
                    onClick={() => void cancelSchedule(item.id)}
                    disabled={cancellingId === item.id} busy={cancellingId === item.id} busyLabel="取消中…">予約を取り消す
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )) : null}
      </section>
      {/* K-1: 公開の進み。失敗した段だけ「失敗」にし、もう一度公開できる。 */}
      {canOperate ? <PublishProgressSection groupId={group.id} onRetry={submit} /> : null}
      {/* N-151: 公開の履歴・失敗だけの再試行・LINEとの照合修復。 */}
      {canOperate ? <PublishHistorySection groupId={group.id} onChanged={onChanged} /> : null}
      {/*
       * hKr8f: 切替のつながり。V8だけ出す（v7 UMiJ9 は変えない）。
       * いまの状態は実データだけ出す
       * （出る人数・今月押された回数の口は無いので載せない）。
       */}
      {v8 ? (
      <section aria-label="切替のつながり" className="border-hairline bg-canvas rounded-card mt-5 border p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-ink text-sm font-bold">切替のつながり</h2>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push(`/rich-menus/connections?id=${encodeURIComponent(group.id)}`)}
            >
              切替のつながりを見る
            </Button>
            <Button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} title="メニューの編集に戻ります">
              編集する
            </Button>
          </div>
        </div>
        <p className="text-ink-secondary mt-3 text-xs leading-5">
          いまの状態：{group.status === 'published' ? '公開中' : '下書き'}
          ・出す相手 {isDefaultForAll ? 'すべての友だち（既定）' : targetingEnabled ? '出し分け条件に合う友だち' : 'すべての友だち'}
        </p>
      </section>
      ) : null}
      {/* N-156: staff は公開・保存を押せない（サーバ側も 403 で止める）。 */}
      <StickyBar actions={<div className="flex w-full items-center justify-between gap-3"><Button onClick={() => router.push(`/rich-menus/edit?id=${group.id}&step=targeting`)}>前へ：誰に出すか</Button><div className="flex gap-2">{canOperate ? <><Button onClick={onSave} disabled={saving || publishing}>下書きを保存する</Button><Button variant="primary" onClick={submit} disabled={saving || publishing || (mode !== 'now' && !startsAt) || (mode === 'period' && !endsAt)} busy={publishing} busyLabel="公開中…">{mode === 'now' ? 'この内容で公開する' : 'この内容で予約する'}</Button></> : <span className="text-ink-faint text-xs">閲覧のみ（公開・保存は管理者の操作です）</span>}</div></div>} />
    </>)
  return v8 ? (
    <div data-design-node="hKr8f" className="pb-24">{body}</div>
  ) : (
    <div data-design-node="UMiJ9" className="pb-24">{body}</div>
  )
}

/**
 * 試験からだけ使う出し口。公開手順の画面を、本物のReactで単体で動かして
 * 「押したときに実際どうなるか」を確かめるために使う（#621）。
 */
RichMenuEditPage.__testing = { PublishStep }
