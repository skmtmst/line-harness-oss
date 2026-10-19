// package.json の命令を持つ束との統合まで、既存の実行口を保つ。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectB244Tree } from './verify.mjs'
export { inspectB244Source, inspectB244Tree } from './verify.mjs'
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectB244Tree(fileURLToPath(new URL('../', import.meta.url)))
  for (const item of result.errors) console.error(`${item.filename}:${item.line} ${item.kind}`)
  console.log(`入力の定義：${result.files}ファイル・違反${result.errors.length}`)
  if (result.errors.length) process.exitCode = 1
}
