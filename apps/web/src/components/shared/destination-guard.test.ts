import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const root = join(process.cwd(), 'src')
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : path.endsWith('.tsx') && !path.includes('.test.') ? [path] : []
  })
}
const legacyEntries = ['app/auto-replies/edit/wizard-v8.tsx', 'app/reminders/list-v8.tsx', 'app/reminders/new/new-v8.tsx', 'app/rich-menus/new/create-v8.tsx']
const targets = [...files(join(root, 'v8')), ...legacyEntries.map(path => join(root, path))]

function violations(path: string, source: string): string[] {
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const errors: string[] = []
  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node)) {
      const property = (name: string) => node.properties.find((part): part is ts.PropertyAssignment => ts.isPropertyAssignment(part) && part.name.getText(tree) === name)
      if (property('label') && property('external')?.initializer.kind === ts.SyntaxKind.TrueKeyword && !property('href')) {
        errors.push(`${relative(root, path)}: ↗には新しいタブで開くhrefが必要`)
      }
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node
      const tag = opening.tagName.getText(tree)
      const open = opening.attributes.properties.find(part => ts.isJsxAttribute(part) && part.name.getText(tree) === 'open')
      if (['Dialog', 'ConfirmDialog', 'DetailPanel'].includes(tag) && open?.getText(tree).includes('duplicateTarget')) errors.push(`${relative(root, path)}: 複製で確認・名前の窓を出さない`)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return errors
}

describe('B-177: 全V8画面の行き先の見張り', () => {
  it('↗はhrefで開き、複製の窓を再導入しない', () => {
    expect(targets.flatMap(path => violations(path, readFileSync(path, 'utf8')))).toEqual([])
  })
  it('実際に古い書き方を入れると見張りが落ちる', () => {
    expect(violations('broken.tsx', `const item = { label: '見る', external: true, onSelect: () => router.push('/friends') }; const view = <ConfirmDialog open={duplicateTarget !== null} />`)).toHaveLength(2)
    expect(violations('valid.tsx', `const item = { label: '見る', external: true, href: 'https://example.com' }; const view = <ConfirmDialog open={deleteTarget !== null} />`)).toEqual([])
  })
  it('選ぶ窓の幅640を共通の決まりで守る', () => {
    expect(readFileSync(join(root, 'app/globals.css'), 'utf8')).toContain('--tpl-picker-narrow-width: 640px')
    expect(readFileSync(join(root, 'components/shared/entity-picker.tsx'), 'utf8').match(/widthPreset="picker"/g)).toHaveLength(1)
  })
  it('主要な一覧の外枠を保つ', () => {
    for (const feature of ['auto-replies', 'templates', 'rich-menus', 'forms', 'scenarios']) {
      const source = readFileSync(join(root, 'v8', feature, 'list.tsx'), 'utf8')
      expect(source).toContain('<ListPage')
      expect(source).not.toMatch(/return\s+<><\/>\s*\n?\}/)
    }
  })
  it('選んだ行の詳細はURLで復元できる', () => {
    for (const feature of ['broadcasts', 'auto-replies', 'scenarios', 'webinars', 'forms']) {
      expect(readFileSync(join(root, 'v8', feature, 'list.tsx'), 'utf8')).toContain('useDetailPanelUrl(')
    }
    expect(readFileSync(join(root, 'app/reminders/list-v8.tsx'), 'utf8')).toContain('useDetailPanelUrl(')
  })
})
