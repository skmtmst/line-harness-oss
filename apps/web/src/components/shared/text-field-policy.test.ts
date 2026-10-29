import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { expect, test } from 'vitest'

/** 文字を入れる欄だけを対象にする。ファイル・色・日時・選択の操作は別の部品。 */
function rawTextControls(file: string, source: string): number[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const lines: number[] = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(tree)
      const attr = node.attributes.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText(tree) === 'type')
      const kind = attr ? attr.initializer && ts.isStringLiteral(attr.initializer) ? attr.initializer.text : 'dynamic' : 'text'
      if (tag === 'textarea' || tag === 'input' && ['text', 'email', 'password', 'search', 'number', 'tel', 'url'].includes(kind)) lines.push(tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return lines
}

function screens(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = resolve(dir, entry.name)
    return entry.isDirectory() ? entry.name === 'shared' ? [] : screens(file) : file.endsWith('.tsx') && !file.includes('.test.') ? [file] : []
  })
}

test('文字の入力欄を手書きすると検出し、共通部品へ戻せば通る', () => {
  expect(rawTextControls('fixture.tsx', '<><input /><input type="password" /><textarea /></>')).toHaveLength(3)
  expect(rawTextControls('fixture.tsx', '<><TextField /><TextArea /><input type="file" /><input type="color" /></>')).toEqual([])
})

test('全画面の文字の入力欄は共通部品を通す', () => {
  const files = ['app', 'v8', 'components'].flatMap(dir => screens(resolve('src', dir)))
  const found = files.flatMap(file => rawTextControls(file, readFileSync(file, 'utf8')).map(line => `${file}:${line}`))
  expect(found).toEqual([])
})
