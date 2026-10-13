import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const INITIAL_SHA = '8e57d715cd73e2e4172a42411c9f9054cf8dd631'
export const BASELINE_PATH = 'apps/web/scripts/v8-guard/code-size-baseline.json'
export const MAX_LINES = 400
// No filename or source comment can declare new generated-code exemptions.
const GENERATED = new Set([])
export const isBodyFile = path => /\.tsx?$/.test(path) && !GENERATED.has(path)
  && !/\.(?:test|spec|d)\.[cm]?tsx?$/.test(path)
  && !/(?:^|\/)(?:test|tests|__tests__|test-utils|fixtures|__fixtures__)(?:\/|$)/.test(path)
export const lineCount = source => source ? source.replace(/\r\n?/g, '\n').split('\n').length - (/[\r\n]$/.test(source) ? 1 : 0) : 0
export function isBodySource(path, source) {
  if (!isBodyFile(path)) return false
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false)
  if (sf.parseDiagnostics.length) return true
  return !sf.statements.length || !sf.statements.every(node =>
    ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEmptyStatement(node)
    || ts.isImportDeclaration(node) && node.importClause?.isTypeOnly
    || ts.isExportDeclaration(node) && node.isTypeOnly
    || node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword))
}
export const initialLimits = files => Object.fromEntries([...files].filter(([path, source]) => isBodySource(path, source) && lineCount(source) > MAX_LINES).map(([path, source]) => [path, lineCount(source)]))
export function lowerLimits(files, baseline) {
  const entries = Object.entries(baseline.files).flatMap(([path, ceiling]) => {
    const source = files.get(path)
    if (source === undefined || !isBodySource(path, source) || lineCount(source) <= MAX_LINES) return []
    return [[path, Math.min(ceiling, lineCount(source))]]
  })
  return { ...baseline, files: Object.fromEntries(entries) }
}

export function inspectSize(files, baseline, previous, seed) {
  const problems = []
  if (baseline?.version !== 1 || baseline?.sourceSha !== INITIAL_SHA || !baseline?.files || typeof baseline.files !== 'object' || Array.isArray(baseline.files)) return ['Invalid size baseline metadata']
  if (previous && (previous.version !== 1 || previous.sourceSha !== INITIAL_SHA || !previous.files)) return ['Invalid base-branch size baseline']
  for (const [path, ceiling] of Object.entries(baseline.files)) {
    if (!Number.isInteger(ceiling) || ceiling <= MAX_LINES || !Object.hasOwn(seed, path) || ceiling > seed[path]) problems.push(`${path}: baseline entry is new or exceeds its initial limit`)
    if (previous && (!Object.hasOwn(previous.files, path) || ceiling > previous.files[path])) problems.push(`${path}: cannot add or raise a baseline entry`)
  }
  for (const [path, source] of files) {
    if (!isBodySource(path, source)) continue
    const lines = lineCount(source)
    const ceiling = baseline.files[path] ?? MAX_LINES
    if (lines > ceiling) problems.push(`${path}: ${lines} lines exceeds ${ceiling} (+${lines - ceiling})`)
  }
  return problems
}

export function functionLengths(path, source) {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found = []
  const length = node => sf.getLineAndCharacterOfPosition(node.end - 1).line - sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const visit = node => {
    if (ts.isFunctionLike(node) && node.body) {
      const parentName = ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(sf) : undefined
      const name = node.name?.getText(sf) ?? parentName ?? '(anonymous)'
      found.push({ path, name, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, full: length(node), body: length(node.body), component: /^[A-Z]/.test(name) && path.endsWith('tsx') })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
export function readTree(root, ref) {
  const paths = git(root, 'ls-tree', '-r', '--name-only', '-z', ref).split('\0').filter(isBodyFile)
  if (paths.some(path => /[\r\n]/.test(path))) throw Error('Unsupported newline in path')
  const bytes = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: paths.map(path => `${ref}:${path}`).join('\n') + '\n', maxBuffer: 128 * 1024 * 1024 })
  const files = new Map(); let offset = 0
  for (const path of paths) {
    const end = bytes.indexOf(10, offset), header = bytes.subarray(offset, end).toString('utf8')
    const match = /^[a-f0-9]+ blob (\d+)$/.exec(header)
    if (!match) throw Error(`Cannot read ${ref}:${path}`)
    const length = Number(match[1]); offset = end + 1
    files.set(path, bytes.subarray(offset, offset + length).toString('utf8')); offset += length + 1
  }
  return files
}
export function readWorkingTree(root) {
  const paths = new Set([...git(root, 'ls-files', '-z').split('\0'), ...git(root, 'ls-files', '--others', '--exclude-standard', '-z').split('\0')])
  return new Map([...paths].filter(path => isBodyFile(path) && existsSync(resolve(root, path))).sort().map(path => [path, readFileSync(resolve(root, path), 'utf8')]))
}
export function checkCodeSize(root, base) {
  const baseline = JSON.parse(readFileSync(resolve(root, BASELINE_PATH), 'utf8'))
  const hadBaseline = git(root, 'ls-tree', '--name-only', base, BASELINE_PATH).trim() === BASELINE_PATH
  const previous = hadBaseline ? JSON.parse(git(root, 'show', `${base}:${BASELINE_PATH}`)) : null
  const seed = initialLimits(readTree(root, INITIAL_SHA))
  const files = readWorkingTree(root)
  return { files: [...files].filter(([path, source]) => isBodySource(path, source)).length, frozen: Object.keys(baseline.files).length, problems: inspectSize(files, baseline, previous, seed) }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const baseIndex = process.argv.indexOf('--base')
  const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : process.env.CODE_SIZE_BASE_SHA
  if (!base) throw Error('Provide --base <PR base SHA>')
  const report = checkCodeSize(process.cwd(), base)
  for (const issue of report.problems) console.error(issue)
  console.log(`Code size: ${report.files} body files, ${report.frozen} frozen, ${report.problems.length} violations`)
  if (report.problems.length) process.exitCode = 1
  else if (process.argv.includes('--lower-baseline')) {
    const path = resolve(process.cwd(), BASELINE_PATH)
    const baseline = JSON.parse(readFileSync(path, 'utf8'))
    writeFileSync(path, JSON.stringify(lowerLimits(readWorkingTree(process.cwd()), baseline), null, 2) + '\n')
  }
}
