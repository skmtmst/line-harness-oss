import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const walkFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walkFiles(join(dir, entry.name)) : [join(dir, entry.name)])
const files = [...walkFiles(join(root, 'v8')), ...walkFiles(join(root, 'app')).filter((file) => file.endsWith('-v8.tsx'))].filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
// メニューのdisabledReason・画面の読込表示・aria-labelは、実行ボタンの表示文字と役割が違う。
// 「許しています」のような設定値の説明も除外し、処理中の状態を表す文字だけを見る。
const progress = (node: ts.Node): boolean => ts.isParenthesizedExpression(node) ? progress(node.expression) : ts.isStringLiteralLike(node)
  ? /中(?:…|\.{3})|(?:確認|接続|複製し|保存し|書き出し|読み直し|送り直し|止め|再開)ています(?:…|\.{3})?$/.test(node.text)
  : ts.isConditionalExpression(node) && (progress(node.whenTrue) || progress(node.whenFalse))
function violations(source: string, file = 'fixture.tsx'): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const errors: string[] = []
  const check = (node: ts.Node) => {
    if (ts.isConditionalExpression(node) && (progress(node.whenTrue) || progress(node.whenFalse))) {
      let parent: ts.Node | undefined = node.parent
      while (parent && !ts.isJsxElement(parent) && !ts.isJsxSelfClosingElement(parent)) parent = parent.parent
      if (parent && (ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent))) {
        const opening = ts.isJsxElement(parent) ? parent.openingElement : parent
        const attribute = opening.attributes.properties.find((attr) => attr.pos <= node.pos && attr.end >= node.end)
        const isText = !attribute || (ts.isJsxAttribute(attribute) && ['confirmLabel', 'label'].includes(attribute.name.getText(ast)))
        if (isText && ['Button', 'button', 'ConfirmDialog', 'Dialog', 'RowMenu', 'ActionMenu'].includes(opening.tagName.getText(ast))) errors.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1} ${node.getText(ast)}`)
      }
      // RowMenu / ActionMenu は選んだあと閉じる。操作名を切り替えず、disabledReasonで状態を知らせる。
      if (ts.isPropertyAssignment(node.parent) && node.parent.name.getText(ast) === 'label') errors.push(`${file}:label ${node.getText(ast)}`)
    }
    ts.forEachChild(node, check)
  }
  check(ast)
  return errors
}

describe('B-157：処理中の文字は共通Buttonのbusy／busyLabelで出す', () => {
  it('V8全体とappのV8ファイルに手作りの切替が残っていない', () => {
    const found = files.flatMap((file) => violations(readFileSync(file, 'utf8'), relative(root, file)))
    expect(found).toEqual([])
  })
  it.each([
    "<Button>{saving ? '保存中…' : '保存'}</Button>",
    "<Button>{!saving ? '保存' : '保存中…'}</Button>",
    "<button>{busy ? '複製しています' : '複製'}</button>",
    "<ConfirmDialog confirmLabel={busy ? '移動中…' : '移動'} />",
    "<RowMenu items={[{label: busy ? '再送中…' : '再送'}]} />",
  ])('再発を検知する：%s', (source) => { expect(violations(source).length).toBeGreaterThan(0) })
  it('共通のbusyLabelと役割の異なる説明は許す', () => {
    expect(violations("<Button busy={saving} busyLabel={creating ? '作成中…' : '保存中…'}>保存</Button>")).toEqual([])
    expect(violations("<p>{loading ? '読み込み中…' : '完了'}</p>")).toEqual([])
    expect(violations("<button title={active ? '許しています' : '止めています'}>設定</button>")).toEqual([])
  })
})
