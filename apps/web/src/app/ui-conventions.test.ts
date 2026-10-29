import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const V8_ROOT = fileURLToPath(new URL('../v8/', import.meta.url))

function screenSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return screenSources(path)
    return entry.isFile() && /\.tsx?$/.test(path) && !/\.(test|spec)\.tsx?$/.test(path) ? [path] : []
  })
}

/** 文面の固定でなく、禁止する語と JSX の並びを構文で検査する。 */
function violations(text: string): string[] {
  const source = ts.createSourceFile('screen.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const result = new Set<string>()
  const forbidden = /2段階認証|2要素認証|2段階の確認|2段階 オン|分類なし|リマインダー|休けい|（選ばない）|CSV [でを]書き出す/
  const arrows = new Set(['ArrowRight'])
  const buttons = new Set(['Button'])
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        const imported = item.propertyName?.text ?? item.name.text
        if (imported === 'ArrowRight') arrows.add(item.name.text)
        if (imported === 'Button') buttons.add(item.name.text)
      }
    }
    if (statement.importClause?.name && ts.isStringLiteral(statement.moduleSpecifier) && /shared\/button$/.test(statement.moduleSpecifier.text)) {
      buttons.add(statement.importClause.name.text)
    }
  }
  const openingOf = (node: ts.Node) => ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null
  const containsArrow = (node: ts.Node): boolean => {
    const opening = openingOf(node)
    if (opening && arrows.has(opening.tagName.getText(source))) return true
    return ts.forEachChild(node, containsArrow) ?? false
  }
  // 条件分岐や断片の中でも、表示される最初の文字・印を調べる。
  const firstMarks = (node: ts.Node): string[] => {
    if (ts.isJsxText(node)) return node.text.trim() ? ['label'] : []
    if (ts.isJsxExpression(node)) return node.expression ? firstMarks(node.expression) : []
    if (ts.isConditionalExpression(node)) return [...firstMarks(node.whenTrue), ...firstMarks(node.whenFalse)]
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return firstMarks(node.right)
    if (ts.isParenthesizedExpression(node)) return firstMarks(node.expression)
    if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return []
    if (ts.isJsxFragment(node) || ts.isJsxElement(node)) {
      if (ts.isJsxElement(node) && arrows.has(node.openingElement.tagName.getText(source))) return ['arrow']
      for (const child of node.children) {
        const marks = firstMarks(child)
        if (marks.length) return marks
      }
      return []
    }
    if (ts.isJsxSelfClosingElement(node) && arrows.has(node.tagName.getText(source))) return ['arrow']
    return ['label']
  }
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'window.open' && (!node.arguments[1] || (ts.isStringLiteral(node.arguments[1]) && node.arguments[1].text === '_blank'))) result.add('external-mark')
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) && forbidden.test(node.text)) result.add('wording')
    const opening = openingOf(node)
    if (opening) {
      const tag = opening.tagName.getText(source)
      if (tag === 'details' || tag === 'summary') result.add('native-disclosure')
      if (tag === 'a' && opening.attributes.properties.some((attr) => ts.isJsxAttribute(attr) && attr.name.getText(source) === 'target' && attr.initializer?.getText(source).includes('_blank'))) result.add('external-mark')
      if (buttons.has(tag)) {
        const attrs = opening.attributes.properties.filter(ts.isJsxAttribute)
        if (attrs.some((attr) => attr.name.getText(source) === 'icon' && attr.initializer && containsArrow(attr.initializer))) result.add('leading-arrow')
        if (ts.isJsxElement(node)) {
          if (node.children.filter((child) => { const icon = openingOf(child); return icon && arrows.has(icon.tagName.getText(source)) }).length > 1) result.add('duplicate-arrow')
          for (const child of node.children) {
            const marks = firstMarks(child)
            if (marks.includes('arrow')) result.add('leading-arrow')
            if (marks.length) break
          }
        }
        const blank = attrs.some((attr) => attr.name.getText(source) === 'target' && attr.initializer && (
          ts.isStringLiteral(attr.initializer) ? attr.initializer.text === '_blank'
            : ts.isJsxExpression(attr.initializer) && attr.initializer.expression && ts.isStringLiteral(attr.initializer.expression) && attr.initializer.expression.text === '_blank'
        ))
        const flag = (name: string) => attrs.some((attr) => attr.name.getText(source) === name && (!attr.initializer || !(ts.isJsxExpression(attr.initializer) && attr.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword)))
        if (blank && !flag('external') && !flag('download')) result.add('external-mark')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...result].sort()
}

describe('画面の言葉と共通操作の構文検査', () => {
  it('全 V8 画面で禁止表記・先頭矢印・手書き開閉・外部印の抜けを検出する', () => {
    const found = screenSources(V8_ROOT).flatMap((path) => violations(readFileSync(path, 'utf8')).map((rule) => `${path.slice(V8_ROOT.length)}: ${rule}`))
    expect(found).toEqual([])
  })

  it.each([
    ['wording', '<p>2段階の確認を設定する</p>', '<p>二段階認証を設定する</p>'],
    ['wording', 'const label = `リマインダー`', 'const label = `リマインダ`'],
    ['leading-arrow', '<Button onClick={() => save()}><ArrowRight />次へ</Button>', '<Button onClick={() => save()}>次へ<ArrowRight /></Button>'],
    ['leading-arrow', '<Button>{ready ? <><ArrowRight />次へ</> : null}</Button>', '<Button>{ready ? <>次へ<ArrowRight /></> : null}</Button>'],
    ['duplicate-arrow', '<Button>次へ<ArrowRight /><ArrowRight /></Button>', '<Button>次へ<ArrowRight /></Button>'],
    ['leading-arrow', '<Button icon={<ArrowRight />}>次へ</Button>', '<Button>次へ<ArrowRight /></Button>'],
    ['leading-arrow', 'import { ArrowRight as Next } from "lucide-react"; <Button><Next />次へ</Button>', 'import { ArrowRight as Next } from "lucide-react"; <Button>次へ<Next /></Button>'],
    ['native-disclosure', '<details><summary>詳細</summary>本文</details>', '<Disclosure title="詳細">本文</Disclosure>'],
    ['external-mark', 'window.open(url, "_blank")', '<Button href={url} external>下見</Button>'],
    ['external-mark', '<a target={external ? "_blank" : undefined}>下見</a>', '<TextLink external={external}>下見</TextLink>'],
    ['external-mark', '<Button target="_blank" href={url}>下見</Button>', '<Button target="_blank" external href={url}>下見</Button>'],
    ['external-mark', '<Button external={false} target={"_blank"}>下見</Button>', '<Button external target={"_blank"}>下見</Button>'],
  ])('%s の故障を検出し、復元すると通る', (rule, broken, restored) => {
    expect(violations(broken)).toContain(rule)
    expect(violations(restored)).toEqual([])
  })

  it('コメント・コールバック内の大小比較・ダウンロードを誤検出しない', () => {
    expect(violations('/* <Button><ArrowRight />次へ</Button> リマインダー */ <Button download target="_blank" onClick={() => count > 0}>CSVで書き出す</Button>')).toEqual([])
  })
})
