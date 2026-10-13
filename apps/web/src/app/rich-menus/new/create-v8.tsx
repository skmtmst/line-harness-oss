'use client'

import ListState from '@/components/shared/list-state'
import Toggle from '@/components/shared/toggle';

import { useFeatureAccess } from '@/lib/use-feature-access'
import { useStaffRole } from '@/lib/staff-role'
import { SaveConflictBand } from '@/components/shared/save-conflict'
import { CreatePage } from '@/components/templates'
import { Steps } from '@/components/templates/steps'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from '@/components/shared/list-navigation'
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  CircleHelp,
  Send,
  Users,
  Zap,
  Circle,
  CircleCheck,
  CircleAlert,
  RectangleHorizontal,
  RectangleVertical,
  Repeat,
  Smartphone,
} from 'lucide-react'
import {
  RICH_MENU_DIMENSIONS,
  RICH_MENU_MAX_PAGES,
  type Folder,
  type MediaItem,
} from '@line-crm/shared'
import Card from '@/components/shared/card'
import LayoutPicker from '@/components/shared/layout-picker'
import TargetMissing from '@/components/shared/target-missing'
import { Field, TextInput, OptionalBadge } from '@/components/shared/form-controls'
import { useFormErrors } from '@/lib/use-form-errors'
import SectionHeader from '@/components/shared/section-header'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { notifyToast } from '@/components/shared/toast'
import Select from '@/components/shared/select'
import FolderSelect, { folderById, folderCreator } from '@/components/shared/folder-select'
import SegmentedControl from '@/components/shared/segmented'
import { SettingCheckbox } from '@/components/shared/checkbox'
import DateTimeField from '@/components/shared/date-time-field'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import ConditionBuilder from '@/components/shared/condition-builder'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import VersionCompare from '@/components/shared/version-compare'
import LinePreview from '@/components/shared/line-preview'
import TapAreaEditor from '@/components/shared/tap-area-editor'
import MediaSlot from '@/components/shared/media-slot'
import { CreateSummaryCard } from '@/components/templates/create-parts'
import { CanvasEditor, areaDisplayName, type Area } from '@/components/rich-menus/canvas-editor'
import { AreaProperties, intentLabelOf, intentOf } from '@/components/rich-menus/area-properties'
import { pruneStaleAreaTags, pruneStaleAreaTemplates } from '@/components/rich-menus/action-drafts'
import {
  NEW_MENU_INTENTS_WITH_SWITCH,
} from '@/components/rich-menus/rich-menu-create-form'
import {
  createAreaDrafts,
  isAreaActionConfigured,
} from '@/components/rich-menus/action-drafts'
import MediaPickerDialog from '@/app/contents/media-picker-dialog'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import {
  api,
  ApiError,
  type RichMenuGroupListItem,
  type RichMenuScheduleInput,
  type RichMenuTargetPreview,
} from '@/lib/api'
import {
  describeApiFailure,
  isForbidden,
  isForbiddenOrRateLimited,
  loadFailureNotice,
} from '@/components/shared/api-error-message'
import { TEMPLATES, type RichMenuTemplate } from '@/lib/rich-menu-templates'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import {
  isEmptyCondition,
  pruneCondition,
  type SegmentCondition,
} from '@/lib/segment-condition'
import { datetimeLocalJstToUtcIso } from '@/lib/jst-datetime'
import { formatDateTime, formatNumber } from '@/lib/format'
import { orderTargetingGroups } from '@/v8/rich-menus/targeting-order'
import { describeCondition } from '@/components/scenarios/scenario-dialogs'
import { useScheduleSubmit } from '@/app/rich-menus/edit/schedule-submit'
import { ManualPublishAttempt } from '@/app/rich-menus/edit/manual-publish-attempt'
import {
  DEFAULT_PUBLISH_PLAN,
  clearPublishPlanDraft,
  loadPublishPlanDraft,
  savePublishPlanDraft,
  type PublishPlanInput,
} from '@/app/rich-menus/edit/publish-plan-draft'
import styles from './create-v8.module.css'
import type { RichMenuCreateHost } from '@/lib/rich-menu-create-host'
import { HQ_RICH_MENU_INTENTS, type HqRichMenuSeed } from '@/lib/hq-rich-menu-create'
import { emptyValue } from '@/components/shared/empty-value'
import NumberInput from '@/components/shared/number-field'
import RichMenuTestApply from '@/v8/rich-menu-edit/test-apply'
import RichMenuSchedules from '@/v8/rich-menu-edit/schedules'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import EntitySelect, { entityOptionMetadata } from '@/components/shared/entity-select'
import { SettingsFormRow } from '@/components/shared/settings-form-card'

/*
 * ★V8 リッチメニューを作る（作る①〜④のウィザード）。
 *
 * Pencil の正本：
 *   ① 形と画像 `JeINq` / ② ボタンの動き `Z0uO6` / ③ 誰に出すか `OxEMM` / ④ 公開 `F4gELj`
 *
 * 立て付け：
 * - 「次へ：ボタンの動き」で下書き（rich_menu_groups）を作る。手順②以降は
 *   保存済みページに対して画像アップロード・公開前確認がそのまま使える。
 * - 形（大きさ・面の分けかた・タブ数）は作成 API だけが受け付ける。
 *   下書きができたあと手順①へ戻ると、それらは読み取り専用になる。
 * - 公開・予約・実機確認・照合の運用ロジックは編集画面（edit/）と同じ
 *   部品・関数を使い回し、別実装にしない。
 */

/* ---------- 手順 ---------- */

const STEP_KEYS = ['shape', 'buttons', 'audience', 'publish'] as const
type StepKey = (typeof STEP_KEYS)[number]

const STEP_LABEL: Record<StepKey, string> = {
  shape: '形と画像',
  buttons: 'ボタンの動き',
  audience: '誰に出すか',
  publish: '公開',
}

const NEXT_LABEL: Record<Exclude<StepKey, 'publish'>, string> = {
  shape: '次へ：ボタンの動き',
  buttons: '次へ：誰に出すか',
  audience: '次へ：公開',
}

/* ---------- 面の見本（作る①「面の分け方」。Pencil では大きい側が7つ） ---------- */

const V8_LAYOUT_KEYS: Record<'large' | 'compact', string[]> = {
  large: [
    'large-full',
    'large-1x2-v',
    'large-1x2-h',
    'large-1plus2',
    'large-2x2',
    'large-2plus1',
    'large-2x3',
  ],
  compact: ['compact-full', 'compact-2x1', 'compact-3x1', 'compact-4x1'],
}

/** Pencil の札に合わせた短い名前。 */
const V8_LAYOUT_LABEL: Record<string, string> = {
  'large-full': '1面',
  'large-1x2-v': '上下2面',
  'large-1x2-h': '左右2面',
  'large-1plus2': '上1・下2',
  'large-2x2': '4面',
  'large-2plus1': '上2・下1',
  'large-2x3': '6面',
  'compact-full': '1面',
  'compact-2x1': '左右2面',
  'compact-3x1': '横3面',
  'compact-4x1': '横4面',
}

const SIZE_OPTIONS: Array<{
  value: 'large' | 'compact'
  label: string
  dims: string
  hint: string
  /* 板 `JeINq`：絵の印は形の印（大＝縦長・小＝横長）。札の印にしない。 */
  icon: typeof RectangleVertical
}> = [
  {
    value: 'large',
    label: '大きい',
    dims: `${RICH_MENU_DIMENSIONS.large.width}×${RICH_MENU_DIMENSIONS.large.height}`,
    hint: '画面をしっかり使う。ボタン6つまで',
    icon: RectangleVertical,
  },
  {
    value: 'compact',
    label: '小さい',
    dims: `${RICH_MENU_DIMENSIONS.compact.width}×${RICH_MENU_DIMENSIONS.compact.height}`,
    hint: 'トークが隠れにくい。横に並べる',
    icon: RectangleHorizontal,
  },
]

const TAB_COUNT_OPTIONS = [
  { value: '0', label: 'なし' },
  { value: '1', label: '2つ' },
  { value: '2', label: '3つ' },
]

/** ①で選べる切替タブの数の上限（ページの数。LINE 側の上限より多くしない）。 */
const MAX_TAB_PAGES = Math.min(RICH_MENU_MAX_PAGES, TAB_COUNT_OPTIONS.length)

/** 作る前に①で選んだ画像（タブごとに1枚）。ファイルか登録メディアのどちらか。 */
type PendingImage = {
  file: File | null
  url: string | null
  dims: { w: number; h: number } | null
  media: MediaItem | null
}

/* ---------- 型 ---------- */

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
  targetingCondition: string | null
  targetingPriority: number
  targetingEnabled: boolean
  folderId: string | null
  defaultOpen: boolean
  version: number
  pages: Page[]
}

/** 古い口や途中の応答を、そのまま編集用の型に断定しない。 */
function isGroupResponse(value: unknown): value is Group {
  if (!value || typeof value !== 'object') return false
  return 'id' in value && typeof value.id === 'string'
    && 'name' in value && typeof value.name === 'string'
    && 'pages' in value && Array.isArray(value.pages)
}

type CheckState = 'ok' | 'ng' | 'yet'
type PrepublishState = {
  self: { state: 'ok' | 'ng'; message: string | null }
  line: { state: CheckState; message: string | null }
  device: { state: 'ok' | 'yet'; at: string | null }
  pages: { state: 'ok' | 'ng'; count: number; max: number }
}

/* ---------- 補助（edit/page.tsx と同じ写し。page.tsx は部品を export できないため） ---------- */

/*
 * ★V8 `r8dGXT`「違いを比べる」の比べる文。版の本文ではなく設定の要約。
 * 最新と入力中の2つを作り、VersionCompare（行ごとの比べる）へ渡す。
 */
function describeMenuSummary(input: {
  name: string
  chatBarText: string
  audienceAll: boolean
  pages: Array<{ areas: unknown[] }>
}): string {
  const areaCount = input.pages.reduce((total, page) => total + page.areas.length, 0)
  return [
    `名前：${input.name || emptyValue('unconfigured')}`,
    `言葉：${input.chatBarText || emptyValue('unconfigured')}`,
    `出す相手：${input.audienceAll ? 'みんな' : '条件あり'}`,
    `面の数：${input.pages.length}`,
    `ボタンの数：${areaCount}`,
  ].join('\n')
}

/** 保存されている条件を読む。壊れた JSON は「条件なし」。 */
function parseStoredCondition(raw: string | null): SegmentCondition | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as SegmentCondition
  } catch {
    return null
  }
}

/** 保存に送る面の投影。署名・PATCH 両方に使う。 */
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

const SIZE_LABEL: Record<'large' | 'compact', string> = {
  large: `${RICH_MENU_DIMENSIONS.large.width}×${RICH_MENU_DIMENSIONS.large.height}`,
  compact: `${RICH_MENU_DIMENSIONS.compact.width}×${RICH_MENU_DIMENSIONS.compact.height}`,
}

/** 画像エラーのサーバ原文（英語）を日本語に写す。 */
function imageUploadErrorText(err: unknown): string {
  const fallback = '画像を読み込めませんでした。もう一度お試しください。'
  if (!(err instanceof ApiError)) return fallback
  const message =
    err.status === 400 && err.message && !/^API error: /.test(err.message) ? err.message : ''
  if (!message) return fallback
  if (
    message.includes('content-type must be image/png or image/jpeg') ||
    message.includes('unrecognized image format')
  ) {
    return '画像の形式はPNGかJPEGにしてください。'
  }
  if (message.includes('exceeds 1MB limit')) {
    return '画像が大きすぎます。1MB以下の画像を選んでください。'
  }
  if (message.includes('dimensions ')) {
    return `画像の大きさが合いません。${SIZE_LABEL.large}（大）か${SIZE_LABEL.compact}（小）の画像を選んでください。`
  }
  return message
}

/** 登録メディアの中身を取り寄せて、ページ画像として上げられるファイルにする。 */
async function mediaToFile(item: MediaItem, accountId: string): Promise<File> {
  const res = await fetch(api.media.contentUrl(item.id, accountId), { credentials: 'include' })
  if (!res.ok) throw new Error(`media fetch failed: ${res.status}`)
  const blob = await res.blob()
  return new File([blob], item.filename, {
    type: item.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png',
  })
}

/** 公開前の下書きはページに実IDがない。切替ボタンの行き先は orderIndex で持つ（N-161）。 */
function areaDraftsWithSwitchTargets(areas: Area[]) {
  return areas.map((area) => {
    if (area.actionType !== 'richmenuswitch') return projectAreaForDraft(area)
    const raw = area.actionData?.targetPageId
    const index = typeof raw === 'string' ? Number(raw) : NaN
    const { targetPageId: _dropped, ...rest } = (area.actionData ?? {}) as Record<string, unknown>
    return {
      ...projectAreaForDraft(area),
      actionData: Number.isInteger(index) ? { ...rest, targetPageIndex: index } : rest,
    }
  })
}

/* ---------- 小部品 ---------- */

function MetricValue({ metric }: { metric: RichMenuTargetPreview['matched'] | undefined }) {
  if (!metric) return <>—</>
  if (metric.state !== 'available' || metric.value === null) {
    return <>数えられません</>
  }
  return <>{formatNumber(metric.value)}人</>
}

function CheckIcon({ state }: { state: CheckState }) {
  if (state === 'ok') return <CircleCheck className={`${styles.checkIcon} ${styles.checkIconOk}`} aria-hidden />
  if (state === 'ng') return <CircleAlert className={`${styles.checkIcon} ${styles.checkIconNg}`} aria-hidden />
  return <Circle className={`${styles.checkIcon} ${styles.checkIconYet}`} aria-hidden />
}

/**
 * LINEでの見え方の中身（スマホの下・入力の帯の位置に出すリッチメニュー）。画像があれば実画像に面の線を重ね、
 * 無ければ面の線（点線）だけ出し「画像を選ぶと、ここに出ます」（仕様書・公式照合より）。
 * 下の帯（トーク画面の下の文言 ∨）は LinePreview が1本だけ描く（gobhu）。
 */
function MenuPreview({
  size,
  imageUrl,
  areas,
  pages,
  activePageId,
}: {
  size: 'large' | 'compact'
  imageUrl: string | null
  areas: Array<{ x: number; y: number; w: number; h: number }> | null
  pages: Array<{ id: string; name: string }>
  activePageId: string | null
}) {
  const dims = RICH_MENU_DIMENSIONS[size]
  const areaBoxes = areas && areas.length > 0 ? (
    <div className={styles.previewMenuAreas} aria-hidden="true">
      {areas.map((a, i) => (
        <span
          key={i}
          className={styles.previewMenuAreaBox}
          style={{
            left: `${(a.x / dims.width) * 100}%`,
            top: `${(a.y / dims.height) * 100}%`,
            width: `${(a.w / dims.width) * 100}%`,
            height: `${(a.h / dims.height) * 100}%`,
          }}
        />
      ))}
    </div>
  ) : null
  return (
    <div>
      {pages.length > 1 ? (
        <div className={styles.previewMenuTabs} aria-hidden="true">
          {pages.map((p) => (
            <span key={p.id} className={p.id === activePageId ? `${styles.previewMenuTab} ${styles.previewMenuTabOn}` : styles.previewMenuTab}>
              {p.name}
            </span>
          ))}
        </div>
      ) : null}
      {imageUrl ? (
        <div className={styles.previewMenuImage}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 認証つきの管理用URL */}
          <img src={imageUrl} alt="メニューの画像" />
          {areaBoxes}
        </div>
      ) : (
        <div
          className={styles.previewMenuEmpty}
          data-rich-menu-size={size}
          style={{ aspectRatio: `${dims.width} / ${dims.height}` }}
        >
          {areaBoxes}
          <span className={styles.previewMenuEmptyText}>
            画像を選ぶと、ここに出ます
            {areas && areas.length > 0 ? `（${areas.length}面）` : ''}
          </span>
        </div>
      )}
    </div>
  )
}

/* ---------- 統括のひな形（host）の画面の中の下書き ---------- */

/** 統括のひな形の中身を、作る画面の下書き（Group）にする。サーバーには作らない。 */
function groupFromSeed(seed: HqRichMenuSeed): Group {
  return {
    id: seed.id ?? 'hq-draft',
    accountId: '',
    name: seed.name,
    chatBarText: seed.chatBarText,
    size: seed.size,
    defaultPageId: seed.defaultPageId,
    isDefaultForAll: seed.displayAudience === 'all',
    status: 'draft',
    targetingCondition: null,
    targetingPriority: seed.displayOrder,
    targetingEnabled: seed.displayAudience === 'store',
    folderId: seed.folderId,
    defaultOpen: true,
    version: 0,
    pages: seed.pages.map((page, index) => ({
      id: page.id, orderIndex: index, name: page.name, aliasId: '', lineRichmenuId: null,
      imageR2Key: page.imageR2Key, imageContentType: null, areas: page.areas,
    })),
  }
}

/* ---------- 本体 ---------- */

/**
 * URL の手順の名前を、作るウィザードの手順へ読み替える。
 * 編集画面（/rich-menus/edit）は昔から `targeting`・`publish` を使っているので、同じ指定で同じ所を開く。
 */
function stepFromParam(key: string | null): StepKey | null {
  if (!key) return null
  if ((STEP_KEYS as readonly string[]).includes(key)) return key as StepKey
  if (key === 'targeting') return 'audience'
  if (key === 'actions' || key === 'areas') return 'buttons'
  return null
}

/**
 * `editGroupId` を渡すと、その下書き（またはいまのメニュー）を読み込んで同じウィザードで直す
 * （/rich-menus/edit の V8）。読み込むまでは手順の中身を出さず、すべての手順へ戻れる。
 */
export default function RichMenuCreateV8({ editGroupId, host }: { editGroupId?: string; host?: RichMenuCreateHost } = {}) {
  const saveErrors = useSaveFormErrors()
  usePageTitle(host ? 'リッチメニュー' : 'リッチメニューを作る')
  /*
   * 統括のひな形（host）：手順の間は画面の中に持ち、最後に一度だけ保存する（店はこれまでどおり手順ごとに下書きを保存）。
   * 統括の画面で持てない欄（登録メディア・計測リンク・トークを開いたとき・出す相手の条件・公開の確かめ）は出さない。
   */
  const stepLabel = (key: StepKey) => (host && key === 'publish' ? '配る' : STEP_LABEL[key])
  const nextLabel = (key: Exclude<StepKey, 'publish'>) => (host && key === 'audience' ? '次へ：配る' : NEXT_LABEL[key])
  const { selectedAccount } = useAccount()
  const publishAttempt = useRef(new ManualPublishAttempt())
  /* ①の画像の枠ごとのファイル入力（タブの順）。 */

  /*
   * 重ねの撮影用に `?step=buttons|audience|publish` で最初の手順を指定できる。
   * 後の移動は中の状態だけ（URLは書かない）。
   */
  const [step, setStep] = useState<StepKey>(() => {
    if (typeof window === 'undefined') return 'shape'
    return stepFromParam(new URLSearchParams(window.location.search).get('step')) ?? 'shape'
  })
  /* 直すときは、すでに下書きがあるので全部の手順へ戻れる。 */
  const [maxStepIndex, setMaxStepIndex] = useState(editGroupId || host?.initial ? STEP_KEYS.length - 1 : 0)
  /* 直すとき：下書きを読み込めたか（読み込むまで中身を出さない）。 */
  const [editLoad, setEditLoad] = useState<'idle' | 'loading' | 'ready' | 'missing' | 'forbidden' | 'error'>(editGroupId ? 'loading' : 'idle')

  /* 作った下書き。手順①の「次へ」で create → get で埋まる。 */
  const [group, setGroup] = useState<Group | null>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null)
  const [imageGuideOpen, setImageGuideOpen] = useState(false)
  const [imageVersion, setImageVersion] = useState(0)

  /* 手順① */
  const [name, setName] = useState('')
  const [chatBarText, setChatBarText] = useState('メニュー')
  const [folderId, setFolderId] = useState('')
  const [size, setSize] = useState<'large' | 'compact'>('large')
  const [tabCount, setTabCount] = useState(0)
  const [templateKey, setTemplateKey] = useState('large-2x3')
  /* 作る前のタブごとの画像と名前（タブの順。0 は最初に見せるページ）。作った後はページが持つ。 */
  const [pendingImages, setPendingImages] = useState<Array<PendingImage | null>>([])
  const [tabNames, setTabNames] = useState<string[]>([])
  /* ①でタブを減らすとき、消えるタブに設定があれば確かめる（その間の次の数）。 */
  const [pendingTabCount, setPendingTabCount] = useState<number | null>(null)

  /* 手順③ */
  const [audience, setAudience] = useState<'all' | 'targeted' | 'none'>('all')
  const [targetingCondition, setTargetingCondition] = useState<SegmentCondition | null>(null)
  const [targetingPriority, setTargetingPriority] = useState(0)
  const [priorityOpen, setPriorityOpen] = useState(false)
  const [priorityInput, setPriorityInput] = useState('1')
  const [defaultOpen, setDefaultOpen] = useState(true)

  /* 手順④ */
  const [publishPlan, setPublishPlan] = useState<PublishPlanInput>(DEFAULT_PUBLISH_PLAN)
  const [publishBaseline, setPublishBaseline] = useState<PublishPlanInput>(DEFAULT_PUBLISH_PLAN)
  const [endEnabled, setEndEnabled] = useState(false)
  const [checks, setChecks] = useState<PrepublishState | null>(null)
  const [checksLoading, setChecksLoading] = useState(false)
  const [checksError, setChecksError] = useState(false)
  const [validating, setValidating] = useState(false)
  const [recording, setRecording] = useState(false)
  const [restoreMenus, setRestoreMenus] = useState<Array<{ id: string; name: string }>>([])

  /* 候補・他メニュー・権限 */
  const [folders, setFolders] = useState<Folder[]>([])
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([])
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([])
  const [forms, setForms] = useState<Array<{ id: string; name: string }>>([])
  const [trackedLinks, setTrackedLinks] = useState<Array<{ id: string; name: string }>>([])
  const [otherMenus, setOtherMenus] = useState<RichMenuGroupListItem[]>([])
  const staffRole = useStaffRole()
  const [loadError, setLoadError] = useState<unknown>(null)
  const [loadFailedKinds, setLoadFailedKinds] = useState<string[]>([])
  const [candidateScope, setCandidateScope] = useState<{
    accountId: string | null; tags: Set<string> | null; templates: Set<string> | null
  } | null>(null)
  const candidateLoadGeneration = useRef(0)
  const candidateAccountRef = useRef<string | null>(null)
  const [candidatePruneNotice, setCandidatePruneNotice] = useState('')

  /* 状態 */
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  /*
   * ★V8 `r8dGXT`：なおし中にほかの人が先に保存した（409）。
   * 入力は残したまま、帯で知らせる。名前・時刻は API に無いので出さない。
   */
  const [conflict, setConflict] = useState(false)
  const [conflictLatest, setConflictLatest] = useState<Group | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)
  /** 登録メディアから選ぶ画像の入れ先（①のタブの順）。 */
  const [imagePickTarget, setImagePickTarget] = useState(0)
  const [done, setDone] = useState<'published' | 'scheduled' | null>(null)
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false)

  const accountId = selectedAccount?.id ?? null
  useEffect(() => { setPublishConfirmOpen(false); setPriorityOpen(false) }, [accountId, group?.id])
  candidateAccountRef.current = accountId
  const pendingMediaAccountRef = useRef(accountId)
  useEffect(() => {
    if (host || pendingMediaAccountRef.current === accountId) return
    pendingMediaAccountRef.current = accountId
    setPendingImages((previous) => {
      for (const image of previous) if (image?.url) URL.revokeObjectURL(image.url)
      return []
    })
    setMediaPickerOpen(false)
  }, [accountId, host])
  const aggregateOnly = staffRole === 'staff' || staffRole === 'viewer'
  const storeCanOperate = useFeatureAccess('richMenus')
  const canOperate = host ? host.canOperate : storeCanOperate

  /* ---------- 署名（未保存の検知） ---------- */

  /** 作成前の入力一式。初期値と違えば未保存。 */
  const createInputSignature = useCallback(
    () =>
      JSON.stringify({
        name,
        chatBarText,
        folderId,
        size,
        tabCount,
        templateKey,
        defaultOpen,
        audience,
        targetingCondition: audience === 'targeted' ? targetingCondition : null,
        targetingPriority,
        tabNames,
        images: pendingImages.map((image) =>
          image ? image.media?.id ?? (image.file ? `${image.file.name}:${image.file.size}` : null) : null,
        ),
      }),
    [name, chatBarText, folderId, size, tabCount, templateKey, defaultOpen, audience, targetingCondition, targetingPriority, pendingImages, tabNames],
  )

  /**
   * 作成後（下書きあり）の署名。persistDraft に送る形と同じ投影にする
   * （条件は保存と同じく prune 済みで出す——空行があると常に未保存になる）。
   */
  const draftSignature = useCallback(
    () =>
      JSON.stringify({
        name,
        chatBarText,
        isDefaultForAll: audience === 'all',
        targetingEnabled: audience === 'targeted',
        targetingPriority,
        targetingCondition:
          audience === 'targeted' && targetingCondition
            ? JSON.stringify(pruneCondition(targetingCondition))
            : null,
        folderId: folderId || null,
        defaultOpen,
        pages: pages.map((p, i) => ({
          id: p.id,
          name: p.name,
          orderIndex: i,
          areas: p.areas.map(projectAreaForDraft),
        })),
      }),
    [name, chatBarText, audience, targetingPriority, targetingCondition, folderId, defaultOpen, pages],
  )

  const signatureNow = useCallback(
    () => (group ? draftSignature() : createInputSignature()),
    [group, draftSignature, createInputSignature],
  )

  const [baselineSignature, setBaselineSignature] = useState<string | null>(null)
  // 初期署名は1回だけ（最初のレンダーの値）。useState 初期化で一度だけ計算。
  useEffect(() => {
    // 統括で直すとき（host.initial）は、読み込んだ中身で基準を取る（hydrate）。開発時の二度目の実行で上書きしない。
    if (baselineSignature === null && !host?.initial) setBaselineSignature(signatureNow())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const publishDirty = JSON.stringify(publishPlan) !== JSON.stringify(publishBaseline)
  const dirty = baselineSignature !== null && (signatureNow() !== baselineSignature || publishDirty)
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({
    dirty,
    busy: saving || publishing,
  })

  function confirmLeaveAndDiscard() {
    if (group && !host) clearPublishPlanDraft(group.id)
    setPublishPlan(DEFAULT_PUBLISH_PLAN)
    setPublishBaseline(DEFAULT_PUBLISH_PLAN)
    setEndEnabled(false)
    confirmLeave()
  }

  /* ---------- 読み込み ---------- */

  const load = useCallback(async () => {
    const generation = ++candidateLoadGeneration.current
    setLoadError(null)
    setLoadFailedKinds([])
    if (host) {
      // 統括：候補は統括のひな形（タグ・テンプレート・回答フォーム）とフォルダ。店のメニュー・計測リンクは無い。
      setFolders(host.folders.map((folder) => ({ id: folder.id, name: folder.name }) as unknown as Folder))
      setTags(host.references.tags)
      setTemplates(host.references.templates)
      setForms(host.references.forms)
      setTrackedLinks([])
      setOtherMenus([])
      return
    }
    const [folderRes, tagRes, templateRes, formRes, linkRes, menuRes] =
      await Promise.allSettled([
        api.folders.list('rich_menu'),
        api.tags.list(accountId ? { accountId } : undefined),
        api.templates.list(undefined, accountId ?? undefined),
        accountId ? api.forms.list(accountId) : Promise.resolve({ success: true as const, data: [] }),
        api.trackedLinks.list(),
        accountId ? api.richMenuGroups.list(accountId) : Promise.resolve({ success: true as const, data: [] }),
      ])
    if (generation !== candidateLoadGeneration.current || candidateAccountRef.current !== accountId) return
    setCandidateScope({
      accountId,
      tags: tagRes.status === 'fulfilled' && tagRes.value.success ? new Set(tagRes.value.data.map(({ id }) => id)) : null,
      templates: templateRes.status === 'fulfilled' && templateRes.value.success ? new Set(templateRes.value.data.map(({ id }) => id)) : null,
    })
    const failed: string[] = []
    let firstError: unknown = null
    const noteFailure = (label: string, res: unknown) => {
      failed.push(label)
      if (firstError === null) {
        firstError =
          typeof res === 'object' && res !== null && 'reason' in res
            ? (res as { reason: unknown }).reason
            : new Error(`${label}の読み込みに失敗しました`)
      }
    }
    if (folderRes.status === 'fulfilled' && folderRes.value.success) setFolders(folderRes.value.data)
    else noteFailure('フォルダ', folderRes)
    if (tagRes.status === 'fulfilled' && tagRes.value.success)
      setTags(tagRes.value.data.map(({ id, name }) => ({ id, name })))
    else noteFailure('タグ', tagRes)
    if (templateRes.status === 'fulfilled' && templateRes.value.success)
      setTemplates(templateRes.value.data.map(({ id, name }) => ({ id, name })))
    else noteFailure('テンプレート', templateRes)
    if (formRes.status === 'fulfilled' && formRes.value.success)
      setForms(formRes.value.data.map(({ id, name }) => ({ id, name })))
    else noteFailure('フォーム', formRes)
    if (linkRes.status === 'fulfilled' && linkRes.value.success)
      setTrackedLinks(linkRes.value.data.map(({ id, name }) => ({ id, name })))
    else noteFailure('計測リンク', linkRes)
    if (menuRes.status === 'fulfilled' && menuRes.value.success) setOtherMenus(menuRes.value.data)
    else noteFailure('メニュー一覧', menuRes)
    if (failed.length > 0) {
      const caught = firstError
      setLoadError(caught)
      setLoadFailedKinds(failed)
      setError(
        isForbiddenOrRateLimited(caught)
          ? loadFailureNotice(caught, '候補')
          : `候補の読み込みに失敗しました（${failed.join('・')}）。もう一度読み込んでください。`,
      )
    }
    // host の候補は開いたときに一度だけ読む（親が描き直しても入力を消さない）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (host || !candidateScope || candidateScope.accountId !== accountId) return
    const drafts = Object.fromEntries(pages.map((page) => [page.id, page.areas]))
    const tagsPruned = candidateScope.tags ? pruneStaleAreaTags(drafts, candidateScope.tags) : { next: drafts, removed: 0 }
    const templatesPruned = candidateScope.templates ? pruneStaleAreaTemplates(tagsPruned.next, candidateScope.templates) : { next: tagsPruned.next, removed: 0 }
    const removed = tagsPruned.removed + templatesPruned.removed
    if (!removed) return
    setPages(pages.map((page) => ({ ...page, areas: templatesPruned.next[page.id] })))
    setCandidatePruneNotice(`選んでいた候補のうち${removed}件は、今のアカウントにないため外しました。選び直してください。`)
  }, [accountId, candidateScope, host, pages])

  /* 統括：直すときは保存してある中身を、画面の中の下書きにする（サーバーの下書きは作らない）。 */
  const hostSeeded = useRef(false)
  useEffect(() => {
    if (!host?.initial || hostSeeded.current) return
    hostSeeded.current = true
    hydrate(groupFromSeed(host.initial))
    // 開いたときに一度だけ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* 直すとき：下書きを読み込み、手順①〜④の入力に入れる。基準の署名も読み込んだ内容で取り直す。 */
  const loadEditGroup = useCallback(async () => {
    if (!editGroupId) return
    setEditLoad('loading')
    try {
      const res = await api.richMenuGroups.get(editGroupId)
      if (!res.success || !isGroupResponse(res.data)) {
        setEditLoad('missing')
        return
      }
      hydrate(res.data)
      setEditLoad('ready')
    } catch (caught) {
      saveErrors.capture(caught)
      setEditLoad(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : caught instanceof ApiError && caught.status === 404 ? 'missing' : 'error')
    }
    // hydrate は state の setter だけを使う。
  }, [editGroupId, saveErrors])

  useEffect(() => {
    void loadEditGroup()
  }, [loadEditGroup])

  /* ---------- 下書きの作成・保存 ---------- */

  /** 作る前のタブの名前（空なら決まりの名前）。 */
  function defaultTabName(index: number, count: number): string {
    if (host && count > 0) return `タブ ${String.fromCharCode(65 + index)}`
    return index === 0 ? 'トップ' : `タブ ${String.fromCharCode(65 + index - 1)}`
  }
  function tabNameAt(index: number): string {
    return tabNames[index]?.trim() || defaultTabName(index, tabCount)
  }

  /** 作る前に選んだタブの画像を外す（ローカルの見本の URL も返す）。 */
  function clearPendingImage(index: number) {
    setPendingImages((prev) => {
      const current = prev[index]
      if (current?.url) URL.revokeObjectURL(current.url)
      const next = [...prev]
      next[index] = null
      return next
    })
  }
  function setPendingImageAt(index: number, image: PendingImage) {
    setPendingImages((prev) => {
      const current = prev[index]
      if (current?.url && current.url !== image.url) URL.revokeObjectURL(current.url)
      const next = [...prev]
      next[index] = image
      return next
    })
  }

  /*
   * 保存で落ちた欄（B-139）。名前・トーク画面の下の文言は①、切り替えの行き先は②の面。
   * 帯ではなく欄を赤くして真下に理由を出し、別の手順・タブ・面ならそこを開いて移る。面の一覧に赤い丸。
   */
  saveErrors.define('name', 'メニュー名', () => null, { required: true, reveal: () => setStep('shape') })
  saveErrors.define('chatBarText', 'トーク画面の下の文言', () => null, { required: true, reveal: () => setStep('shape') })
  const fields = useFormErrors()
  fields.define('name', 'メニュー名', () => (name.trim() ? null : '名前を入力してください'), { required: true, reveal: () => setStep('shape') })
  fields.define('chatbar', 'トーク画面の下の文言', () => (chatBarText.trim() ? null : 'トーク画面の下の文言を入力してください'), { required: true, reveal: () => setStep('shape') })
  if (group) {
    pages.forEach((page, pageIndex) => {
      page.areas.forEach((area, areaIndex) => {
        if (area.actionType !== 'richmenuswitch') return
        fields.define(`area-${area.id}`, `タブ${pageIndex + 1}の面 ${String.fromCharCode(65 + areaIndex)} の切り替え先`, () => (
          String(area.actionData?.targetPageId ?? '').trim() ? null : '「メニューを切り替える」面の行き先ページが決まっていません。切り替え先を選んでください。'
        ), { required: true, reveal: () => { setStep('buttons'); setActivePageId(page.id); setSelectedAreaId(area.id) }, group: `area-${area.id}` })
      })
    })
  }

  function validateBasics(): boolean {
    if (fields.submit().length > 0) {
      setError(null)
      return false
    }
    return true
  }

  function hydrate(g: Group) {
    setGroup(g)
    setSize(g.size)
    setTabCount(Math.max(0, g.pages.length - 1))
    const matchedLayout = TEMPLATES.find((layout) => layout.size === g.size && layout.areas.length === g.pages[0]?.areas.length && layout.areas.every((bounds, i) => {
      const area = g.pages[0].areas[i]
      return area.boundsX === Math.round(bounds.x) && area.boundsY === Math.round(bounds.y) && area.boundsWidth === Math.round(bounds.w) && area.boundsHeight === Math.round(bounds.h)
    }))
    setTemplateKey(matchedLayout?.key ?? V8_LAYOUT_KEYS[g.size][0])
    setPages(g.pages)
    // 保存→読み直しで、いま見ているページを飛ばさない。消えたページだけ既定へ戻す。
    setActivePageId((prev) =>
      prev && g.pages.some((p) => p.id === prev)
        ? prev
        : g.pages.find((p) => p.id === g.defaultPageId)?.id ?? g.pages[0]?.id ?? null,
    )
    setSelectedAreaId((prev) =>
      prev && g.pages.some((p) => p.areas.some((a) => a.id === prev)) ? prev : (g.pages.find((p) => p.id === g.defaultPageId) ?? g.pages[0])?.areas[0]?.id ?? null,
    )
    setName(g.name)
    setChatBarText(g.chatBarText)
    setFolderId(g.folderId ?? '')
    setDefaultOpen(g.defaultOpen)
    setAudience(g.targetingEnabled ? 'targeted' : g.isDefaultForAll ? 'all' : host ? 'targeted' : 'none')
    setTargetingCondition(parseStoredCondition(g.targetingCondition))
    setTargetingPriority(g.targetingPriority)
    /*
     * 基準署名は draftSignature と同じ投影で組み立てる（audience の写像・
     * 条件の prune が違うと、保存直後なのに未保存と出る）。
     */
    const hydratedAudience = g.targetingEnabled ? 'targeted' : g.isDefaultForAll ? 'all' : host ? 'targeted' : 'none'
    const hydratedCondition = parseStoredCondition(g.targetingCondition)
    setBaselineSignature(
      JSON.stringify({
        name: g.name,
        chatBarText: g.chatBarText,
        isDefaultForAll: hydratedAudience === 'all',
        targetingEnabled: hydratedAudience === 'targeted',
        targetingPriority: g.targetingPriority,
        targetingCondition:
          hydratedAudience === 'targeted' && hydratedCondition
            ? JSON.stringify(pruneCondition(hydratedCondition))
            : null,
        folderId: g.folderId,
        defaultOpen: g.defaultOpen,
        pages: g.pages.map((p, i) => ({
          id: p.id,
          name: p.name,
          orderIndex: i,
          areas: p.areas.map(projectAreaForDraft),
        })),
      }),
    )
  }

  async function reloadGroup(groupId: string) {
    const res = await api.richMenuGroups.get(groupId)
    if (!res.success) throw new Error(res.error ?? '取得失敗')
    hydrate(res.data as Group)
  }

  /*
   * `?id=<下書き>` で作りかけの下書きを開き直す（手順②〜④へ直接来る・撮影の作る② Z0uO6・kmTab）。
   * 開けたら手順はどれでも選べる（①で作った後と同じ）。開けなければ理由を出し、新しく作る道は残す。
   */
  const resumeIdRef = useRef<string | null>(
    host || editGroupId || typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('id'),
  )
  useEffect(() => {
    const id = resumeIdRef.current
    if (!id) return
    resumeIdRef.current = null
    reloadGroup(id)
      // 開いた手順より前は済み（①は下書きがある＝済み）。後ろは未着手のまま。
      .then(() => setMaxStepIndex(Math.max(1, STEP_KEYS.indexOf(step))))
      .catch(() => setError('作りかけの下書きを開けませんでした。一覧から開き直してください。'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 統括：手順①の内容から画面の中の下書きを作る。ファイルを選んでいたら統括の置き場へ上げて最初のページの画像にする。 */
  async function hostSeedFromShape(): Promise<HqRichMenuSeed | null> {
    if (!host || !validateBasics()) return null
    const template = TEMPLATES.find((t) => t.key === templateKey)
    if (!template) {
      setError('面の分けかたを選び直してください')
      return null
    }
    const imageKeys: Array<string | null> = []
    for (let index = 0; index <= tabCount; index += 1) {
      const file = pendingImages[index]?.file ?? null
      if (!file) {
        imageKeys.push(null)
        continue
      }
      try {
        imageKeys.push((await host.uploadImage(file, size)).r2Key)
      } catch (e) {
        const fieldFailure = saveErrors.capture(e)

        { if (!fieldFailure)


        setError(e instanceof Error && /[ぁ-んァ-ヶ一-龠]/u.test(e.message) ? e.message : imageUploadErrorText(e)) }
        return null
      }
    }
    const shapePages = Array.from({ length: tabCount + 1 }, (_, index) => ({
      id: `page-${index + 1}`,
      name: tabNameAt(index),
      imageR2Key: imageKeys[index] ?? null,
      areas: createAreaDrafts(template).map((area, areaIndex) => ({ ...area, id: `p${index + 1}-a${areaIndex + 1}` })),
    }))
    return { id: host.initial?.id, name: name.trim(), chatBarText: chatBarText.trim(), folderId: folderId || null, size, displayAudience: audience === 'all' ? 'all' : 'store', displayOrder: targetingPriority, defaultPageId: shapePages[0].id, pages: shapePages }
  }

  /** 手順①の内容で下書きを作る。作れたら true。 */
  async function createDraft(): Promise<boolean> {
    if (host) {
      const seed = await hostSeedFromShape()
      if (!seed) return false
      hydrate(groupFromSeed(seed))
      return true
    }
    if (!accountId) {
      setError('アカウントを選択してください')
      return false
    }
    if (!validateBasics()) return false
    const template = TEMPLATES.find((t) => t.key === templateKey)
    if (!template) {
      setError('面の分けかたを選び直してください')
      return false
    }
    const areas = areaDraftsWithSwitchTargets(createAreaDrafts(template))
    const condition = audience === 'targeted' ? pruneCondition(targetingCondition) : null
    if (audience === 'targeted' && !condition) {
      setError('出す相手の条件を設定してください。')
      return false
    }
    const res = await api.richMenuGroups.create({
      accountId,
      name: name.trim(),
      chatBarText: chatBarText.trim(),
      size,
      folderId: folderId || null,
      defaultPageIndex: 0,
      isDefaultForAll: audience === 'all',
      targetingEnabled: audience === 'targeted',
      targetingCondition: condition ? JSON.stringify(condition) : null,
      targetingPriority,
      defaultOpen,
      imageMediaId: pendingImages[0]?.media?.id,
      pages: Array.from({ length: tabCount + 1 }, (_, index) => ({
        name: tabNameAt(index),
        orderIndex: index,
        areas,
      })),
    })
    if (!res.success) throw new Error(res.error ?? '作成失敗')
    const createdId = res.data.id
    // ①で選んだタブごとの画像をそのページへ上げる（最初のページの登録メディアは作るときに渡した）。
    for (let index = 0; index <= tabCount; index += 1) {
      const image = pendingImages[index]
      const pageId = res.data.pages[index]?.id
      if (!image || !pageId || (index === 0 && image.media && !image.file)) continue
      try {
        const file = image.file ?? (image.media && accountId ? await mediaToFile(image.media, accountId) : null)
        if (file) await api.richMenuGroups.uploadImage(createdId, pageId, file)
      } catch (e) {
        const fieldFailure = saveErrors.capture(e)
        // 下書き自体はできている。画像だけ失敗として知らせる。
        { if (!fieldFailure)


        setError(e instanceof ApiError ? imageUploadErrorText(e) : '登録メディアの画像を読み込めませんでした。もう一度お試しください。') }
      }
    }
    pendingImages.forEach((image) => { if (image?.url) URL.revokeObjectURL(image.url) })
    setPendingImages([])
    await reloadGroup(createdId)
    return true
  }

  /** 作成後の保存（PATCH）。 */
  async function persistDraft(): Promise<void> {
    if (!group) throw new Error('下書きがまだ作られていません')
    if (host) return
    if (group.accountId !== accountId) throw new Error('この下書きのアカウントへ戻してから保存してください。')
    const condition = audience === 'targeted' ? pruneCondition(targetingCondition) : null
    if (audience === 'targeted' && !condition) {
      throw new Error('出す相手の条件を設定してください。')
    }
    const res = await api.richMenuGroups.update(group.id, {
      expectedVersion: group.version,
      name: name.trim(),
      chatBarText: chatBarText.trim(),
      isDefaultForAll: audience === 'all',
      targetingEnabled: audience === 'targeted',
      targetingPriority,
      targetingCondition: condition ? JSON.stringify(condition) : null,
      folderId: folderId || null,
      defaultOpen,
      pages: pages.map((p, i) => ({
        ...(p.id.startsWith('tmp-') ? {} : { id: p.id }),
        name: p.name,
        orderIndex: i,
        areas: p.areas.map(projectAreaForDraft),
      })),
    })
    if (!res.success) throw new Error(res.error ?? '保存失敗')
  }

  /** 保存して読み直す。戻り値は成否。 */
  async function saveDraft(): Promise<boolean> {
    if (saving) return false
    if (!validateBasics()) return false
    setSaving(true)
    setError(null)
    setNotice('')
    try {
      if (!group) {
        const ok = await createDraft()
        if (!ok) return false
      } else {
        // 切替ボタンの行き先未設定は validateBasics（欄の誤り）で先に止めている（server 400 を日本語で先回り）。
        await persistDraft()
        if (!host) await reloadGroup(group.id)
      }
      if (host) return true
      setNotice('下書きを保存しました。')
      notifyToast('下書きを保存しました')
      return true
    } catch (e) {
      const fieldFailure = saveErrors.capture(e)
      // ★V8 `r8dGXT`：ほかの人が先に保存した（409）。入力は残したまま、
      // 帯を出して最新を取り直す。比べる文に使う。
      if (e instanceof ApiError && e.status === 409 && group) {
        setConflict(true)
        setCompareOpen(false)
        try {
          const latest = await api.richMenuGroups.get(group.id)
          if (latest.success) setConflictLatest(latest.data as Group)
        } catch (saveFailure) {
          saveErrors.capture(saveFailure)
          // 取り直しに失敗しても帯は出す。比べる文は出さない。
        }
        return false
      }
      const raw = e instanceof Error ? e.message : ''
      { if (!fieldFailure)


      setError(
        /targetingPriority/.test(raw)
          ? '出す順番は1以上の整数で入力してください。小数は使えません。'
          : describeApiFailure(e, '下書きの保存', {
              scope: 'store',
            }),
      ) }
      return false
    } finally {
      setSaving(false)
    }
  }

  /** 「次へ」。内容を保存してから次の手順へ進む。 */
  async function goNext() {
    const idx = STEP_KEYS.indexOf(step)
    if (idx >= STEP_KEYS.length - 1) return
    const ok = await saveDraft()
    if (!ok) return
    const next = STEP_KEYS[idx + 1]
    setMaxStepIndex((m) => Math.max(m, idx + 1))
    setStep(next)
  }

  /** 手順の見出しの左へ戻る（入力はメモリに残る）。 */
  function goToStep(key: StepKey) {
    setStep(key)
    setError(null)
  }

  /** ★V8 `r8dGXT`「最新を読み込んで続ける」。最新で入力を置き換える。 */
  function acceptLatestAndContinue() {
    if (!conflictLatest) return
    hydrate(conflictLatest)
    setConflict(false)
    setConflictLatest(null)
    setCompareOpen(false)
    setNotice('最新の内容を読み込みました。直していた所は最新の内容に置き換わっています。')
  }

  const currentSummary = describeMenuSummary({
    name,
    chatBarText,
    audienceAll: audience === 'all',
    pages,
  })
  const latestSummary = conflictLatest
    ? describeMenuSummary({
        name: conflictLatest.name,
        chatBarText: conflictLatest.chatBarText,
        audienceAll: conflictLatest.isDefaultForAll,
        pages: conflictLatest.pages,
      })
    : ''

  /* ---------- ページ（切替タブ） ---------- */

  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0] ?? null
  const selectedArea = activePage?.areas.find((a) => a.id === selectedAreaId) ?? null

  function updatePage(pageId: string, patch: Partial<Page>) {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, ...patch } : p)))
  }

  function updateArea(pageId: string, areaId: string, patch: Partial<Area>) {
    setPages((prev) =>
      prev.map((p) =>
        p.id === pageId
          ? { ...p, areas: p.areas.map((a) => (a.id === areaId ? { ...a, ...patch } : a)) }
          : p,
      ),
    )
  }

  function addArea(pageId: string, area: Area) {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, areas: [...p.areas, area] } : p)))
    setSelectedAreaId(area.id)
  }

  function deleteArea(pageId: string, areaId: string) {
    setPages((prev) =>
      prev.map((p) => (p.id === pageId ? { ...p, areas: p.areas.filter((a) => a.id !== areaId) } : p)),
    )
    setSelectedAreaId(null)
  }

  /** 消えるページを行き先にしている切替ボタンがあれば、その理由（残るページの中から探す）。 */
  function removePageBlockers(removed: Page[], remaining: Page[]): string[] {
    const removedIds = new Set(removed.map((p) => p.id))
    const referrers = remaining.filter((p) =>
      p.areas.some(
        (a) =>
          a.actionType === 'richmenuswitch' &&
          removedIds.has(String((a.actionData as { targetPageId?: string }).targetPageId ?? '')),
      ),
    )
    if (referrers.length === 0) return []
    return [
      `${referrers.map((p) => `「${p.name}」`).join('、')}のタブ切替ボタンが、消えるタブを行き先にしています。先に手順②で行き先を変えてください。`,
    ]
  }

  /** 画像か、決めた動きがあるページ（消すときに確かめる）。 */
  function pageHasSettings(page: Page): boolean {
    return Boolean(page.imageR2Key) || page.areas.some(isAreaActionConfigured)
  }

  /** ①の切替タブの数（0＝なし・1＝2つ・2＝3つ）を変える。消えるタブに設定があれば確かめの窓を出す。 */
  function requestTabCount(next: number) {
    if (!group) {
      if (next === tabCount) return
      if (pendingImages.slice(next + 1).some(Boolean)) {
        setPendingTabCount(next)
        return
      }
      applyTabCount(next)
      return
    }
    if (next + 1 === pages.length) return
    const removed = pages.slice(next + 1)
    if (removed.some(pageHasSettings) || removePageBlockers(removed, pages.slice(0, next + 1)).length > 0) {
      setPendingTabCount(next)
      return
    }
    applyTabCount(next)
  }

  function applyTabCount(next: number) {
    setPendingTabCount(null)
    setTabCount(next)
    if (!group) {
      setPendingImages((prev) => {
        prev.slice(next + 1).forEach((image) => { if (image?.url) URL.revokeObjectURL(image.url) })
        return prev.slice(0, next + 1)
      })
      setTabNames((prev) => prev.slice(0, next + 1))
      return
    }
    const count = next + 1
    if (pages.length > count) {
      const remaining = pages.slice(0, count)
      if (removePageBlockers(pages.slice(count), remaining).length > 0) return
      setPages(remaining)
      if (!remaining.some((p) => p.id === activePageId)) {
        setActivePageId(remaining[0]?.id ?? null)
        setSelectedAreaId(remaining[0]?.areas[0]?.id ?? null)
      }
      return
    }
    // 足すタブは①の面の分け方で始める（面と動きはタブごとに持つ）。保存すると作られる。
    const layout = TEMPLATES.find((t) => t.key === templateKey) ?? TEMPLATES[0]
    const added: Page[] = Array.from({ length: count - pages.length }, (_, offset) => {
      const index = pages.length + offset
      return {
        id: `tmp-${Math.random().toString(36).slice(2, 10)}`,
        orderIndex: index,
        name: host ? `タブ ${String.fromCharCode(65 + index)}` : `タブ ${String.fromCharCode(65 + index - 1)}`,
        aliasId: '',
        lineRichmenuId: null,
        imageR2Key: null,
        imageContentType: null,
        areas: createAreaDrafts(layout).map((area) => ({ ...area, id: crypto.randomUUID() })),
      }
    })
    setPages([...pages, ...added])
  }

  /* ---------- 画像 ---------- */

  async function uploadPageImage(pageId: string, file: File) {
    if (!group) return
    setError(null)
    if (host) {
      try {
        const uploaded = await host.uploadImage(file, group.size)
        updatePage(pageId, { imageR2Key: uploaded.r2Key, imageContentType: file.type })
        setImageVersion((v) => v + 1)
      } catch (e) {
        const fieldFailure = saveErrors.capture(e)

        { if (!fieldFailure)


        setError(e instanceof Error && /[ぁ-んァ-ヶ一-龠]/u.test(e.message) ? e.message : imageUploadErrorText(e)) }
      }
      return
    }
    try {
      const res = await api.richMenuGroups.uploadImage(group.id, pageId, file)
      updatePage(pageId, {
        imageR2Key: res.data.imageR2Key,
        imageContentType: res.data.imageContentType,
      })
      setImageVersion((v) => v + 1)
    } catch (e) {
      const fieldFailure = saveErrors.capture(e)

      { if (!fieldFailure)


      setError(imageUploadErrorText(e)) }
    }
  }

  /** 登録メディアの中身を取り寄せて、ページ画像として上げる。 */
  async function uploadMediaToPage(pageId: string, item: MediaItem) {
    if (!group || !accountId) return
    setError(null)
    try {
      await uploadPageImage(pageId, await mediaToFile(item, accountId))
    } catch (e) {
      const fieldFailure = saveErrors.capture(e)

      { if (!fieldFailure)


      setError(e instanceof ApiError ? imageUploadErrorText(e) : '登録メディアの画像を読み込めませんでした。もう一度お試しください。') }
    }
  }

  /** ①の画像の枠（タブの順）にファイルを入れる。作る前は持っておき、作った後はそのページへ上げる。 */
  function handlePickedFile(file: File | null, tabIndex: number) {
    if (!file) return
    if (!group) {
      const url = URL.createObjectURL(file)
      setPendingImageAt(tabIndex, { file, url, dims: null, media: null })
      const img = new Image()
      img.onload = () =>
        setPendingImages((prev) => {
          if (prev[tabIndex]?.url !== url) return prev
          const next = [...prev]
          next[tabIndex] = { ...prev[tabIndex]!, dims: { w: img.naturalWidth, h: img.naturalHeight } }
          return next
        })
      img.src = url
      return
    }
    const target = pages[tabIndex]
    if (!target) return
    if (target.id.startsWith('tmp-') && !host) {
      setError('新しいタブは、先に下書きを保存してから画像を入れてください。')
      return
    }
    void uploadPageImage(target.id, file)
  }

  function handlePickedMedia(item: MediaItem) {
    setMediaPickerOpen(false)
    if (!group) {
      setPendingImageAt(imagePickTarget, { file: null, url: null, dims: null, media: item })
      return
    }
    const target = pages[imagePickTarget]
    if (!target) return
    if (target.id.startsWith('tmp-')) {
      setError('新しいタブは、先に下書きを保存してから画像を入れてください。')
      return
    }
    void uploadMediaToPage(target.id, item)
  }

  /* ---------- 手順③：出る人数 ---------- */

  const [targetPreview, setTargetPreview] = useState<RichMenuTargetPreview | null>(null)
  const [targetPreviewLoading, setTargetPreviewLoading] = useState(false)
  const [targetPreviewError, setTargetPreviewError] = useState('')

  const reloadTargetPreview = useCallback(async () => {
    if (!group) return
    setTargetPreviewLoading(true)
    setTargetPreviewError('')
    try {
      if (aggregateOnly) {
        // staff は集計だけ。保存途中の条件ではなく、保存済みの条件で数える。
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
        audience === 'targeted' ? targetingCondition : null,
      )
      if (!response.success) throw new Error(response.error)
      setTargetPreview(response.data)
    } catch (saveFailure) {
      const fieldFailure = saveErrors.capture(saveFailure)
      setTargetPreview(null)
      { if (!fieldFailure)
      setTargetPreviewError('対象人数を確認できませんでした。条件は保存できます。') }
    } finally {
      setTargetPreviewLoading(false)
    }
  }, [group, audience, targetingCondition, aggregateOnly, targetingPriority, saveErrors])

  useEffect(() => {
    if (step !== 'audience' && step !== 'publish') return
    if (!group || host) return
    const timer = window.setTimeout(() => void reloadTargetPreview(), 250)
    return () => window.clearTimeout(timer)
  }, [step, group, reloadTargetPreview])

  /* ---------- 手順④：公開 ---------- */

  const loadChecks = useCallback(async () => {
    if (!group) return
    setChecksLoading(true)
    try {
      const res = await api.richMenuGroups.prepublishCheck(group.id)
      if (!res.success) throw new Error(res.error)
      const data = res.data
      /* 形が違う応答（古い口・途中の応答）で画面ごと落とさない。読めなかったものとして扱う。 */
      if (!data || typeof data.selfCheck !== 'object' || data.selfCheck === null || typeof data.pageCount !== 'number') {
        throw new Error('prepublish-check response malformed')
      }
      setChecks((prev) => ({
        self: { state: data.selfCheck.ok ? 'ok' : 'ng', message: data.selfCheck.ok ? null : data.selfCheck.message },
        // LINEの検査結果は別口（validatePublish）で確かめた分だけ残す。
        line: prev?.line ?? { state: 'yet', message: null },
        device: { state: data.deviceConfirmed ? 'ok' : 'yet', at: data.deviceConfirmedAt },
        pages: { state: data.pageCount <= data.maxPages ? 'ok' : 'ng', count: data.pageCount, max: data.maxPages },
      }))
      setChecksError(false)
    } catch (saveFailure) {
      const fieldFailure = saveErrors.capture(saveFailure)

      { if (!fieldFailure)
      setChecksError(true) }
    } finally {
      setChecksLoading(false)
    }
  }, [group, saveErrors])

  useEffect(() => {
    if (step === 'publish' && group && !host) void loadChecks()
  }, [step, group, loadChecks, host])

  // 「終わりを決める」の戻し先候補：公開中のほかのメニュー。
  useEffect(() => {
    if (!group) return
    setRestoreMenus(
      otherMenus
        .filter((item) => item.id !== group.id && item.status === 'published')
        .map((item) => ({ id: item.id, name: item.name })),
    )
  }, [group, otherMenus])

  /*
   * 公開予定は下書きとしてブラウザへ控える（編集画面と同じ仕組み。
   * 再読込しても「いつ公開するか」の入力が消えない）。
   * 下書きができたタイミングで一度だけ読み、以後は入力のたびに書く。
   */
  const groupId = group?.id ?? null
  const planLoadedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!groupId || planLoadedRef.current === groupId) return
    planLoadedRef.current = groupId
    const saved = loadPublishPlanDraft(groupId) ?? DEFAULT_PUBLISH_PLAN
    setPublishPlan(saved)
    setPublishBaseline(DEFAULT_PUBLISH_PLAN)
    setEndEnabled(saved.mode === 'period')
  }, [groupId])

  // 入力したメニューの控えだけを更新する。切替の途中の古い入力を別のIDへ書かない。
  function updatePublishPlan(next: PublishPlanInput) {
    setPublishPlan(next)
    if (groupId && !host) savePublishPlanDraft(groupId, next)
  }

  async function validateWithLine() {
    if (!group || validating) return
    setValidating(true)
    setError(null)
    try {
      const res = await api.richMenuGroups.validatePublish(group.id)
      if (!res.success) throw new Error(res.error)
      const line = res.data.checks.find((c) => c.key === 'line')
      const self = res.data.checks.find((c) => c.key === 'self')
      setChecks((prev) =>
        prev
          ? {
              ...prev,
              self: self && !self.ok ? { state: 'ng', message: self.message } : prev.self,
              line: { state: line?.ok ? 'ok' : 'ng', message: line?.ok ? 'LINEの受付に通りました。' : (line?.message ?? 'LINEの検査を通りませんでした。') },
            }
          : prev,
      )
    } catch (saveFailure) {
      const fieldFailure = saveErrors.capture(saveFailure)

      { if (!fieldFailure)


      setError('LINEの検査を通せませんでした。しばらくおいてから、もう一度お試しください。') }
    } finally {
      setValidating(false)
    }
  }

  async function recordSeen() {
    if (!group || recording) return
    setRecording(true)
    setError(null)
    try {
      const res = await api.richMenuGroups.confirmDevice(group.id)
      if (!res.success) throw new Error(res.error)
      setChecks((prev) => (prev ? { ...prev, device: { state: 'ok', at: res.data.confirmedAt } } : prev))
    } catch (saveFailure) {
      const fieldFailure = saveErrors.capture(saveFailure)

      { if (!fieldFailure)


      setError('実機で見た記録を残せませんでした。もう一度お試しください。') }
    } finally {
      setRecording(false)
    }
  }

  const checksAllOk =
    checks !== null &&
    checks.self.state === 'ok' &&
    checks.line.state === 'ok' &&
    checks.device.state === 'ok' &&
    checks.pages.state === 'ok'

  /*
   * 予約公開は実行係（schedule executor）があとでLINEへ出す。
   * 実機確認は「いま押す」の保全なので、予約時は自前+LINEの検査だけ求める。
   * （確定内容は保存時点の下書きスナップショットとして固定される）
   */
  const scheduleGateOk =
    checks !== null &&
    checks.self.state === 'ok' &&
    checks.line.state === 'ok' &&
    checks.pages.state === 'ok'

  const scheduleSubmit = useScheduleSubmit({
    groupId: group?.id ?? '',
    persistDraft: () => persistDraft(),
    onSaving: setSaving,
    onSaved: (message) => {
      setError(null)
      setNotice(message)
      setPublishBaseline(publishPlan)
      setDone('scheduled')
      if (group) {
        setBaselineSignature(draftSignature())
        clearPublishPlanDraft(group.id)
      }
      void reloadGroup(group?.id ?? '')
    },
    onFailed: (message) => {
      setNotice('')
      setError(message)
    },
  })

  async function handlePublish() {
    if (!group || publishing || saving) return
    const idempotencyKey = publishAttempt.current.begin()
    if (!idempotencyKey) return
    setPublishing(true)
    setError(null)
    setNotice('')
    let draftSaved = false
    try {
      await persistDraft()
      draftSaved = true
      // 保存で内容が変わると実機確認の fingerprint が変わる。保存し直した状態で再確認する。
      await loadChecks()
      await reloadGroup(group.id)
      const res = await api.richMenuGroups.publish(group.id, idempotencyKey)
      if (!res.success) throw new Error(res.error ?? 'publish failed')
      publishAttempt.current.succeed()
      setDone('published')
      setNotice(
        audience === 'all'
          ? 'LINEへの登録が終わり、すべての友だちの既定メニューになりました。'
          : audience === 'none'
            ? 'LINEへの登録が終わりました。この操作だけでは、友だちの画面は変わりません。出す相手は一覧の「表示先」から操作してください。'
            : 'LINEへの登録が終わりました。条件に当てはまる人の画面には、その人に関係する出来事（友だち追加・タグ付けなど）が起きたタイミングで順次出ます。',
      )
      notifyToast(
        audience === 'all'
          ? 'すべての友だちの既定メニューになりました'
          : 'LINEへの登録が終わりました',
      )
      clearPublishPlanDraft(group.id)
      await reloadGroup(group.id)
    } catch (e) {
      const fieldFailure = saveErrors.capture(e);


      const raw = e instanceof Error ? e.message : ''
      const isValidationMessage = /[ぁ-んァ-ヶ一-龠]/u.test(raw) && raw !== 'publish failed'
      { if (!fieldFailure)


      setError(
        /targetingPriority/.test(raw)
          ? '出す順番は1以上の整数で入力してください。小数は使えません。'
          : isValidationMessage
            ? raw
            : draftSaved
              ? 'LINEへ登録できませんでした。下書きは保存済みです。LINEへの登録だけもう一度お試しください。'
              : 'LINEへ登録できませんでした。下書きは保存されていません。しばらくおいてから、もう一度お試しください。',
      ) }
      void loadChecks()
    } finally {
      setPublishing(false)
      publishAttempt.current.finish()
    }
  }

  /** 「公開する」/「予約する」。時刻を決めた公開は予約口へ。 */
  async function handlePublishSubmit() {
    const timingIsScheduled = publishPlan.mode !== 'now'
    if (timingIsScheduled) {
      const startsAt = publishPlan.startsAt
      if (!startsAt) {
        if (!saveErrors.fail("startsAt", '公開を始める日時を選んでください。'))
        setError('公開を始める日時を選んでください。')
        return
      }
      if (publishPlan.mode === 'period' && !publishPlan.endsAt) {
        if (!saveErrors.fail("publishPlan.endsAt", '終わる日時を選んでください。'))
        setError('終わる日時を選んでください。')
        return
      }
      const input: RichMenuScheduleInput = {
        mode: publishPlan.mode === 'period' ? 'period' : 'scheduled',
        startsAt: datetimeLocalJstToUtcIso(startsAt),
        endsAt: publishPlan.mode === 'period' ? datetimeLocalJstToUtcIso(publishPlan.endsAt) : null,
        restoreGroupId: publishPlan.mode === 'period' ? publishPlan.restoreGroupId || null : null,
      }
      void scheduleSubmit(input)
      return
    }
    setPublishConfirmOpen(true)
  }

  /* ---------- 派生値 ---------- */

  const locked = group !== null // 形（大きさ・面・タブ数）は create 後は変えられない
  const template = TEMPLATES.find((t) => t.key === templateKey) ?? TEMPLATES[0]
  const shownLayouts = V8_LAYOUT_KEYS[size]
    .map((key) => TEMPLATES.find((t) => t.key === key))
    .filter((t): t is RichMenuTemplate => Boolean(t))

  /*
   * 右のスマホ見本：手順②はいま編集中のページ、それ以外は最初に見せる
   * ページ（既定ページ）の見え方を出す。
   */
  const previewPage = !group
    ? null
    : step === 'buttons'
      ? activePage
      : pages.find((p) => p.id === group.defaultPageId) ?? pages[0] ?? null

  const previewImageUrl = !group
    ? pendingImages[0]?.media && accountId
      ? api.media.contentUrl(pendingImages[0].media.id, accountId)
      : pendingImages[0]?.url ?? null
    : previewPage?.imageR2Key
      ? host ? host.imageUrl(previewPage.imageR2Key) : `${api.richMenuGroups.imageUrl(previewPage.imageR2Key)}?v=${imageVersion}`
      : null

  const previewAreas = !group
    ? template.areas
    : previewPage
      ? previewPage.areas.map((a) => ({ x: a.boundsX, y: a.boundsY, w: a.boundsWidth, h: a.boundsHeight }))
      : null

  const previewPages = !group
    ? Array.from({ length: tabCount + 1 }, (_, i) => ({
        id: String(i),
        name: tabNameAt(i),
      }))
    : pages.map((p) => ({ id: p.id, name: p.name }))

  const currentDefaultMenu = otherMenus.find(
    (m) => m.id !== group?.id && m.isDefaultForAll && m.status === 'published',
  )

  /*
   * 出す順番の並び：条件つきメニューが順番（小さいほど先）に並び、
   * 既定（すべての友だち）はいちばん下。自分は targeted なら順番の位置へ、
   * all なら末尾の「既定」として置く。
   */
  const targetedMenus = orderTargetingGroups(
    otherMenus.filter((m) => m.targetingEnabled && m.id !== group?.id),
  )
  const selfRow = {
    id: '__self__',
    label:
      audience === 'all'
        ? `${name || '（名前未入力）'}（このメニュー・既定）`
        : `${name || '（名前未入力）'}（このメニュー）`,
    isSelf: true,
  }
  const orderRows: Array<{ id: string; label: string; isSelf: boolean }> = (() => {
    const rows = targetedMenus.map((m) => ({
      id: m.id,
      label: `${m.name}（${describeCondition(parseStoredCondition(m.targetingCondition))}）`,
      isSelf: false,
    }))
    if (audience === 'all') return [...rows, selfRow]
    const before = targetedMenus.filter((m) => m.targetingPriority < targetingPriority).length
    rows.splice(before, 0, selfRow)
    return rows
  })()

  const conditionEmpty = isEmptyCondition(targetingCondition)
  const conditionUnsaved = Boolean(group) && JSON.stringify(audience === 'targeted' ? targetingCondition : null)
    !== JSON.stringify(group?.targetingEnabled ? parseStoredCondition(group.targetingCondition) : null)
  const conditionCount = targetingCondition?.rules.length ?? 0
  const nowNote = audience === 'all'
    ? '保存したらすぐ、個別に指定した人を除くすべての友だちの既定メニューになります'
    : audience === 'none'
      ? 'LINEへの登録だけで、友だちの画面は変わりません。出す相手は一覧の「表示先」で決めてください'
      : conditionEmpty
        ? 'いまの条件では誰にも出ません（今0人）。条件を決めてから出してください'
        : '保存するとLINEに登録され、条件に当てはまる人の画面に出来事のタイミングで順次出ます'
  const publishEffectNote = audience === 'all'
    ? '個別に指定した人を除く、すべての友だちのトーク画面に出ます。既定のメニューが入れ替わります。'
    : audience === 'none'
      ? 'LINEへの登録だけでは、友だちのトーク画面は変わりません。「表示先」で出す相手を決めてください。'
      : conditionEmpty
        ? '公開しても今は誰の画面にも出ません（0人）。条件を1つ以上足してください。'
        : '条件に当てはまる人の画面は、その人に関係する出来事のタイミングで順次切り替わります。すぐ全員に出るわけではありません。'
  const publishConfirmNote = audience === 'all'
    ? '個別に指定した人を除く、すべての友だちの既定メニューになります。'
    : audience === 'none'
      ? 'この操作だけでは、友だちのトーク画面には出ません。出すには登録後に一覧の「表示先」から操作してください。'
      : conditionEmpty
        ? 'いまの条件では誰にも出ません（今0人）。条件を決めてから出してください。'
        : '条件に当てはまる人の画面に、その人に関係する出来事（友だち追加・タグ付けなど）が起きたタイミングで順次出ます。'
  /*
   * 面の数：作成前は選んだ面の分けかたの数、作成後は全ページの面の合計。
   * 作成前の面はまだ動きが未設定（0設定済み）なので、分けかたの枚数だけ数える。
   */
  const totalAreaCount = group
    ? pages.reduce((count, p) => count + p.areas.length, 0)
    : template.areas.length * (tabCount + 1)
  const configuredCount = group
    ? pages.reduce((count, p) => count + p.areas.filter(isAreaActionConfigured).length, 0)
    : 0

  const pageImageUrl = activePage?.imageR2Key
    ? host ? host.imageUrl(activePage.imageR2Key) : `${api.richMenuGroups.imageUrl(activePage.imageR2Key)}?v=${imageVersion}`
    : null

  const areaActionSummary = (area: Area): string => {
    if (!isAreaActionConfigured(area)) return ''
    const intent = intentOf(area)
    if (intent === 'switch') {
      const target = pages.find((p) => p.id === String(area.actionData?.targetPageId ?? ''))
      return target ? `${target.name}を開く` : 'メニューを切り替える'
    }
    return intentLabelOf(area)
  }

  /* ---------- 手順ごとの中身 ---------- */

  const stepIndex = STEP_KEYS.indexOf(step)
  /*
   * 居場所は currentKey が決める。state は「済みか」だけを表すので、
   * いまいる段は done にしない（まだ入力中）。
   */
  const stepperSteps = STEP_KEYS.map((key, i) => ({
    key,
    label: stepLabel(key),
    state: (i !== stepIndex && i <= maxStepIndex ? 'done' : 'todo') as 'done' | 'todo',
    onSelect: i !== stepIndex && i <= maxStepIndex ? () => goToStep(key) : undefined,
  }))

  const headNote =
    step === 'shape'
      ? host ? 'いまは下書きとして作ります。最後の「配る」で選んだアカウントへ届けます。' : 'いまは下書きとして作ります。最後の「公開」で LINE に出します。'
      : `名前：${name || emptyValue('unconfigured')}・いまは下書きです`
  const conditionHelp = audience === 'targeted' && conditionEmpty
    ? '条件が空のままだと、公開しても誰にも出ません。条件を1つ以上足してください。'
    : ''

  /* ---------- 描画 ---------- */

  const busy = saving || publishing || Boolean(host?.busy)

  /** 統括：画面の中の下書きを一度に保存する（手順の途中でも同じ）。 */
  async function hostSave(distribute: boolean) {
    if (!host || saving) return
    setError(null)
    if (!group) {
      setSaving(true)
      try {
        const seed = await hostSeedFromShape()
        if (!seed) return
        hydrate(groupFromSeed(seed))
        host.onSave(seed, distribute)
      } finally {
        setSaving(false)
      }
      return
    }
    if (!validateBasics()) return
    host.onSave(seedNow(), distribute)
  }
  function seedNow(): HqRichMenuSeed {
    return {
      id: host?.initial?.id,
      name: name.trim(),
      chatBarText: chatBarText.trim(),
      folderId: folderId || null,
      size: group?.size ?? size,
      displayAudience: audience === 'all' ? 'all' : 'store',
      displayOrder: targetingPriority,
      defaultPageId: group?.defaultPageId ?? pages[0]?.id ?? '',
      pages: pages.map((page) => ({ id: page.id, name: page.name, imageR2Key: page.imageR2Key, areas: page.areas })),
    }
  }

  if (editGroupId && editLoad !== 'ready') {
    if (editLoad === 'forbidden') {
      return <SaveErrorScope errors={saveErrors}><ListState kind="forbidden"
        permissionScope="store"
        action={<Button href="/rich-menus">リッチメニュー一覧へ戻る</Button>} /></SaveErrorScope>
    }
    if (editLoad === 'missing') {
      return <SaveErrorScope errors={saveErrors}><TargetMissing kind="not-found" title="このリッチメニューは見つかりません" description="削除されたか、別の LINE アカウントのものです。一覧から選び直してください。" backHref="/rich-menus" backLabel="リッチメニュー一覧へ戻る" /></SaveErrorScope>
    }
    if (editLoad === 'error') {
      return <SaveErrorScope errors={saveErrors}><TargetMissing kind="error" title="リッチメニューを読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。" onRetry={() => void loadEditGroup()} /></SaveErrorScope>
    }
    return <SaveErrorScope errors={saveErrors}><p className={styles.editLoading} role="status">読み込み中…</p></SaveErrorScope>
  }

  if (!host && !canOperate && !editGroupId && !group) return <CreatePage boardId="JeINq" title="リッチメニューを作る" readOnly footerActions={<Button href="/rich-menus">一覧へ戻る</Button>} dirty={false}>{null}</CreatePage>

  return (
    <SaveErrorScope errors={saveErrors}><fieldset disabled={busy} className="contents">
    <CreatePage dirty={false} readOnly={!host && !canOperate} boardId={
        host ? (step === 'shape' ? 'gobhu' : step === 'buttons' ? 'egdGx' : step === 'audience' ? 'K0gu1' : 'gQabc')
          : step === 'shape' ? 'JeINq' : step === 'buttons' ? 'Z0uO6' : step === 'audience' ? 'OxEMM' : 'F4gELj'
      } headingSize="large" title={<>リッチメニューを作る</>} help={<>{headNote}{conditionHelp ? <p>{conditionHelp}</p> : null}</>} notice={conflict ? (
          /* 板 `r8dGXT`：帯は頭の説明の下に横いっぱい（右の列の上まで）。見た目は共通部品（save-conflict）。比べる窓はこの画面の要約の比べ（VersionCompare）。 */
          <div className={styles.conflictSlot}>
            <SaveConflictBand
              title="ほかの人がこのメニューを更新しました"
              description="あなたが直した所はまだ保存されていません。このまま保存すると、ほかの人の変更が消えます。"
              designNode="r8dGXT"
              compareBusy={!conflictLatest}
              onCompare={() => setCompareOpen(true)}
              onReload={acceptLatestAndContinue}
            />
          </div>
