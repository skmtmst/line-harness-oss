/*
 * `bootstrap.sql` が、実際のマイグレーションと合っているか。
 *
 * `bootstrap.sql` は「schema.sql ＋ 全マイグレーション」を1枚にした生成物。
 * Gitでは管理せず、ビルド・テスト・配布物作成の前に毎回生成する。
 *
 * 実際に起きた: `158_auto_reply_name.sql` がファイルとしては入っているのに、
 * `bootstrap.sql` にも `bootstrap-meta.json` にも入っていなかった。別のPRの
 * ブランチに相乗りして取り込まれ、そのPRでは生成し直されなかったため。
 *
 * ずれると何が困るか。
 *
 *   - **新しくデータベースを作ると、その列が無い状態から始まる**
 *   - 当てる仕組みは「いまのスキーマ」を見て要否を判断するので、当たり方が
 *     環境ごとに変わる
 *   - どちらも**エラーにならない**。動いているように見えて、列だけ無い
 *
 * 数を数えるだけでは見つからない。**番号は連番ではない**（同じ番号のファイルが
 * 複数ある）ので、「最大番号＝本数」と読むと必ずずれる。名前で突き合わせる。
 *
 * この試験は、生成後のメタ情報と実際のmigrationを名前で突き合わせる。
 * 件数だけでは同じ番号を持つ別ファイルの抜けを見つけられないため。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('bootstrap.sql とマイグレーション', () => {
  const files = readdirSync(join(ROOT, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const meta = JSON.parse(readFileSync(join(ROOT, 'bootstrap-meta.json'), 'utf8')) as {
    includedMigrations: string[]
    migrationCount: number
  }

  it('取り込んだ一覧が、実際のファイルと一致する', () => {
    const missing = files.filter((f) => !meta.includedMigrations.includes(f))
    const extra = meta.includedMigrations.filter((f) => !files.includes(f))

    // 落ちたら生成器かmigration一覧の扱いを確認してください。
    expect({ 取り込まれていない: missing, ファイルが無い: extra })
      .toEqual({ 取り込まれていない: [], ファイルが無い: [] })
  })

  it('件数も合っている', () => {
    expect(meta.migrationCount).toBe(meta.includedMigrations.length)
  })
})
