/**
 * 統括「バナー生成」の型と、画面が使う小さな計算。
 *
 * API の形は `apps/worker/src/routes/hq-banners.ts` が正本。
 * ここには通信を持たない（通信は `api.hqBanners`）。純粋な関数だけにして
 * テストしやすくしておく。
 */

import { formatDateTime, formatRelative } from './format'

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
  /** 課金の状態（トライアル終了・解約）で止まっているか。理由は blockedReason。 */
  blocked?: boolean
  blockedReason?: string | null
  planState?: string
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
/**
 * 参照画像の使い方（★V6 35-2・承認済み ★BG-C `cOgWE`）。
 * edit=土台にする、parts=素材を一部使う、inspire=雰囲気を参考にする。
 */
export type BannerReferenceMode = 'edit' | 'parts' | 'inspire'

/** 参照画像は最大3枚（承認済み ★BG-C `cOgWE`）。 */
export const BANNER_MAX_REFERENCE_IMAGES = 3

/** 画像1枚とその使い方の組。順番はプロンプトの「N枚目」と同じ。 */
export interface BannerReference {
  imageId: string
  mode: BannerReferenceMode
}

/** 使い方の表示名（★BG-B `L1ax1Y` / ★BG-C `cOgWE` の文言）。 */
export const BANNER_REFERENCE_MODE_LABEL: Record<BannerReferenceMode, string> = {
  edit: '土台にする',
  parts: '素材を一部使う',
  inspire: '雰囲気を参考にする',
}

/** 使い方の説明（★BG-B `R6MBHf` の文言）。 */
export const BANNER_REFERENCE_MODE_DESCRIPTION: Record<BannerReferenceMode, string> = {
  edit: '構図と配色をそのまま残し、文字や背景だけを指示どおりに変えます。',
  parts: 'ロゴや商品など、その画像の一部だけを取り込んで新しく組み立てます。',
  inspire: '色とトーンだけを引き継ぎ、構図は写さずに新しく作ります。',
}

export const BANNER_REFERENCE_MODES: BannerReferenceMode[] = ['edit', 'parts', 'inspire']

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
  /**
   * 強調した行（Pencil ★修正案 `g64HOD`・2026-10-06 承認）。`textLines` と同じ順・
   * 同じ長さで、true の行だけを強調カラーで目立たせる。強調を知らない古い生成は空。
   */
  emphasisLines: boolean[]
  /** 背景に敷く色（Pencil ★BG-B `KkTNS` ベースカラー）。 */
  baseColor: string | null
  mainColor: string | null
  subColor: string | null
  /** 目立たせたい文字の色（同 強調カラー）。 */
  accentColor: string | null
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
  /** 参照画像（最大3枚）。古い生成は1枚組から作られる。 */
  references?: BannerReference[] | null
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
  /** 用途の指定寸法へ整形できたか。false のときは元の大きさのまま（検証環境で確認）。 */
  resized?: boolean
  targetWidth?: number
  targetHeight?: number
}

/** 切り抜きの位置。用途寸法へ cover で整えるときに残す側（R120）。 */
export type BannerCropPosition = 'center' | 'top' | 'bottom'

export const CROP_POSITION_OPTIONS: Array<{ value: BannerCropPosition; label: string }> = [
  { value: 'center', label: '中央' },
  { value: 'top', label: '上' },
  { value: 'bottom', label: '下' },
]

export function isBannerCropPosition(value: string): value is BannerCropPosition {
  return value === 'center' || value === 'top' || value === 'bottom'
}

export interface BannerDeliveryResult {
  image: BannerImage
  deliveries: Array<{ lineAccountId: string; mediaId: string; alreadyDelivered: boolean }>
}

/** 生成パネルの入力。API へそのまま送れる形。 */
export interface BannerGenerationInput {
  mode: BannerMode
  presetKey: string
  /** 切り抜きの位置。run のときに送り、条件の登録ではサーバーが無視する。 */
  cropPosition: BannerCropPosition
  textLines: string[]
  /**
   * 行ごとの「強調」。`textLines` と同じ長さに保つ（行を足す・消すときも一緒に動かす）。
   * Pencil ★修正案 `g64HOD`（2026-10-06 承認）の決まり 1・5。
   */
  emphasisLines: boolean[]
  baseColor: string | null
  mainColor: string | null
  subColor: string | null
  accentColor: string | null
  personOption: BannerPersonOption
  customPrompt: string
  freePrompt: string
  count: number
  /** 参照画像（ライブラリの画像 ID と使い方）。最大3枚。無ければ空。 */
  references: BannerReference[]
}

/** 生成パネルの初期値。用途は一覧の先頭を画面側で入れる。 */
export const EMPTY_GENERATION_INPUT: BannerGenerationInput = {
  mode: 'banner',
  presetKey: '',
  cropPosition: 'center',
  textLines: [''],
  emphasisLines: [false],
  baseColor: null,
  mainColor: null,
  subColor: null,
  accentColor: null,
  personOption: 'without',
  customPrompt: '',
  freePrompt: '',
  count: 1,
  references: [],
}

/** 色を入れる4つの欄。 */
export type BannerColorRoleKey = 'baseColor' | 'mainColor' | 'subColor' | 'accentColor'

/**
 * 色の4つの役割（Pencil ★BG-B `KkTNS`）。
 * 見本の色と説明は承認した版のとおり。
 */
export const COLOR_ROLES: readonly {
  key: BannerColorRoleKey
  label: string
  /** 何も選んでいないときにピッカーが開く色（承認した見本の色）。 */
  sample: string
}[] = [
  { key: 'baseColor', label: 'ベースカラー', sample: '#FFFFFF' },
  { key: 'mainColor', label: 'メインカラー', sample: '#D7263D' },
  { key: 'subColor', label: 'サブカラー', sample: '#F3E9DC' },
  { key: 'accentColor', label: '強調カラー', sample: '#FFD400' },
]

export const TEXT_LINE_MAX = 6
export const TEXT_LINE_LENGTH_MAX = 40
export const CUSTOM_PROMPT_MAX = 600
export const FREE_PROMPT_MAX = 1200

/** `#RRGGBB`。すけ具合つき（`#RRGGBBAA`）も受ける。 */
export function isHexColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(value)
}

/**
 * 強調の指定をテキストの行数へ揃える。足りない分はオフ、余った分は捨てる。
 * 行を足す・消すで取り違えないよう、入口（戻し）と出口（送信）の両方でこれを通す。
 */
export function alignEmphasis(lines: string[], emphasis: boolean[] | null | undefined): boolean[] {
  return lines.map((_, index) => emphasis?.[index] === true)
}

/**
 * 送る形に整えたテキストと強調。空の行は落とすが、強調は同じ行に付いたまま
 * 残す（先に片方だけ詰めると番号がずれる）。
 */
export function packedTextLines(input: Pick<BannerGenerationInput, 'textLines' | 'emphasisLines'>): {
  textLines: string[]
  emphasisLines: boolean[]
} {
  const kept = input.textLines
    .map((line, index) => ({ line: line.trim(), emphasis: input.emphasisLines[index] === true }))
    .filter((entry) => entry.line.length > 0)
  return { textLines: kept.map((e) => e.line), emphasisLines: kept.map((e) => e.emphasis) }
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
  // 参照画像は最大3枚で、同じ画像は選べない（★BG-C `cOgWE`）。
  if (input.references.length > BANNER_MAX_REFERENCE_IMAGES) {
    return `参照画像は${BANNER_MAX_REFERENCE_IMAGES}枚までにしてください`
  }
  if (new Set(input.references.map((reference) => reference.imageId)).size !== input.references.length) {
    return '同じ画像を2回選べません'
  }
  if (input.mode === 'banner') {
    const lines = input.textLines.map((line) => line.trim()).filter(Boolean)
    // 「土台にする」は指示だけでも成り立つ（文字を入れない差し替えもある）。
    const editing = input.references.some((reference) => reference.mode === 'edit')
    if (lines.length === 0 && !editing && !input.customPrompt.trim()) {
      return '画像に入れるテキストか、追加の指示を入力してください'
    }
    if (lines.length > TEXT_LINE_MAX) return `テキストは${TEXT_LINE_MAX}行までです`
    if (lines.some((line) => line.length > TEXT_LINE_LENGTH_MAX)) {
      return `テキストは1行${TEXT_LINE_LENGTH_MAX}文字までです`
    }
    for (const role of COLOR_ROLES) {
      const color = input[role.key]
      if (color && !isHexColor(color)) return `${role.label}は #RRGGBB の形で入力してください`
    }
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
  if (usage.blocked) return usage.blockedReason ?? '配信とバナー生成は止まっています。課金プランを確認してください'
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
  // API の中身が欠けていても `undefined.replace` で落ちない。呼び出し側は NaN を「—」にする。
  if (typeof value !== 'string' || value.trim() === '') return new Date(Number.NaN)
  const normalized = value.replace(' ', 'T')
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
  return new Date(hasOffset ? normalized : `${normalized}+09:00`)
}

/** 「9月12日（土）21:40」。運用画面の基準は日本時間（`@/lib/format`）。 */
export function shortDateTime(iso: string, now = new Date()): string {
  const date = parseJstDateTime(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return formatDateTime(date, '—', now)
}

/**
 * 「3分前」「昨日 21:40」「9月5日（金）」。プロジェクトカードの「更新」に使う。
 * `docs/v8-design-rules.md` §5: 分の生表示は日で丸める。
 */
export function relativeUpdated(iso: string, now = new Date()): string {
  const date = parseJstDateTime(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return formatRelative(date, now)
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

/** 用途の見出し。LINE と SNS（ほかの用途）を分けて並べる。 */
export function groupPresets(presets: BannerPreset[]): Array<{ group: BannerPresetGroup; label: string; items: BannerPreset[] }> {
  return [
    { group: 'line' as const, label: 'LINE', items: presets.filter((p) => p.group === 'line') },
    { group: 'sns' as const, label: 'SNS', items: presets.filter((p) => p.group === 'sns') },
  ].filter((g) => g.items.length > 0)
}

/** 「リッチメッセージ（1040×1040）」 */
export function presetOptionLabel(preset: BannerPreset): string {
  return `${preset.label}（${preset.targetWidth}×${preset.targetHeight}）`
}

/**
 * 出力サイズのカードの名前（★BG-B `xy4EW`）。
 * 「LINE」はカードの見出し（出力サイズ／LINEの規格から選ぶ）で分かるので、頭の「LINE 」は落とす。
 */
export function presetCardLabel(preset: BannerPreset): string {
  return preset.group === 'line' ? preset.label.replace(/^LINE /, '') : preset.label
}

/** 出力サイズのカードの寸法「1040 × 1040」（★BG-B `xy4EW`）。 */
export function presetSizeLabel(preset: BannerPreset): string {
  return `${preset.targetWidth} × ${preset.targetHeight}`
}

/**
 * 下の帯の真ん中に出す「1040 × 1040 で書き出します」（★BG-B `GcuH5`）。
 * 選んでいる用途の寸法をそのまま使う。用途が未選択のときは出さない
 * （寸法が決まっていないので書けない）。
 */
export function exportSizeText(presets: BannerPreset[], presetKey: string): string {
  const preset = presets.find((p) => p.key === presetKey)
  return preset ? `${presetSizeLabel(preset)} で書き出します` : ''
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
      value:
        COLOR_ROLES.map((role) => (g[role.key] ? `${role.label.replace('カラー', '')} ${g[role.key]}` : null))
          .filter(Boolean)
          .join('・') || '指定なし',
    })
    rows.push({ label: '人物', value: g.personOption === 'with' ? '入れる' : '入れない' })
    rows.push({ label: '追加の指示', value: g.customPrompt || '（なし）' })
  }
  const references = g.references ?? []
  if (references.length > 0) {
    // 1枚なら使い方だけ、複数なら枚数と使い方を並べる（★BG-C `cOgWE`）。
    const usages = references.map((reference) => BANNER_REFERENCE_MODE_LABEL[reference.mode] ?? reference.mode)
    rows.push({
      label: '参照画像',
      value: references.length === 1 ? usages[0] : `${references.length}枚（${usages.join('・')}）`,
    })
  }
  rows.push({ label: '作成', value: shortDateTime(image.createdAt) })
  return rows
}

/**
 * 画像の「生成時の条件」を、生成パネルへ戻す（同じ設定でもう一度生成）。
 *
 * 2026-10-06（オーナー指示）：生成パネルから「バナー／自由入力」の切替を外したので、
 * 戻すときは必ず `banner` にする。昔の自由入力で作った画像は、説明の文を
 * 画面にある「追加の指示」へ移す（移さないと入力欄の無い状態で
 * 「説明を入力してください」と止まり、やり直せなくなる）。
 */
export function inputFromGeneration(g: BannerGeneration): BannerGenerationInput {
  const carried = g.mode === 'free' ? (g.freePrompt ?? '') : (g.customPrompt ?? '')
  return {
    mode: 'banner',
    presetKey: g.presetKey,
    // 切り抜き位置は保存していないので中央に戻す（R120・migration 不要のため）。
    cropPosition: 'center',
    textLines: g.textLines.length > 0 ? [...g.textLines] : [''],
    // 強調は行と同じ長さに揃えて戻す（強調を知らない古い生成は全部オフになる）。
    emphasisLines: alignEmphasis(g.textLines.length > 0 ? g.textLines : [''], g.emphasisLines),
    baseColor: g.baseColor,
    mainColor: g.mainColor,
    subColor: g.subColor,
    accentColor: g.accentColor,
    personOption: g.personOption,
    customPrompt: carried.slice(0, CUSTOM_PROMPT_MAX),
    freePrompt: '',
    count: 1,
    references: (g.references ?? []).map((reference) => ({ ...reference })),
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
