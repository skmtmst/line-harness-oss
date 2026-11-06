import test from 'node:test'
import assert from 'node:assert/strict'
import { isBodyFile, isBodySource, lineCount, functionLengths } from './code-size.mjs'

test('source measurement separates fixtures and declarations from runtime code', () => {
  for (const path of ['view.test.tsx', 'view.spec.ts', 'view.d.ts', 'src/__tests__/view.ts', 'src/test-utils/view.tsx', 'src/fixtures/large.ts']) assert.equal(isBodyFile(path), false)
  assert.equal(isBodyFile('src/view.tsx'), true)
  assert.equal(isBodySource('types.ts', 'export interface Payload { id: string }'), false)
  assert.equal(isBodySource('types.ts', 'export enum Status { Ready }'), true)
})
test('logical lines are stable for CRLF and a missing final newline', () => {
  assert.equal(lineCount('one\ntwo\n'), 2)
  assert.equal(lineCount('one\r\ntwo'), 2)
  assert.equal(lineCount('one\rtwo\r'), 2)
  assert.equal(lineCount(''), 0)
  assert.equal(lineCount('\n'), 1)
})
test('function measurements preserve full and body lengths', () => {
  const [fn] = functionLengths('view.tsx', 'function View(\nprops: { title: string }\n) {\nreturn <div/>\n}\n')
  assert.deepEqual({ name: fn.name, full: fn.full, body: fn.body, component: fn.component }, { name: 'View', full: 5, body: 3, component: true })
})
