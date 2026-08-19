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
 *   - 予約した絞り込み配信が全員に届いていたのを直した @kenta #151
 *
 * 行末の `@名前` と `#番号` を拾って、本文からは外す。どちらも省略できる。
 */
function parseEntry(line) {
  let text = line.replace(/^[-*]\s+/, '').trim()
  let by = null
  let pr = null

  const prMatch = text.match(/\s#(\d+)\s*$/)
  if (prMatch) {
    pr = Number(prMatch[1])
    text = text.slice(0, prMatch.index).trim()
  }
  const byMatch = text.match(/\s@([A-Za-z0-9_-]+)\s*$/)
  if (byMatch) {
    by = byMatch[1]
    text = text.slice(0, byMatch.index).trim()
  }
  return { text, by, pr }
}

function parseFile(name) {
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
