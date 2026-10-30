import ts from 'typescript'

/** Find exclusive FilterChip groups without treating independent boolean chips as exclusive. */
export function singleChoiceFilters(source, file = 'screen.tsx') {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set()
  const chips = []
  const falseFields = new Set()
  const calls = new Map()
  const opposedPredicates = new Map()
  function visit(node) {
    if (ts.isImportDeclaration(node) && /(?:^|\/)filter-chip$/.test(node.moduleSpecifier.text)) {
      if (node.importClause?.name) names.add(node.importClause.name.text)
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && node.right.kind === ts.SyntaxKind.FalseKeyword && ts.isPropertyAccessExpression(node.left)) falseFields.add(node.left.name.text)
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) calls.set(node.expression.text, (calls.get(node.expression.text) ?? 0) + 1)
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && names.has(node.tagName.getText(ast))) {
      const attr = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.text === 'selected')
      const selected = attr?.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : undefined
      if (selected) {
        const refs = []
        function comparisons(n) {
          if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken].includes(n.operatorToken.kind)) refs.push(n.left.getText(ast))
          ts.forEachChild(n, comparisons)
        }
        comparisons(selected)
        let repeated = false
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (ts.isArrowFunction(parent)) {
            if (ts.isCallExpression(parent.parent) && ts.isPropertyAccessExpression(parent.parent.expression) && parent.parent.expression.name.text === 'map') repeated = true
            if (ts.isVariableDeclaration(parent.parent) && ts.isIdentifier(parent.parent.name) && (calls.get(parent.parent.name.text) ?? 0) > 1) repeated = true
          }
          if (ts.isFunctionDeclaration(parent)) break
        }
        chips.push({ node, selected, refs, repeated })
      }
    }
    if (ts.isIfStatement(node) && ts.isBinaryExpression(node.expression) && node.expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const { left, right } = node.expression
      if (ts.isCallExpression(left) && ts.isPropertyAccessExpression(left.expression) && left.expression.name.text === 'includes' && ts.isStringLiteral(left.arguments[0]) && /return\s+false/.test(node.thenStatement.getText(ast))) {
        const negative = ts.isPrefixUnaryExpression(right) && right.operator === ts.SyntaxKind.ExclamationToken
        const predicate = negative ? right.operand.getText(ast) : right.getText(ast)
        const group = `${left.expression.expression.getText(ast)}:${predicate}`
        const entries = opposedPredicates.get(group) ?? []
        entries.push({ negative, selection: left.getText(ast) }); opposedPredicates.set(group, entries)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  // Calls after a helper declaration have not been visited when its JSX is collected.
  for (const chip of chips) for (let parent = chip.node.parent; parent; parent = parent.parent) {
    if (ts.isArrowFunction(parent) && ts.isVariableDeclaration(parent.parent) && ts.isIdentifier(parent.parent.name)
      && (calls.get(parent.parent.name.text) ?? 0) > 1) chip.repeated = true
    if (ts.isFunctionDeclaration(parent)) break
  }
  const frequencies = new Map()
  for (const chip of chips) for (const ref of new Set(chip.refs)) frequencies.set(ref, (frequencies.get(ref) ?? 0) + 1)
  const booleanGroups = new Map()
  for (const chip of chips) if (ts.isPropertyAccessExpression(chip.selected) && falseFields.has(chip.selected.name.text)) {
    const group = chip.selected.expression.getText(ast)
    booleanGroups.set(group, (booleanGroups.get(group) ?? 0) + 1)
  }
  const exclusiveMemberships = new Set([...opposedPredicates.values()].filter(entries => entries.some(x => x.negative) && entries.some(x => !x.negative)).flatMap(entries => entries.map(x => x.selection)))
  return chips.filter(chip => exclusiveMemberships.has(chip.selected.getText(ast)) || chip.refs.some(ref => chip.repeated || (frequencies.get(ref) ?? 0) > 1)
    || (ts.isPropertyAccessExpression(chip.selected) && falseFields.has(chip.selected.name.text)
      && (booleanGroups.get(chip.selected.expression.getText(ast)) ?? 0) > 1))
    .map(chip => ({ file, line: ast.getLineAndCharacterOfPosition(chip.node.getStart(ast)).line + 1,
      selection: chip.selected.getText(ast), reason: 'exclusive-filter-chip' }))
}
