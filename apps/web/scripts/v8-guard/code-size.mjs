import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const isBodyFile = path => /\.tsx?$/.test(path) && !/\.(?:test|spec|d)\.[cm]?tsx?$/.test(path)
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
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = [...readWorkingTree(process.cwd())].filter(([path, source]) => isBodySource(path, source))
  console.log(JSON.stringify(files.map(([path, source]) => ({ path, lines: lineCount(source) })), null, 2))
}
