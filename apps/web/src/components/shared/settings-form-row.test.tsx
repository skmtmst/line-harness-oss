import { readUiSource } from '../../../scripts/test-ui-source.mjs'
// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { SettingsFormRow } from './settings-form-card'
afterEach(cleanup)
it('名前とフォルダは共通の2列。通常の横並びと郵便番号の幅を変えない', () => {
  const { container } = render(<><SettingsFormRow layout="name-folder"><div>名前</div><div>フォルダ</div></SettingsFormRow><SettingsFormRow postal><div>郵便番号</div></SettingsFormRow></>)
  expect(container.querySelectorAll('[data-form-row="name-folder"]')).toHaveLength(1)
  const css = readFileSync(`${__dirname}/settings-form-card.module.css`, 'utf8')
  expect(css).toMatch(/\.nameFolderRow\s*\{[^}]*grid-template-columns:\s*minmax\(0, 2fr\) minmax\(0, 1fr\)/)
  expect(css).toMatch(/\.nameFolderRow\s*\{[^}]*gap:\s*var\(--polish-space-field\)/)
  expect(css).toMatch(/@media \(max-width: 640px\).*\.nameFolderRow.*grid-template-columns:\s*minmax\(0, 1fr\)/)
  expect(css).toMatch(/@container v8-page \(width < 1100px\).*\.nameFolderRow.*grid-template-columns:\s*minmax\(0, 1fr\)/)
  expect(css).toContain('.postalRow > :first-child')
})
it('同じ並びの3つの画面は共通の行へ、フォルダは行の全幅へ渡す', () => {
  for (const file of ['src/v8/auto-replies/edit/wizard.tsx', 'src/v8/friend-add/editor.tsx', 'src/v8/reminders/basics-form.tsx']) {
    const source = readUiSource(file, 'utf8')
    expect(source).toContain('<SettingsFormRow layout="name-folder">')
    expect(source).not.toContain('className={styles.fieldPair}')
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const folders: ts.JsxAttributes[] = []
    const visit = (node: ts.Node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(tree) === 'FolderSelect') folders.push(node.attributes)
      ts.forEachChild(node, visit)
    }
    visit(tree)
    expect(folders.length).toBeGreaterThan(0)
    for (const attributes of folders) {
      const size = attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(tree) === 'size') as ts.JsxAttribute | undefined
      expect(size?.initializer && ts.isStringLiteral(size.initializer) ? size.initializer.text : undefined).toBe('full')
    }
  }
})

it('画像と小さい欄を並べる任意の行は、既存の既定・2列の行と独立する', () => {
 const {container}=render(<><SettingsFormRow data-testid="default"><span>既定</span></SettingsFormRow><SettingsFormRow layout="columns"><span>列</span></SettingsFormRow><SettingsFormRow layout="media-fields"><span>画像</span><span>入力</span></SettingsFormRow><SettingsFormRow layout="compact"><span>小さい欄</span></SettingsFormRow></>)
 expect(container.querySelector('[data-testid="default"]')?.getAttribute('data-form-row')).toBeNull()
 expect(container.querySelector('[data-form-row="columns"]')?.getAttribute('data-form-columns')).toBe('2')
 expect(container.querySelectorAll('[data-form-row="media-fields"]')).toHaveLength(1)
 expect(container.querySelectorAll('[data-form-row="compact"]')).toHaveLength(1)
})
