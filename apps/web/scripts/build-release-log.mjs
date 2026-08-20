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

/** 見出しは3つだけ。増やすと、読む側が分類を覚えないといけなくなる。 */
const KINDS = { 追加: 'added', 変更: 'changed', 修正: 'fixed' }

function parseFrontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { meta: {}, body: text }
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i < 0) continue
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { meta, body: text.slice(match[0].length) }
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

function parseFile(name) {
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
  return {
    version: meta.version ?? name.replace(/\.md$/, ''),
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
    return
  }

  const files = readdirSync(LOG_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md')
  const releases = files.map(parseFile)

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
      const parsed = parseFile(join('unreleased', name))
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
  const total = releases.reduce((n, r) => n + r.entries.length, 0)
  console.log(`[release-log] ${releases.length} 版 / ${total} 件を書き出しました`)
}

main()
