'use client'

import { SaveConflictBand } from '@/components/shared/save-conflict'
import { CreatePage } from '@/components/templates'
import { Steps } from '@/components/templates/steps'
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

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
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
  CircleDot,
  Image as ImageIcon,
  RectangleHorizontal,
  RectangleVertical,
  Repeat,
  Smartphone,
  Star,
  Trash2,
} from 'lucide-react'
import {
  RICH_MENU_DIMENSIONS,
  RICH_MENU_MAX_PAGES,
  type Folder,
  type MediaItem,
} from '@line-crm/shared'
import Card from '@/components/shared/card'
import TargetMissing from '@/components/shared/target-missing'
import { RowMenu } from '@/components/shared/row-actions'
import FilterChip from '@/components/shared/filter-chip'
import { Field, TextInput } from '@/components/shared/form-controls'
import SectionHeader from '@/components/shared/section-header'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { notifyToast } from '@/components/shared/toast'
import Select from '@/components/shared/select'
import SegmentedControl from '@/components/shared/segmented'
import Toggle from '@/components/shared/toggle'
import DateTimeField from '@/components/shared/date-time-field'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import ConditionBuilder from '@/components/shared/condition-builder'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import VersionCompare from '@/components/shared/version-compare'
import LinePreview from '@/components/shared/line-preview'
import { CreateSummaryCard } from '@/components/templates/create-parts'
import { CanvasEditor, areaDisplayName, type Area } from '@/components/rich-menus/canvas-editor'
import { AreaProperties, intentLabelOf, intentOf } from '@/components/rich-menus/area-properties'
import {
  NEW_MENU_INTENTS_WITH_SWITCH,
  RichMenuTemplatePreview,
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
import { orderTargetingGroups } from '@/app/rich-menus/targeting-order'
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

/** ページの足せる上限（LINE 側の上限。超える分は公開前確認でも止める）。 */
const MAX_TAB_PAGES = RICH_MENU_MAX_PAGES

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
    `名前：${input.name || '（未入力）'}`,
    `言葉：${input.chatBarText || '（未入力）'}`,
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
  usePageTitle(host ? 'リッチメニュー' : 'リッチメニューを作る')
  /*
   * 統括のひな形（host）：手順の間は画面の中に持ち、最後に一度だけ保存する（店はこれまでどおり手順ごとに下書きを保存）。
   * 統括の画面で持てない欄（登録メディア・計測リンク・トークを開いたとき・出す相手の条件・公開の確かめ）は出さない。
   */
  const stepLabel = (key: StepKey) => (host && key === 'publish' ? '配る' : STEP_LABEL[key])
  const nextLabel = (key: Exclude<StepKey, 'publish'>) => (host && key === 'audience' ? '次へ：配る' : NEXT_LABEL[key])
  const { selectedAccount } = useAccount()
  const publishAttempt = useRef(new ManualPublishAttempt())
  const pageFileInput = useRef<HTMLInputElement>(null)
  const shapeFileInput = useRef<HTMLInputElement>(null)

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
  const [editLoad, setEditLoad] = useState<'idle' | 'loading' | 'ready' | 'missing' | 'error'>(editGroupId ? 'loading' : 'idle')

  /* 作った下書き。手順①の「次へ」で create → get で埋まる。 */
  const [group, setGroup] = useState<Group | null>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null)
  const [pageActionsOpen, setPageActionsOpen] = useState(false)
  const [canvasToolsOpen, setCanvasToolsOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [imageGuideOpen, setImageGuideOpen] = useState(false)
  const [imageVersion, setImageVersion] = useState(0)

  /* 手順① */
  const [name, setName] = useState('')
  const [chatBarText, setChatBarText] = useState('メニュー')
  const [folderId, setFolderId] = useState('')
  const [size, setSize] = useState<'large' | 'compact'>('large')
  const [tabCount, setTabCount] = useState(0)
  const [templateKey, setTemplateKey] = useState('large-2x3')
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingFileUrl, setPendingFileUrl] = useState<string | null>(null)
  const [pendingFileDims, setPendingFileDims] = useState<{ w: number; h: number } | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [chatBarTextError, setChatBarTextError] = useState<string | null>(null)

  /* 手順③ */
  const [audience, setAudience] = useState<'all' | 'targeted'>('all')
  const [targetingCondition, setTargetingCondition] = useState<SegmentCondition | null>(null)
  const [targetingPriority, setTargetingPriority] = useState(0)
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
  const [staffRole, setStaffRole] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [loadFailedKinds, setLoadFailedKinds] = useState<string[]>([])

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
  /** 画像の入れ先。手順①は既定ページ、手順②はいま見ているページ。 */
  const [imagePickTarget, setImagePickTarget] = useState<'default' | 'active'>('active')
  const [removePageTarget, setRemovePageTarget] = useState<Page | null>(null)
  const [done, setDone] = useState<'published' | 'scheduled' | null>(null)

  const accountId = selectedAccount?.id ?? null
  const aggregateOnly = staffRole === 'staff' || staffRole === 'viewer'
  const canOperate = staffRole === 'owner' || staffRole === 'admin'

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
        media: selectedMedia?.id ?? null,
        file: pendingFile ? `${pendingFile.name}:${pendingFile.size}` : null,
      }),
    [name, chatBarText, folderId, size, tabCount, templateKey, defaultOpen, audience, targetingCondition, targetingPriority, selectedMedia, pendingFile],
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

  /* ---------- 読み込み ---------- */

  const load = useCallback(async () => {
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
      setStaffRole(host.canOperate ? 'owner' : 'viewer')
      return
    }
    const [folderRes, tagRes, templateRes, formRes, linkRes, menuRes, staffRes] =
      await Promise.allSettled([
        api.folders.list('rich_menu'),
        api.tags.list(accountId ? { accountId } : undefined),
        api.templates.list(undefined, accountId ?? undefined),
        accountId ? api.forms.list(accountId) : Promise.resolve({ success: true as const, data: [] }),
        api.trackedLinks.list(),
        accountId ? api.richMenuGroups.list(accountId) : Promise.resolve({ success: true as const, data: [] }),
        api.staff.me(),
      ])
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
    if (staffRes.status === 'fulfilled' && staffRes.value.success) setStaffRole(staffRes.value.data.role)
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
      if (!res.success || !res.data || !Array.isArray((res.data as Group).pages)) {
        setEditLoad('missing')
        return
      }
      hydrate(res.data as Group)
      setEditLoad('ready')
    } catch (caught) {
      setEditLoad(caught instanceof ApiError && caught.status === 404 ? 'missing' : 'error')
    }
    // hydrate は state の setter だけを使う。
  }, [editGroupId])

  useEffect(() => {
    void loadEditGroup()
  }, [loadEditGroup])

  /* ---------- 下書きの作成・保存 ---------- */

  function resetPendingFile() {
    if (pendingFileUrl) URL.revokeObjectURL(pendingFileUrl)
    setPendingFile(null)
    setPendingFileUrl(null)
    setPendingFileDims(null)
  }

  function validateBasics(): boolean {
    if (!name.trim()) {
      setNameError('名前を入力してください')
      setError(null)
      requestAnimationFrame(() => document.getElementById('rm-name')?.focus())
      return false
    }
    if (!chatBarText.trim()) {
      setChatBarTextError('トーク画面の下の文言を入力してください')
      setError(null)
      requestAnimationFrame(() => document.getElementById('rm-chatbar')?.focus())
      return false
    }
    return true
  }

  function hydrate(g: Group) {
    setGroup(g)
    setPages(g.pages)
    // 保存→読み直しで、いま見ているページを飛ばさない。消えたページだけ既定へ戻す。
    setActivePageId((prev) =>
      prev && g.pages.some((p) => p.id === prev)
        ? prev
        : g.pages.find((p) => p.id === g.defaultPageId)?.id ?? g.pages[0]?.id ?? null,
    )
    setSelectedAreaId((prev) =>
      prev && g.pages.some((p) => p.areas.some((a) => a.id === prev)) ? prev : null,
    )
    setName(g.name)
    setChatBarText(g.chatBarText)
    setFolderId(g.folderId ?? '')
    setDefaultOpen(g.defaultOpen)
    setAudience(g.targetingEnabled ? 'targeted' : 'all')
    setTargetingCondition(parseStoredCondition(g.targetingCondition))
    setTargetingPriority(g.targetingPriority)
    /*
     * 基準署名は draftSignature と同じ投影で組み立てる（audience の写像・
     * 条件の prune が違うと、保存直後なのに未保存と出る）。
     */
    const hydratedAudience = g.targetingEnabled ? 'targeted' : 'all'
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
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('id'),
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
    let imageR2Key: string | null = null
    if (pendingFile) {
      try {
        imageR2Key = (await host.uploadImage(pendingFile, size)).r2Key
      } catch (e) {
        setError(e instanceof Error && /[ぁ-んァ-ヶ一-龠]/u.test(e.message) ? e.message : imageUploadErrorText(e))
        return null
      }
    }
    const shapePages = Array.from({ length: tabCount + 1 }, (_, index) => ({
      id: `page-${index + 1}`,
      name: index === 0 ? 'トップ' : `タブ ${String.fromCharCode(65 + index - 1)}`,
      imageR2Key: index === 0 ? imageR2Key : null,
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
      imageMediaId: selectedMedia?.id,
      pages: Array.from({ length: tabCount + 1 }, (_, index) => ({
        name: index === 0 ? 'トップ' : `タブ ${String.fromCharCode(65 + index - 1)}`,
        orderIndex: index,
        areas,
      })),
    })
    if (!res.success) throw new Error(res.error ?? '作成失敗')
    const createdId = res.data.id
    // ファイルを直接選んでいたら既定ページへ上げる。
    if (pendingFile) {
      const defaultPageId = res.data.pages[0]?.id
      if (defaultPageId) {
        try {
          await api.richMenuGroups.uploadImage(createdId, defaultPageId, pendingFile)
        } catch (e) {
          // 下書き自体はできている。画像だけ失敗として知らせる。
          setError(imageUploadErrorText(e))
        }
      }
    }
    await reloadGroup(createdId)
    return true
  }

  /** 作成後の保存（PATCH）。 */
  async function persistDraft(): Promise<void> {
    if (!group) throw new Error('下書きがまだ作られていません')
    if (host) return
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
        // 切替ボタンの行き先未設定は先に止める（server 400 を日本語で先回り）。
        const unsetSwitch = pages.some((p) =>
          p.areas.some(
            (a) => a.actionType === 'richmenuswitch' && !String(a.actionData?.targetPageId ?? '').trim(),
          ),
        )
        if (unsetSwitch) {
          setError('「メニューを切り替える」面の行き先ページが決まっていません。面の設定で切り替え先を選んでください。')
          return false
        }
        await persistDraft()
        if (!host) await reloadGroup(group.id)
      }
      if (host) return true
      setNotice('下書きを保存しました。')
      notifyToast('下書きを保存しました')
      return true
    } catch (e) {
      // ★V8 `r8dGXT`：ほかの人が先に保存した（409）。入力は残したまま、
      // 帯を出して最新を取り直す。比べる文に使う。
      if (e instanceof ApiError && e.status === 409 && group) {
        setConflict(true)
        setCompareOpen(false)
        try {
          const latest = await api.richMenuGroups.get(group.id)
          if (latest.success) setConflictLatest(latest.data as Group)
        } catch {
          // 取り直しに失敗しても帯は出す。比べる文は出さない。
        }
        return false
      }
      const raw = e instanceof Error ? e.message : ''
      setError(
        /targetingPriority/.test(raw)
          ? '出す順番は1以上の整数で入力してください。小数は使えません。'
          : describeApiFailure(e, '下書きの保存', {
              forbidden: 'リッチメニューを保存できるのは、権限を持つ人だけです。必要なときは統括に頼んでください。',
            }),
      )
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

  function addPage() {
    const nextOrder = pages.length
    const newPage: Page = {
      id: `tmp-${Math.random().toString(36).slice(2, 10)}`,
      orderIndex: nextOrder,
      name: `タブ ${String.fromCharCode(65 + nextOrder - 1)}`,
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

  /** このページを消せない理由。空なら消せる。 */
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

  function removePage(target: Page) {
    if (removePageBlockers(target).length > 0) return
    const remaining = pages.filter((p) => p.id !== target.id).map((p, i) => ({ ...p, orderIndex: i }))
    setPages(remaining)
    if (activePageId === target.id) setActivePageId(remaining[0]?.id ?? null)
    setSelectedAreaId(null)
    setRemovePageTarget(null)
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
        setError(e instanceof Error && /[ぁ-んァ-ヶ一-龠]/u.test(e.message) ? e.message : imageUploadErrorText(e))
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
      setError(imageUploadErrorText(e))
    }
  }

  /** 登録メディアの中身を取り寄せて、ページ画像として上げる。 */
  async function uploadMediaToPage(pageId: string, item: MediaItem) {
    if (!group || !accountId) return
    setError(null)
    try {
      const res = await fetch(api.media.contentUrl(item.id, accountId), { credentials: 'include' })
      if (!res.ok) throw new Error(`media fetch failed: ${res.status}`)
      const blob = await res.blob()
      const file = new File([blob], item.filename, {
        type: item.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png',
      })
      await uploadPageImage(pageId, file)
    } catch (e) {
      setError(e instanceof ApiError ? imageUploadErrorText(e) : '登録メディアの画像を読み込めませんでした。もう一度お試しください。')
    }
  }

  /**
   * 画像の入れ先ページを決める。手順①は既定ページ（最初に見せる面）、
   * 手順②はいま開いているページ。
   */
  function imageTargetPage(which: 'default' | 'active'): Page | null {
    if (!group) return null
    if (which === 'default') {
      return pages.find((p) => p.id === group.defaultPageId) ?? pages[0] ?? null
    }
    return activePage
  }

  /** 手順①・手順②で共通の画像ファイル処理。入れ先は呼び出し側が決める。 */
  function handlePickedFile(file: File | null, which: 'default' | 'active') {
    if (!file) return
    // 作成前：手順①の画像は「選んだファイル」を持ち、create 後に既定ページへ上げる。
    if (!group) {
      resetPendingFile()
      const url = URL.createObjectURL(file)
      setPendingFile(file)
      setPendingFileUrl(url)
      setPendingFileDims(null)
      const img = new Image()
      img.onload = () => setPendingFileDims({ w: img.naturalWidth, h: img.naturalHeight })
      img.src = url
      setSelectedMedia(null)
      return
    }
    const target = imageTargetPage(which)
    if (!target) return
    if (target.id.startsWith('tmp-') && !host) {
      setError('新しいページは、先に下書きを保存してから画像を入れてください。')
      return
    }
    void uploadPageImage(target.id, file)
  }

  function handlePickedMedia(item: MediaItem) {
    setMediaPickerOpen(false)
    if (!group) {
      setSelectedMedia(item)
      resetPendingFile()
      return
    }
    const target = imageTargetPage(imagePickTarget)
    if (!target) return
    if (target.id.startsWith('tmp-')) {
      setError('新しいページは、先に下書きを保存してから画像を入れてください。')
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
    } catch {
      setTargetPreview(null)
      setTargetPreviewError('対象人数を確認できませんでした。条件は保存できます。')
    } finally {
      setTargetPreviewLoading(false)
    }
  }, [group, audience, targetingCondition, aggregateOnly, targetingPriority])

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
    } catch {
      setChecksError(true)
    } finally {
      setChecksLoading(false)
    }
  }, [group])

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
    const saved = loadPublishPlanDraft(groupId)
    if (saved) {
      setPublishPlan(saved)
      setPublishBaseline(saved)
      setEndEnabled(saved.mode === 'period')
    }
  }, [groupId])
  useEffect(() => {
    if (groupId && !host) savePublishPlanDraft(groupId, publishPlan)
  }, [groupId, publishPlan, host])

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
    } catch {
      setError('LINEの検査を通せませんでした。しばらくおいてから、もう一度お試しください。')
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
    } catch {
      setError('実機で見た記録を残せませんでした。もう一度お試しください。')
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
      const raw = e instanceof Error ? e.message : ''
      const isValidationMessage = /[ぁ-んァ-ヶ一-龠]/u.test(raw) && raw !== 'publish failed'
      setError(
        /targetingPriority/.test(raw)
          ? '出す順番は1以上の整数で入力してください。小数は使えません。'
          : isValidationMessage
            ? raw
            : draftSaved
              ? 'LINEへ登録できませんでした。下書きは保存済みです。LINEへの登録だけもう一度お試しください。'
              : 'LINEへ登録できませんでした。下書きは保存されていません。しばらくおいてから、もう一度お試しください。',
      )
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
        setError('公開を始める日時を選んでください。')
        return
      }
      if (publishPlan.mode === 'period' && !publishPlan.endsAt) {
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
    await handlePublish()
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
    ? selectedMedia && accountId
      ? api.media.contentUrl(selectedMedia.id, accountId)
      : pendingFileUrl
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
        name: i === 0 ? 'トップ' : `タブ ${String.fromCharCode(65 + i - 1)}`,
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
      : `名前：${name || '（未入力）'}・いまは下書きです`

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
    if (editLoad === 'missing') {
      return <TargetMissing kind="not-found" title="このリッチメニューは見つかりません" description="削除されたか、別の LINE アカウントのものです。一覧から選び直してください。" backHref="/rich-menus" backLabel="リッチメニュー一覧へ戻る" />
    }
    if (editLoad === 'error') {
      return <TargetMissing kind="error" title="リッチメニューを読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。" onRetry={() => void loadEditGroup()} />
    }
    return <p className={styles.editLoading} role="status">読み込み中…</p>
  }

  return (
    <CreatePage boardId={
        host ? (step === 'shape' ? 'gobhu' : step === 'buttons' ? 'egdGx' : step === 'audience' ? 'K0gu1' : 'gQabc')
          : step === 'shape' ? 'JeINq' : step === 'buttons' ? 'Z0uO6' : step === 'audience' ? 'OxEMM' : 'F4gELj'
      } title={<>リッチメニューを作る</>} description={<>{headNote}{conflict ? (
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
        ) : null}</>} identity={host ? (
          <button type="button" className={styles.backLink} onClick={host.onCancel}>← リッチメニューへ</button>
        ) : <Link href="/rich-menus" className={styles.backLink}>
          ← リッチメニューへ
        </Link>} steps={<Steps label="リッチメニューを作る手順" steps={stepperSteps} currentKey={step} />}  preview={renderRail()} previewCompactWhenNarrow footerActions={
          host ? (
            <>
              <Button type="button" onClick={host.onCancel} disabled={busy}>キャンセル</Button>
              {step === 'publish' ? (
                <>
                  <Button type="button" disabled={busy || !host.canOperate} busy={saving || host.busy} busyLabel="保存中…" onClick={() => void hostSave(false)}>
                    下書きのまま保存
                  </Button>
                  <Button type="button" variant="primary" disabled={busy || !host.canOperate || host.selectedCount === 0} title={host.selectedCount === 0 ? '配るアカウントを選んでください' : undefined} busy={saving || host.busy} busyLabel="保存しています…" onClick={() => void hostSave(true)}>
                    <Send size={14} aria-hidden="true" />
                    アカウントへ配る
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" disabled={busy || !host.canOperate} busy={saving} busyLabel="保存中…" onClick={() => void hostSave(false)}>
                    下書きを保存
                  </Button>
                  <Button type="button" variant="primary" disabled={busy} busy={saving} busyLabel="保存中…" onClick={() => void goNext()}>
                    <ArrowRight size={14} aria-hidden="true" />
                    {nextLabel(step as Exclude<StepKey, 'publish'>)}
                  </Button>
                </>
              )}
            </>
          ) : <>
            <Button href="/rich-menus">キャンセル</Button>
            {step === 'publish' ? (
              done ? (
                <Button href="/rich-menus">一覧へ戻る</Button>
              ) : (
                <>
                  <Button type="button" disabled={busy || !canOperate} busy={saving} busyLabel="保存中…" onClick={() => void saveDraft()}>
                    下書きのまま保存
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={
                      busy ||
                      !canOperate ||
                      (checks !== null && publishPlan.mode === 'now' && !checksAllOk) ||
                      (checks !== null && publishPlan.mode !== 'now' && !scheduleGateOk)
                    }
                    busy={publishing || saving}
                    busyLabel={publishPlan.mode === 'now' ? '公開しています…' : '予約しています…'}
                    onClick={() => void handlePublishSubmit()}
                  >
                    {publishPlan.mode === 'now' ? <Send size={14} aria-hidden="true" /> : <CalendarClock size={14} aria-hidden="true" />}
                    {publishPlan.mode === 'now' ? '公開する' : '予約する'}
                  </Button>
                </>
              )
            ) : (
              <>
                <Button type="button" disabled={busy} busy={saving} busyLabel="保存中…" onClick={() => void saveDraft()}>
                  下書きを保存
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy}
                  busy={saving}
                  busyLabel="保存中…"
                  onClick={() => void goNext()}
                >
                  {/* 板 `JeINq`：絵は印→文字の順（印が左・文字は絵x894）。 */}
                  <ArrowRight size={14} aria-hidden="true" />
                  {NEXT_LABEL[step as Exclude<StepKey, 'publish'>]}
                </Button>
              </>
            )}
          </>
        } status={dirty ? '未保存の変更があります' : undefined} >
      {host?.notice}



      {error ? (
        <Notice
          tone="danger"
          message={error}
          className="mb-1"
          action={
            loadFailedKinds.length > 0 && !isForbidden(loadError) ? (
              <Button type="button" onClick={() => { setError(null); void load() }}>
                もう一度読み込む
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {notice ? <Notice tone="success" message={notice} className="mb-1" onClose={() => setNotice('')} /> : null}


          {step === 'shape' ? renderShape() : null}
          {step === 'buttons' ? renderButtons() : null}
          {step === 'audience' ? renderAudience() : null}
          {step === 'publish' ? renderPublish() : null}




      {/* ページ画像：ファイルから */}
      <input
        ref={pageFileInput}
        type="file"
        accept="image/png,image/jpeg"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null
          e.target.value = ''
          handlePickedFile(file, 'active')
        }}
      />
      <input
        ref={shapeFileInput}
        type="file"
        accept="image/png,image/jpeg"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null
          e.target.value = ''
          handlePickedFile(file, 'default')
        }}
      />

      {host ? null : <MediaPickerDialog
        open={mediaPickerOpen}
        accountId={accountId}
        kind="image"
        title="リッチメニューの画像を選ぶ"
        description={
          group
            ? imagePickTarget === 'default'
              ? '最初に見せるページの画像として登録します。'
              : `ページ「${activePage?.name ?? ''}」の画像として登録します。`
            : '作成したメニューの最初に見せるページへ登録します。'
        }
        onClose={() => setMediaPickerOpen(false)}
        onSelect={handlePickedMedia}
      />}

      <ConfirmDialog
        open={removePageTarget !== null}
        title={removePageTarget ? `ページ「${removePageTarget.name}」を削除しますか？` : ''}
        description={
          removePageTarget && removePageBlockers(removePageTarget).length > 0
            ? 'このページはいま削除できません。理由を直してから、もう一度お試しください。'
            : 'このページと、そのページの面の設定を消します。'
        }
        confirmLabel="ページを削除する"
        destructive
        // 消せないときは押し口ごと出さない。
        onConfirm={
          removePageTarget && removePageBlockers(removePageTarget).length === 0
            ? () => removePage(removePageTarget)
            : undefined
        }
        onCancel={() => setRemovePageTarget(null)}
      >
        {removePageTarget && removePageBlockers(removePageTarget).length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {removePageBlockers(removePageTarget).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
      </ConfirmDialog>

      <Dialog open={previewOpen} title="LINEでの見え方" cancelLabel="閉じる" onCancel={() => setPreviewOpen(false)}>
        {renderLinePreview()}
      </Dialog>
      <Dialog open={imageGuideOpen} title="画像の作り方" cancelLabel="閉じる" onCancel={() => setImageGuideOpen(false)}>
        <div className="space-y-3 text-sm">
          <p>大きい画像は2500×1686px、小さい画像は2500×843pxで作ります。PNGかJPEGで、1MB以下にしてください。</p>
          <p>選んだ面の分け方に合わせて文字や絵を置きます。大切な文字や絵は面の区切りから離して、押す場所が分かるようにしてください。</p>
          <p>手順②で画像の上から面を選び、押したときの動きを設定します。公開前に「LINEでの見え方」と実際のスマートフォンで確認してください。</p>
        </div>
      </Dialog>
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="メニューの入力" onConfirm={confirmLeave} onCancel={cancelLeave} />

      {/* ★V8 `r8dGXT`「違いを比べる」の窓。最新と入力中の設定の要約を比べる。 */}
      <Dialog
        open={compareOpen}
        title="違いを比べる"
        description="ほかの人が保存した最新の内容と、あなたが直している内容を比べます。"
        cancelLabel="閉じる"
        onCancel={() => setCompareOpen(false)}
        footer={
          <Button type="button" variant="primary" onClick={acceptLatestAndContinue}>
            最新を読み込んで続ける
          </Button>
        }
      >
        <VersionCompare before={latestSummary} after={currentSummary} />
      </Dialog>
    </CreatePage>
  )

  /* ======== 手順①：形と画像 ======== */
  function renderShape() {
    const dims = RICH_MENU_DIMENSIONS[size]
    const shapeImageSelected = selectedMedia !== null || pendingFile !== null
    const pickedDims =
      selectedMedia && selectedMedia.width && selectedMedia.height
        ? { w: selectedMedia.width, h: selectedMedia.height }
        : pendingFileDims
    const shapeImageOk = pickedDims !== null ? pickedDims.w === dims.width && pickedDims.h === dims.height : null

    return (
      <>
        <Card padding="roomy" layout="vertical" className={styles.stackSection}>
          <SectionHeader title="名前とフォルダ" />
          <div className={styles.fieldGrid}>
            <Field label="メニュー名（友だちには見えません）" htmlFor="rm-name" error={nameError}>
              <TextInput id="rm-name" value={name} onChange={(e) => {
                setName(e.target.value)
                if (nameError) setNameError(null)
              }} placeholder="例：通常メニュー（会員向け）" invalid={Boolean(nameError)} />
            </Field>
            <Field label="フォルダ">
              <Select aria-label="フォルダ" value={folderId} onChange={setFolderId}
                options={[{ value: '', label: '未分類' }, ...folders.map((f) => ({ value: f.id, label: f.name }))]} size="full" />
            </Field>
          </div>
          <Field label="トーク画面の下の文言（14文字まで）" htmlFor="rm-chatbar" error={chatBarTextError}>
            <TextInput id="rm-chatbar" value={chatBarText} maxLength={14} onChange={(e) => {
              setChatBarText(e.target.value)
              if (chatBarTextError) setChatBarTextError(null)
            }} placeholder="メニュー" invalid={Boolean(chatBarTextError)} />
          </Field>
        </Card>

        <Card padding="roomy" layout="vertical" className={styles.stackSection}>
          <SectionHeader title="大きさと切替タブ" />
          <RadioCardGroup legend="大きさ" className="grid grid-cols-2 gap-3">
            {SIZE_OPTIONS.map((opt) => <RadioCard key={opt.value} name="rich-menu-size" value={opt.value}
              title={`${opt.label} ${opt.dims}`} note={opt.hint} icon={<opt.icon size={16} aria-hidden="true" />} checked={size === opt.value}
              disabled={locked} disabledReason="形は下書きを作ったあとは変えられません"
              onChange={() => {
                setSize(opt.value)
                const first = V8_LAYOUT_KEYS[opt.value][0]
                if (first) setTemplateKey(first)
              }} />)}
          </RadioCardGroup>
          {locked ? (
            <p className={styles.fieldHint}>形は下書きを作ったあとは変えられません。別の形で作るときは、新しく作り直してください。</p>
          ) : null}
          <div className={styles.segRow}>
            <span className={styles.segLabel}>切替タブの数</span>
            {locked ? (
              <span className={styles.cardNote}>
                {pages.length > 1 ? `${pages.length}ページ` : 'なし'}（手順②でページを足せます）
              </span>
            ) : (
              <>
                <SegmentedControl
                  aria-label="切替タブの数"
                  options={TAB_COUNT_OPTIONS}
                  value={String(Math.min(tabCount, 2))}
                  onChange={(v) => setTabCount(Number(v))}
                />
                <span className={styles.segHint}>タブで別のメニューへ移れます</span>
              </>
            )}
          </div>
        </Card>

        {/* 面の分け方 */}
        <Card padding="roomy" layout="vertical" className={styles.stackSection}>
          <div className={`flex flex-col ${styles.stackCompact}`}>
            <SectionHeader title="面の分け方" />
            <p className={styles.cardNote}>押せるところをいくつに分けるか。あとで区切り直せます</p>
          </div>
          <div className={styles.layoutGrid} role="radiogroup" aria-label="面の分け方">
            {shownLayouts.map((item) => (
              <button
                key={item.key}
                type="button"
                role="radio"
                aria-checked={templateKey === item.key}
                aria-label={V8_LAYOUT_LABEL[item.key] ?? item.label}
                disabled={locked}
                className={`${styles.layoutItem} ${templateKey === item.key ? styles.layoutItemOn : ''}`}
                onClick={() => setTemplateKey(item.key)}
              >
                <span className={styles.layoutThumb}>
                  <RichMenuTemplatePreview template={item} />
                </span>
                <span className={styles.layoutName} aria-hidden="true">
                  {V8_LAYOUT_LABEL[item.key] ?? item.label}
                </span>
              </button>
            ))}
          </div>
        </Card>

        {/* 画像 */}
        <Card padding="roomy" layout="vertical" className={styles.stackSection}>
          <div className={`flex flex-col ${styles.stackCompact}`}>
            <SectionHeader title="画像" />
            <p className={styles.cardNote}>
              {dims.width}×{dims.height}px・PNG か JPEG・1MB まで
            </p>
          </div>
          <div className={styles.imageRow}>
            {shapeImageSelected ? (
              <>
                {selectedMedia && accountId ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 認証つきの管理用URL
                  <img
                    src={api.media.contentUrl(selectedMedia.id, accountId)}
                    alt={`選択中の画像: ${selectedMedia.filename}`}
                    className={styles.imageThumb}
                  />
                ) : pendingFileUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- ローカルプレビュー
                  <img src={pendingFileUrl} alt={`選択中の画像: ${pendingFile?.name ?? ''}`} className={styles.imageThumb} />
                ) : null}
                <div className={styles.imageMeta}>
                  <span className="font-semibold text-ink">{selectedMedia?.filename ?? pendingFile?.name}</span>
                  <span className={shapeImageOk === true ? styles.imageMetaOk : undefined}>
                    {pickedDims ? `${pickedDims.w}×${pickedDims.h}・` : ''}
                    {selectedMedia?.sizeBytes !== undefined || pendingFile
                      ? `${Math.round(((selectedMedia?.sizeBytes ?? 0) || pendingFile?.size || 0) / 1024)}KB`
                      : ''}
                    {shapeImageOk === true ? '・大きさは合っています' : shapeImageOk === false ? '・大きさが合いません' : ''}
                  </span>
                  <span className="flex gap-2">
                    {host ? null : <Button type="button" onClick={() => { setImagePickTarget('default'); setMediaPickerOpen(true) }} disabled={!accountId}>
                      <ImageIcon size={15} aria-hidden /> 登録メディアから選ぶ
                    </Button>}
                    <Button type="button" onClick={() => { setSelectedMedia(null); resetPendingFile() }}>
                      選ばない
                    </Button>
                  </span>
                  <button type="button" className={styles.guideLink} onClick={() => setImageGuideOpen(true)}>
                    <BookOpen size={15} aria-hidden />画像の作り方（大きさ・押しやすい余白）
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* 板 `JeINq`：絵の画像の枠（180×121）。画像なしでは押すとファイルを選ぶ。 */}
                <Button
                  type="button"
                  aria-label="画像ファイルを選ぶ"
                  disabled={!accountId && !host}
                  onClick={() => shapeFileInput.current?.click()}
                  className="bg-success-bg text-accent-deep h-30 w-45 shrink-0 rounded-control border border-hairline text-caption font-semibold disabled:opacity-50"
                >
                  <span className="flex flex-col items-center justify-center gap-1">
                    <ImageIcon size={20} aria-hidden />
                    画像を選ぶ
                  </span>
                </Button>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="flex flex-wrap gap-2">
                    {host ? null : <Button type="button" onClick={() => { setImagePickTarget('default'); setMediaPickerOpen(true) }} disabled={!accountId}>
                      <ImageIcon size={15} aria-hidden /> 登録メディアから選ぶ
                    </Button>}
                    <Button type="button" onClick={() => shapeFileInput.current?.click()} disabled={!accountId && !host}>
                      ファイルを選ぶ
                    </Button>
                  </span>
                  <button type="button" className={styles.guideLink} onClick={() => setImageGuideOpen(true)}>
                    <BookOpen size={15} aria-hidden />画像の作り方（大きさ・押しやすい余白）
                  </button>
                </div>
              </>
            )}
          </div>
          {!shapeImageOk && shapeImageSelected ? (
            <p className={styles.fieldError} role="alert">
              画像の大きさが合いません。{dims.width}×{dims.height}px の画像を選んでください。
            </p>
          ) : null}
        </Card>
      </>
    )
  }

  /* ======== 手順②：ボタンの動き ======== */
  function renderButtons() {
    if (!activePage) return <div className={styles.stateCard}>ページがありません</div>
    const activeIndex = activePage.areas.findIndex((a) => a.id === selectedAreaId)
    const areaPages = pages
      .filter((p) => host || !p.id.startsWith('tmp-'))
      .map((p) => ({ id: p.id, name: p.name }))

    return (
      <>
        {/* 板 `Z0uO6`（2026-10-07 の絵）：外の箱に、札の箱・題・画像・面の一覧を入れる。 */}
        <div className={styles.buttonsSection}>
          <div className={styles.tabsCard}>
            <h2 className={styles.tabsTitle}>切替タブ（ページ）</h2>
            <p className={styles.cardNote}>ページごとに画像・面・動きを決めます。最後の1ページは消せません。</p>
          <div className="flex flex-wrap items-center gap-2">
            {pages.map((p, i) => (
              <FilterChip key={p.id} selected={p.id === activePage.id} icon={i === 0 ? <CircleDot size={13} aria-hidden /> : <Star size={13} aria-hidden />} onChange={() => {
                setActivePageId(p.id)
                setSelectedAreaId(p.areas[0]?.id ?? null)
                setPageActionsOpen(false)
              }} title={i === 0 ? '最初に見せるページ' : undefined}>
                {p.name}
              </FilterChip>
            ))}
            {pages.length < MAX_TAB_PAGES ? <Button type="button" onClick={addPage}>
              ページを足す
            </Button> : null}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className={styles.pageName}>
              <Field label="このページの名前" htmlFor="rm-page-name">
                <TextInput id="rm-page-name" value={activePage.name}
                  onChange={(e) => updatePage(activePage.id, { name: e.target.value })} maxLength={14} />
              </Field>
            </div>
            <Button type="button" onClick={() => setRemovePageTarget(activePage)} disabled={pages.length <= 1}>
              <Trash2 size={15} aria-hidden />このページを消す
            </Button>
            <div>
              <RowMenu appearance="plain" label="ページと画像の操作" open={pageActionsOpen} onOpenChange={setPageActionsOpen} items={[
                ...(host ? [] : [{ id: 'media', label: '登録メディアから選ぶ', disabled: busy || activePage.id.startsWith('tmp-'), disabledReason: '先に下書きを保存してください', onSelect: () => { setImagePickTarget('active'); setMediaPickerOpen(true) } }]),
                { id: 'file', label: 'ファイルを選ぶ', disabled: busy || (!host && activePage.id.startsWith('tmp-')), disabledReason: '先に下書きを保存してください', onSelect: () => pageFileInput.current?.click() },
                { id: 'tools', label: canvasToolsOpen ? '区切りの調整を閉じる' : '区切りを調整する', onSelect: () => setCanvasToolsOpen(!canvasToolsOpen) },
                { id: 'delete-area', label: '選んだ面を消す', tone: 'danger', disabled: !selectedAreaId, disabledReason: '先に面を選んでください', onSelect: () => { if (selectedAreaId) deleteArea(activePage.id, selectedAreaId) } },
              ]} />
            </div>
          </div>
          </div>
          <div className={styles.buttonsHead}>
            <h2 className={styles.buttonsTitle}>画像の上で面を選ぶ</h2>
            <p className={styles.cardNote}>面を押すと、下に動きを決める欄が出ます。線を動かして区切り直せます</p>
          </div>
          <CanvasEditor
            appearance="v8"
            showAreaList={false}
            showTools={canvasToolsOpen}
            areas={activePage.areas}
            size={group?.size ?? size}
            imageUrl={pageImageUrl}
            selectedAreaId={selectedAreaId}
            onSelectArea={setSelectedAreaId}
            onAddArea={(area) => addArea(activePage.id, area)}
            onUpdateArea={(id, patch) => updateArea(activePage.id, id, patch)}
            onDeleteArea={(id) => deleteArea(activePage.id, id)}
          />
          {/* 面の一覧 */}
          {activePage.areas.length > 0 ? (
            <ul className={styles.areaList}>
              {activePage.areas.map((area, i) => {
                const configured = isAreaActionConfigured(area)
                return (
                  <li key={area.id}>
                    <button
                      type="button"
                      className={`${styles.areaRow} ${area.id === selectedAreaId ? styles.areaRowOn : ''}`}
                      aria-pressed={area.id === selectedAreaId}
                      onClick={() => setSelectedAreaId(area.id)}
                    >
                      <span className={styles.areaLetter} aria-hidden>
                        {String.fromCharCode(65 + i)}
                      </span>
                      <span className={styles.areaName}>{areaDisplayName(area, i)}</span>
                      {configured ? (
                        <span className={styles.areaAction}>{areaActionSummary(area)}</span>
                      ) : (
                        <span className={styles.areaUnset}>未設定</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className={styles.cardNote}>画像の上をドラッグすると、面を足せます。</p>
          )}
          </div>

        {/* 面の動き */}
        {selectedArea && activeIndex >= 0 ? (
          <Card padding="roomy" layout="vertical">
            <SectionHeader title={`面 ${String.fromCharCode(65 + activeIndex)}「${areaDisplayName(selectedArea, activeIndex)}」の動き`} />
            <AreaProperties
              area={selectedArea}
              pages={areaPages}
              tags={tags}
              templates={templates}
              forms={forms}
              trackedLinks={trackedLinks}
              taps={null}
              onUpdate={(patch) => updateArea(activePage.id, selectedArea.id, patch)}
              onDelete={() => deleteArea(activePage.id, selectedArea.id)}
              showManagementDetails={false}
              allowedIntents={host ? [...HQ_RICH_MENU_INTENTS] : NEW_MENU_INTENTS_WITH_SWITCH}
            />
          </Card>
        ) : (
          <Card padding="roomy" layout="vertical">
            <p className={styles.cardNote}>上の画像で面を押すと、ここで動きを決められます。</p>
          </Card>
        )}
      </>
    )
  }

  /* ======== 手順③：誰に出すか ======== */
  function renderAudience() {
    return (
      <>
        {/* 出す相手 */}
        <Card padding="spacious" layout="vertical" className={`${styles.stackSection} ${styles.flatCard}`}>
          <SectionHeader title="出す相手" />
          <RadioCardGroup legend="出す相手" className="grid grid-cols-2 gap-3">
            <RadioCard
              name="audience"
              value="all"
              checked={audience === 'all'}
              onChange={() => setAudience('all')}
              title="すべての友だち"
              icon={<Users aria-hidden="true" />}
              note="ほかの出し分けに当てはまらない人に出る（既定）"
            />
            <RadioCard
              name="audience"
              value="targeted"
              checked={audience === 'targeted'}
              onChange={() => {
                setAudience('targeted')
                // 既定は「いちばん下」。0 は先頭の順番を意味するので、
                // すでにある出し分けのあとに置く（編集で前に持っていける）。
                if (targetingPriority === 0 && targetedMenus.length > 0) {
                  setTargetingPriority(targetedMenus.length)
                }
              }}
              title="条件に当てはまる友だちだけ"
              icon={<CircleHelp aria-hidden="true" />}
              note={host ? '条件は配った先のアカウントで決めます' : 'タグ・友だち情報などで絞る'}
            />
          </RadioCardGroup>

          {host ? (
            <div className={styles.infoBand}>
              <span className={styles.infoBandIcon}><Repeat size={16} aria-hidden /></span>
              <span>
                {audience === 'all'
                  ? '配ると、各アカウントで既定のメニューにするかどうかを選べます。'
                  : '配った先では下書きのまま届きます。どの友だちに出すかは、各アカウントで条件を決めます。'}
              </span>
            </div>
          ) : audience === 'all' ? (
            <div className={styles.infoBand}>
              <span className={styles.infoBandIcon}><Repeat size={16} aria-hidden /></span>
              <span>
                公開すると LINE の既定のメニューになります。
                {currentDefaultMenu
                  ? `いまの既定「${currentDefaultMenu.name}」と入れ替わります。`
                  : 'いま既定のメニューはありません。'}
              </span>
            </div>
          ) : (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>どんな人に出すか</span>
              <ConditionBuilder
                value={targetingCondition}
                onChange={setTargetingCondition}
                label="このメニューを出す相手"
                showCount={false}
              />
              {conditionEmpty ? (
                <p className={styles.fieldHint}>条件が空のままだと、公開しても誰にも出ません。</p>
              ) : null}
            </div>
          )}
        </Card>

        {/* 出す順番（統括：配った先の出す順番。小さいほど先） */}
        {host ? (
          <Card padding="spacious" layout="vertical" className={`${styles.stackSection} ${styles.flatCard}`}>
            <div className={`flex flex-col ${styles.stackCompact}`}>
              <SectionHeader title="出す順番" />
              <p className={styles.cardNote}>ほかの出し分けにも当てはまる人には、順番が早いメニューが出ます。配った先の順番として届きます</p>
            </div>
            <ol className={styles.orderList}>
              <li className={`${styles.orderRow} ${styles.orderRowSelf}`}>
                <span className={styles.orderNum}>{targetingPriority + 1}</span>
                <span className={styles.orderName}>{`${name || '（名前未入力）'}（このメニュー${audience === 'all' ? '・既定' : ''}）`}</span>
              </li>
            </ol>
            <Field label="順番（1 がいちばん先）" htmlFor="rm-hq-order">
              <TextInput id="rm-hq-order" inputMode="numeric" value={String(targetingPriority + 1)} onChange={(e) => {
                const next = Number(e.target.value.replace(/[^0-9]/g, ''))
                setTargetingPriority(Number.isFinite(next) && next > 0 ? Math.min(next, 999) - 1 : 0)
              }} />
            </Field>
          </Card>
        ) : null}
        {host ? null : <Card padding="spacious" layout="vertical" className={`${styles.stackSection} ${styles.flatCard}`}>
          <div className={`flex flex-col ${styles.stackCompact}`}>
            <SectionHeader title="出す順番" />
            <p className={styles.cardNote}>ほかの出し分けにも当てはまる人には、順番が早いメニューが出ます</p>
          </div>
          {orderRows.length > 0 ? (
            <ol className={styles.orderList}>
              {orderRows.map((row, i) => (
                <li key={row.id} className={`${styles.orderRow} ${row.isSelf ? styles.orderRowSelf : ''}`}>
                  <span className={styles.orderNum}>{i + 1}</span>
                  <span className={styles.orderName}>{row.label}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.cardNote}>ほかの出し分けメニューはありません。</p>
          )}
          {audience === 'targeted' ? (
            <p className={styles.fieldHint}>新しく作るメニューはいちばん下に置きます。前に出したいときは、あとで編集画面の「出す順番」から変えられます。</p>
          ) : null}
        </Card>}

        {/* トークを開いたとき（統括のひな形は持たない。配った先で決める） */}
        {host ? null : <Card padding="spacious" layout="vertical" className={`${styles.stackSection} ${styles.flatCard}`}>
          <SectionHeader title="トークを開いたとき" />
          <div className={styles.segRow}>
            <span className={`${styles.segLabel} ${styles.segLabelPlain}`}>メニューを</span>
            <SegmentedControl
              aria-label="トークを開いたときのメニュー"
              options={[
                { value: 'open', label: '開いておく' },
                { value: 'closed', label: '閉じておく' },
              ]}
              value={defaultOpen ? 'open' : 'closed'}
              onChange={(v) => setDefaultOpen(v === 'open')}
            />
          </div>
        </Card>}
      </>
    )
  }

  /* ======== 手順④：公開 ======== */
  function renderPublish() {
    if (host) {
      return (
        <>
          {host.distribute}
          <div className={styles.infoBand}>
            <span className={styles.infoBandIcon}><Repeat size={16} aria-hidden /></span>
            <span>配ると、選んだアカウントにリッチメニューが下書きとして届きます。既定のメニューにするか・LINE に出すかは、各アカウントで決めます。</span>
          </div>
        </>
      )
    }
    const timingIsScheduled = publishPlan.mode !== 'now'
    if (done) {
      return (
        <Card padding="spacious" layout="vertical" className={`${styles.stackSection} ${styles.flatCard}`}>
          <h2 className={styles.cardTitle}>
            {done === 'published' ? 'LINEへの登録が終わりました' : '公開予約を受け付けました'}
          </h2>
          <p className={styles.cardNote}>
            {done === 'published'
              ? '公開のようす・履歴は、リッチメニュー一覧の「公開中」から見られます。'
              : '予約の時点の内容で公開します。予約の確認・取り消しは編集画面からできます。'}
          </p>
          <div className={styles.pageTools}>
            <Button href="/rich-menus" variant="primary">
              一覧へ戻る
            </Button>
            {group ? <Button href={`/rich-menus/edit?id=${group.id}`}>編集画面を開く</Button> : null}
          </div>
        </Card>
      )
    }
    return (
      <>
        {/* いつ公開するか */}
        <Card padding="spacious" layout="vertical" className={`${styles.stackSection} ${styles.flatCard}`}>
          <SectionHeader title="いつ公開するか" />
          <RadioCardGroup legend="いつ公開するか" className="grid grid-cols-2 gap-3">
            <RadioCard
              name="timing"
              value="now"
              checked={publishPlan.mode === 'now'}
              onChange={() => {
                // 「すぐ出す」に終わりは関係しない。選び直したら期間の設定も外す。
                setEndEnabled(false)
                setPublishPlan({ ...publishPlan, mode: 'now' })
              }}
              title="すぐ公開する"
              icon={<Zap aria-hidden="true" />}
              note="確認が済んだらすぐLINEに出す"
            />
            <RadioCard
              name="timing"
              value="scheduled"
              checked={timingIsScheduled}
              onChange={() => setPublishPlan({ ...publishPlan, mode: endEnabled ? 'period' : 'scheduled' })}
              title="日時を決めて公開する"
              icon={<CalendarClock aria-hidden="true" />}
              note="キャンペーンの始まりに合わせる"
            />
          </RadioCardGroup>
          {timingIsScheduled ? (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>始める日時</span>
              <DateTimeField
                value={publishPlan.startsAt}
                onChange={(v) => setPublishPlan({ ...publishPlan, startsAt: v })}
                aria-label="公開を始める日時"
              />
            </div>
          ) : null}
          {/* 板 `F4gELj`：終わりを決めるは枠の箱。上の行に題とトグル、下の行に「日時 に終わり、［戻す先］に戻す」。オフのときは入力を無効化。 */}
          <div className={styles.endBox}>
            <div className={styles.endHead}>
              <span className={styles.endTitle}>終わりを決める（任意）</span>
              <Toggle
                label="終わりを決める"
                checked={endEnabled}
                onChange={(on) => {
                  setEndEnabled(on)
                  setPublishPlan({
                    ...publishPlan,
                    mode: on ? 'period' : publishPlan.mode === 'now' ? 'now' : 'scheduled',
                  })
                }}
              />
            </div>
            <div className={styles.endRow}>
              <span className={styles.endDate}>
                <DateTimeField
                  value={publishPlan.endsAt}
                  onChange={(v) => setPublishPlan({ ...publishPlan, endsAt: v })}
                  aria-label="終わる日時"
                  disabled={!endEnabled}
                />
              </span>
              <span>に終わり、</span>
              <Select
                aria-label="終わったらどうする"
                value={publishPlan.restoreGroupId}
                onChange={(v) => setPublishPlan({ ...publishPlan, restoreGroupId: v })}
                disabled={!endEnabled}
                options={[
                  { value: '', label: '前のメニューに戻す（実行開始時に確定）' },
                  ...restoreMenus.map((item) => ({ value: item.id, label: item.name })),
                ]}
              />
              <span>に戻す</span>
            </div>
          </div>
        </Card>

        {/* 公開の前の確認 */}
        <Card padding="spacious" layout="vertical" className={`${styles.stackSection} ${styles.flatCard}`}>
          <div className={`flex flex-col ${styles.stackCompact}`}>
            <SectionHeader title="公開の前の確認" />
            <p className={styles.cardNote}>3つそろうと公開できます</p>
          </div>
          {checksError ? (
            <p className={styles.fieldError}>確認の状態を読み込めませんでした。</p>
          ) : checksLoading && !checks ? (
            <p className={styles.cardNote}>読み込み中…</p>
          ) : checks ? (
            <ul className={styles.checkList}>
              <li className={styles.checkRow}>
                <CheckIcon state={checks.self.state} />
                <div className={styles.checkBody}>
                  <p className={styles.checkName}>自前の検査</p>
                  <p className={styles.checkNote}>
                    {checks.self.message ?? '未設定の面・重なり・画像・参照先・文字数・面の数'}
                  </p>
                </div>
                <span className={styles.checkAction}>
                  <button type="button" className={styles.checkRetry} onClick={() => void loadChecks()} disabled={checksLoading}>
                    {checksLoading ? '確認中…' : '見直す'}
                  </button>
                </span>
              </li>
              <li className={styles.checkRow}>
                <CheckIcon state={checks.line.state} />
                <div className={styles.checkBody}>
                  <p className={styles.checkName}>LINE の検査</p>
                  <p className={styles.checkNote}>
                    {checks.line.message ?? '下の「見直す」でLINEの受付へ確かめます。'}
                  </p>
                </div>
                <span className={styles.checkAction}>
                  <button type="button" className={styles.checkRetry} onClick={() => void validateWithLine()} disabled={validating}>
                    {validating ? '確認中…' : '見直す'}
                  </button>
                </span>
              </li>
              <li className={styles.checkRow}>
                {checks.device.state === 'ok'
                  ? <CheckIcon state="ok" />
                  : <CircleAlert className={`${styles.checkIcon} ${styles.checkIconWarn}`} aria-hidden />}
                <div className={styles.checkBody}>
                  <p className={styles.checkName}>スマホの LINE で見た</p>
                  <p className={styles.checkNote}>
                    {checks.device.state === 'ok'
                      ? `スマホの実機で確認済みです${checks.device.at ? `（${formatDateTime(checks.device.at)}）` : ''}。`
                      : '管理画面の見本だけでは公開できません。スマホで見た担当者が押します'}
                  </p>
                </div>
                <span className={styles.checkAction}>
                  <Button type="button" onClick={() => void recordSeen()} disabled={recording} busy={recording} busyLabel="記録中…">
                    <Smartphone size={15} aria-hidden /> スマホで見た
                  </Button>
                </span>
              </li>
            </ul>
          ) : null}
        </Card>
        {/* 板 `F4gELj`：案内の帯は段の外（左の直下）。 */}
        <div className={styles.infoBand}>
            <span className={styles.infoBandIcon}><Repeat size={16} aria-hidden /></span>
            <span>
              {audience === 'all'
                ? `公開すると、すべての友だちの既定のメニューが入れ替わります。`
                : '公開すると、条件に当てはまる人にこのメニューが出ます。'}
              {targetPreview?.higherMenus && targetPreview.higherMenus.length > 0 && targetPreview.overlap?.value
                ? `${targetPreview.higherMenus[0]}の${formatNumber(targetPreview.overlap.value)}人には、いままでどおり上のメニューが出ます。`
                : ''}
            </span>
        </div>
      </>
    )
  }

  /* ======== 右の列 ======== */
  /* LINEでの見え方（スマホの見本）。広い板は右の列に、狭い板（kmTab）は右の列のボタンから窓で開く。 */
  function renderLinePreview() {
    return (
      <LinePreview
        accountName={host ? '公式アカウント' : selectedAccount?.name}
        note="メニューの見え方の見本です。"
        chatBarText={chatBarText}
        richMenu={(
          <MenuPreview
            size={group?.size ?? size}
            imageUrl={previewImageUrl}
            areas={previewAreas}
            pages={previewPages}
            activePageId={previewPage?.id ?? activePage?.id ?? null}
          />
        )}
      />
    )
  }

  function renderRail() {
    return (
      <>
        {/* 絵 kmTab（1152）：右の列のいちばん上に「LINEでの見え方を見る」。広い板では出さない。 */}
        <div className={styles.railPhoneButton}>
          <Button type="button" onClick={() => setPreviewOpen(true)}>
            <Smartphone size={15} aria-hidden="true" />LINEでの見え方を見る
          </Button>
        </div>
        {step === 'shape' ? (
          <CreateSummaryCard
            title={host ? '配る前に見ておくところ' : '公開前に見ておくところ'}
            rows={[
              {
                key: 'actions',
                label: 'ボタンの動き',
                value: (
                  <span className={configuredCount < totalAreaCount || totalAreaCount === 0 ? styles.summaryValueWarn : styles.summaryValueOk}>
                    {totalAreaCount === 0
                      ? '面がありません'
                      : configuredCount === 0
                        ? `${totalAreaCount}つとも未設定`
                        : configuredCount < totalAreaCount
                          ? `${totalAreaCount - configuredCount}つ未設定`
                          : 'すべて設定済み'}
                  </span>
                ),
              },
              {
                key: 'image',
                label: '画像',
                value: (
                  <span className={previewImageUrl ? styles.summaryValueOk : styles.summaryValueWarn}>
                    {previewImageUrl ? 'OK' : 'まだ選んでいません'}
                  </span>
                ),
              },
              {
                key: 'tabs',
                label: '切替タブ',
                value: (group ? pages.length : tabCount + 1) > 1 ? `${group ? pages.length : tabCount + 1}ページ` : 'なし',
              },
            ]}
          />
        ) : null}

        {step === 'buttons' ? (
          <CreateSummaryCard
            title="押された回数（今月）"
            rows={
              selectedArea && activePage
                ? [
                    {
                      key: selectedArea.id,
                      label: `${String.fromCharCode(65 + activePage.areas.findIndex((a) => a.id === selectedArea.id))} ${areaDisplayName(selectedArea, activePage.areas.findIndex((a) => a.id === selectedArea.id))}`,
                      value: host ? '—（配る前）' : '—（公開前）',
                    },
                  ]
                : []
            }
          >
            {selectedArea && activePage ? null : <p className={styles.cardNote}>面を選ぶと、ここに数が出ます。</p>}
            <p className={styles.tapNote}>
              「メニューを切り替える」「日時を選ぶ」などLINEの中で終わる動きは、押されたことがこちらに届きません。
            </p>
          </CreateSummaryCard>
        ) : null}

        {step === 'audience' && host ? (
          <CreateSummaryCard
            title="誰に出すか"
            rows={[
              { key: 'audience', label: '出す相手', value: audience === 'all' ? 'すべての友だち（既定）' : '配った先で店が決める' },
              { key: 'order', label: '出す順番', value: `${targetingPriority + 1}番目` },
            ]}
          >
            <p className={styles.cardNote}>出る人数は、配った先の友だちで決まります。</p>
          </CreateSummaryCard>
        ) : null}
        {step === 'audience' && !host ? (
          <CreateSummaryCard
            title="出る人数"
            rows={[
              {
                key: 'effective',
                label: 'このメニューが出る人',
                value: audience === 'targeted' && conditionEmpty ? '0人' : targetPreviewLoading ? '確認中…' : <MetricValue metric={targetPreview?.effective} />,
              },
              {
                key: 'overlap',
                label: '上の順番で別のメニューが出る人',
                value: audience === 'targeted' && conditionEmpty ? '0人' : targetPreviewLoading ? '確認中…' : <MetricValue metric={targetPreview?.overlap} />,
              },
            ]}
          >
            {targetPreviewError ? <p className={styles.fieldError}>{targetPreviewError}</p> : null}
          </CreateSummaryCard>
        ) : null}

        {step === 'publish' && host ? (
          <CreateSummaryCard title="配ると" rows={host.distributeSummary} />
        ) : null}
        {step === 'publish' && !host ? (
          <CreateSummaryCard
            title="公開すると"
            rows={[
              ...(audience === 'all'
                ? [
                    {
                      key: 'default',
                      label: '既定のメニュー',
                      value: `${currentDefaultMenu?.name ?? '（なし）'} → このメニュー`,
                    },
                  ]
                : []),
              {
                key: 'audience',
                label: '出る人',
                value: audience === 'targeted' && conditionEmpty ? '0人' : targetPreviewLoading ? '確認中…' : <MetricValue metric={targetPreview?.effective} />,
              },
            ]}
          />
        ) : null}

        <div className={`flex w-full min-w-0 flex-col ${styles.stackSection} ${styles.railPhone}`}>
          {renderLinePreview()}
        </div>
      </>
    )
  }
}
