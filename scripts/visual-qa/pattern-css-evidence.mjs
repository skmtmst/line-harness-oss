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
              if (ts.isJsxExpression(child) && child.parent && (ts.isJsxElement(child.parent) || ts.isJsxFragment(child.parent)) && child.expression && !ts.isJsxElement(child.expression) && !ts.isJsxSelfClosingElement(child.expression) && !ts.isStringLiteral(child.expression) && !ts.isNumericLiteral(child.expression)) unknownChildren = true
              ts.forEachChild(child, collect)
            }
            collect(ts.isJsxOpeningElement(opening) ? opening.parent : opening)
            evidence = { native: native(opening.tagName.getText(tree)), nativeTree: !unknownChildren && tags.every(native) }
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
  if (!uses || /:global\(/.test(selector)) return false
  return selector.split(',').every(part => {
    // Only simple compounds/combinators are proven. Keep :has/:is and unknown syntax.
    if (/:has\(|:is\(|:where\(|:not\(/.test(part)) return false
    const classes = [...part.matchAll(/\.([\w-]+)/g)]
    const last = classes.at(-1)
    if (!last) return false
    const evidence = uses.get(last[1])
    if (!evidence?.length) return false
    const tail = part.slice(last.index + last[0].length).replace(/\[[^\]]*\]/g, '').replace(/::?[\w-]+/g, '').trim()
    return evidence.every(item => tail ? item.nativeTree : item.native)
  })
}
