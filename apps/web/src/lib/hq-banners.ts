/**
 * 統括「バナー生成」の型と、画面が使う小さな計算。
 *
 * API の形は `apps/worker/src/routes/hq-banners.ts` が正本。
 * ここには通信を持たない（通信は `api.hqBanners`）。純粋な関数だけにして
 * テストしやすくしておく。
 */

export type BannerPresetGroup = 'line' | 'sns'

export interface BannerPreset {
  key: string
  group: BannerPresetGroup
  label: string
  note: string
  aspectRatio: string
  apiSize: string
  targetWidth: number
  targetHeight: number
}

export interface BannerUsageBucket {
  used: number
  limit: number
  remaining: number
}

export interface BannerUsage {
  month: BannerUsageBucket
  today: BannerUsageBucket
  paused: boolean
  pausedReason: string | null
}

export interface BannerPresetsResponse {
  presets: BannerPreset[]
  maxCount: number
  usage: BannerUsage
  engineReady: boolean
}

export interface BannerStats {
  projects: { active: number; archived: number }
  deliveredImages: number
  deliveredAccounts: number
}

export interface BannerProject {
  id: string
  name: string
  description: string | null
  isFavorite: boolean
  archivedAt: string | null
  imageCount: number
  runningCount: number
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type BannerGenerationStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'
export type BannerMode = 'banner' | 'free'
export type BannerPersonOption = 'with' | 'without'

export interface BannerGeneration {
  id: string
  projectId: string
  status: BannerGenerationStatus
  mode: BannerMode
  presetKey: string
  aspectRatio: string
  apiSize: string
  quality: string
  textLines: string[]
  mainColor: string | null
  subColor: string | null
  personOption: BannerPersonOption
  customPrompt: string | null
  freePrompt: string | null
  finalPrompt: string
  engine: string
  modelName: string
  requestedCount: number
  doneCount: number
  failedCount: number
  unitsPerImage: number
  errorMessage: string | null
  createdBy: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface BannerImageMedia {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  url: string
}

export type BannerImageSource = 'generated' | 'upload' | 'edited'

export interface BannerImage {
  id: string
  projectId: string
  generationId: string | null
  sequence: number
  source: BannerImageSource
  parentImageId: string | null
  isFavorite: boolean
  createdBy: string | null
  createdAt: string
  media: BannerImageMedia
  generation: BannerGeneration | null
  deliveredAccountIds: string[]
}

export interface BannerProjectDetail {
  project: BannerProject
  images: BannerImage[]
  generations: BannerGeneration[]
}

export interface BannerRunResult {
  generation: BannerGeneration
  image: BannerImage | null
  finished: boolean
}

export interface BannerDeliveryResult {
  image: BannerImage
  deliveries: Array<{ lineAccountId: string; mediaId: string; alreadyDelivered: boolean }>
}

/** 生成パネルの入力。API へそのまま送れる形。 */
export interface BannerGenerationInput {
  mode: BannerMode
  presetKey: string
  textLines: string[]
  mainColor: string | null
  subColor: string | null
  personOption: BannerPersonOption
  customPrompt: string
  freePrompt: string
  count: number
}

/** 生成パネルの初期値。用途は一覧の先頭を画面側で入れる。 */
export const EMPTY_GENERATION_INPUT: BannerGenerationInput = {
  mode: 'banner',
  presetKey: '',
  textLines: [''],
  mainColor: null,
  subColor: null,
  personOption: 'without',
  customPrompt: '',
  freePrompt: '',
  count: 1,
}

/** 見本の色。Pencil 35-2 `h5eMj` / `fRYho` のとおり。 */
export const MAIN_COLOR_SWATCHES = ['#D7263D', '#06C755', '#175CD3', '#F5C56B', '#1D1D1F'] as const
export const SUB_COLOR_SWATCHES = ['#FFFFFF', '#F5F5F7', '#FFE8B0', '#FFD6DB', '#1D1D1F'] as const

export const TEXT_LINE_MAX = 6
export const TEXT_LINE_LENGTH_MAX = 40
export const CUSTOM_PROMPT_MAX = 600
export const FREE_PROMPT_MAX = 1200

export function isHexColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value)
}

/**
 * 生成できるかを手元で確かめる。API と同じ規則で、押す前に理由を出すため。
 * 通れば null、だめならその理由。
 */
export function validateGenerationInput(
  input: BannerGenerationInput,
  maxCount: number,
): string | null {
  if (!input.presetKey) return '用途を選んでください'
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > maxCount) {
    return `枚数は 1〜${maxCount}枚で選んでください`
  }
  if (input.mode === 'banner') {
    const lines = input.textLines.map((line) => line.trim()).filter(Boolean)
    if (lines.length === 0) return '画像に入れるテキストを1行以上入力してください'
    if (lines.length > TEXT_LINE_MAX) return `テキストは${TEXT_LINE_MAX}行までです`
    if (lines.some((line) => line.length > TEXT_LINE_LENGTH_MAX)) {
      return `テキストは1行${TEXT_LINE_LENGTH_MAX}文字までです`
    }
    if (input.mainColor && !isHexColor(input.mainColor)) return 'メインカラーは #RRGGBB の形で入力してください'
    if (input.subColor && !isHexColor(input.subColor)) return 'サブカラーは #RRGGBB の形で入力してください'
    if (input.customPrompt.length > CUSTOM_PROMPT_MAX) return `追加の指示は${CUSTOM_PROMPT_MAX}文字までです`
  } else {
    if (!input.freePrompt.trim()) return '作りたい画像の説明を入力してください'
    if (input.freePrompt.length > FREE_PROMPT_MAX) return `説明は${FREE_PROMPT_MAX}文字までです`
  }
  return null
}

/**
 * 利用量から「いま n枚 作れるか」を判定する。API の 409 と同じ言い方で
 * 返す。押す前に断る用。通れば null。
 */
export function usageRefusal(usage: BannerUsage | null, needed: number): string | null {
  if (!usage) return null
  if (usage.paused) return usage.pausedReason ?? '失敗が続いたため一時停止しています'
  if (needed > usage.month.remaining) {
    return `今月の生成上限（${usage.month.limit}枚）に達します（残り ${usage.month.remaining}枚・必要 ${needed}枚）`
  }
  if (needed > usage.today.remaining) {
    return `今日の生成上限（1日 ${usage.today.limit}枚）に達します（残り ${usage.today.remaining}枚・必要 ${needed}枚）`
  }
  return null
}

/** 下部追従バーの左に出す文。「今月の残り 108枚・今日の残り 22枚。この生成で 2枚使います」 */
export function usageStatusText(usage: BannerUsage | null, needed: number): string {
  if (!usage) return '利用量を確認しています…'
  const base = `今月の残り ${usage.month.remaining}枚・今日の残り ${usage.today.remaining}枚`
  return needed > 0 ? `${base}。この生成で ${needed}枚使います` : base
}

/** 数値カード「今月の残り」の札。上限に対する残りの割合。 */
export function remainingPercent(usage: BannerUsage | null): number | null {
  if (!usage || usage.month.limit <= 0) return null
  return Math.round((usage.month.remaining / usage.month.limit) * 100)
}

/** 来月1日（日本時間）を「10/1」の形で。数値カードの説明に使う。 */
export function nextMonthResetLabel(now = new Date()): string {
  const month = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', month: 'numeric' }).format(now))
  const next = month === 12 ? 1 : month + 1
  return `${next}/1`
}

/** 生成画像の縦横比の札。1:1 / 3:2 / 9:16 … を用途から引く。 */
export function aspectBadge(image: Pick<BannerImage, 'generation' | 'media'>): string {
  if (image.generation?.aspectRatio) return image.generation.aspectRatio
  const { width, height } = image.media
  if (!width || !height) return '—'
  const divisor = gcd(width, height)
  return `${width / divisor}:${height / divisor}`
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/**
 * DB の日時を Date にする。
 *
 * この機能の表は `strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')` で
 * **日本時間の壁時計を、時差なしで**保存している。そのまま `new Date()` に
 * 渡すとブラウザの時間帯で読まれてずれるので、`+09:00` を足して読む。
 * すでに時差（Z / +09:00）が付いているものはそのまま。
 */
export function parseJstDateTime(value: string): Date {
  const normalized = value.replace(' ', 'T')
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
  return new Date(hasOffset ? normalized : `${normalized}+09:00`)
}

/** 「9/12 21:40」。運用画面の基準は日本時間。 */
export function shortDateTime(iso: string, now = new Date()): string {
  const date = parseJstDateTime(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = fmt.formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const sameYear =
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric' }).format(date) ===
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric' }).format(now)
  const dayPart = `${get('month')}/${get('day')}`
  const timePart = `${get('hour')}:${get('minute')}`
  return sameYear ? `${dayPart} ${timePart}` : `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric' }).format(date)}/${dayPart} ${timePart}`
}

/**
 * 「3分前」「昨日」「9/5」。プロジェクトカードの「更新」に使う。
 * `docs/v6-common-rules.md` §2-7: 分の生表示は日で丸める。
 */
export function relativeUpdated(iso: string, now = new Date()): string {
  const date = parseJstDateTime(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const diffMs = now.getTime() - date.getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}時間前`
  const days = Math.floor(hours / 24)
  if (days === 1) return '昨日'
  if (days < 7) return `${days}日前`
  const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('month')}/${get('day')}`
}

/** 「412KB」「1.2MB」 */
export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/** 「JPEG」「PNG」 */
export function formatLabel(mimeType: string): string {
  const sub = mimeType.split('/')[1] ?? mimeType
  return sub.toUpperCase().replace('JPG', 'JPEG')
}

/** 用途プルダウンの見出し。LINE と SNS を分けて並べる。 */
export function groupPresets(presets: BannerPreset[]): Array<{ group: BannerPresetGroup; label: string; items: BannerPreset[] }> {
  return [
    { group: 'line' as const, label: 'LINE', items: presets.filter((p) => p.group === 'line') },
    { group: 'sns' as const, label: 'ほかのSNS', items: presets.filter((p) => p.group === 'sns') },
  ].filter((g) => g.items.length > 0)
}

/** 「リッチメッセージ（1040×1040）」 */
export function presetOptionLabel(preset: BannerPreset): string {
  return `${preset.label}（${preset.targetWidth}×${preset.targetHeight}）`
}

/**
 * 画像ライブラリの用途の絞り込み。設計 35-3 `H0n2G` は「正方形／リッチメニュー／横長／縦長」。
 * 用途の並びが増えても、この4つに畳む。
 */
export type ShapeFilter = 'square' | 'rich_menu' | 'landscape' | 'portrait'

export const SHAPE_FILTERS: Array<{ key: ShapeFilter; label: string }> = [
  { key: 'square', label: '正方形' },
  { key: 'rich_menu', label: 'リッチメニュー' },
  { key: 'landscape', label: '横長' },
  { key: 'portrait', label: '縦長' },
]

export function presetKeysForShape(presets: BannerPreset[], shape: ShapeFilter): string[] {
  return presets
    .filter((p) => {
      if (shape === 'rich_menu') return p.key.startsWith('line_rich_menu')
      if (p.key.startsWith('line_rich_menu')) return false
      if (shape === 'square') return p.apiSize === '1024x1024'
      if (shape === 'landscape') return p.apiSize === '1536x1024'
      return p.apiSize === '1024x1536'
    })
    .map((p) => p.key)
}

/** 画像1枚の「生成時の条件」を、詳細モーダルの項目に並べる。 */
export function generationConditionRows(
  image: BannerImage,
  presets: BannerPreset[],
): Array<{ label: string; value: string }> {
  const g = image.generation
  if (!g) {
    return [
      { label: '取り込み', value: image.source === 'upload' ? '手持ちの画像を取り込んだもの' : '編集で作られたもの' },
      { label: '作成', value: shortDateTime(image.createdAt) },
    ]
  }
  const preset = presets.find((p) => p.key === g.presetKey)
  const rows: Array<{ label: string; value: string }> = [
    { label: '用途', value: preset ? presetOptionLabel(preset) : g.presetKey },
  ]
  if (g.mode === 'free') {
    rows.push({ label: '説明', value: g.freePrompt ?? '' })
  } else {
    rows.push({ label: 'テキスト', value: g.textLines.map((line, i) => `${i + 1}. ${line}`).join('\n') || '（文字なし）' })
    rows.push({
      label: '色',
      value: [g.mainColor ? `メイン ${g.mainColor}` : null, g.subColor ? `サブ ${g.subColor}` : null].filter(Boolean).join('・') || '指定なし',
    })
    rows.push({ label: '人物', value: g.personOption === 'with' ? '入れる' : '入れない' })
    rows.push({ label: '追加の指示', value: g.customPrompt || '（なし）' })
  }
  rows.push({ label: '作成', value: shortDateTime(image.createdAt) })
  return rows
}

/** 画像の「生成時の条件」を、生成パネルへ戻す（同じ設定でもう一度生成）。 */
export function inputFromGeneration(g: BannerGeneration): BannerGenerationInput {
  return {
    mode: g.mode,
    presetKey: g.presetKey,
    textLines: g.textLines.length > 0 ? [...g.textLines] : [''],
    mainColor: g.mainColor,
    subColor: g.subColor,
    personOption: g.personOption,
    customPrompt: g.customPrompt ?? '',
    freePrompt: g.freePrompt ?? '',
    count: 1,
  }
}

/** 生成中の札の文。「0/2枚 生成中」 */
export function progressBadgeText(g: BannerGeneration): string {
  return `${g.doneCount}/${g.requestedCount}枚 生成中`
}

/** いま動いている生成（queued / running）。無ければ null。 */
export function activeGeneration(generations: BannerGeneration[]): BannerGeneration | null {
  return generations.find((g) => g.status === 'queued' || g.status === 'running') ?? null
}

/**
 * 画像タイルのキャプション。「9/12 21:40・リッチメッセージ」「9/9・取り込み」
 * 品質は運用者に見せないので出さない（2026-09-12 決定）。
 */
export function tileCaption(image: BannerImage, presets: BannerPreset[]): string {
  const when = shortDateTime(image.createdAt)
  if (image.source === 'upload') return `${when}・取り込み`
  const preset = image.generation ? presets.find((p) => p.key === image.generation?.presetKey) : null
  return preset ? `${when}・${preset.label}` : when
}

/** 検索語で画像を手元で絞る（テキスト・指示・説明）。プロジェクト名は呼び出し側で足す。 */
export function imageMatchesQuery(image: BannerImage, query: string, projectName?: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = [
    projectName ?? '',
    ...(image.generation?.textLines ?? []),
    image.generation?.customPrompt ?? '',
    image.generation?.freePrompt ?? '',
    image.media.filename,
  ]
    .join('\n')
    .toLowerCase()
  return hay.includes(q)
}

/** ファイルを base64（data: なし）にする。取り込み API が受ける形。 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('ファイルを読み取れませんでした'))
    reader.readAsDataURL(file)
  })
}
