import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import ts from 'typescript'

/*
 * 影の無いカード（線だけの箱・平らな地の箱）を増やさない。
 * カードは白い地に影だけ（決まり）。共通の Card を影の無い形（frame の flat・ring・inset、
 * surface の inset・bordered）で使うファイルを探し、下の「直す途中」に無いファイルで出たら落とす。
 * muted は通常Cardの内側と証明できる面だけ認める。証明できない外側・持ち出しは従来どおり落とす。
 * 直し終えたファイルは一覧から外す（足さない）。カードそのものの形を影ありにそろえるのは Card の持ち主（tone）。
 */
const migrating = new Set([
  'app/analytics/reports/new/page.tsx',
  'components/accounts/account-ordering.tsx',
  'components/shared/condition-builder.tsx',
  'components/shared/recovery-code-list.tsx',
  'components/shared/reservation-board.tsx',
  'v8/account-new/register.tsx',
  'v8/account-new/step1-precheck.tsx',
  'v8/account-new/step2-connect.tsx',
  'v8/account-new/step4-template.tsx',
  'v8/account-new/step5-completion.tsx',
  'v8/accounts-detail/detail.tsx',
  'v8/accounts-detail/handover.tsx',
  'v8/affiliate-offer-new/create.tsx',
  'v8/automations/templates.tsx',
  'v8/booking-bookings/day-frame.tsx',
  'v8/booking-bookings/day-list.tsx',
  'v8/booking-menus/photos.tsx',
  'v8/contents/list-media-card.tsx',
  'v8/emergency/control.tsx',
  'v8/events/create.tsx',
  'v8/hq-banners/list.tsx',
  'v8/hq/home.tsx',
  'v8/login/recovery-codes.tsx',
  'v8/login/two-factor-ops.tsx',
  'v8/mileage/reward-edit.tsx',
  'v8/nen-pets/feeding.tsx',
  'v8/notifications/list.tsx',
  'v8/onboarding/style-choice-step.tsx',
  'v8/onboarding/wizard.tsx',
  'v8/restaurant-reservations/detail-dialog.tsx',
  'v8/restaurant/approvals/approvals.tsx',
  'v8/restaurant/booking-kit/shell.tsx',
  'v8/restaurant/inventory/stock.tsx',
  'v8/restaurant/organization/organization-forms.tsx',
  'v8/restaurant/reservations/list.tsx',
  'v8/rich-menus/connections.tsx',
  'v8/settings/emergency/security-monitor.tsx',
  'v8/settings/pools/create.tsx',
  'v8/settings/pools/pools.tsx',
  'v8/settings/staff/create.tsx',
  'v8/settings/staff/mfa-policy.tsx',
  'v8/tags/create.tsx',
  'v8/webhooks/create.tsx',
])

/** 同じファイルで通常のCardの中と証明できるmuted面だけを認める。 */
function hasFlatCard(source: string): boolean {
  if (!/\b(?:flat|ring|inset|bordered|muted)\b/.test(source)) return false
  const file = ts.createSourceFile('view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, jsx: ts.JsxEmit.Preserve }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = name => name === file.fileName ? file : undefined
  const program = ts.createProgram([file.fileName], options, host)
  if (program.getSyntacticDiagnostics(file).length) return true
  const checker = program.getTypeChecker()
  const nodes: ts.Node[] = []
  const visit = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, visit) }
  visit(file)
  const symbol = (node: ts.Identifier) => ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent)
    : ts.isExportSpecifier(node.parent) ? checker.getExportSpecifierLocalTargetSymbol(node.parent) : checker.getSymbolAtLocation(node)
  const cardSymbols = new Set(nodes.filter(ts.isImportDeclaration)
    .filter(node => !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier) && /(?:^|\/)card(?:\.tsx?)?$/.test(node.moduleSpecifier.text))
    .map(node => node.importClause?.name).filter((name): name is ts.Identifier => Boolean(name)).map(symbol).filter((value): value is ts.Symbol => Boolean(value)))
  const cardTag = (node: ts.Node, seen = new Set<ts.Symbol>()): boolean => {
    if (!ts.isIdentifier(node)) return false
    const binding = symbol(node)
    if (node.text === 'Card' || (binding && cardSymbols.has(binding))) return true
    if (!binding || seen.has(binding)) return false
    seen.add(binding)
    return Boolean(binding.declarations?.some(declaration => ts.isVariableDeclaration(declaration)
      && declaration.initializer && cardTag(declaration.initializer, seen)))
  }
  const provenCard = (node: ts.Node, seen = new Set<ts.Symbol>()): boolean => {
    if (!ts.isIdentifier(node)) return false
    const binding = symbol(node)
    if (!binding || seen.has(binding)) return false
    if (cardSymbols.has(binding)) return true
    seen.add(binding)
    return Boolean(binding.declarations?.some(declaration => ts.isVariableDeclaration(declaration)
      && (declaration.parent.flags & ts.NodeFlags.Const) !== 0
      && declaration.initializer && provenCard(declaration.initializer, seen)))
  }
  type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement
  const literal = (attr: ts.JsxAttribute) => {
    const value = attr.initializer
    if (value && ts.isStringLiteral(value)) return value.text
    if (value && ts.isJsxExpression(value) && value.expression && ts.isStringLiteral(value.expression)) return value.expression.text
    return null
  }
  const props = (node: Opening, key: string) => node.attributes.properties.filter(ts.isJsxAttribute).filter(attr => attr.name.getText(file) === key)
  const hasSpread = (node: Opening) => node.attributes.properties.some(ts.isJsxSpreadAttribute)
  const normal = (node: Opening) => provenCard(node.tagName) && !hasSpread(node) && ['frame', 'surface'].every(key => {
    const attrs = props(node, key)
    return !attrs.length || (attrs.length === 1 && literal(attrs[0]) === (key === 'frame' ? 'raised' : 'standard'))
  })
  const functionNode = (node: ts.Node) => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
  const mapCall = (node: ts.Node): node is ts.CallExpression => ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map'
  const mapCallback = (node: ts.Node) => (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && mapCall(node.parent) && node.parent.arguments[0] === node
  const opaque = (node: ts.Node) => ts.isJsxAttribute(node) || ts.isVariableDeclaration(node)
    || ts.isPropertyAssignment(node) || ts.isTaggedTemplateExpression(node)
    || (ts.isCallExpression(node) && !mapCall(node))
    || (ts.isJsxElement(node) && !provenCard(node.openingElement.tagName)
      && !(ts.isIdentifier(node.openingElement.tagName) && /^[a-z]/.test(node.openingElement.tagName.text)))
  const element = (node: Opening) => ts.isJsxOpeningElement(node) ? node.parent : node
  const underNormal = (node: Opening) => {
    for (let parent = element(node).parent; parent; parent = parent.parent) {
      if (opaque(parent) || (functionNode(parent) && !mapCallback(parent))) return false
      if (ts.isJsxElement(parent) && normal(parent.openingElement)) return true
    }
    return false
  }
  const localOwner = (node: Opening): ts.FunctionDeclaration | undefined => {
    let returned = false
    for (let parent = element(node).parent; parent; parent = parent.parent) {
      if (ts.isReturnStatement(parent)) returned = true
      if (ts.isFunctionDeclaration(parent)) {
        return returned && parent.parent === file && parent.name
          && !parent.modifiers?.some(mod => [ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.DefaultKeyword, ts.SyntaxKind.AsyncKeyword].includes(mod.kind))
          ? parent : undefined
      }
      if (opaque(parent) || (functionNode(parent) && !mapCallback(parent))) return undefined
    }
    return undefined
  }
  const localUsesInside = (owner: ts.FunctionDeclaration) => {
    if (!owner.name) return false
    const ownerSymbol = symbol(owner.name)
    if (!ownerSymbol) return false
    const uses = nodes.filter(ts.isIdentifier).filter(node => node !== owner.name && symbol(node) === ownerSymbol)
    const openings: Opening[] = []
    for (const use of uses) {
      const parent = use.parent
      if (ts.isJsxClosingElement(parent) && parent.tagName === use) continue
      if ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) && parent.tagName === use) openings.push(parent)
      else return false
    }
    return openings.length > 0 && openings.every(underNormal)
  }
  return nodes.some(node => {
    if (!(ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) || !cardTag(node.tagName)) return false
    if (props(node, 'frame').some(attr => ['flat', 'ring', 'inset'].includes(literal(attr) ?? ''))
      || props(node, 'surface').some(attr => ['inset', 'bordered'].includes(literal(attr) ?? ''))) return true
    if (!props(node, 'surface').some(attr => literal(attr) === 'muted')) return false
    if (!provenCard(node.tagName) || hasSpread(node) || props(node, 'surface').length !== 1
      || props(node, 'frame').length > 1 || props(node, 'frame').some(attr => literal(attr) !== 'raised')) return true
    if (underNormal(node)) return false
    const owner = localOwner(node)
    return !owner || !localUsesInside(owner)
  })
}

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FILES: Array<{ p: string; s: string }> = []
const walk = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.tsx') && !e.name.includes('.test.')) FILES.push({ p: relative(SRC, p), s: readFileSync(p, 'utf8') })
  }
}
walk(SRC)

it('直す途中のファイルの外で、影の無いカードを使わない', () => {
  const hits = FILES.filter((f) => !migrating.has(f.p) && hasFlatCard(f.s)).map((f) => f.p)
  expect(hits, '共通の Card を影ありの形（frame・surface を付けない）で使う').toEqual([])
})

it.each([
  ['通常のCard', '<Card variant="aside">本文</Card>'],
  ['内側の薄い面', '<Card><Card surface="muted" /></Card>'],
  ['通常を明示した親', '<Card frame="raised" surface="standard"><div><Card surface={"muted"} /></div></Card>'],
  ['薄い面の入れ子', '<Card><Card surface="muted"><Card surface="muted" /></Card></Card>'],
  ['局所関数の全使用が内側', 'function Variant(){return <Card surface="muted" />} const view=<Card><Variant/><Variant/></Card>'],
  ['局所関数のmap表示', 'function Variant(){return <Card surface="muted" />} const view=<Card>{items.map(item=><Variant key={item}/>)}</Card>'],
  ['import名を変えても入れ子を確認', 'import Panel from "@/components/shared/card"; const view=<Panel><Panel surface="muted"/></Panel>'],
])('%sは外側の影を保つ', (_, source) => {
  expect(hasFlatCard(`import Card from "@/components/shared/card"; ${source}`)).toBe(false)
})

it.each([
  ['外側の薄い面', '<Card surface="muted" padding="compact">本文</Card>'],
  ['内側でもflat', '<Card><Card frame="flat" /></Card>'],
  ['内側でもring', '<Card><Card frame="ring" /></Card>'],
  ['内側でもframe inset', '<Card><Card frame="inset" /></Card>'],
  ['内側でもsurface inset', '<Card><Card surface="inset" /></Card>'],
  ['内側でもbordered', '<Card><Card surface="bordered" /></Card>'],
  ['外側での使用が混ざる', 'function Variant(){return <Card surface="muted" />} const view=<><Card><Variant/></Card><Variant/></>'],
  ['未使用の局所関数', 'function Variant(){return <Card surface="muted" />}'],
  ['export関数', 'export function Variant(){return <Card surface="muted" />} const view=<Card><Variant/></Card>'],
  ['別のexport文', 'function Variant(){return <Card surface="muted" />} export {Variant}; const view=<Card><Variant/></Card>'],
  ['別名への持ち出し', 'function Variant(){return <Card surface="muted" />} const Alias=Variant; const view=<Card><Alias/></Card>'],
  ['値として渡す', 'function Variant(){return <Card surface="muted" />} const view=<Card>{items.map(Variant)}</Card>'],
  ['同名の引数は元の関数の使用にならない', 'function Variant(){return <Card surface="muted" />} function View(Variant:any){return <Card><Variant/></Card>}'],
  ['通常の親か不明', '<Card frame={mode}><Card surface="muted" /></Card>'],
  ['親のsurfaceが不明', '<Card surface={mode}><Card surface="muted" /></Card>'],
  ['親のspreadが不明', '<Card {...props}><Card surface="muted" /></Card>'],
  ['内側のspreadが不明', '<Card><Card {...props} surface="muted" /></Card>'],
  ['外側のflatは残る', '<Card frame="flat"><Card surface="muted" /></Card>'],
  ['属性へ渡す', 'function Variant(){return <Card surface="muted" />} const view=<Card action={<Variant/>}/>'],
  ['任意のcomponent経由', 'function Variant(){return <Card surface="muted" />} const view=<Card><Portal><Variant/></Portal></Card>'],
  ['portal呼び出し経由', 'function Variant(){return <Card surface="muted" />} const view=<Card>{createPortal(<Variant/>,target)}</Card>'],
  ['helper内部のportal', 'function Variant(){return createPortal(<Card surface="muted"/>,target)} const view=<Card><Variant/></Card>'],
  ['呼び出しで渡す', 'function Variant(){return <Card surface="muted" />} const view=<Card>{Variant()}</Card>'],
  ['描画か不明な関数を渡す', 'function Variant(){return <Card surface="muted" />} const view=<Card>{()=> <Variant/>}</Card>'],
  ['証明対象外の関数式', 'const Variant=()=> <Card surface="muted"/>; const view=<Card><Variant/></Card>'],
  ['import名を変えても外側は拒否', 'import Panel from "@/components/shared/card"; const view=<Panel surface="muted"/>'],
  ['変数aliasでも外側は拒否', 'const Panel=Card; const view=<Panel surface="muted"/>'],
  ['内側のframeが不明', '<Card><Card frame={mode} surface="muted" /></Card>'],
  ['同名Cardの引数は通常Cardと証明できない', 'function View(Card:any){return <Card><Card surface="muted"/></Card>}'],
  ['可変aliasは通常の親と証明できない', 'let Panel=Card; const view=<Panel><Card surface="muted"/></Panel>'],
  ['解析できない構文', '<Card surface="muted"'],
])('%sは例外にしない', (_, source) => {
  expect(hasFlatCard(`import Card from "@/components/shared/card"; ${source}`)).toBe(true)
})
