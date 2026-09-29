import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(HERE, rel), 'utf8')
const PROJECTS = read('../../../components/hq/banners/projects-section.tsx')
const LIBRARY = read('../../../components/hq/banners/library-section.tsx')
const SHELL = read('../../../components/hq/banners/banner-shell.tsx')

/**
 * U017 / U032: バナー生成の検索欄の潰れと、タブへの操作ボタンの重なり
 * （外部UI監査 ab9d80b07）。
 *
 * U017: 390pxで並び順に幅を取られ、検索欄がほぼ四角形まで潰れていた。
 * 検索は全幅の独立行にし、並び順は次の行へ。画像ライブラリの検索も同じ形。
 *
 * U032: 390pxでタブと右端の操作（プロジェクトを作る・アーカイブを見る）が
 * 表示領域を取り合い、ラベルを隠していた。狭い幅ではタブ行を折り返して
 * 操作を別行にする。
 *
 * ブラウザの実測幅は vitest では取れないので、**潰れない構造**を
 * 契約として見る。
 */
const searchRowBlock = (src: string): string => {
  const start = src.indexOf('data-search-row')
  const end = src.indexOf('</div>', start)
  return src.slice(start, end)
}

describe('バナー生成の検索行（U017）', () => {
  it('プロジェクト一覧の検索欄は独立した全幅の行に1つだけ置く', () => {
    const row = searchRowBlock(PROJECTS)
    expect(row).toContain('プロジェクト名・説明で検索')
    expect(row, '検索欄が全幅でない').toContain('className="w-full"')
    expect(row).not.toContain('SelectField')
    expect(row).not.toContain('並び順')
  })

  it('プロジェクト一覧の並び順は検索の次の行（絞り込み行）へ置く', () => {
    const rowEnd = PROJECTS.indexOf('</div>', PROJECTS.indexOf('data-search-row'))
    const sortAt = PROJECTS.indexOf('aria-label="並び順"')
    expect(sortAt).toBeGreaterThan(rowEnd)
    // 絞り込みチップと同じ行にある。
    expect(sortAt).toBeGreaterThan(PROJECTS.indexOf('お気に入り'))
    expect(sortAt).toBeLessThan(PROJECTS.indexOf('border-t border-hairline'))
  })

  it('画像ライブラリの検索欄も同じく独立した全幅の行にする', () => {
    const row = searchRowBlock(LIBRARY)
    expect(row).toContain('テキスト・指示・プロジェクト名で検索')
    expect(row, '検索欄が全幅でない').toContain('className="w-full"')
    expect(row).not.toContain('並び順')
    // 並び順の注記は絞り込み行へ移す。
    const rowEnd = LIBRARY.indexOf('</div>', LIBRARY.indexOf('data-search-row'))
    expect(LIBRARY.indexOf('並び順: 作成が新しい順')).toBeGreaterThan(rowEnd)
  })
})

describe('バナー生成のタブ行（U032）', () => {
  it('狭い幅ではタブと操作を別行へ折る（行の折り返しを持つ）', () => {
    expect(SHELL).toContain('@media (width < 768px)')
    expect(SHELL).toContain('flex-wrap: wrap')
    expect(SHELL).toContain('height: auto')
    // 両タブ状態（プロジェクト一覧 jGeAF／画像ライブラリ bpdek）の nav に効く。
    expect(SHELL).toContain("[data-design-node='jGeAF'] > nav")
    expect(SHELL).toContain("[data-design-node='bpdek'] > nav")
  })

  it('広い幅では設計どおり操作をタブ行の右端に置く（actions を渡す）', () => {
    // `docs/v6-common-rules.md` §1-4: ヘッダー操作を独立した行にしない。
    expect(SHELL).toContain('actions={actions}')
  })
})
