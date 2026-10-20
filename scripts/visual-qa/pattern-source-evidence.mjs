import ts from 'typescript'
import { createHash } from 'node:crypto'

const printer = ts.createPrinter({ removeComments: true })
const digest = value => createHash('sha256').update(value).digest('hex')
const trees = new Map()
const visualProps = new Set(['className', 'style', 'variant', 'tone', 'size', 'appearance', 'presentation', 'density', 'role', 'aria-modal', 'aria-pressed'])

/** 検索に当たった文字が、JSX・コメント・単なる検索文字列のどれかを調べる。 */
export function sourceEvidence(file, source, offset, length = 1) {
  if (file.endsWith('.css')) return null
  let entry = trees.get(file)
  if (!entry || entry.source !== source) {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const comments = []
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, source)
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
      if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) comments.push([scanner.getTokenPos(), scanner.getTextPos()])
    }
    const imports = {}
    for (const node of tree.statements) {
      if (!ts.isImportDeclaration(node) || !node.importClause || !ts.isStringLiteral(node.moduleSpecifier)) continue
      const path = node.moduleSpecifier.text
      if (node.importClause.name) imports[node.importClause.name.text] = { path, name: 'default' }
      if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const binding of node.importClause.namedBindings.elements) imports[binding.name.text] = { path, name: binding.propertyName?.text ?? binding.name.text }
      }
    }
    entry = { source, tree, comments, imports, printed: new WeakMap(), hashes: new WeakMap(), shapes: new WeakMap() }
    trees.set(file, entry)
  }
  if (entry.comments.some(([start, end]) => (offset >= start && offset < end) || (offset + length - 1 >= start && offset + length - 1 < end))) return { comment: true }
  const parents = []
  const walk = node => {
    if (offset < node.getStart(entry.tree) || offset >= node.end) return
    parents.push(node)
    ts.forEachChild(node, walk)
  }
  walk(entry.tree)
  const jsx = parents.findLast(node => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))
  const attribute = parents.findLast(ts.isJsxAttribute)
  const literal = parents.findLast(ts.isStringLiteral)
  const opening = jsx && (ts.isJsxElement(jsx) ? jsx.openingElement : jsx)
  const nearest = jsx ?? parents.findLast(node => ts.isStatement(node) && !ts.isBlock(node))
  const print = node => {
    if (!entry.printed.has(node)) entry.printed.set(node, printer.printNode(ts.EmitHint.Unspecified, node, entry.tree).replace(/\s+/g, ' ').trim())
    return entry.printed.get(node)
  }
  const shapeProps = opening?.attributes.properties.filter(node => ts.isJsxAttribute(node) && ['className', 'style', 'role', 'aria-modal', 'aria-pressed'].includes(node.name.getText(entry.tree))) ?? []
  const accessibleName = opening?.attributes.properties.find(node => ts.isJsxAttribute(node) && ['aria-label', 'aria-labelledby'].includes(node.name.getText(entry.tree)))
  const dialogIdentity = accessibleName ? digest(JSON.stringify([opening.tagName.getText(entry.tree), print(accessibleName)])) : undefined
  const descendantTags = []
  if (jsx) { const descendants = node => { if (node !== jsx && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))) descendantTags.push((ts.isJsxElement(node) ? node.openingElement : node).tagName.getText(entry.tree)); ts.forEachChild(node, descendants) }; descendants(jsx) }
  const shape = opening && JSON.stringify([opening.tagName.getText(entry.tree), shapeProps.map(print)])
  const declaration = parents.findLast(ts.isVariableDeclaration)
    ?? parents.findLast(ts.isVariableStatement)?.declarationList.declarations.find(node => node.getStart(entry.tree) < offset + length && node.end > offset)
  const initializer = declaration?.initializer
  // A nested boolean named *Preview is not the JSX returned by its parent screen.
  let declarationReturnsJsx
  if (initializer) {
    declarationReturnsJsx = false
    const inspect = node => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) declarationReturnsJsx = true
      else ts.forEachChild(node, inspect)
    }
    inspect(initializer)
  }
  const functionNode = initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) ? initializer : parents.findLast(node => ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))
  let returnsJsx = false
  const returnTags = []
  const rootTag = node => {
    while (node && ts.isParenthesizedExpression(node)) node = node.expression
    if (node && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))) return (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText(entry.tree)
  }
  const returns = node => {
    if (ts.isReturnStatement(node)) { const tag = rootTag(node.expression); if (tag) returnTags.push(tag) }
    else if (node !== functionNode && (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))) return
    ts.forEachChild(node, returns)
  }
  const visit = node => { if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) returnsJsx = true; else ts.forEachChild(node, visit) }
  if (functionNode) {
    visit(functionNode)
    returns(functionNode)
    if (ts.isArrowFunction(functionNode)) { const tag = rootTag(functionNode.body); if (tag) returnTags.push(tag) }
  }
  // 分割された宣言・JSX全体を一対一で照合する。候補だけの短い語は証拠にしない。
  const unitParents = [...parents, ...(functionNode ? [functionNode] : []), ...(parents.findLast(ts.isVariableStatement)?.declarationList.declarations ?? [])]
  const units = unitParents.filter(node => ts.isVariableDeclaration(node) || ts.isJsxFragment(node) || ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))
    .map(node => {
      if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body) {
        node = node.body
        if (ts.isBlock(node) && node.statements.length === 1 && ts.isReturnStatement(node.statements[0])) node = node.statements[0].expression ?? node
        while (ts.isParenthesizedExpression(node)) node = node.expression
      }
      return node
    })
    .map(node => {
      if (!entry.hashes.has(node)) { const text = print(node); entry.hashes.set(node, (ts.isVariableDeclaration(node) || text.length >= 80) ? digest(text) : null) }
      return entry.hashes.get(node)
    }).filter(Boolean)
  // 名前付きの同じ外枠は、中の共通部品を交換しても移動元と一対一で照合する。
  // class/style/属性を含めて比べるので、新しい枠・上書き・複製は候補に残る。
  if (opening && accessibleName) units.push(`opening:${digest(print(opening))}`)
  // 動きのpropsを追加しただけの同じ形も、ファイル分割の前後で照合する。
  // 見た目のpropsと本文・子の構造は残す。CSSの値は別のidentityで必ず比較する。
  for (const node of parents.filter(node => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))) {
    if (!entry.hashes.has(node)) continue
    if (!entry.shapes.has(node)) {
      const result = ts.transform(node, [context => {
        const visit = child => {
          if (ts.isJsxAttribute(child) && !visualProps.has(child.name.getText(entry.tree))) return ts.factory.updateJsxAttribute(child, child.name, undefined)
          return ts.visitEachChild(child, visit, context)
        }
        return child => ts.visitNode(child, visit)
      }])
      const text = print(result.transformed[0])
      // roleだけ・短いタグの一致を移動の根拠にはしない。
      entry.shapes.set(node, text.length >= 40 ? `shape:${digest(text)}` : null)
      result.dispose()
    }
    const hash = entry.shapes.get(node)
    if (hash) units.push(hash)
  }
  return {
    comment: false,
    searchString: Boolean(literal && (!attribute || (literal !== attribute.initializer && !(ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression === literal)))),
    tag: opening?.tagName.getText(entry.tree),
    emptyElement: Boolean(jsx && (ts.isJsxSelfClosingElement(jsx) || jsx.children.every(child => ts.isJsxText(child) && !child.text.trim()))),
    attribute: attribute?.name.getText(entry.tree),
    literalAttribute: Boolean(literal && attribute && (attribute.initializer === literal || (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression === literal))),
    literalProperty: literal && ts.isPropertyAssignment(literal.parent) ? literal.parent.name.getText(entry.tree) : undefined,
    imports: entry.imports,
    calls: parents.filter(ts.isCallExpression).map(node => node.expression.getText(entry.tree)),
    ancestorTags: parents.filter(node => ts.isJsxElement(node)).map(node => node.openingElement.tagName.getText(entry.tree)),
    enclosingTags: parents.filter(node => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)).map(node => (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText(entry.tree)),
    visualPropCount: shapeProps.length,
    shapeIdentity: shape && digest(shape),
    dialogIdentity,
    jsxStart: jsx?.getStart(entry.tree),
    descendantTags,
    readOnlyText: Boolean(jsx && !attribute && ['p', 'span', 'HelpTip', 'GridCell'].includes(opening?.tagName.getText(entry.tree))
      && descendantTags.every(tag => ['span', 'strong', 'em', 'br', 'Info'].includes(tag))
      && (['p', 'span'].includes(opening.tagName.getText(entry.tree))
        || entry.imports[opening.tagName.getText(entry.tree)]?.path === '@/components/shared/help-tip'
        || entry.imports[opening.tagName.getText(entry.tree)]?.path === '@/components/shared/grid-table')),

    returnsJsx,
    declarationReturnsJsx,
    returnTags,
    payloadType: Boolean(literal && ts.isPropertyAssignment(literal.parent) && literal.parent.name.getText(entry.tree) === 'type' && ts.isObjectLiteralExpression(literal.parent.parent) && literal.parent.parent.properties.some(node => ts.isPropertyAssignment(node) && node.name.getText(entry.tree) === 'uri')),
    identity: nearest ? digest(print(nearest)) : undefined,
    units,
  }
}

export function clearSourceEvidence() { trees.clear() }
