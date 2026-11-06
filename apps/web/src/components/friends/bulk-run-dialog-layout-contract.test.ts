import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const CSS = readFileSync(join(__dirname, 'bulk-run-dialog.module.css'), 'utf8')
const DIALOG = readFileSync(join(__dirname, 'bulk-run-dialog.tsx'), 'utf8')

describe('V8 一括操作の小窓（CYJ0L）', () => {
  it('外側・フォーカス・画面内への収まりは共通Dialogを使う', () => {
    const source = ts.createSourceFile('bulk-run-dialog.tsx', DIALOG, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const dialogImport = source.statements.find((node): node is ts.ImportDeclaration => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === '@/components/shared/dialog')
    expect(dialogImport?.importClause?.name?.text).toBe('Dialog')
    const bindings = dialogImport?.importClause?.namedBindings
    expect(bindings && ts.isNamedImports(bindings) ? bindings.elements.map((item) => item.name.text) : []).toContain('DialogActions')
    expect(DIALOG).toContain('<Dialog open={open}')
    expect(DIALOG).toContain('busy={busy} footer={footer}')
    expect(CSS).not.toContain('position: fixed')
    expect(CSS).not.toContain('left: 256px')
  })
  it('操作カードは最小幅で表を押し広げず、狭い幅で列を減らす', () => {
    expect(CSS).toContain('repeat(3, minmax(0, 1fr))')
    expect(CSS).toContain('repeat(auto-fit, minmax(180px, 1fr))')
  })
})
