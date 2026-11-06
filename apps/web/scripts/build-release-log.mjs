/*
 * docs/release-log/*.md を、管理画面が読める JSON にする。
 *
 * ビルド時に走らせて同梱する。実行時に取りに行かないのは、
 * **表示される履歴と、いま動いているコードを必ず一致させる**ため。
 * DBやGitHub APIから取ると、配布に失敗したときに画面だけ新しくなる。
 *
 * 書き方は docs/release-log/README.md にある。
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = join(SCRIPT_DIR, '..')
const LOG_DIR = join(WEB_ROOT, '../../docs/release-log')
const OUT_DIR = join(WEB_ROOT, 'src/generated')
const OUT_FILE = join(OUT_DIR, 'release-log.json')
/** 運用状態の画面が読む要約（下の summarize）。 */
const SUMMARY_FILE = join(OUT_DIR, 'release-log-summary.json')
/** 要約に本文ごと残す、反映済みの新しい行の数。画面が出す10行より十分多く。 */
const SUMMARY_KEEP = 50

/** 見出しは3つだけ。増やすと、読む側が分類を覚えないといけなくなる。 */
const KINDS = { 追加: 'added', 変更: 'changed', 修正: 'fixed' }

/** front-matter のうち、字下げした `- 行` の並びとして読む項目。ほかは1行の値のまま。 */
const LIST_KEYS = new Set(['highlights'])

function parseFrontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { meta: {}, body: text }
  const meta = {}
  let listKey = null
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*?)\s*$/)
    if (item && listKey) {
      meta[listKey].push(item[1])
      continue
    }
    listKey = null
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i).trim()
    const value = line.slice(i + 1).trim()
    if (LIST_KEYS.has(key) && value === '') {
      meta[key] = []
      listKey = key
    } else {
      meta[key] = value
    }
  }
  return { meta, body: text.slice(match[0].length) }
}

/** その回の3行のまとめ。人が書くもので、無ければ空のまま（機械で作らない）。 */
const HIGHLIGHT_LIMIT = 3

/*
 * 版のファイルの `highlights:` を読む。書き方の誤りでビルドを落とさないよう、
 * 読めない形は警告して空にする。PRごとのファイルには書かない決まりなので無視する。
 */
function readHighlights(meta, name) {
  if (meta.highlights === undefined) return []
  if (name.startsWith('unreleased')) {
    console.warn(`[release-log] ${name}: highlights は版のファイルにだけ書きます — 無視しました`)
    return []
  }
  if (!Array.isArray(meta.highlights)) {
    console.warn(`[release-log] ${name}: highlights は「- 行」を字下げして並べます — 無視しました`)
    return []
  }
  const lines = meta.highlights
    .map((line) => line.replace(/^(["'])(.*)\1$/, '$2').trim())
    .filter(Boolean)
  if (lines.length > HIGHLIGHT_LIMIT) {
    console.warn(`[release-log] ${name}: highlights は${HIGHLIGHT_LIMIT}行までです — 先の${HIGHLIGHT_LIMIT}行だけ使います`)
  }
  return lines.slice(0, HIGHLIGHT_LIMIT)
}

/**
 * 1行を項目にする。
 *
 *   - 予約した絞り込み配信が全員に届いていたのを直した @kenta #151 2026-08-19 10:22
 *
 * 行末に付いている `@名前` `#番号` `YYYY-MM-DD HH:MM` を拾って、本文からは外す。
 * どれも省略でき、順番も問わない。書く人が並びを覚えなくて済むように、
 * **末尾から1つずつ剥がす**形にしてある。
 */
const TRAILING = [
  { key: 'at', re: /\s(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?)\s*$/, take: (m) => m[1].replace(' ', 'T') },
  { key: 'pr', re: /\s#(\d+)\s*$/, take: (m) => Number(m[1]) },
  { key: 'by', re: /\s@([A-Za-z0-9_-]+)\s*$/, take: (m) => m[1] },
]

function parseEntry(line) {
  let text = line.replace(/^[-*]\s+/, '').trim()
  const out = { text: '', by: null, pr: null, at: null }

  // 1周で1つも剥がせなくなったら終わり。
  let peeled = true
  while (peeled) {
    peeled = false
    for (const token of TRAILING) {
      if (out[token.key] !== null) continue
      const m = text.match(token.re)
      if (!m) continue
      out[token.key] = token.take(m)
      text = text.slice(0, m.index).trim()
      peeled = true
    }
  }

  out.text = text
  return out
}

function parseFile(name, summaryExcludedVersions, highlightsByVersion) {
  // name にはサブディレクトリ（`unreleased/196-kenta-....md`）も来る。
  const raw = readFileSync(join(LOG_DIR, name), 'utf8')
  const { meta, body } = parseFrontMatter(raw)
  const entries = []
  let kind = null
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading) {
      kind = KINDS[heading[1]] ?? null
      if (!kind) {
        // 知らない見出しは黙って捨てない。書いた本人が気づけるようにする。
        console.warn(`[release-log] ${name}: 知らない見出し「${heading[1]}」— 追加/変更/修正 のどれかにしてください`)
      }
      continue
    }
    if (!/^[-*]\s+/.test(line)) continue
    if (!kind) {
      console.warn(`[release-log] ${name}: 見出しの外に項目があります — ${line.trim()}`)
      continue
    }
    entries.push({ kind, ...parseEntry(line) })
  }
  const version = meta.version ?? name.replace(/\.md$/, '')
  // 過去の未公開行を保管する版は、全文を残したまま要約の候補から外せる。
  if (meta.summary === 'false') summaryExcludedVersions.add(version)
  const highlights = readHighlights(meta, name)
  if (highlights.length > 0) highlightsByVersion.set(version, highlights)
  return {
    version,
    released: meta.released ?? null,
    entries,
  }
}

function versionKey(version) {
  return version.split('.').map((n) => Number(n) || 0)
}

function main() {
  if (!existsSync(LOG_DIR)) {
    console.warn('[release-log] docs/release-log がありません。空で出します。')
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(OUT_FILE, JSON.stringify({ releases: [] }, null, 2))
    writeFileSync(SUMMARY_FILE, JSON.stringify(summarize([])) + '\n')
    return
  }

  const files = readdirSync(LOG_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md')
  const summaryExcludedVersions = new Set()
  const highlightsByVersion = new Map()
  const releases = files.map((name) => parseFile(name, summaryExcludedVersions, highlightsByVersion))

  /*
   * 未リリースぶんは、PRごとの1ファイルからも拾う。
   *
   * `unreleased.md` に全員が書き足す形だと、**全員が同じ場所（`## 追加` の
   * 直後）に行を差し込むので、PRのたびに必ずぶつかる。** 一晩で9本のPRが
   * 全部ここで止まった。1本ずつ別のファイルにすれば、ぶつかりようがない。
   *
   * ファイル名は `<番号>-<担当>-<何の話か>.md`。番号で並ぶので、
   * 並び順を人が決めなくてよくなる。
   */
  const partsDir = join(LOG_DIR, 'unreleased')
  if (existsSync(partsDir)) {
    const unreleased = releases.find((r) => r.released === null)
    const parts = readdirSync(partsDir)
      .filter((f) => f.endsWith('.md') && f !== 'README.md')
      .sort()
    for (const name of parts) {
      const parsed = parseFile(join('unreleased', name), summaryExcludedVersions, highlightsByVersion)
      if (unreleased) unreleased.entries.push(...parsed.entries)
      else releases.push({ version: 'unreleased', released: null, entries: parsed.entries })
    }
  }

  // 未リリースを先頭に、あとは新しい版から。
  releases.sort((a, b) => {
    if (a.released === null && b.released !== null) return -1
    if (a.released !== null && b.released === null) return 1
    const [av, bv] = [versionKey(a.version), versionKey(b.version)]
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
      if ((bv[i] ?? 0) !== (av[i] ?? 0)) return (bv[i] ?? 0) - (av[i] ?? 0)
    }
    return 0
  })

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify({ releases }, null, 2) + '\n')
  const options = { deployments: readDeployments(), highlights: highlightsByVersion }
  writeFileSync(SUMMARY_FILE, JSON.stringify(summarize(releases, summaryExcludedVersions, options)) + '\n')
  const total = releases.reduce((n, r) => n + r.entries.length, 0)
  console.log(`[release-log] ${releases.length} 版 / ${total} 件を書き出しました`)
}

/*
 * 検証への配備の記録。ビルドの時に手元のファイルとして渡されたときだけ使う
 * （`RELEASE_LOG_DEPLOYMENTS` にファイルの場所。中身は `[{ "at": "...", "environment": "staging", "phase": "succeeded" }]`）。
 * 実行時に取りに行かないのは頭のコメントと同じ理由。渡されない・読めないときは、
 * 回の区切りを日本時間の日ごとにする。ビルドは落とさない。
 */
function readDeployments() {
  const path = process.env.RELEASE_LOG_DEPLOYMENTS
  if (!path) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed instanceof Array) return parsed
    console.warn('[release-log] 配備の記録が並びの形ではありません — 日ごとに区切ります')
  } catch {
    console.warn('[release-log] 配備の記録を読めませんでした — 日ごとに区切ります')
  }
  return []
}

/*
 * 運用状態の画面用の要約。
 *
 * 全文（release-log.json）は未反映の行が数千件あり、画面のJSに同梱すると
 * それだけで 160kB を超えた。画面が本文を出すのは「反映済みの新しい行」だけで、
 * ほかは版ごとの件数しか使わない。そこで件数（entryCount）を残し、本文は
 * 反映済みの新しい SUMMARY_KEEP 行だけにする。
 * 保管用の版で `summary: false` を指定したものは候補から外す。未公開の行を
 * 版へまとめても、要約に新しく載せず、全文と版ごとの件数は残すため。
 *
 * 「新しい行」の並べ方は画面（update-history.ts の collectRecentUpdates）と同じ
 * `at ?? released` の新しい順。画面は配備記録と混ぜて新しい10行を出すので、
 * 反映済みの新しい10行より多く残しておけば、表示される行は全文のときと変わらない。
 *
 * `updates` は更新1回ごとの並び（groupUpdates）、`pending` は次回反映予定の件数。
 */
export function summarize(releases, summaryExcludedVersions = new Set(), options = {}) {
  const rows = []
  releases.forEach((release, r) => {
    if (!release.released || summaryExcludedVersions.has(release.version)) return
    release.entries.forEach((entry, e) => {
      rows.push({ r, e, key: Date.parse(entry.at ?? release.released ?? '') })
    })
  })
  rows.sort((a, b) => b.key - a.key)
  const keep = new Set(rows.slice(0, SUMMARY_KEEP).map((row) => `${row.r}:${row.e}`))
  const pendingEntries = releases.filter((release) => !release.released).flatMap((release) => release.entries)
  return {
    releases: releases.map((release, r) => ({
      version: release.version,
      released: release.released,
      entryCount: release.entries.length,
      entries: release.entries.filter((_, e) => keep.has(`${r}:${e}`)),
    })),
    updates: groupUpdates(releases, summaryExcludedVersions, options),
    pending: { entryCount: pendingEntries.length, counts: countKinds(pendingEntries) },
  }
}

const JST_OFFSET = '+09:00'
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 反映履歴の日時（日本時間・オフセット無し）も、配備の記録（UTC）も同じ物差しの数にする。 */
function toTime(value) {
  if (typeof value !== 'string' || value === '') return NaN
  const text = value.trim().replace(' ', 'T')
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return Date.parse(`${text}T00:00${JST_OFFSET}`)
  if (/T.*(?:[zZ]|[+-]\d{2}:\d{2})$/.test(text)) return Date.parse(text)
  return Date.parse(`${text}${JST_OFFSET}`)
}

/** `<time datetime>` にそのまま入る日本時間の形（年-月-日T時:分+09:00）。 */
function toJstIso(time) {
  return new Date(time + JST_OFFSET_MS).toISOString().slice(0, 16) + JST_OFFSET
}

function countKinds(entries) {
  const counts = { added: 0, changed: 0, fixed: 0 }
  for (const entry of entries) if (entry.kind in counts) counts[entry.kind] += 1
  return counts
}

function isStagingSuccess(deployment) {
  if (!deployment || typeof deployment !== 'object') return false
  if (deployment.environment !== undefined && deployment.environment !== 'staging') return false
  if (deployment.phase !== undefined && deployment.phase !== 'succeeded') return false
  return true
}

/*
 * 更新1回ごとの並び（新しい順）。1回＝検証への配備1回（オーナーの決定）。
 *
 * - 行は、その行の日時より後で最初の配備の回に入る。ただし最初の配備の記録より前と、
 *   最後の配備より後の行は、どの配備で入ったか分からないので日本時間の日ごとにする。
 * - 同じ回でも版が違えば分ける（版の札を正しく出すため）。
 * - `summary: false` の保管用の版は日付で割らず、版1つを1回（source: 'archive'）にする。
 * - 3行のまとめは版の `highlights:` を、その版のいちばん新しい回に載せる。無ければ空。
 * - 「最新」（latest）は並びの先頭の1回だけ。
 */
export function groupUpdates(releases, summaryExcludedVersions = new Set(), options = {}) {
  const highlights = options.highlights ?? new Map()
  const deploys = (options.deployments instanceof Array ? options.deployments : [])
    .filter(isStagingSuccess)
    .map((deployment) => toTime(deployment.at ?? deployment.occurredAt))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  const groups = new Map()
  const open = (key, init) => {
    if (!groups.has(key)) groups.set(key, { ...init, key, entries: [] })
    return groups.get(key)
  }

  for (const release of releases) {
    if (!release.released) continue
    const { version } = release
    const releasedAt = toTime(release.released)
    if (summaryExcludedVersions.has(version)) {
      open(`archive|${version}`, { source: 'archive', version, time: releasedAt }).entries.push(...release.entries)
      continue
    }
    for (const entry of release.entries) {
      let time = toTime(entry.at)
      if (!Number.isFinite(time)) time = releasedAt
      const index = Number.isFinite(time) ? deploys.findIndex((deployedAt) => deployedAt >= time) : -1
      if (index > 0) {
        open(`deployment|${deploys[index]}|${version}`, { source: 'deployment', version, time: deploys[index] }).entries.push(entry)
        continue
      }
      const day = Number.isFinite(time) ? toJstIso(time).slice(0, 10) : 'unknown'
      const group = open(`day|${day}|${version}`, { source: 'day', version, time })
      if (Number.isFinite(time) && !(group.time >= time)) group.time = time
      group.entries.push(entry)
    }
  }

  const sorted = [...groups.values()].sort((a, b) => {
    const [at, bt] = [Number.isFinite(a.time) ? a.time : -Infinity, Number.isFinite(b.time) ? b.time : -Infinity]
    if (at !== bt) return bt - at
    const [av, bv] = [versionKey(a.version), versionKey(b.version)]
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
      if ((bv[i] ?? 0) !== (av[i] ?? 0)) return (bv[i] ?? 0) - (av[i] ?? 0)
    }
    return 0
  })
  const highlighted = new Set()
  return sorted.map((group, i) => {
    const lines = highlighted.has(group.version) ? [] : highlights.get(group.version) ?? []
    if (lines.length > 0) highlighted.add(group.version)
    return {
      key: group.key,
      source: group.source,
      version: group.version,
      at: Number.isFinite(group.time) ? toJstIso(group.time) : null,
      latest: i === 0,
      counts: countKinds(group.entries),
      entryCount: group.entries.length,
      highlights: [...lines],
    }
  })
}

// 試験から summarize だけを読むとき（import）は書き出さない。
if (process.argv[1] && process.argv[1].endsWith('build-release-log.mjs')) main()
