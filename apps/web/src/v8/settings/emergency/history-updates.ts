/*
 * 更新履歴の「1回の更新＝1枚」の並びを決める（SPEC-7 の画面）。
 *
 * - 区切りは検証への配備1回ごと（オーナーの決まり）。行は、その行の日時より後で最初の
 *   検証の配備（成功）の回に入る。最初の配備より前・最後の配備より後の行は、どの配備で
 *   入ったか分からないので日本時間の日ごとにする（組み立ての台本と同じ決め方）。
 * - 成功以外の配備（失敗・戻した）と本番の配備も1枚にする（結果を落とさない）。行は持たない。
 * - `summary: false` の保管用の版は日で割らず、版1つを1枚にする（行は画面に持たない）。
 * - 3行のまとめは、版の `highlights:`（人が書く）があればその版のいちばん新しい1枚に。
 *   無ければ、その回の行から「修正→追加→変更」の順に新しい行を3つ。足りなければ足りないまま。
 * - 「最新」は、いま動いている版と同じ版の、いちばん新しい1枚だけ。
 * - まだ版に入っていない行（次回反映予定）は、いちばん上に別の1枚（「最新」は付けない）。
 */
import type { OperationHistoryEntry } from '@/lib/api'

export type UpdateKind = 'added' | 'changed' | 'fixed'
export type UpdateCounts = Record<UpdateKind, number>
export type UpdateEntry = { kind: string; text: string; by?: string | null; pr?: number | null; at?: string | null }
export type SummaryRelease = { version: string; released: string | null; entryCount?: number; entries: UpdateEntry[] }
/** 組み立ての台本が出す回の並び（あれば読む。無い形でも画面は作る）。 */
export type SummaryUpdate = { version?: string | null; source?: string; highlights?: unknown; counts?: Partial<UpdateCounts> }
export type ReleaseSummary = {
  releases?: SummaryRelease[]
  updates?: SummaryUpdate[]
  pending?: { entryCount?: number; counts?: Partial<UpdateCounts> }
}
export type Deployment = NonNullable<OperationHistoryEntry['deployment']>

export type UpdateCard = {
  key: string
  source: 'pending' | 'deployment' | 'day' | 'archive'
  version: string | null
  /** 日本時間・分まで・`+09:00` 付きの日時。分からなければ null。 */
  at: string | null
  deployment: Deployment | null
  latest: boolean
  counts: UpdateCounts
  /** この回の行の数（画面に持っていない行も含む）。 */
  entryCount: number
  /** 画面に持っている、この回の行（新しい順）。 */
  entries: UpdateEntry[]
  /** 3行のまとめ。 */
  highlights: string[]
  /** まとめが人の書いたものか、行から選んだものか。 */
  highlightSource: 'written' | 'entries' | 'none'
}

const JST_OFFSET = '+09:00'
const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const HIGHLIGHT_LIMIT = 3
/** 3行に選ぶ種類の順（修正・追加・変更）。 */
const HIGHLIGHT_ORDER: UpdateKind[] = ['fixed', 'added', 'changed']

/** 反映履歴の日時（日本時間・オフセット無し）も配備の記録（UTC）も、同じ物差しの数にする。 */
export function toTime(value: string | null | undefined): number {
  if (typeof value !== 'string' || value.trim() === '') return NaN
  const text = value.trim().replace(' ', 'T')
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return Date.parse(`${text}T00:00${JST_OFFSET}`)
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) return Date.parse(text)
  return Date.parse(`${text}${JST_OFFSET}`)
}

/** `<time datetime>` にそのまま入る日本時間の形。 */
export function toJstIso(time: number): string | null {
  if (!Number.isFinite(time)) return null
  return `${new Date(time + JST_OFFSET_MS).toISOString().slice(0, 16)}${JST_OFFSET}`
}

const bare = (version: string | null | undefined) => (version ? version.replace(/^v/, '') : null)

export function countKinds(entries: UpdateEntry[]): UpdateCounts {
  const counts: UpdateCounts = { added: 0, changed: 0, fixed: 0 }
  for (const entry of entries) if (entry.kind in counts) counts[entry.kind as UpdateKind] += 1
  return counts
}

/** 1回の配備の段階（待っている→…→成功）は1枚にする。記録は新しい順。 */
export function latestDeploymentPhases(deployments: Deployment[]): Deployment[] {
  const seen = new Set<string>()
  const latest: Deployment[] = []
  for (const deployment of deployments) {
    const key = deployment.deploymentId || `${deployment.version ?? ''}|${deployment.occurredAt}`
    if (seen.has(key)) continue
    seen.add(key)
    latest.push(deployment)
  }
  return latest
}

/** 行から3つ選ぶ：修正→追加→変更の順、同じ種類は新しい順。作り物で埋めない。 */
export function pickHighlights(entries: UpdateEntry[]): string[] {
  const newest = (a: UpdateEntry, b: UpdateEntry) => (toTime(b.at) || 0) - (toTime(a.at) || 0)
  return HIGHLIGHT_ORDER
    .flatMap((kind) => entries.filter((entry) => entry.kind === kind).toSorted(newest))
    .slice(0, HIGHLIGHT_LIMIT)
    .map((entry) => entry.text)
}

/** 台本の `updates[].highlights` から、版ごとの人が書いた3行を拾う。壊れた形は無視する。 */
function writtenHighlights(updates: SummaryUpdate[] | undefined): Map<string, string[]> {
  const byVersion = new Map<string, string[]>()
  for (const update of Array.isArray(updates) ? updates : []) {
    const version = bare(update?.version)
    if (!version || byVersion.has(version) || !Array.isArray(update.highlights)) continue
    const lines = update.highlights.filter((line): line is string => typeof line === 'string' && line.trim() !== '').map((line) => line.trim())
    if (lines.length > 0) byVersion.set(version, lines.slice(0, HIGHLIGHT_LIMIT))
  }
  return byVersion
}

function readCounts(counts: Partial<UpdateCounts> | undefined): UpdateCounts {
  return { added: Number(counts?.added) || 0, changed: Number(counts?.changed) || 0, fixed: Number(counts?.fixed) || 0 }
}

/** 台本が保管用（archive）と印を付けた版と、その種類の数。 */
function archivedVersions(summary: ReleaseSummary): Map<string, UpdateCounts> {
  const archived = new Map<string, UpdateCounts>()
  for (const update of Array.isArray(summary.updates) ? summary.updates : []) {
    const version = bare(update?.version)
    if (update?.source === 'archive' && version) archived.set(version, readCounts(update.counts))
  }
  return archived
}

type Draft = Omit<UpdateCard, 'latest' | 'counts' | 'highlights' | 'highlightSource' | 'entryCount'> & { time: number; entryCount?: number; counts?: UpdateCounts }

export function buildUpdateCards({ summary, deployments, runningVersion, includeArchivedEntries = false }: {
  summary: ReleaseSummary
  deployments: Deployment[]
  runningVersion?: string | null
  includeArchivedEntries?: boolean
}): UpdateCard[] {
  const releases = Array.isArray(summary.releases) ? summary.releases : []
  const written = writtenHighlights(summary.updates)
  const archived = archivedVersions(summary)
  const latestPhases = latestDeploymentPhases(deployments)
  const boundaries = latestPhases
    .filter((deployment) => deployment.environment === 'staging' && deployment.phase === 'succeeded')
    .map((deployment) => ({ deployment, time: toTime(deployment.occurredAt) }))
    .filter((item) => Number.isFinite(item.time))
    .toSorted((a, b) => a.time - b.time)

  const drafts = new Map<string, Draft>()
  const open = (key: string, init: Omit<Draft, 'key' | 'entries'>) => {
    let draft = drafts.get(key)
    if (!draft) { draft = { ...init, key, entries: [] }; drafts.set(key, draft) }
    return draft
  }
  for (const deployment of latestPhases) {
    const time = toTime(deployment.occurredAt)
    open(`deployment|${deployment.deploymentId || `${deployment.version ?? ''}|${deployment.occurredAt}`}`, {
      source: 'deployment', version: bare(deployment.version), at: toJstIso(time), deployment, time,
    })
  }

  let pending = 0
  const pendingEntries: UpdateEntry[] = []
  for (const release of releases) {
    const version = bare(release.version)
    const total = release.entryCount ?? release.entries.length
    if (!release.released) { pending += total; pendingEntries.push(...release.entries); continue }
    const releasedAt = toTime(release.released)
    if (archived.has(version ?? '') || (release.entries.length === 0 && total > 0)) {
      const archive = open(`archive|${version}`, { source: 'archive', version, at: toJstIso(releasedAt), deployment: null, time: releasedAt, entryCount: total, counts: archived.get(version ?? '') })
      if (includeArchivedEntries) archive.entries.push(...release.entries)
      continue
    }
    for (const entry of release.entries) {
      const time = Number.isFinite(toTime(entry.at)) ? toTime(entry.at) : releasedAt
      const index = Number.isFinite(time) ? boundaries.findIndex((item) => item.time >= time) : -1
      if (index > 0) {
        const { deployment } = boundaries[index]
        const draft = drafts.get(`deployment|${deployment.deploymentId || `${deployment.version ?? ''}|${deployment.occurredAt}`}`)
        if (draft) { draft.entries.push(entry); continue }
      }
      const day = toJstIso(time)?.slice(0, 10) ?? 'unknown'
      const draft = open(`day|${day}|${version}`, { source: 'day', version, at: null, deployment: null, time: NaN })
      if (Number.isFinite(time) && !(draft.time >= time)) { draft.time = time; draft.at = toJstIso(time) }
      draft.entries.push(entry)
    }
  }

  const ordered = [...drafts.values()].toSorted((a, b) => (Number.isFinite(b.time) ? b.time : -Infinity) - (Number.isFinite(a.time) ? a.time : -Infinity))
  const running = bare(runningVersion)
  const highlighted = new Set<string>()
  let latestGiven = false
  const cards: UpdateCard[] = ordered.map((draft) => {
    const entries = draft.entries.toSorted((a, b) => (toTime(b.at) || 0) - (toTime(a.at) || 0))
    const version = draft.version
    const humanLines = version && !highlighted.has(version) && draft.source !== 'archive' ? written.get(version) : undefined
    if (humanLines && version) highlighted.add(version)
    const picked = humanLines ?? pickHighlights(entries)
    const succeeded = !draft.deployment || draft.deployment.phase === 'succeeded'
    const latest = !latestGiven && Boolean(running) && version === running && succeeded
    if (latest) latestGiven = true
    return {
      key: draft.key,
      source: draft.source,
      version,
      at: draft.at,
      deployment: draft.deployment,
      latest,
      counts: draft.counts ?? countKinds(entries),
      entryCount: draft.entryCount ?? entries.length,
      entries,
      highlights: picked,
      highlightSource: humanLines ? 'written' : picked.length > 0 ? 'entries' : 'none',
    }
  })

  if (pending > 0) {
    cards.unshift({
      key: 'pending',
      source: 'pending',
      version: null,
      at: null,
      deployment: null,
      latest: false,
      counts: readCounts(summary.pending?.counts),
      entryCount: pending,
      entries: pendingEntries,
      highlights: [],
      highlightSource: 'none',
    })
  }
  return cards
}

/** 版の行のうち、要約に入っていない（画面に持っていない）古い行の数。保管用の版と次回反映予定は数えない。 */
export function missingLineCount(summary: ReleaseSummary): number {
  const archived = archivedVersions(summary)
  return (Array.isArray(summary.releases) ? summary.releases : []).reduce((sum, release) => {
    if (!release.released || release.entries.length === 0 || archived.has(bare(release.version) ?? '')) return sum
    return sum + Math.max(0, (release.entryCount ?? release.entries.length) - release.entries.length)
  }, 0)
}

/** 本文を探し、版・日付と反映予定の区分を維持する。 */
export function searchUpdateCards(cards: UpdateCard[], query: string): UpdateCard[] {
  const needle = query.trim().normalize('NFKC').toLocaleLowerCase('ja')
  if (!needle) return cards
  const matches = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ja').includes(needle)
  return cards.flatMap((card) => {
    const entries = card.entries.filter((entry) => matches(entry.text))
    const highlights = card.highlights.filter(matches)
    if (!entries.length && !highlights.length) return []
    return [{ ...card, entryCount: entries.length, counts: countKinds(entries), entries, highlights: highlights.length ? highlights : pickHighlights(entries), highlightSource: highlights.length ? card.highlightSource : 'entries' as const }]
  })
}
