import ts from 'typescript'
import { dirname, resolve } from 'node:path'

/** Resolve CSS-module consumers once; unknown selectors remain candidates. */
export function cssConsumerIndex(files, read, codeRoot) {
  const index = new Map()
  for (const file of files.filter(file => file.endsWith('.tsx'))) {
    const source = read(file)
    const imports = [...source.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.css)['"]/g)]
    if (!imports.length) continue
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const icons = new Set()
    for (const node of tree.statements) {
      if (!ts.isImportDeclaration(node) || node.moduleSpecifier.text !== 'lucide-react') continue
      for (const item of node.importClause?.namedBindings?.elements ?? []) icons.add(item.name.text)
    }
    const initializers = new Map()
    const declarations = node => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) initializers.set(node.name.text, node.initializer); ts.forEachChild(node, declarations) }
    declarations(tree)
    const unbox = node => { while (node && (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression; return node }
    const scalar = node => node && (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind))
    const scalarMapBinding = node => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (!ts.isArrowFunction(parent) || !parent.parameters.some(param => param.name.getText(tree) === node.getText(tree))) continue
        const call = parent.parent
        if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'map') return false
        const receiver = call.expression.expression
        const array = unbox(ts.isIdentifier(receiver) ? initializers.get(receiver.text) : receiver)
        return Boolean(array && ts.isArrayLiteralExpression(array) && array.elements.every(scalar))
      }
      return false
    }
    const knownExpression = expr => scalar(expr) || (ts.isIdentifier(expr) && scalarMapBinding(expr))
      || ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr)
      || (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && expr.expression.name.text === 'map'
        && expr.arguments.some(arg => ts.isArrowFunction(arg) && (ts.isJsxElement(unbox(arg.body)) || ts.isJsxSelfClosingElement(unbox(arg.body)))))
    for (const [, alias, path] of imports) {
      const css = path.startsWith('@/') ? resolve(codeRoot, 'apps/web/src', path.slice(2)) : resolve(dirname(file), path)
      const uses = index.get(css) ?? new Map()
      const native = tag => /^[a-z][\w-]*$/.test(tag) || icons.has(tag)
      const visit = node => {
        let className
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === alias) className = node.name.text
        if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === alias && ts.isStringLiteral(node.argumentExpression)) className = node.argumentExpression.text
        if (className) {
          // Every reference must be proven: aliases/variables/spreads remain unknown.
          let attr = node.parent
          while (attr && !ts.isJsxAttribute(attr) && !ts.isSourceFile(attr)) attr = attr.parent
          const opening = attr && ts.isJsxAttribute(attr) && attr.name.text === 'className' ? attr.parent.parent : null
          let evidence = { native: false, nativeTree: false }
          if (opening && (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening))) {
            const tags = []
            let unknownChildren = false
            const collect = child => {
              if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) tags.push((ts.isJsxElement(child) ? child.openingElement : child).tagName.getText(tree))
              // Dynamic children may render shared components outside this syntax tree.
              if (ts.isJsxExpression(child) && child.parent && (ts.isJsxElement(child.parent) || ts.isJsxFragment(child.parent)) && child.expression && !knownExpression(child.expression)) unknownChildren = true
              ts.forEachChild(child, collect)
            }
            collect(ts.isJsxOpeningElement(opening) ? opening.parent : opening)
            let hidden = false
            for (let parent = opening; parent; parent = parent.parent) {
              const element = ts.isJsxElement(parent) ? parent.openingElement : parent
              if ((ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) && element.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(tree) === 'aria-hidden' && attr.initializer && ['"true"', '{true}'].includes(attr.initializer.getText(tree)))) hidden = true
            }
            const attrs = opening.attributes.properties
            const style = attrs.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(tree) === 'style')
            const coords = style && ts.isJsxExpression(style.initializer) && style.initializer.expression && ts.isObjectLiteralExpression(style.initializer.expression)
              ? style.initializer.expression.properties.filter(ts.isPropertyAssignment).map(prop => prop.name.getText(tree)) : []
            const coordinateOverlay = hidden && ['span', 'div'].includes(opening.tagName.getText(tree)) && ['left', 'top', 'width', 'height'].every(key => coords.includes(key))
              && !attrs.some(attr => ts.isJsxSpreadAttribute(attr) || ts.isJsxAttribute(attr) && /^on[A-Z]|^role$|^tabIndex$/.test(attr.name.getText(tree)))
            const children = ts.isJsxOpeningElement(opening) ? opening.parent.children : []
            const directNative = children.every(child => ts.isJsxText(child) || (ts.isJsxExpression(child) ? !child.expression || scalar(child.expression) : (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) && native((ts.isJsxElement(child) ? child.openingElement : child).tagName.getText(tree))))
            evidence = { native: native(opening.tagName.getText(tree)), nativeTree: !unknownChildren && tags.every(native), directNative, coordinateOverlay }
          }
          const previous = uses.get(className) ?? []
          previous.push(evidence)
          uses.set(className, previous)
        }
        ts.forEachChild(node, visit)
      }
      visit(tree)
      index.set(css, uses)
    }
  }
  return index
}

/** Local native elements own their state styles; shared/unknown targets stay guarded. */
export function selectorTargetsNative(selector, uses) {
  if (!uses || /:global\b/.test(selector)) return false
  return selector.split(',').every(part => {
    // Only simple compounds/combinators are proven. Keep :has/:is and unknown syntax.
    if (/:has\(|:is\(|:where\(|:not\(/.test(part)) return false
    const classes = [...part.matchAll(/\.([\w-]+)/g)]
    const last = classes.at(-1)
    if (!last) return false
    const evidence = uses.get(last[1])
    if (!evidence?.length) return false
    const tail = part.slice(last.index + last[0].length).replace(/\[[^\]]*\]/g, '').replace(/::?[\w-]+/g, '').trim()
    return evidence.every(item => /^>\s*svg$/.test(tail) ? item.directNative : tail ? item.nativeTree : item.native)
  })
}

/** 座標で重ねる読み取り専用の領域線は、ファイルを受ける入力欄ではない。 */
export function selectorIsCoordinateOverlay(selector, uses) {
  const match = selector.trim().match(/^\.([\w-]+)$/)
  const evidence = match && uses?.get(match[1])
  return Boolean(evidence?.length && evidence.every(item => item.coordinateOverlay))
}
