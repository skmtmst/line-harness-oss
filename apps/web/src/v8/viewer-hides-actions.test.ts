import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * ★V8 の決まり（2026-10-06 オーナー）：閲覧のみ（変える権限が無い人）には、
 * 作る・追加・編集・削除などの押せないボタンやメニューの項目を置かずに隠す。
 * 絵が押せない形で描いていても隠す。閲覧のみの帯は出す。
 *
 * src/v8 の画面で「権限が無いから押せない」形を書いたら落ちる。
 * （選んでいない・空なので押せない、のような権限以外の理由はかまわない。）
 */
const ROOT = dirname(fileURLToPath(import.meta.url))
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  if (statSync(path).isDirectory()) return files(path)
  return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : []
})

// 権限の有無を表す名前（画面ごとに違う）
const PERM = '(?:canEdit|canManage|canWrite|canOperate|isViewer|viewOnly|readOnly|readonly)'
const REASON = '(?:NO_MANAGE_NOTE|READONLY_REASON|READ_ONLY_REASON|VIEWER_NOTE)'
const PATTERNS: Array<[string, RegExp]> = [
  ['disabled={!権限}', new RegExp(`disabled=\\{\\s*!${PERM}\\s*[}|&]`)],
  ['disabled={読み取りのみ}', new RegExp(`disabled=\\{\\s*(?:readOnly|readonly|isViewer|viewOnly)\\s*[}|&]`)],
  ['disabled: !権限（メニューの項目）', new RegExp(`disabled:\\s*!${PERM}\\b`)],
  ['disabled: 読み取りのみ（メニューの項目）', new RegExp(`disabled:\\s*(?:readOnly|readonly|isViewer|viewOnly)\\b`)],
  ['権限の理由つきで押せないボタン', new RegExp(`<Button[^>]*\\bdisabled\\b[^>]*title=\\{${REASON}\\}`)],
  ['フォルダを追加を押せない形で出す', new RegExp(`addFolderDisabled=\\{[^}]*${PERM}`)],
]

describe('V8：閲覧のみには押せない操作を置かない', () => {
  it('src/v8 の画面に「権限が無いから押せない」形が無い', () => {
    const hits: string[] = []
    for (const file of files(ROOT)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        for (const [name, re] of PATTERNS) {
          if (re.test(line)) hits.push(`${relative(ROOT, file)}:${index + 1} ${name}`)
        }
      })
    }
    expect(hits, '閲覧のみには押せないボタン・項目を置かずに隠す（{canEdit && …} か、項目を外す）').toEqual([])
  })
})
