import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

test('シナリオのオン・オフは5秒待たずに保存し、停止だけ確認する', () => {
  const source = readFileSync(resolve('src/v8/scenarios/list.tsx'), 'utf8')
  const body = source.slice(source.indexOf('const runBulkToggle'), source.indexOf('/* ===== フォルダ移動'))
  expect(body).toContain('runOptimistic(')
  expect(body).not.toContain('runUndoable(')
  expect(source).toContain('setPendingStop(stoppableIds)')
})
