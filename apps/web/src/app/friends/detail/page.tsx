'use client'

import Avatar from '@/components/shared/avatar'
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ApiResponse, Chat, Folder, FriendField, Scenario } from '@line-crm/shared'
import {
  api,
  ApiError,
  fetchApi,
  type FriendDetail,
  type FriendFormSubmission,
  type MileageConnectedAccount,
  type MileageSelfInsights,
  type MileageSummary,
} from '@/lib/api'
import { canEditFeature, isOwnerOrAdmin } from '@/lib/staff-capability'
import { useAccount } from '@/contexts/account-context'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import { loadOperators } from '@/lib/operators-cache'
import { FeatureDisabledScreen } from '@/components/feature-disabled-gate'
import TagBadge from '@/components/friends/tag-badge'
import { FIELD_TYPE_LABELS } from '@/components/friend-fields/field-list'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import TargetMissing from '@/components/shared/target-missing'
import SelectField from '@/components/shared/select-field'
import ListRange from '@/components/ui/list-range'
import { usePageTitle } from '@/components/shell/page-chrome'

/**
 * 友だち詳細。
 *
 * ルートが /friends/[id] ではなく /friends/detail?id= なのは、この管理画面が
 * 静的書き出し（next.config の output: 'export'）だから。動的セグメントは
 * ビルド時に全IDが分からないと書き出せない。既存の /scenarios/detail?id= や
 * /rich-menus/edit?id= と同じ形にそろえている。
 */

/**
 * 右カラムのタブ（友だちV4詳細設計）。
 *
 * `pending` は、出す先のデータを取る口がまだ無いもの。タブそのものを
 * 消すと設計と並びが変わるので、出したうえで何が足りないかを書く。
 */
const TABS = [
  { key: 'timeline', label: '概要' },
  { key: 'history', label: '履歴' },
  { key: 'info', label: '情報欄' },
  { key: 'forms', label: '回答フォーム' },
  /*
    FRIEND-27: pending は開発者向けの「口が無い」説明で終わらせず、
    利用者向けの理由と、顧客を引き継ぐ/関連一覧へ進める操作を添える。
    操作の中身は下の pendingTabActions で付ける。
  */
  { key: 'scenario', label: '配信・シナリオ', pending: 'この友だちに届いている配信・シナリオの一覧はまだ見られません。この友だちをシナリオへ登録する操作はここからできます。' },
  { key: 'orders', label: '予約', pending: 'この友だちの予約だけを集めた画面はまだありません。予約の一覧からはこの人の予約を探せます。' },
  { key: 'reminders', label: 'リマインダ', pending: 'この友だちに届くリマインダだけを集めた画面はまだありません。設定済みのリマインダは一覧で確認できます。' },
  { key: 'actions', label: 'アクション', pending: 'この友だちへの操作だけを集めた履歴はまだありません。今は履歴タブに同じ記録が時系列で並んでいます。' },
  { key: 'miles', label: 'マイル', pending: 'この友だちのマイル残高と履歴は、マイル画面で確認できます。' },
  { key: 'richmenu', label: 'リッチメニュー', pending: 'この友だちのリッチメニュー変更履歴はまだ記録されていません。現在の割り当ては左の「リッチメニュー」欄で確認できます。' },
] as const
type TabKey = (typeof TABS)[number]['key']

/**
 * 上に並ぶ情報欄のグループ。既定の「基本」だけ固定で、あとは
 * 友だち情報欄のフォルダがそのまま並ぶ（飼い主情報・ペットプロフィール…）。
 *
 * 項目が増えると1枚の縦長なフォームになり、目的の項目まで
 * 延々と巻かないと届かない。分類でまとめて出す。
 */
const BASIC_GROUP = 'basic'
/** FRIEND-21: 「すべて」は分類をまたいだ全項目。URLの group 値として使う。 */
const ALL_GROUP = 'all'

/**
 * 受信箱への深いリンク。友だちIDはURL状態として安全に渡す。
 *
 * 受信箱は `?friend=` を読む。`?friendId=` では着かず既定一覧に
 * 落ちていた(#673)。IDに記号が混ざっても壊れないよう符号化する。
 */
function inboxHrefForFriend(friendId: string) {
  return `/chats?friend=${encodeURIComponent(friendId)}`
}

/**
 * 友だちの履歴1行（GET /api/friends/:id/timeline の形）。
 * 対応・配信・予約・フォーム回答・注文・投稿・名寄せ・計測イベントを時系列で返す。
 * source は元の台帳を指す。遷移先が作られている種類だけリンクにする。
 */
type FriendTimelineItem = {
  id: string
  type: string
  summary: string
  /** 状態を持つ種類だけ値が入る（予約の確定/取消、注文、投稿の審査など）。 */
  status: string | null
  source: {
    kind: string
    id: string
    /** 遷移先が親単位の画面のときの親ID（フォーム回答→フォームID等）。 */
    parentId: string | null
    /** 管理画面の外にある元情報（注文詳細・投稿画像）のURL。 */
    url: string | null
  } | null
  occurredAt: string
  lineAccount: { id: string; name: string | null } | null
}

/** 補助パネルそれぞれの読み込み状態。0件と取り損ねを分けるために持つ。 */
type PanelStatus = 'idle' | 'loading' | 'ready' | 'error'

/** 履歴の種別列。知らない種別が来ても落とさず「記録」に倒す。 */
const TIMELINE_TYPE_LABELS: Record<string, string> = {
  message_received: 'メッセージ受信',
  message_sent: 'メッセージ送信',
  form_submitted: 'フォーム回答',
  booking: '予約',
  calendar_booking: 'カレンダー予約',
  event_booking: 'イベント予約',
  reminder: 'リマインダ',
  ec_order: '注文',
  photo_submitted: '写真投稿',
  candidate: '重複候補',
  link: '名寄せ',
  unlink: '名寄せ解除',
  profile: 'プロフィール採用',
  priority: '名寄せ',
  migration: 'データ移行',
  // analytics_events 由来。専用台帳を持たない記録だけここへ届く。
  friend_add: '友だち追加',
  friend_unfollow: 'ブロック',
  tag_change: 'タグ変更',
  field_change: '情報欄変更',
  scenario_started: 'シナリオ開始',
  scenario_completed: 'シナリオ完了',
  url_clicked: 'リンククリック',
  site_event: 'サイトイベント',
  conversion_created: 'CV登録',
  conversion_approved: 'CV承認',
  conversion_rejected: 'CV否認',
  automation_completed: 'オートメーション完了',
}

function timelineTypeLabel(type: string) {
  return TIMELINE_TYPE_LABELS[type] ?? '記録'
}

/*
 * 状態列。種類ごとに画面の言葉へそろえる。
 * 知らない値は生の値を出す（隠すと「状態が取れたのに見えない」になる）。
 */
const TIMELINE_STATUS_LABELS: Record<string, Record<string, string>> = {
  booking: {
    requested: '申込中',
    confirmed: '確定',
    rejected: '却下',
    expired: '期限切れ',
    cancelled: 'キャンセル',
    completed: '完了',
    no_show: '未来店',
  },
  calendar_booking: {
    confirmed: '確定',
    cancelled: 'キャンセル',
    completed: '完了',
  },
  event_booking: {
    requested: '申込中',
    confirmed: '確定',
    rejected: '却下',
    cancelled: 'キャンセル',
    expired: '期限切れ',
    no_show: '未来店',
    attended: '出席',
  },
  reminder: {
    active: '設定中',
    completed: '完了',
    cancelled: 'キャンセル',
  },
  ec_order: {
    current: '有効',
    refunded: '返金済み',
    cancelled: 'キャンセル',
  },
  photo_submitted: {
    pending: '確認待ち',
    adopted: '採用',
    rejected: '不採用',
  },
}

function timelineStatusLabel(type: string, status: string | null) {
  if (!status) return null
  return TIMELINE_STATUS_LABELS[type]?.[status] ?? status
}

/*
 * 元情報へのリンク。実在する画面・URLだけを出す。
 * 行き先が無い種類（名寄せ・計測イベント・カレンダー予約）は黙って
 * リンクを付けず、本文だけにする（IDEA-03「無いデータをあるように出さない」）。
 */
function timelineSourceHref(item: FriendTimelineItem, friendId: string): { href: string; external: boolean } | null {
  const source = item.source
  if (!source) return null
  if (source.url) return { href: source.url, external: true }
  switch (source.kind) {
    case 'message':
      return { href: inboxHrefForFriend(friendId), external: false }
    case 'form_submission':
      return source.parentId
        ? { href: `/form-submissions/responses?id=${encodeURIComponent(source.parentId)}`, external: false }
        : null
    case 'booking':
      return { href: `/booking/bookings/detail?id=${encodeURIComponent(source.id)}`, external: false }
    case 'event_booking':
      return source.parentId
        ? { href: `/events/bookings?id=${encodeURIComponent(source.parentId)}`, external: false }
        : null
    case 'friend_reminder':
      return { href: '/reminders', external: false }
    default:
      return null
  }
}

/**
 * 世代・アカウント照合。別の友だち・アカウントへ切り替わったあとに届いた
 * 遅い応答を捨てるための判定。ref しか見ないのでコンポーネントの外に置く。
 */
function responseIsStale(
  generationRef: { current: number },
  accountRef: { current: string | null },
  generation: number,
  requestedAccountId: string | null,
) {
  return generation !== generationRef.current || requestedAccountId !== accountRef.current
}

/** 履歴1行の表の並び。概要タブ・履歴タブで同じ形にする。 */
/*
 * #773: 右ペインのカードは lg 帯で 500px 台前半までしか広がらず、
 * 固定列 140+140+110+64+gap+padding がほぼ全域を食い、「内容」の 1fr が
 * 実測 3px に潰れて1文字縦積みになっていた。minmax で各列に下限を持たせ、
 * カード幅が足りないときは下の @lg: 系コンテナクエリで折り返しへ逃がす。
 */
const TIMELINE_ROW_COLUMNS = 'minmax(7.5rem,140px) minmax(4.5rem,140px) minmax(6rem,1fr) minmax(4rem,110px) 3rem'

/**
 * 履歴1行。日時・種別・内容・状態・アカウント・元情報リンクを出す。
 * 狭い幅では grid をやめて折り返す（概要タブと同じ組み方）。
 */
function FriendTimelineRow({ item, friendId, last = false }: { item: FriendTimelineItem; friendId: string; last?: boolean }) {
  const statusLabel = timelineStatusLabel(item.type, item.status)
  const source = timelineSourceHref(item, friendId)
  return (
    <div
      className={`text-ink-secondary flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline px-4 py-3 text-xs @lg:grid @lg:border-b-0 ${last ? 'last:border-b-0' : ''}`}
      style={{ gridTemplateColumns: TIMELINE_ROW_COLUMNS }}
    >
      <span>{new Date(item.occurredAt).toLocaleString('ja-JP')}</span>
      <span>{timelineTypeLabel(item.type)}</span>
      <span className="min-w-0 flex-1 basis-full @lg:basis-auto">
        {statusLabel ? (
          <span className="border-hairline bg-canvas-sunken text-ink-faint mr-1.5 inline-block rounded-full border px-1.5 py-px font-semibold leading-4">
            {statusLabel}
          </span>
        ) : null}
        {item.summary}
      </span>
      <span className="truncate">{item.lineAccount?.name ?? '—'}</span>
      <span>
        {source ? (
          source.external ? (
            <a href={source.href} target="_blank" rel="noreferrer" className="text-action hover:underline">
              開く
            </a>
          ) : (
            <Link href={source.href} className="text-action hover:underline">
              開く
            </Link>
          )
        ) : null}
      </span>
    </div>
  )
}

function FieldInput({
  field,
  value,
  onChange,
  disabled = false,
  id,
  labelId,
}: {
  field: FriendField
  value: string
  onChange: (v: string) => void
  /** N-037: 保存権限が無い人には値を読ませるだけにする（PUTは403になる）。 */
  disabled?: boolean
  /*
    FRIEND-22: 項目名ラベルと入力欄を結び付けるための一意ID。
    labelId は <input> と結び付かない表示型（複数選択）が
    aria-labelledby で項目名へ戻るための参照。
  */
  id?: string
  labelId?: string
}) {
  const readOnly = disabled || field.ecIsMaster
  const base =
    'border-hairline rounded-control w-full border px-3 py-2 text-sm disabled:bg-canvas-sunken disabled:text-ink-faint'

  if (field.type === 'textarea') {
    return (
      <textarea
        id={id}
        rows={3}
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={`${base} resize-y`}
      />
    )
  }
  if (field.type === 'multi_select') {
    // 複数選択を単一選択で保存すると、既存の複数値が1値で黙って上書きされる
    // (#496-16)。複数選択UIと区切りの持ち方を決めるまで、読み取り専用にする。
    return (
      <div aria-labelledby={labelId}>
        <p className="border-hairline bg-canvas-sunken text-ink-secondary rounded-control border px-3 py-2 text-sm">
          {value || '未入力'}
        </p>
        <p className="text-ink-faint mt-1 text-xs">複数選択の項目はこの画面では変更できません。</p>
      </div>
    )
  }
  if (field.type === 'select') {
    return (
      <SelectField
        id={id}
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${field.name}の値`}
        className={base}
        options={[
          { value: '', label: '— 未設定 —' },
          ...(field.options ?? []).map((option) => ({ value: option, label: option })),
        ]}
      />
    )
  }
  if (field.type === 'checkbox') {
    return (
      <label className="flex cursor-pointer items-center gap-2">
        <input
          id={id}
          type="checkbox"
          checked={value === '1'}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.checked ? '1' : '')}
          className="rounded border-gray-300"
        />
        <span className="text-ink-secondary text-sm">はい</span>
      </label>
    )
  }
  const inputType =
    field.type === 'number'
      ? 'number'
      : field.type === 'date'
        ? 'date'
        : field.type === 'url'
          ? 'url'
          : field.type === 'tel'
            ? 'tel'
            : field.type === 'email'
              ? 'email'
              : 'text'
  return (
    <input
      id={id}
      type={inputType}
      value={value}
      disabled={readOnly}
      onChange={(e) => onChange(e.target.value)}
      className={base}
    />
  )
}

/**
 * 左の各節の見出し。右端に「編集」「すべて見る」「変更」が付く。
 *
 * 設計では節ごとに行き先が違う。ここで受けて、節の中身と離さない。
 */
function SectionHead({
  label,
  actionLabel,
  href,
}: {
  label: string
  actionLabel: string
  href: string
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <p className="text-ink-faint text-xs font-semibold">{label}</p>
      <Link href={href} className="text-action shrink-0 text-xs hover:underline">
        {actionLabel}
      </Link>
    </div>
  )
}

/** 対応状況。やり取りがまだ無い友だちは、未対応でも対応済みでもない。 */
function SupportMarkBadge({ status }: { status?: 'unread' | 'in_progress' | 'on_hold' | 'resolved' }) {
  if (!status) return <span className="text-ink-faint text-xs">やり取りなし</span>
  const map = {
    unread: { label: '未対応', className: 'bg-warning-bg text-warning' },
    in_progress: { label: '対応中', className: 'bg-info-bg text-info' },
    on_hold: { label: '保留', className: 'bg-action-soft text-action' },
    resolved: { label: '対応済み', className: 'bg-success-bg text-success' },
  } as const
  const s = map[status]
  return (
    <span className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${s.className}`}>
      {s.label}
    </span>
  )
}

function FriendDetailInner() {
  usePageTitle('友だち詳細')
  const params = useSearchParams()
  const friendId = params.get('id') ?? ''
  const rawTab = params.get('tab')
  // 既定はタイムライン。設計でも最初に開くのはやり取り。
  const tab: TabKey = (TABS.find((t) => t.key === rawTab)?.key ?? 'timeline') as TabKey

  const [friend, setFriend] = useState<FriendDetail | null>(null)
  const [fields, setFields] = useState<FriendField[]>([])
  const [hiddenPersonalCount, setHiddenPersonalCount] = useState(0)
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  /** 404・空で見つからないとき。取得の失敗（error）とは分ける。 */
  const [friendMissing, setFriendMissing] = useState(false)
  const [notice, setNotice] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  /*
    NEXT-11: マイル・リッチメニュー・情報欄・履歴はそれぞれ独立して読み込む。
    以前は Promise.all で待ち合わせていたため、遅い補助APIが顧客名の表示まで
    止めていた。各パネルは自分の状態（loading/ready/error）と再試行口を持つ。
  */
  const [fieldsStatus, setFieldsStatus] = useState<PanelStatus>('idle')
  /*
    FRIEND-21: 情報欄の分類（フォルダ）名。項目だけでは分類の名前が
    分からないため、friend_field 種別のフォルダ一覧から引く。
    取り損ねても項目自体は見せられるよう、状態は fields とは分ける。
  */
  const [fieldFolders, setFieldFolders] = useState<Folder[]>([])
  const [fieldFoldersStatus, setFieldFoldersStatus] = useState<PanelStatus>('idle')
  /*
    FRIEND-25: 保存に送った版。応答待ちの間に利用者が追記した欄を、
    保存後の再取得で上書きしないために保持する。保存成功の確認まで残す。
  */
  const saveSnapshotRef = useRef<Record<string, string> | null>(null)
  /*
    #773: タブ帯はV7の方針で「折らずに横へ流す」が、macOSではスクロールバーが
    出ないため、端で切れたタブ（リマインダ等）が壊れて見え、続きの存在にも
    気づけない。はみ出している時だけ右端にフェードを出して続きを示す。
  */
  const tabsRowRef = useRef<HTMLDivElement>(null)
  const [tabsOverflowing, setTabsOverflowing] = useState(false)
  const [mileage, setMileage] = useState<MileageSummary | null>(null)
  const [mileageInsights, setMileageInsights] = useState<MileageSelfInsights | null>(null)
  const [mileageConnections, setMileageConnections] = useState<MileageConnectedAccount[]>([])
  const [mileageStatus, setMileageStatus] = useState<PanelStatus>('idle')
  const [richMenu, setRichMenu] = useState<{ name: string | null; isDefault: boolean } | null>(null)
  const [richMenuStatus, setRichMenuStatus] = useState<PanelStatus>('idle')
  const [historyItems, setHistoryItems] = useState<FriendTimelineItem[]>([])
  const [historyStatus, setHistoryStatus] = useState<PanelStatus>('idle')
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null)
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false)
  /*
    FRIEND-26: 「さらに読み込む」の失敗は末尾だけに出す。
    初回の失敗（historyStatus='error'）と分けないと、読めていた履歴まで
    エラー画面に巻き込まれる。
  */
  const [historyMoreError, setHistoryMoreError] = useState(false)
  /*
    PERF-13: フォーム回答は本体の応答に同梱せず、回答フォームタブを
    開いたときにカーソル式で取る。履歴タブと同じく「さらに読み込む」で
    古い回答へ遡れる。0件・未取得・失敗は別の状態で出す。
  */
  const [submissions, setSubmissions] = useState<FriendFormSubmission[]>([])
  const [submissionsStatus, setSubmissionsStatus] = useState<PanelStatus>('idle')
  const [submissionsTotal, setSubmissionsTotal] = useState<number | null>(null)
  const [submissionsNextCursor, setSubmissionsNextCursor] = useState<string | null>(null)
  const [submissionsLoadingMore, setSubmissionsLoadingMore] = useState(false)
  const [submissionsMoreError, setSubmissionsMoreError] = useState(false)
  /*
    FRIEND-31: スマートフォンでは長いプロフィールがタブを下へ追いやる。
    氏名・対応状況・主操作の下にタブが来るよう、補助プロフィールは
    lg未満では折りたたむ。lg以上では常時展開。
  */
  const [profileExpanded, setProfileExpanded] = useState(false)
  // 上部のメニュー（NEXT-08）。個別操作＝この友だちへの操作、その他＝関連画面。
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  // シナリオ登録の選択画面（NEXT-09）。選択→確認→登録までここで完結する。
  const [scenarioPickerOpen, setScenarioPickerOpen] = useState(false)
  const [scenarioOptions, setScenarioOptions] = useState<Scenario[]>([])
  const [scenarioListStatus, setScenarioListStatus] = useState<PanelStatus>('idle')
  const [scenarioPick, setScenarioPick] = useState('')
  const [scenarioBusy, setScenarioBusy] = useState(false)
  const [scenarioError, setScenarioError] = useState('')
  const [scenarioNotice, setScenarioNotice] = useState('')
  /*
    N-045: PUT /api/friends/:id/fields はオーナー・管理者、または
    attribute.personal_info.edit を持つ staff が個人情報の項目だけ
    変更できる。鍵の無い staff に押すと403になる口は出さない。
    項目の新規登録（POST /api/friend-fields）は従来どおり
    オーナー・管理者専用。localStorage の役割は auth-guard が
    /api/auth/session から保存したもの。
  */
  const [canSaveFields] = useState(() => typeof window === 'undefined' ? true : isOwnerOrAdmin() || canEditFeature('attribute.personal_info.edit'))
  const [canManageFieldDefs] = useState(() => typeof window === 'undefined' ? true : isOwnerOrAdmin())
  // staff は個人情報の項目だけ書ける。それ以外はサーバも受けない。
  const canEditField = (field: FriendField) =>
    canManageFieldDefs || (field.isPersonal && canSaveFields)
  /*
    N-035: 担当・対応状況は PUT /api/chats/:id で変えられる
    （owner/admin/staff + '/chats' 編集キー）。友だち詳細にも同じ権限で
    だけ編集口を出す。鍵の無いstaff・viewerには出さない。
  */
  const [canEditSupport] = useState(() => typeof window === 'undefined' ? true : canEditFeature('/chats'))
  const [supportEditing, setSupportEditing] = useState(false)
  const [supportStatus, setSupportStatus] = useState<Chat['status']>('resolved')
  const [supportOperatorId, setSupportOperatorId] = useState('')
  const [supportRevision, setSupportRevision] = useState(0)
  const [supportOperators, setSupportOperators] = useState<Array<{ id: string; name: string }>>([])
  const [supportBusy, setSupportBusy] = useState(false)
  const [supportError, setSupportError] = useState('')
  const [supportNotice, setSupportNotice] = useState('')
  const router = useRouter()
  // ID切替で遅い返事が新しい画面に残らないよう、世代で捨てる(#496-20。一覧側と同型)。
  const loadRequestRef = useRef(0)
  // 補助パネルごとの番号。同じパネルの再試行が前の応答を上書きしない。
  const fieldsReqRef = useRef(0)
  const foldersReqRef = useRef(0)
  const mileageReqRef = useRef(0)
  const richMenuReqRef = useRef(0)
  const historyReqRef = useRef(0)
  const submissionsReqRef = useRef(0)
  const scenarioReqRef = useRef(0)
  const group = params.get('group') ?? BASIC_GROUP
  // 情報欄タブは friend_fields の画面。オフのaccountではタブごと出さない。
  const { selectedAccountId, selectedAccount } = useAccount()
  const fieldsEnabled = useFeatureVisibility(selectedAccountId).enabled('friend_fields')
  const visibleTabs = fieldsEnabled ? TABS : TABS.filter((t) => t.key !== 'info')
  /*
    要求が向かったアカウントを固定し、応答時に現在値と照合する。
    アカウントを切り替えたあとに届いた古い応答は捨てる（一覧側 #964 と同型）。
  */
  const accountContextRef = useRef(selectedAccountId)
  accountContextRef.current = selectedAccountId
  /** 世代とアカウントの両方が今の画面と合うときだけ応答を採用する。refのみ読むので安定。 */
  const isStaleResponse = useCallback(
    (generation: number, requestedAccountId: string | null) =>
      responseIsStale(loadRequestRef, accountContextRef, generation, requestedAccountId),
    [],
  )

  /*
   * 本体の取得。顧客名・基本情報・戻る導線はこれだけで出せるので、
   * 補助パネルの遅延・失敗に巻き込まれないよう独立させる（NEXT-11）。
   */
  const loadFriend = useCallback(async () => {
    if (!friendId) {
      setLoading(false)
      return
    }
    const generation = loadRequestRef.current
    const requestedAccountId = selectedAccountId
    setLoading(true)
    setError('')
    setFriendMissing(false)
    try {
      // PERF-13: 回答本文は初期応答に載せない。総数だけ返るので
      // サイドの「フォーム回答 N件」とタブの案内は変わらない。
      const res = await api.friends.get(friendId, { includeSubmissions: false })
      if (isStaleResponse(generation, requestedAccountId)) return
      if (res.success) setFriend(res.data)
      else setError(res.error)
    } catch (err) {
      if (isStaleResponse(generation, requestedAccountId)) return
      setFriend(null)
      if (err instanceof ApiError && err.status === 404) {
        setFriendMissing(true)
        setError('')
      } else {
        setError('読み込みに失敗しました。もう一度読み込んでください。')
      }
    } finally {
      if (!isStaleResponse(generation, requestedAccountId)) setLoading(false)
    }
  }, [friendId, selectedAccountId, isStaleResponse])

  const loadFields = useCallback(async () => {
    if (!friendId) return
    const generation = loadRequestRef.current
    const requestedAccountId = selectedAccountId
    const req = ++fieldsReqRef.current
    setFieldsStatus('loading')
    try {
      const res = await api.friendFields.forFriend(friendId, { suppressFeatureDisabledEvent: true })
      if (req !== fieldsReqRef.current || isStaleResponse(generation, requestedAccountId)) return
      if (res.success) {
        setFields(res.data.items)
        setHiddenPersonalCount(res.data.hiddenPersonalCount)
        /*
          FRIEND-25: 保存の応答を待つ間に追記された欄は、再取得値で
          上書きしない。送信した版（saveSnapshotRef）から変わっていない
          欄だけ最新の値へ置き換える。再取得失敗時は setValues に
          触らないので、下書きはそのまま残る。
        */
        const sentSnapshot = saveSnapshotRef.current
        saveSnapshotRef.current = null
        setValues((prev) => {
          const next: Record<string, string> = {}
          for (const f of res.data.items) {
            const serverValue = f.value ?? ''
            if (
              sentSnapshot
              && prev[f.id] !== undefined
              && prev[f.id] !== sentSnapshot[f.id]
            ) {
              // 保存待ちの間に利用者が書き換えた欄。下書きを優先する。
              next[f.id] = prev[f.id]
            } else {
              next[f.id] = serverValue
            }
          }
          return next
        })
        setFieldsStatus('ready')
      } else {
        setFieldsStatus('error')
      }
    } catch {
      if (req !== fieldsReqRef.current || isStaleResponse(generation, requestedAccountId)) return
      setFieldsStatus('error')
    }
  }, [friendId, selectedAccountId, isStaleResponse])

  /*
    FRIEND-21: 分類の切替に必要なフォルダ名一覧。項目の読み込みとは
    独立させ、ここが失敗しても情報欄自体は使える（分類名は「分類」と
    だけ出す縮退表示にする）。
  */
  const loadFieldFolders = useCallback(async () => {
    const generation = loadRequestRef.current
    const requestedAccountId = selectedAccountId
    const req = ++foldersReqRef.current
    setFieldFoldersStatus('loading')
    try {
      const res = await api.folders.list('friend_field')
      if (req !== foldersReqRef.current || isStaleResponse(generation, requestedAccountId)) return
      if (res.success) {
        setFieldFolders(res.data)
        setFieldFoldersStatus('ready')
      } else {
        setFieldFoldersStatus('error')
      }
    } catch {
      if (req !== foldersReqRef.current || isStaleResponse(generation, requestedAccountId)) return
      setFieldFoldersStatus('error')
    }
  }, [selectedAccountId, isStaleResponse])

  const loadMileage = useCallback(async () => {
    if (!friendId) return
    const generation = loadRequestRef.current
    const requestedAccountId = selectedAccountId
    const req = ++mileageReqRef.current
    setMileageStatus('loading')
    try {
      /*
        名寄せ件数（insights）と接続アカウント一覧も同じ応答に入る。
        accountId を渡すと、表示中アカウントと別アカウントの友だちでは
        404 になる＝アカウント照合をサーバ側でも効かせられる。
      */
      const res = await api.friends.mileage(friendId, {
        limit: 1,
        accountId: requestedAccountId || undefined,
      })
      if (req !== mileageReqRef.current || isStaleResponse(generation, requestedAccountId)) return
      if (res.success) {
        setMileage(res.data.summary)
        setMileageInsights(res.data.insights)
        setMileageConnections(res.data.connections)
        setMileageStatus('ready')
      } else {
        setMileageStatus('error')
      }
    } catch {
      if (req !== mileageReqRef.current || isStaleResponse(generation, requestedAccountId)) return
      setMileageStatus('error')
    }
  }, [friendId, selectedAccountId, isStaleResponse])

  const loadRichMenu = useCallback(async () => {
    if (!friendId) return
    const generation = loadRequestRef.current
    const requestedAccountId = selectedAccountId
    const req = ++richMenuReqRef.current
    setRichMenuStatus('loading')
    try {
      const res = await api.friends.richMenu(friendId)
      if (req !== richMenuReqRef.current || isStaleResponse(generation, requestedAccountId)) return
      // 失敗時と「未設定」は出し分ける。失敗を「既定のメニュー」に倒すと誤表示(#496-13)。
      if (res.success) {
        setRichMenu(res.data)
        setRichMenuStatus('ready')
      } else {
        setRichMenuStatus('error')
      }
    } catch {
      if (req !== richMenuReqRef.current || isStaleResponse(generation, requestedAccountId)) return
      setRichMenuStatus('error')
    }
  }, [friendId, selectedAccountId, isStaleResponse])

  /*
   * 履歴は「概要の最近の履歴」と「履歴タブ」で共用する。
   * 必要なタブを開いたときにだけ取りに行く（NEXT-11の表示時取得）。
   * cursor を渡すと続きを足す（履歴タブの「さらに読み込む」）。
   */
  const loadHistory = useCallback(async (cursor?: string) => {
    if (!friendId) return
    const generation = loadRequestRef.current
    const requestedAccountId = selectedAccountId
    const req = ++historyReqRef.current
    if (cursor) {
      setHistoryLoadingMore(true)
      setHistoryMoreError(false)
    } else {
      setHistoryStatus('loading')
      setHistoryMoreError(false)
    }
    try {
      const query = new URLSearchParams({ limit: cursor ? '50' : '8' })
      if (cursor) query.set('cursor', cursor)
      const res = await fetchApi<ApiResponse<{
        items: FriendTimelineItem[]
        nextCursor: string | null
      }>>(`/api/friends/${encodeURIComponent(friendId)}/timeline?${query}`, {
        suppressFeatureDisabledEvent: true,
      })
      if (req !== historyReqRef.current || isStaleResponse(generation, requestedAccountId)) return
      if (res.success) {
        setHistoryItems((prev) => {
          if (!cursor) return res.data.items
          /*
            IDEA-03「重複なし」: 続きを取る間に予約などが更新されて
            occurred_at が動くと、同じ行が次のページへずれて二重に
            届きうる。source が指す元の行が同じものは足さない。
          */
          const seen = new Set(prev.map((item) => `${item.source?.kind ?? item.type}:${item.id}`))
          return [...prev, ...res.data.items.filter((item) => !seen.has(`${item.source?.kind ?? item.type}:${item.id}`))]
        })
        setHistoryNextCursor(res.data.nextCursor)
        setHistoryStatus('ready')
      } else if (cursor) {
        /*
          FRIEND-26: 続きの取り損ねは末尾の再試行だけに留め、
          取得済みの行とカーソルは消さない。historyStatus は
          'ready' のままなので一覧はそのまま残る。
        */
        setHistoryMoreError(true)
      } else {
        setHistoryStatus('error')
      }
    } catch {
      if (req !== historyReqRef.current || isStaleResponse(generation, requestedAccountId)) return
      if (cursor) setHistoryMoreError(true)
      else setHistoryStatus('error')
    } finally {
      if (req === historyReqRef.current && !isStaleResponse(generation, requestedAccountId)) {
        setHistoryLoadingMore(false)
      }
    }
  }, [friendId, selectedAccountId, isStaleResponse])

  /*
   * PERF-13: フォーム回答は回答フォームタブを開いたときにだけ取る。
   * cursor を渡すと続きを足す（履歴タブの「さらに読み込む」と同じ形）。
   * 途中の取り損ねは末尾の再試行だけに留め、取得済みの行は消さない。
   */
  const loadSubmissions = useCallback(async (cursor?: string) => {
    if (!friendId) return
    const generation = loadRequestRef.current
    const requestedAccountId = selectedAccountId
    const req = ++submissionsReqRef.current
    if (cursor) {
      setSubmissionsLoadingMore(true)
      setSubmissionsMoreError(false)
    } else {
      setSubmissionsStatus('loading')
      setSubmissionsMoreError(false)
    }
    try {
      const res = await api.friends.formSubmissions(friendId, { cursor: cursor ?? null, limit: 10 })
      if (req !== submissionsReqRef.current || isStaleResponse(generation, requestedAccountId)) return
      if (res.success) {
        setSubmissions((prev) => {
          if (!cursor) return res.data.items
          const seen = new Set(prev.map((item) => item.id))
          return [...prev, ...res.data.items.filter((item) => !seen.has(item.id))]
        })
        setSubmissionsTotal(res.data.total)
        setSubmissionsNextCursor(res.data.nextCursor)
        setSubmissionsStatus('ready')
      } else if (cursor) {
        setSubmissionsMoreError(true)
      } else {
        setSubmissionsStatus('error')
      }
    } catch {
      if (req !== submissionsReqRef.current || isStaleResponse(generation, requestedAccountId)) return
      if (cursor) setSubmissionsMoreError(true)
      else setSubmissionsStatus('error')
    } finally {
      if (req === submissionsReqRef.current && !isStaleResponse(generation, requestedAccountId)) {
        setSubmissionsLoadingMore(false)
      }
    }
  }, [friendId, selectedAccountId, isStaleResponse])

  /*
   * 友だち・アカウントの切替。本体を取り直し、補助パネルは全部リセットして
   * それぞれ取り直す。履歴だけは開いているタブに合わせて別のeffectで取る。
   */
  const startAll = useCallback(() => {
    loadRequestRef.current += 1
    setFriend(null)
    setError('')
    setNotice('')
    setWarnings([])
    setLoading(!!friendId)
    setFields([])
    setHiddenPersonalCount(0)
    setValues({})
    setFieldsStatus('idle')
    saveSnapshotRef.current = null
    setFieldFolders([])
    setFieldFoldersStatus('idle')
    setProfileExpanded(false)
    setMileage(null)
    setMileageInsights(null)
    setMileageConnections([])
    setMileageStatus('idle')
    setRichMenu(null)
    setRichMenuStatus('idle')
    setHistoryItems([])
    setHistoryStatus('idle')
    setHistoryNextCursor(null)
    setHistoryLoadingMore(false)
    setHistoryMoreError(false)
    setSubmissions([])
    setSubmissionsStatus('idle')
    setSubmissionsTotal(null)
    setSubmissionsNextCursor(null)
    setSubmissionsLoadingMore(false)
    setSubmissionsMoreError(false)
    setScenarioPickerOpen(false)
    setScenarioOptions([])
    setScenarioListStatus('idle')
    setScenarioPick('')
    setScenarioError('')
    setScenarioNotice('')
    setActionMenuOpen(false)
    setMoreMenuOpen(false)
    void loadFriend()
    void loadFields()
    void loadFieldFolders()
    void loadMileage()
    void loadRichMenu()
  }, [friendId, loadFriend, loadFields, loadFieldFolders, loadMileage, loadRichMenu])

  useEffect(() => {
    startAll()
  }, [startAll])

  // 履歴は「概要」「履歴」タブを開いたときにだけ取る（表示時取得）。
  useEffect(() => {
    if ((tab === 'timeline' || tab === 'history') && historyStatus === 'idle') {
      void loadHistory()
    }
  }, [tab, historyStatus, loadHistory])

  // #773: タブ帯がはみ出しているかを実測する。はみ出し中だけ右端フェードを出す。
  useEffect(() => {
    const el = tabsRowRef.current
    if (!el) return
    const check = () => setTabsOverflowing(el.scrollWidth > el.clientWidth + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [visibleTabs.length])

  // PERF-13: フォーム回答も「回答フォーム」タブを開いたときにだけ取る。
  useEffect(() => {
    if (tab === 'forms' && submissionsStatus === 'idle') {
      void loadSubmissions()
    }
  }, [tab, submissionsStatus, loadSubmissions])

  /*
    編集を開くたびに今の担当・対応状況を取り直す。GET /api/chats/:id は
    友だちIDでも引けて、行が無い友だちでは 'resolved'・revision 0 の
    合成値を返す（新規作成はしない）。選択肢の担当者もここで取る。
  */
  const openSupportEditor = async () => {
    if (supportBusy) return
    setSupportEditing(true)
    setSupportError('')
    setSupportNotice('')
    setSupportBusy(true)
    try {
      const [chatRes, operatorRes] = await Promise.all([
        api.chats.get(friendId),
        // 友だち一覧の絞り込みと同じ名簿を共有する。保存の可否はサーバ側。
        loadOperators(),
      ])
      if (chatRes.success) {
        setSupportStatus(chatRes.data.status)
        setSupportOperatorId(chatRes.data.operatorId ?? '')
        setSupportRevision(chatRes.data.revision)
      }
      if (operatorRes.success) setSupportOperators(operatorRes.data)
      else setSupportError('担当者の選択肢を読み込めませんでした')
    } catch {
      setSupportError('対応の状況を読み込めませんでした')
    } finally {
      setSupportBusy(false)
    }
  }

  const saveSupport = async () => {
    if (supportBusy) return
    setSupportBusy(true)
    setSupportError('')
    setSupportNotice('')
    try {
      // 友だちIDで送る（サーバー側で行を引く・無ければ作る）。
      // 読んだ改訂値を付けて、ほかの人の変更を黙って上書きしない。
      const res = await api.chats.update(friendId, {
        status: supportStatus,
        operatorId: supportOperatorId || null,
        revision: supportRevision,
      })
      if (!res.success) {
        setSupportError(res.error)
        return
      }
      setSupportEditing(false)
      setSupportNotice('担当・対応状況を更新しました')
      void loadFriend()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setSupportError('ほかの担当者が先に更新しました。最新の内容を読み直しました')
        setSupportEditing(false)
        void loadFriend()
      } else {
        setSupportError(err instanceof ApiError ? err.message : '保存に失敗しました。通信を確かめて、もう一度お試しください。')
      }
    } finally {
      setSupportBusy(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setError('')
    setNotice('')
    setWarnings([])
    try {
      // 変わったものだけ送る。全部送ると、見ただけの項目にも
      // 更新の記録（updated_by / updated_at）が付いてしまう。
      const changed: Record<string, string | null> = {}
      for (const f of fields) {
        const before = f.value ?? ''
        const after = values[f.id] ?? ''
        if (before !== after) changed[f.id] = after === '' ? null : after
      }
      if (Object.keys(changed).length === 0) {
        setNotice('変更はありません')
        return
      }
      /*
        FRIEND-25: 送信した版を記録しておく。応答待ちの間に別の欄へ
        追記しても、保存後の再取得で「送った版から変わっていない欄」
        だけが新しい値に置き換わり、追記は消えない。失敗時は記録を
        残さないので、画面の下書きがそのまま保持される。
      */
      saveSnapshotRef.current = { ...values }
      const res = await api.friendFields.saveForFriend(friendId, changed)
      if (!res.success) {
        saveSnapshotRef.current = null
        setError(res.error)
        return
      }
      if (res.warnings?.length) setWarnings(res.warnings)
      setNotice(`${res.data.updated} 件を保存しました`)
      // 値の正本は情報欄の取得口。保存後はそこだけ取り直す。
      void loadFields()
    } catch {
      setError('保存に失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  /*
   * NEXT-09: 「シナリオを操作」は汎用一覧へ飛ばすのではなく、この友だちを
   * 対象にした選択画面をここで開く。選べるのは表示中アカウントの
   * シナリオだけで、選ぶ→確認→登録までこの画面で完結する。
   * 登録口はサーバ側がオーナー・管理者専用なので、呼び出し口も同じ権限でだけ出す。
   */
  const openScenarioPicker = useCallback(async () => {
    setScenarioPickerOpen(true)
    setScenarioError('')
    setScenarioNotice('')
    setScenarioPick('')
    const req = ++scenarioReqRef.current
    const generation = loadRequestRef.current
    const requestedAccountId = selectedAccountId
    setScenarioListStatus('loading')
    try {
      const res = await api.scenarios.list({ accountId: requestedAccountId || undefined })
      if (req !== scenarioReqRef.current || isStaleResponse(generation, requestedAccountId)) return
      if (res.success) {
        setScenarioOptions(res.data)
        setScenarioListStatus('ready')
      } else {
        setScenarioListStatus('error')
      }
    } catch {
      if (req !== scenarioReqRef.current || isStaleResponse(generation, requestedAccountId)) return
      setScenarioListStatus('error')
    }
  }, [selectedAccountId, isStaleResponse])

  const enrollScenario = async () => {
    if (scenarioBusy || !scenarioPick) return
    const scenario = scenarioOptions.find((s) => s.id === scenarioPick)
    if (!scenario) return
    setScenarioBusy(true)
    setScenarioError('')
    setScenarioNotice('')
    try {
      const res = await api.scenarios.enroll(scenario.id, friendId)
      if (res.success) {
        setScenarioPickerOpen(false)
        setScenarioNotice(`「${scenario.name}」に登録しました`)
        // 登録は履歴に現れうるので、取り済みなら取り直す。
        if (historyStatus === 'ready') void loadHistory()
      } else {
        setScenarioError(res.error)
      }
    } catch (err) {
      setScenarioError(err instanceof ApiError ? err.message : '登録に失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setScenarioBusy(false)
    }
  }

  /*
   * NEXT-08: 「個別操作」はこの友だちへ今できる操作、「…」は関連する画面への
   * 移動。どちらも選んだ先で操作・取消・完了まで辿れるものだけを並べる。
   */
  const primaryActions: ActionMenuItem[] = [
    {
      id: 'inbox',
      label: '受信箱で開く',
      onSelect: () => router.push(inboxHrefForFriend(friendId)),
    },
    ...(canEditSupport
      ? [{
          id: 'support',
          label: '対応状況を編集',
          onSelect: () => void openSupportEditor(),
        }]
      : []),
    ...(fieldsEnabled
      ? [{
          id: 'fields',
          label: '情報欄を編集',
          onSelect: () =>
            router.push(`/friends/detail?id=${encodeURIComponent(friendId)}&tab=info`),
        }]
      : []),
    // POST /api/scenarios/:id/enroll/:friendId はオーナー・管理者専用。
    ...(canManageFieldDefs
      ? [{
          id: 'scenario-enroll',
          label: 'シナリオに登録',
          onSelect: () => void openScenarioPicker(),
        }]
      : []),
    {
      id: 'send-template',
      label: 'テンプレートを送る（受信箱で選択）',
      onSelect: () => router.push(inboxHrefForFriend(friendId)),
    },
  ]
  const secondaryActions: ActionMenuItem[] = [
    { id: 'templates', label: 'テンプレート一覧を見る', onSelect: () => router.push('/templates') },
    { id: 'scenarios', label: 'シナリオ一覧を見る', onSelect: () => router.push('/scenarios') },
    { id: 'reminders', label: 'リマインダ一覧を見る', onSelect: () => router.push('/reminders') },
    { id: 'mileage', label: 'マイルを確認', onSelect: () => router.push('/mileage') },
    { id: 'duplicates', label: '重複候補を確認', onSelect: () => router.push('/duplicates') },
    {
      id: 'back-to-list',
      label: '友だち一覧へ戻る',
      dividerBefore: true,
      onSelect: () => router.push('/friends'),
    },
  ]

  /*
   * FRIEND-27: 準備中タブに置く代替操作。説明文だけで行き止まりにせず、
   * この友だちを引き継ぐ操作（シナリオ登録・マイル明細）か、
   * 関連する一覧への移動を添える。
   */
  const pendingTabActions: Partial<Record<TabKey, ReactNode>> = {
    scenario: (
      <>
        {canManageFieldDefs ? (
          <Button type="button" variant="primary" onClick={() => void openScenarioPicker()}>
            この友だちをシナリオに登録
          </Button>
        ) : null}
        <Button href="/scenarios">シナリオ一覧を見る</Button>
      </>
    ),
    orders: <Button href="/booking/bookings">予約一覧を見る</Button>,
    reminders: <Button href="/reminders">リマインダ一覧を見る</Button>,
    actions: (
      <Button href={`/friends/detail?id=${encodeURIComponent(friendId)}&tab=history`}>
        履歴タブを見る
      </Button>
    ),
    miles: (
      <Button href={`/mileage/friends/detail?id=${encodeURIComponent(friendId)}`}>
        この人のマイルを見る
      </Button>
    ),
    richmenu: <Button href="/rich-menus">リッチメニュー一覧を見る</Button>,
  }

  if (!friendId) {
    return (
      <TargetMissing
        kind="unspecified"
        title="見る友だちが指定されていません"
        description="友だちの一覧から、見たい人を選び直してください。"
        backHref="/friends"
        backLabel="友だち一覧へ戻る"
      />
    )
  }

  /*
   * 上のタブで選んだグループの項目だけを編集の対象にする。「基本」は
   * 分類のない項目、「すべて」は分類をまたいだ全項目（FRIEND-21）。
   * ★つきは基本のときだけ先頭へ寄せる。グループを開いているときは、
   * その分類の中の並び順のほうが読みやすい。
   */
  const inGroup =
    group === ALL_GROUP
      ? fields
      : group === BASIC_GROUP
        ? fields.filter((f) => !f.folderId)
        : fields.filter((f) => f.folderId === group)
  const starred = fields.filter((f) => f.isStarred)
  const groupStarred = group === BASIC_GROUP ? inGroup.filter((f) => f.isStarred) : []
  const rest = group === BASIC_GROUP ? inGroup.filter((f) => !f.isStarred) : inGroup

  /*
    FRIEND-21: 分類チップに出す名前と件数。件数はこの友だちへ
    見せられる項目で数える（個人情報の非表示分は母数に入れない）。
    定義済みだが項目が無い分類も並べ、「分類はあるが空」と
    「情報欄自体が未作成」を分けて案内できるようにする。
    フォルダ一覧の取得に失敗・未完了のときは、項目が実際に
    持っている folderId だけを「分類」として出す。
  */
  const folderNameById = new Map(fieldFolders.map((f) => [f.id, f.name]))
  const folderCountById = new Map<string, number>()
  let unfiledFieldCount = 0
  for (const f of fields) {
    if (!f.folderId) {
      unfiledFieldCount += 1
    } else {
      folderCountById.set(f.folderId, (folderCountById.get(f.folderId) ?? 0) + 1)
    }
  }
  const fieldFolderIds = new Set(fieldFolders.map((f) => f.id))
  // 定義一覧に無いが項目が属している分類（一覧取得失敗・削除途中など）。
  const orphanFolderIds = [...folderCountById.keys()].filter((id) => !fieldFolderIds.has(id))
  const groupChips: Array<{ id: string; label: string; count: number }> = [
    { id: ALL_GROUP, label: 'すべて', count: fields.length },
    { id: BASIC_GROUP, label: '基本', count: unfiledFieldCount },
    ...fieldFolders.map((f) => ({ id: f.id, label: f.name, count: folderCountById.get(f.id) ?? 0 })),
    ...orphanFolderIds.map((id) => ({ id, label: '分類', count: folderCountById.get(id) ?? 0 })),
  ]
  /*
    URL直指定・分類削除後も「選択中」と「出ている内容」が一致するようにする。
    フォルダ一覧が取れたあとで、どの分類にも当たらない group は
    「削除された分類」として案内し、基本へ戻す導線を出す。
  */
  const groupIsKnown =
    group === BASIC_GROUP
    || group === ALL_GROUP
    || fieldFolderIds.has(group)
    || folderCountById.has(group)
    || fieldFoldersStatus !== 'ready'
  /** 設計の「本名」。友だち情報欄に同じ名前の項目があればそれを使う。 */
  const realName = fields.find((f) => f.name === '本名')?.value ?? ''

  if (!loading && (friendMissing || (!error && !friend))) {
    return (
      <TargetMissing
        kind="not-found"
        title="この友だちは見つかりません"
        description="削除されたか、別の LINE アカウントの人です。一覧から選び直してください。"
        accountName={selectedAccount?.name}
        backHref="/friends"
        backLabel="友だち一覧へ戻る"
      />
    )
  }

  // 保存の失敗は error のまま帯で出す（下の `{error && friend && ...}`）。
  // ここは本体が無いときだけ。友だちがあるのに error があるのは保存の失敗。
  if (!loading && !friend) {
    return (
      <TargetMissing
        kind="error"
        title="友だちを読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => void loadFriend()}
      />
    )
  }

  return (
    <div data-friends-detail-design="v4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <nav className="text-ink-faint text-xs" data-design="Crumb">
          <Link href="/friends" className="hover:underline">
            友だち
          </Link>
          <span className="mx-1.5">/</span>
          <span>{friend?.displayName ?? '詳細'}</span>
        </nav>
        <div className="flex flex-wrap gap-2">
          <Link
            href={inboxHrefForFriend(friendId)}
            className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium transition-colors"
          >
            受信箱で開く
          </Link>
          {/*
            NEXT-08: 押しても何も起きないボタンを共通メニューへ接続する。
            「個別操作」はこの友だちへの操作、「…」は関連する画面への移動。
          */}
          <span className="relative inline-block">
            <Button
              type="button"
              aria-haspopup="menu"
              aria-expanded={actionMenuOpen}
              onClick={() => {
                setActionMenuOpen((v) => !v)
                setMoreMenuOpen(false)
              }}
            >
              個別操作
            </Button>
            <ActionMenu
              open={actionMenuOpen}
              items={primaryActions}
              ariaLabel="この友だちへの個別操作"
              onClose={() => setActionMenuOpen(false)}
            />
          </span>
          <span className="relative inline-block">
            <Button
              type="button"
              aria-label="その他の操作"
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen}
              onClick={() => {
                setMoreMenuOpen((v) => !v)
                setActionMenuOpen(false)
              }}
            >
              …
            </Button>
            <ActionMenu
              open={moreMenuOpen}
              items={secondaryActions}
              ariaLabel="関連する画面を開く"
              onClose={() => setMoreMenuOpen(false)}
            />
          </span>
        </div>
      </div>

      {/* 本体が取れている途中の失敗（保存など）は帯で出す。本体の失敗は下のカードが出す。 */}
      {error && friend && (
        <Notice tone="danger" message={error} onClose={() => setError('')} className="mb-4" />
      )}

      {/*
        NEXT-11: 読み込み中・取得失敗は「本体」だけを見る。マイルなどの
        補助パネルの遅延・失敗ではここに入らない。
      */}
      {loading || !friend ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[23.5rem_1fr]">
          {/* 左：プロフィール（設計の並び：マイル → 対応 → 名前 → タグ →
              ★つき友だち情報 → リッチメニュー → 友だち情報 → フォーム回答） */}
          {/*
            FRIEND-31: PC由来の minHeight:1234 をスマートフォンへ持ち込まない。
            lg未満では名前・対応・主操作だけを出し、補助プロフィールは
            「顧客情報をすべて表示」で展開する（直下にタブが来る）。
            固定高は任意値クラスを増やさないよう scoped style で掛ける。
          */}
          <style>{`
            @media (min-width: 1024px) {
              [data-friend-profile-panel] { min-height: 1234px; }
            }
          `}</style>
          <aside data-design="Left" data-friend-profile-panel className="bg-canvas rounded-card border-hairline overflow-hidden border">
            <div className="border-hairline border-b px-5 py-3.5">
              <div className="flex items-center justify-between"><h2 className="text-ink text-sm font-semibold">顧客情報</h2><Link href="/friends" aria-label="友だち一覧へ戻る" title="友だち一覧へ戻る" className="text-ink-faint text-lg">×</Link></div>
            </div>

            <div className="border-hairline flex flex-col items-center border-b px-5 py-5 text-center">
              {/* ★V7 友だちの顔：名前が無い時は「?」ではなく人の印。 */}
              <Avatar name={friend?.displayName} src={friend?.pictureUrl} size={56} />
              <h2 className="text-ink mt-3 text-sm font-bold">{friend?.displayName ?? '名前未登録'}</h2>
              <p className="text-ink-faint mt-1 text-xs">LINE表示名</p>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5"><SupportMarkBadge status={friend?.support?.status} /><span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-micro">{friend?.support?.operatorName ?? '未割り当て'}</span><span className="bg-accent-soft text-accent-deep rounded-pill px-2 py-0.5 text-micro">表示中</span></div>
              {/* 同じ画面の「情報欄」タブへ移る。今いる画面と同じ名前・チェスの駒の記号は紛らわしかった（★V7）。 */}
              <Button href={`/friends/detail?id=${friendId}&tab=info`} className="mt-3">情報欄を見る</Button>
            </div>

            {/* FRIEND-31: lg未満ではここから下（マイル以降の補助プロフィール）を畳む。 */}
            <button
              type="button"
              onClick={() => setProfileExpanded((v) => !v)}
              aria-expanded={profileExpanded}
              className="text-action w-full px-5 py-2.5 text-center text-xs font-semibold hover:bg-canvas-sunken lg:hidden"
            >
              {profileExpanded ? '顧客情報を閉じる' : '顧客情報をすべて表示'}
            </button>
            <div className={profileExpanded ? '' : 'max-lg:hidden'}>

            {/*
              マイル。設計どおり、見出しの下に利用可能残高を1行で置く。
              読み込みは独立しているため、遅くても他の表示を止めない。
              取り損ねは「取得できませんでした」＋再試行で「—」と区別する。
            */}
            <div className="border-hairline border-b bg-canvas px-5 py-4">
              <div className="flex items-center justify-between"><p className="text-ink text-xs font-bold">マイル</p><Link href="/mileage" className="text-action text-xs">詳細を見る →</Link></div>
              <div className="bg-canvas-sunken mt-2 flex items-center justify-between rounded-control px-3 py-3">
                <span className="text-ink-faint text-xs">
                  利用可能
                  {mileage && mileage.pending > 0
                    ? ` ・ 確定待ち ${mileage.pending.toLocaleString('ja-JP')}`
                    : ''}
                </span>
                <strong className="text-ink text-base font-bold tabular-nums">
                  {mileageStatus === 'loading'
                    ? '…'
                    : mileage
                      ? mileage.available.toLocaleString('ja-JP')
                      : '—'}
                  <span className="ml-1 text-xs font-semibold">mile</span>
                </strong>
              </div>
              {mileageStatus === 'error' ? (
                <p className="text-ink-faint mt-2 flex items-center justify-between gap-2 text-xs">
                  マイルを取得できませんでした
                  <button
                    type="button"
                    onClick={() => void loadMileage()}
                    className="text-action shrink-0 hover:underline"
                  >
                    再試行
                  </button>
                </p>
              ) : null}
            </div>

            <div className="space-y-4 p-5">
              {/* ---- 対応 ---- */}
              <div>
                {/*
                  N-035: 担当・対応状況はこの画面からも変えられる。
                  受信箱の PUT /api/chats/:id と同じ権限（'/chats' 編集キー）で
                  だけ編集口を出し、鍵の無い人には受信箱への案内だけを残す。
                */}
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <p className="text-ink-faint text-xs font-semibold">対応</p>
                  {canEditSupport ? (
                    <button
                      type="button"
                      onClick={() => (supportEditing ? setSupportEditing(false) : void openSupportEditor())}
                      aria-expanded={supportEditing}
                      className="text-action shrink-0 text-xs hover:underline"
                    >
                      {supportEditing ? 'やめる' : '編集'}
                    </button>
                  ) : (
                    <Link href={inboxHrefForFriend(friendId)} className="text-action shrink-0 text-xs hover:underline">
                      編集
                    </Link>
                  )}
                </div>
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-faint">対応状況</dt>
                    <dd>
                      <SupportMarkBadge status={friend?.support?.status} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-faint">担当者</dt>
                    <dd className="text-ink-secondary truncate">
                      {friend?.support?.operatorName ?? '未割り当て'}
                    </dd>
                  </div>
                </dl>
                {supportEditing ? (
                  <div className="border-hairline bg-canvas-sunken rounded-control mt-2 space-y-2 border p-3" data-support-editor>
                    <label className="text-ink-faint block text-xs">
                      対応状況
                      <SelectField
                        value={supportStatus}
                        disabled={supportBusy}
                        onChange={(e) => setSupportStatus(e.target.value as Chat['status'])}
                        aria-label="対応状況を変える"
                        className="border-hairline rounded-control bg-canvas text-ink mt-1 w-full border px-2 py-1.5 text-xs"
                        options={[
                          { value: 'unread', label: '未対応' },
                          { value: 'in_progress', label: '対応中' },
                          { value: 'on_hold', label: '保留' },
                          { value: 'resolved', label: '対応済み' },
                        ]}
                      />
                    </label>
                    <label className="text-ink-faint block text-xs">
                      担当者
                      <SelectField
                        value={supportOperatorId}
                        disabled={supportBusy}
                        onChange={(e) => setSupportOperatorId(e.target.value)}
                        aria-label="担当者を変える"
                        className="border-hairline rounded-control bg-canvas text-ink mt-1 w-full border px-2 py-1.5 text-xs"
                        options={[
                          { value: '', label: '未割り当て' },
                          ...supportOperators.map((operator) => ({ value: operator.id, label: operator.name })),
                        ]}
                      />
                    </label>
                    {supportError ? <p className="text-danger text-xs" role="alert">{supportError}</p> : null}
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => void saveSupport()}
                        disabled={supportBusy}
                      >
                        {supportBusy ? '処理中…' : '保存する'}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => setSupportEditing(false)}
                        disabled={supportBusy}
                      >
                        キャンセル
                      </Button>
                    </div>
                  </div>
                ) : null}
                {supportNotice && !supportEditing ? (
                  <p className="text-success mt-2 text-xs">{supportNotice}</p>
                ) : null}
                {supportError && !supportEditing ? (
                  <p className="text-danger mt-2 text-xs" role="alert">{supportError}</p>
                ) : null}
                <p className="text-ink-faint mt-2 mb-1 text-xs">個別メモ</p>
                {/* 個別メモの書き換えは受信箱側が持っている。ここは読むだけ。 */}
                <p className="border-hairline bg-canvas-sunken text-ink-secondary rounded-control min-h-[3.5rem] border px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap">
                  {friend?.support?.notes || 'メモはありません'}
                </p>
              </div>

              {/* ---- 名前 ---- */}
              <div>
                <SectionHead label="名前" actionLabel="編集" href={inboxHrefForFriend(friendId)} />
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-faint">本名</dt>
                    <dd className="text-ink-secondary truncate">{realName || '未登録'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-faint">システム表示名</dt>
                    <dd className="text-ink-secondary truncate">{friend?.displayName ?? '未登録'}</dd>
                  </div>
                </dl>
              </div>

              {/* ---- タグ ---- */}
              {/* 設計では名前の下。以前はいちばん上にあり、名前より先に
                  タグが目に入っていた。 */}
              <div>
                <SectionHead label="タグ" actionLabel="編集" href={inboxHrefForFriend(friendId)} />
                <div className="flex flex-wrap items-center gap-1">
                  {friend?.tags?.length ? (
                    friend.tags.map((t) => <TagBadge key={t.id} tag={t} />)
                  ) : (
                    <span className="text-ink-faint text-xs">タグはありません</span>
                  )}
                  <Link
                    href={inboxHrefForFriend(friendId)}
                    className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-pill border px-2 py-0.5 text-[11px]"
                  >
                    ＋ 追加
                  </Link>
                </div>
              </div>

              {/* ---- ★つき友だち情報 ---- */}
              {starred.length > 0 && (
                <div>
                  <SectionHead
                    label="★つき友だち情報"
                    actionLabel="すべて見る"
                    href={`/friends/detail?id=${friendId}&tab=info`}
                  />
                  <dl className="space-y-1 text-xs">
                    {starred.map((f) => (
                      <div key={f.id} className="flex justify-between gap-2">
                        <dt className="text-ink-faint shrink-0">{f.name}</dt>
                        <dd className="text-ink-secondary truncate text-right">
                          {values[f.id] || '未入力'}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              {/*
                情報欄の取り損ねは「項目なし」と区別する。
                成功で0件ならそもそも節を出さない従来どおりの見た目。
              */}
              {fieldsStatus === 'error' && (
                <div>
                  <p className="text-ink-faint mb-1.5 text-xs font-semibold">友だち情報欄</p>
                  <p className="text-ink-faint text-xs">
                    情報欄を取得できませんでした
                    <button
                      type="button"
                      onClick={() => void loadFields()}
                      className="text-action ml-1 hover:underline"
                    >
                      再試行
                    </button>
                  </p>
                </div>
              )}

              {/* ---- リッチメニュー ---- */}
              <div>
                <SectionHead label="リッチメニュー" actionLabel="変更" href="/rich-menus" />
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-faint">現在の設定</dt>
                    <dd className="text-ink-secondary truncate text-right">
                      {richMenuStatus === 'loading'
                        ? '読み込み中…'
                        : richMenuStatus === 'error'
                          ? '取得できませんでした'
                          : (richMenu?.name ?? '既定のメニュー')}
                      {richMenuStatus === 'ready' && richMenu?.isDefault && (
                        <span className="text-ink-faint ml-1">（全員に出しているもの）</span>
                      )}
                    </dd>
                  </div>
                </dl>
                {richMenuStatus === 'error' ? (
                  <p className="text-ink-faint mt-1 text-right text-xs">
                    <button
                      type="button"
                      onClick={() => void loadRichMenu()}
                      className="text-action hover:underline"
                    >
                      再試行
                    </button>
                  </p>
                ) : null}
              </div>

              {/* ---- 友だち情報 ---- */}
              <div>
                <p className="text-ink-faint mb-1.5 text-xs font-semibold">友だち情報</p>
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-faint">追加日</dt>
                    <dd className="text-ink-secondary">
                      {friend?.createdAt
                        ? new Date(friend.createdAt).toLocaleDateString('ja-JP')
                        : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-faint">流入元</dt>
                    <dd className="text-ink-secondary truncate">
                      {friend?.firstTrackedLinkName ?? '不明'}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* ---- フォーム回答 ---- */}
              <div>
                <SectionHead
                  label="フォーム回答"
                  actionLabel="すべて見る"
                  href={`/friends/detail?id=${friendId}&tab=forms`}
                />
                <p className="text-ink-secondary text-xs">
                  {typeof friend?.formSubmissionTotal === 'number'
                    ? friend.formSubmissionTotal > 0
                      ? `${friend.formSubmissionTotal}件`
                      : '回答はまだありません'
                    : friend?.formSubmissions?.length
                      ? `${friend.formSubmissions.length}件`
                      : '回答はまだありません'}
                </p>
              </div>
            </div>
            </div>
          </aside>

          {/* 右：タブ */}
          {/*
            ★V7差し戻し: 折らないタブ帯がグリッドの右列を押し広げ、右端が
            画面からはみ出していた。grid の子に min-w-0 を付け、幅の決定を
            グリッドに任せてタブ帯だけ中で横に流す。
          */}
          <div data-design="Right" className="min-w-0">
            {/*
              ★V7: 10個のタブが 1440px で2段に折れていた。折らずに1段にし、
              入り切らない分は横に送る。リンクで移動するタブなので
              aria-current="page" で現在地を示す（role="tab" は付けない）。
            */}
            <div className="relative">
              <div ref={tabsRowRef} className="border-hairline mb-4 flex gap-1 overflow-x-auto border-b">
                {visibleTabs.map((t) => (
                  <Link
                    key={t.key}
                    href={`/friends/detail?id=${friendId}&tab=${t.key}${
                      group === BASIC_GROUP ? '' : `&group=${group}`
                    }`}
                    aria-current={tab === t.key ? 'page' : undefined}
                    className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                      tab === t.key
                        ? 'border-accent text-accent-deep'
                        : 'text-ink-secondary hover:text-ink border-transparent'
                    }`}
                  >
                    {t.label}
                  </Link>
                ))}
              </div>
              {/* #773: はみ出し中だけ右端にフェードを出し、続きがあることを示す。 */}
              {tabsOverflowing ? (
                <div
                  aria-hidden="true"
                  className="from-canvas-sunken pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l to-transparent"
                />
              ) : null}
            </div>

            {tab === 'timeline' && (
              <div className="space-y-4">
                <div className="grid gap-4 xl:grid-cols-2">
                  <section className="bg-canvas rounded-card border-hairline border p-4 shadow-card">
                    <h2 className="text-ink text-sm font-bold">進行中の配信・自動処理</h2>
                    <dl className="text-ink-secondary mt-3 space-y-2 text-xs"><div className="flex gap-5"><dt className="font-semibold">シナリオ</dt><dd>取得元を接続後に表示</dd></div><div className="flex gap-5"><dt className="font-semibold">リマインド</dt><dd>取得元を接続後に表示</dd></div><div className="flex gap-5"><dt className="font-semibold">対象ルール</dt><dd>—</dd></div></dl>
                    {/* ★V7：押せないまま置かれていた「配信状態を確認」は外した。 */}
                  </section>
                  <section className="bg-canvas rounded-card border-hairline border p-4 shadow-card">
                    <h2 className="text-ink text-sm font-bold">同じ人としてつながる情報</h2>
                    {/*
                      NEXT-10: 固定の「現在は1アカウントのみ」ではなく、
                      名寄せの実績（マイル口の応答に含まれる統合情報）から出す。
                      取り損ねは「未取得」と正直に表示する。
                    */}
                    {mileageStatus === 'loading' ? (
                      <p className="text-ink-faint mt-3 text-xs">つながり情報を読み込んでいます…</p>
                    ) : mileageStatus === 'error' ? (
                      <p className="text-ink-faint mt-3 text-xs">
                        つながり情報を取得できませんでした
                        <button
                          type="button"
                          onClick={() => void loadMileage()}
                          className="text-action ml-1 hover:underline"
                        >
                          再試行
                        </button>
                      </p>
                    ) : mileageInsights && mileageInsights.accountCount > 1 ? (
                      <>
                        <p className="text-ink-secondary mt-3 text-xs">
                          {mileageInsights.accountCount}件のLINEアカウントで同じ人としてつながっています
                        </p>
                        {mileageConnections.length > 0 ? (
                          <ul className="text-ink-secondary mt-2 space-y-1 text-xs">
                            {mileageConnections.map((c) => (
                              <li key={`${c.accountId}-${c.friendId}`} className="truncate">
                                {c.accountName}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-ink-secondary mt-3 text-xs">
                        このアカウントのみに登録があります（名寄せ済みの他アカウントはありません）
                      </p>
                    )}
                    <p className="text-ink-faint mt-3 text-xs">重複候補が見つかると、根拠と確信度を表示します。</p>
                    <Button href="/duplicates" className="mt-3">重複候補を確認</Button>
                  </section>
                </div>
                {/*
                  NEXT-10: 「最近の履歴」は実際の活動履歴（対応・配信・予約・
                  フォーム回答・名寄せ）を時系列で取ったものを出す。
                  0件・取得失敗・読み込み中はそれぞれ区別して表示する。
                */}
                {/* #773: 行の表組みは「カードの幅」で切り替える（画面幅ではない）。 */}
                <section className="@container bg-canvas rounded-card border-hairline overflow-hidden border shadow-card">
                  <div className="flex items-center justify-between px-4 py-3"><h2 className="text-ink text-sm font-bold">最近の履歴</h2><Link href={`/friends/detail?id=${friendId}&tab=history`} className="text-action text-xs font-semibold">すべてを見る →</Link></div>
                  {/*
                    #985 CHK-04: 140+160+140pxの固定列は狭い幅で
                    親の overflow-hidden に欠ける。md 未満では見出しを
                    畳み、各行は折り返すカードにする。
                  */}
                  <div className="bg-canvas-sunken border-hairline hidden border-y px-4 py-3 text-xs font-semibold text-ink-faint @lg:grid" style={{ gridTemplateColumns: TIMELINE_ROW_COLUMNS }}><span>日時</span><span>種別</span><span>内容</span><span>アカウント</span><span>元</span></div>
                  {historyStatus === 'loading' ? (
                    <p className="text-ink-faint px-4 py-5 text-xs">履歴を読み込んでいます…</p>
                  ) : historyStatus === 'error' ? (
                    <p className="text-ink-faint px-4 py-5 text-xs">
                      履歴を取得できませんでした
                      <button
                        type="button"
                        onClick={() => void loadHistory()}
                        className="text-action ml-1 hover:underline"
                      >
                        再試行
                      </button>
                    </p>
                  ) : (
                    <>
                      {historyItems.slice(0, 5).map((item) => (
                        <FriendTimelineRow key={`${item.source?.kind ?? item.type}:${item.id}`} item={item} friendId={friendId} />
                      ))}
                      {/*
                        友だち追加の記録は本体の作成日時から出す実データ。
                        活動履歴が0件のときは、この記録だけが履歴になる。
                      */}
                      <div className="text-ink-secondary border-hairline flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t px-4 py-3 text-xs @lg:grid" style={{ gridTemplateColumns: TIMELINE_ROW_COLUMNS }}><span>{friend.createdAt ? new Date(friend.createdAt).toLocaleDateString('ja-JP') : '—'}</span><span>友だち追加</span><span className="min-w-0 flex-1 basis-full @lg:basis-auto">{friend.firstTrackedLinkName ? `${friend.firstTrackedLinkName}から追加されました` : '友だちに追加されました'}</span><span>システム</span><span /></div>
                      {historyStatus === 'ready' && historyItems.length === 0 ? (
                        <p className="text-ink-faint px-4 pb-4 text-xs">
                          上の「友だち追加の記録」以外の活動履歴はまだありません。
                        </p>
                      ) : null}
                    </>
                  )}
                </section>
                {/*
                  NEXT-09: 対象者を引き継ぐ操作と、汎用一覧への移動を分ける。
                  「シナリオに登録」はこの友だちを対象に選んで実行できる。
                  一覧へ行くだけのものは名前を「一覧を見る」に変えて混同させない。
                */}
                <section className="bg-canvas rounded-card border-hairline border p-4 shadow-card">
                  <h2 className="text-ink text-sm font-bold">この友だちに行う操作</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {/* 「受信箱で開く」は画面右上にもあるので、ここでは重ねない（★V7）。 */}
                    {canManageFieldDefs ? (
                      <Button
                        type="button"
                        onClick={() =>
                          scenarioPickerOpen ? setScenarioPickerOpen(false) : void openScenarioPicker()
                        }
                        aria-expanded={scenarioPickerOpen}
                      >
                        シナリオに登録
                      </Button>
                    ) : null}
                    {/* ★V7：この友だちに関係の無い「〜一覧を見る」は外した（左のメニューから行ける）。 */}
                  </div>
                  <p className="text-ink-faint mt-2 text-xs">
                    この友だちへテンプレートを送るときは、受信箱でテンプレートを選んで送信します。
                  </p>
                  {scenarioPickerOpen ? (
                    <div
                      className="border-hairline bg-canvas-sunken rounded-control mt-3 space-y-2 border p-3"
                      data-scenario-picker
                    >
                      {scenarioListStatus === 'loading' ? (
                        <p className="text-ink-faint text-xs">シナリオを読み込んでいます…</p>
                      ) : scenarioListStatus === 'error' ? (
                        <p className="text-ink-faint text-xs">
                          シナリオの選択肢を取得できませんでした
                          <button
                            type="button"
                            onClick={() => void openScenarioPicker()}
                            className="text-action ml-1 hover:underline"
                          >
                            再試行
                          </button>
                        </p>
                      ) : scenarioOptions.filter((s) => s.isActive).length === 0 ? (
                        <p className="text-ink-faint text-xs">登録できるシナリオがありません。</p>
                      ) : (
                        <>
                          <SelectField
                            value={scenarioPick}
                            disabled={scenarioBusy}
                            onChange={(e) => setScenarioPick(e.target.value)}
                            aria-label="登録するシナリオを選ぶ"
                            className="border-hairline rounded-control bg-canvas text-ink w-full border px-2 py-1.5 text-xs"
                            options={[
                              { value: '', label: '— シナリオを選ぶ —' },
                              ...scenarioOptions
                                .filter((s) => s.isActive)
                                .map((s) => ({ value: s.id, label: s.name })),
                            ]}
                          />
                          {scenarioPick ? (
                            <p className="text-ink-secondary text-xs">
                              「{scenarioOptions.find((s) => s.id === scenarioPick)?.name}」に
                              {friend.displayName ?? 'この友だち'}を登録します。
                            </p>
                          ) : null}
                        </>
                      )}
                      {scenarioError ? (
                        <p className="text-danger text-xs" role="alert">{scenarioError}</p>
                      ) : null}
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="primary"
                          onClick={() => void enrollScenario()}
                          disabled={scenarioBusy || !scenarioPick || scenarioListStatus !== 'ready'}
                        >
                          {scenarioBusy ? '登録中…' : 'このシナリオに登録する'}
                        </Button>
                        <Button
                          type="button"
                          onClick={() => setScenarioPickerOpen(false)}
                          disabled={scenarioBusy}
                        >
                          やめる
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {scenarioNotice ? (
                    <p className="text-success mt-2 text-xs">{scenarioNotice}</p>
                  ) : null}
                </section>
              </div>
            )}

            {/*
              NEXT-10: 履歴タブは実際の活動履歴につなげる。
              0件・取得失敗・読み込み中を分け、続きは「さらに読み込む」。
            */}
            {tab === 'history' && (
              <div className="@container bg-canvas rounded-card border-hairline overflow-hidden border">
                {/* #985 CHK-04 / #773: 見出しの表組みはカード幅(@lg)で切り替える。 */}
                <div className="bg-canvas-sunken border-hairline hidden border-b px-4 py-3 text-xs font-semibold text-ink-faint @lg:grid" style={{ gridTemplateColumns: TIMELINE_ROW_COLUMNS }}>
                  <span>日時</span><span>種別</span><span>内容</span><span>アカウント</span><span>元</span>
                </div>
                {historyStatus === 'loading' ? (
                  <p className="text-ink-faint px-4 py-6 text-center text-sm">履歴を読み込んでいます…</p>
                ) : historyStatus === 'error' ? (
                  <div className="px-4 py-6 text-center text-sm">
                    <p className="text-ink-faint">履歴を取得できませんでした。</p>
                    <Button type="button" className="mt-3" onClick={() => void loadHistory()}>
                      もう一度読み込む
                    </Button>
                  </div>
                ) : (
                  <>
                    {historyItems.map((item) => (
                      <FriendTimelineRow key={`${item.source?.kind ?? item.type}:${item.id}`} item={item} friendId={friendId} />
                    ))}
                    {/* 最後まで取れたときだけ、いちばん古い記録として友だち追加を末尾に出す。 */}
                    {!historyNextCursor ? (
                      <div className="text-ink-secondary border-hairline flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t px-4 py-3 text-xs @lg:grid" style={{ gridTemplateColumns: TIMELINE_ROW_COLUMNS }}>
                        <span>{friend.createdAt ? new Date(friend.createdAt).toLocaleDateString('ja-JP') : '—'}</span>
                        <span>友だち追加</span>
                        <span className="min-w-0 flex-1 basis-full @lg:basis-auto">{friend.firstTrackedLinkName ? `${friend.firstTrackedLinkName}から追加されました` : '友だちに追加されました'}</span>
                        <span>システム</span>
                        <span />
                      </div>
                    ) : null}
                    {historyItems.length === 0 && !historyNextCursor ? (
                      <p className="text-ink-faint px-4 py-4 text-xs">
                        活動履歴はまだありません。上の「友だち追加の記録」がこの友だちの最初の記録です。
                      </p>
                    ) : null}
                    {historyNextCursor ? (
                      <div className="border-hairline border-t px-4 py-3 text-center">
                        {/*
                          FRIEND-26: 続きの取り損ねはここだけに出す。
                          取得済みの行とカーソルは残るので、同じ続きから
                          やり直せる（重複・欠落なし）。
                        */}
                        {historyMoreError ? (
                          <p className="text-danger mb-2 text-xs" role="alert">
                            続きを読み込めませんでした。同じところから試せます。
                          </p>
                        ) : null}
                        <Button
                          type="button"
                          onClick={() => void loadHistory(historyNextCursor)}
                          disabled={historyLoadingMore}
                        >
                          {historyLoadingMore ? '読み込み中…' : historyMoreError ? 'もう一度試す' : 'さらに読み込む'}
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            )}

            {/*
              出す先のデータを取る口が無いもの（FRIEND-27）。
              開発者向けの説明で行き止まりにせず、利用者向けの理由と
              代替操作（この友だちを引き継ぐか、関連一覧へ進む）を出す。
            */}
            {TABS.map((t) =>
              'pending' in t && t.pending && tab === t.key ? (
                <div
                  key={t.key}
                  className="bg-canvas rounded-card border-hairline border p-8 text-center"
                >
                  <p className="text-ink-secondary mx-auto max-w-md text-sm leading-6">
                    {t.pending}
                  </p>
                  {pendingTabActions[t.key] ? (
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {pendingTabActions[t.key]}
                    </div>
                  ) : null}
                </div>
              ) : null,
            )}

            {tab === 'info' && !fieldsEnabled && <FeatureDisabledScreen featureId="friend_fields" />}
            {tab === 'info' && fieldsEnabled && (
              <div className="bg-canvas rounded-card border-hairline border p-5">
                {/* 情報欄は独立して読み込む。取り損ねは0件と区別して再試行口を出す。 */}
                {fieldsStatus === 'loading' || fieldsStatus === 'idle' ? (
                  <p className="text-ink-faint py-6 text-center text-sm">情報欄を読み込んでいます…</p>
                ) : fieldsStatus === 'error' ? (
                  <div className="py-6 text-center text-sm">
                    <p className="text-ink-faint">情報欄を取得できませんでした。</p>
                    <Button type="button" className="mt-3" onClick={() => void loadFields()}>
                      もう一度読み込む
                    </Button>
                  </div>
                ) : (
                  <>
                    {/*
                      FRIEND-21: 分類の切替。これまでは URL の group を
                      直接書き換えないとフォルダ内の項目へ辿れなかった。
                      現在位置は aria-current、件数はこの友だちへ
                      見せられる項目で数える。
                    */}
                    <div className="mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="情報欄の分類">
                      {groupChips.map((chip) => {
                        const active = group === chip.id
                        const href = `/friends/detail?id=${encodeURIComponent(friendId)}&tab=info${
                          chip.id === BASIC_GROUP ? '' : `&group=${encodeURIComponent(chip.id)}`
                        }`
                        return (
                          <Link
                            key={chip.id}
                            href={href}
                            aria-current={active ? 'true' : undefined}
                            className={`rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors ${
                              active
                                ? 'border-accent bg-accent-soft text-accent-deep'
                                : 'border-hairline text-ink-secondary hover:bg-canvas-sunken'
                            }`}
                          >
                            {chip.label}
                            <span className="ml-1 text-ink-faint">{chip.count}</span>
                          </Link>
                        )
                      })}
                    </div>
                    {!groupIsKnown ? (
                  /*
                    FRIEND-21: 削除済み・URL直指定の分類は「項目なし」ではなく
                    「分類が見つからない」と正直に出し、基本へ戻す導線を置く。
                  */
                  <p className="text-ink-faint py-6 text-center text-sm">
                    この分類は削除されたか、見つかりません。
                    <Link
                      href={`/friends/detail?id=${encodeURIComponent(friendId)}&tab=info`}
                      className="text-action ml-1 hover:underline"
                    >
                      基本の項目を見る
                    </Link>
                  </p>
                ) : inGroup.length === 0 ? (
                  <div className="py-6 text-center text-sm">
                    {/*
                      FRIEND-23: 権限で全項目が隠れている応答
                      （items空・hiddenPersonalCount>0）を「項目なし」と
                      誤案内しない。真の0件・権限による非表示・空の分類を
                      分けて出す。
                    */}
                    {hiddenPersonalCount > 0 ? (
                      <p className="text-ink-faint bg-canvas-sunken rounded-control mx-auto max-w-md px-3 py-2 text-xs">
                        個人情報の項目が {hiddenPersonalCount} 件あります。
                        表示には個人情報の閲覧権限が要ります。
                      </p>
                    ) : null}
                    <p className="text-ink-faint mt-2">
                      {fields.length === 0 && hiddenPersonalCount === 0
                        ? '情報欄の項目がまだありません。'
                        : group === BASIC_GROUP || group === ALL_GROUP
                          ? '表示できる項目がありません。'
                          : 'この分類の項目はまだありません。'}
                      {/* 項目の新規登録もオーナー・管理者専用（POST /api/friend-fields）。 */}
                      {canManageFieldDefs && hiddenPersonalCount === 0 ? (
                        <Link
                          href={`/tags/fields/new?back=/friends/detail?id=${friendId}`}
                          className="text-action ml-1 hover:underline"
                        >
                          項目を追加
                        </Link>
                      ) : null}
                    </p>
                  </div>
                ) : (
                  <>
                    {[...groupStarred, ...rest].map((field) => {
                      // FRIEND-22: 項目名ラベルと入力欄を結び付ける一意ID。
                      const inputId = `ff-${field.id}`
                      return (
                      <div key={field.id} className="mb-4">
                        <label htmlFor={inputId} id={`${inputId}-label`} className="text-ink-secondary mb-1 block text-sm font-medium">
                          {field.isStarred && <span className="text-warning mr-1">★</span>}
                          {field.name}
                          <span className="text-ink-faint ml-1.5 text-xs font-normal">
                            {FIELD_TYPE_LABELS[field.type] ?? field.type}
                          </span>
                          {field.isPersonal && (
                            <span className="bg-warning-bg text-warning rounded-pill ml-1.5 px-1.5 py-0.5 text-[10px]">
                              個人情報
                            </span>
                          )}
                        </label>
                        <FieldInput
                          id={inputId}
                          labelId={`${inputId}-label`}
                          field={field}
                          value={values[field.id] ?? ''}
                          onChange={(v) => setValues((prev) => ({ ...prev, [field.id]: v }))}
                          disabled={!canEditField(field)}
                        />
                        {field.ecIsMaster && (
                          <p className="text-ink-faint mt-1 text-xs">
                            EC側の値が正のため、ここからは変更できません。
                          </p>
                        )}
                      </div>
                      )
                    })}

                    {hiddenPersonalCount > 0 && (
                      <p className="text-ink-faint bg-canvas-sunken rounded-control mb-4 px-3 py-2 text-xs">
                        個人情報の項目が {hiddenPersonalCount} 件あります。
                        表示には個人情報の閲覧権限が要ります。
                      </p>
                    )}

                    {warnings.length > 0 && (
                      <ul className="bg-warning-bg text-warning mb-3 space-y-1 rounded-lg p-3 text-xs">
                        {warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    )}
                    {notice && <p className="text-success mb-3 text-sm">{notice}</p>}

                    {/*
                      N-045: 保存はオーナー・管理者、または個人情報の編集権限を
                      持つ staff（個人情報の項目だけ）。押すと403になる口は
                      出さない。項目の新規登録は定義の変更なので
                      オーナー・管理者専用のまま。
                    */}
                    {canSaveFields ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={save}
                          disabled={saving}
                          className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
                        >
                          {saving ? '保存中...' : '保存'}
                        </button>
                        {canManageFieldDefs && (
                          <Link
                            href={`/tags/fields/new?back=/friends/detail?id=${friendId}`}
                            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium"
                          >
                            項目を追加
                          </Link>
                        )}
                      </div>
                    ) : (
                      <p className="text-ink-faint text-xs">
                        情報欄の値を保存できるのはオーナー・管理者、または個人情報の編集権限を持つスタッフです。
                      </p>
                    )}
                  </>
                )}
                  </>
                )}
              </div>
            )}

            {tab === 'forms' && (
              <div className="bg-canvas rounded-card border-hairline border p-5">
                {submissionsStatus === 'loading' || submissionsStatus === 'idle' ? (
                  <p className="text-ink-faint py-6 text-center text-sm">回答を読み込んでいます…</p>
                ) : submissionsStatus === 'error' ? (
                  <div className="py-6 text-center">
                    <p className="text-ink-faint text-sm">回答を読み込めませんでした。</p>
                    <Button type="button" variant="secondary" className="mt-3" onClick={() => void loadSubmissions()}>
                      もう一度読み込む
                    </Button>
                  </div>
                ) : submissions.length === 0 ? (
                  <p className="text-ink-faint py-6 text-center text-sm">
                    フォームの回答はまだありません。
                  </p>
                ) : (
                  <>
                  {typeof submissionsTotal === 'number' && submissionsTotal > submissions.length && (
                    <p className="mb-2">
                      <ListRange total={submissionsTotal} first={1} last={submissions.length} />
                    </p>
                  )}
                  <ul className="divide-hairline divide-y">
                    {submissions.map((s) => {
                      /*
                        FRIEND-24: data のキー（q_xxx の内部名）をそのまま
                        見出しにしない。回答時点の質問定義（fields）の label
                        を表示し、定義に無いキー（削除・改名済みの質問）は
                        原キーを併記して意味を残す。
                      */
                      const namedFields = (s.fields ?? []).filter(
                        (f) => f && typeof f.name === 'string' && typeof f.label === 'string',
                      )
                      const labelByName = new Map(namedFields.map((f) => [f.name, f.label]))
                      const orderedKeys = namedFields
                        .map((f) => f.name)
                        .filter((name) => name in (s.data ?? {}))
                      const orphanKeys = Object.keys(s.data ?? {}).filter(
                        (key) => !labelByName.has(key),
                      )
                      const renderValue = (v: unknown) =>
                        Array.isArray(v) ? v.join(', ') : String(v ?? '')
                      return (
                      <li key={s.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-ink text-sm font-medium">{s.formName}</p>
                          <p className="text-ink-faint text-xs">
                            {new Date(s.createdAt).toLocaleString('ja-JP')}
                          </p>
                        </div>
                        <dl className="mt-1.5 space-y-0.5">
                          {orderedKeys.map((k) => (
                            <div key={k} className="flex gap-2 text-xs">
                              <dt className="text-ink-faint shrink-0">{labelByName.get(k)}</dt>
                              <dd className="text-ink-secondary break-all">{renderValue(s.data[k])}</dd>
                            </div>
                          ))}
                          {orphanKeys.map((k) => (
                            <div key={k} className="flex gap-2 text-xs">
                              <dt className="text-ink-faint shrink-0" title={`項目キー: ${k}`}>
                                {k}
                                <span className="ml-1">（現在は使われていない項目）</span>
                              </dt>
                              <dd className="text-ink-secondary break-all">{renderValue(s.data[k])}</dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                      )
                    })}
                  </ul>
                  {submissionsNextCursor ? (
                    <div className="mt-3 border-t border-hairline pt-3 text-center">
                      {submissionsMoreError ? (
                        <p className="text-warning mb-2 text-xs">続きを読み込めませんでした。</p>
                      ) : null}
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={submissionsLoadingMore}
                        onClick={() => void loadSubmissions(submissionsNextCursor)}
                      >
                        {submissionsLoadingMore ? '読み込んでいます…' : 'さらに読み込む'}
                      </Button>
                    </div>
                  ) : null}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function FriendDetailPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <FriendDetailInner />
    </Suspense>
  )
}
