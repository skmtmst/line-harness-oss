import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, posix } from 'node:path'

export const baselinePath = 'scripts/structure/quality-baseline.json'
export function repositoryFiles(root, ref) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const names = ref ? git('ls-tree', '-r', '--name-only', '-z', ref) : git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
  const paths = [...new Set(names.split('\0'))].filter(path => /^(?:apps\/|packages\/|scripts\/)/.test(path) && /\.(?:[cm]?[jt]sx?|css|sql|sh|py)$/.test(path))
  if (!ref) return new Map(paths.flatMap(path => {
    try { return [[path, readFileSync(resolve(root, path), 'utf8')]] } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }))
  if (paths.some(path => /[\r\n]/.test(path))) throw Error('Unsupported newline in source path')
  const bytes = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: paths.map(path => `${ref}:${path}`).join('\n') + '\n', maxBuffer: 256 * 1024 * 1024 })
  let offset = 0
  return new Map(paths.map(path => {
    const end = bytes.indexOf(10, offset), match = /^[a-f0-9]+ blob (\d+)$/.exec(bytes.subarray(offset, end).toString())
    if (!match) throw Error(`Cannot read base: ${path}`)
    const length = Number(match[1]); offset = end + 1
    const source = bytes.subarray(offset, offset + length).toString('utf8'); offset += length + 1
    return [path, source]
  }))
}
export function packageRoots(root, ref) {
  const paths = execFileSync('git', ref ? ['ls-tree', '-r', '--name-only', ref, 'packages'] : ['ls-files', 'packages/*/package.json'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(path => /^packages\/[^/]+\/package.json$/.test(path))
  return new Map(paths.map(path => {
    const source = ref ? execFileSync('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8' }) : readFileSync(resolve(root, path), 'utf8')
    return [JSON.parse(source).name, posix.dirname(path)]
  }))
}
