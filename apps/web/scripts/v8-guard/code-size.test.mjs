import test from 'node:test'
import assert from 'node:assert/strict'
import { INITIAL_SHA, initialLimits, inspectSize, isBodyFile, lineCount, functionLengths, lowerLimits } from './code-size.mjs'
const source = lines => Array.from({ length: lines }, () => '// line').join('\n') + '\n'
const record = files => ({ version: 1, sourceSha: INITIAL_SHA, files })
const seed = { 'existing.ts': 500 }
const baseline = record(seed)
const check = (files, next = baseline, previous = baseline) => inspectSize(new Map(Object.entries(files)), next, previous, seed)

test('400 lines pass, new 401-line files fail', () => {
  assert.deepEqual(check({ 'new.ts': source(400) }), [])
  assert.match(check({ 'new.ts': source(401) })[0], /exceeds 400/)
})
test('frozen files cannot grow by even one line', () => {
  assert.deepEqual(check({ 'existing.ts': source(500) }), [])
  assert.match(check({ 'existing.ts': source(501) })[0], /exceeds 500/)
})
test('shrinking passes and lowers the record without allowing regrowth', () => {
  assert.deepEqual(check({ 'existing.ts': source(450) }), [])
  const shrunk = record({ 'existing.ts': 450 })
  assert.deepEqual(check({ 'existing.ts': source(450) }, shrunk), [])
  assert.ok(check({ 'existing.ts': source(451) }, shrunk, shrunk).length)
  assert.ok(check({ 'existing.ts': source(450) }, baseline, shrunk).length)
})
test('entries cannot be added, raised or reintroduced after removal', () => {
  assert.ok(check({ 'new.ts': source(501) }, record({ ...seed, 'new.ts': 501 })).length)
  assert.ok(check({}, record({ 'existing.ts': 501 })).length)
  assert.ok(check({}, baseline, record({})).length)
})
test('updating the record only lowers existing ceilings and drops resolved entries', () => {
  assert.deepEqual(lowerLimits(new Map([['existing.ts', source(450)], ['new.ts', source(900)]]), baseline), record({ 'existing.ts': 450 }))
  assert.deepEqual(lowerLimits(new Map([['existing.ts', source(400)]]), baseline), record({}))
})
test('the initial record cannot include a new file or modify its anchor', () => {
  assert.deepEqual(inspectSize(new Map(), baseline, null, seed), [])
  assert.ok(inspectSize(new Map(), record({ 'new.ts': 800 }), null, seed).length)
  assert.ok(inspectSize(new Map(), { ...baseline, sourceSha: 'HEAD' }, null, seed).length)
})
test('test, spec, fixtures, declaration and helper files are separate', () => {
  for (const path of ['view.test.tsx', 'view.spec.ts', 'view.d.ts', 'src/__tests__/view.ts', 'src/test-utils/view.tsx', 'src/fixtures/large.ts']) {
    assert.equal(isBodyFile(path), false, path)
    assert.deepEqual(check({ [path]: source(1000) }), [])
  }
  assert.equal(isBodyFile('src/view.tsx'), true)
  assert.equal(isBodyFile('src/generated/handwritten.ts'), true)
})
test('renaming a large file cannot add it to the frozen set', () => {
  assert.ok(check({ 'renamed.ts': source(500) }).length)
})
test('pure type declarations are separate, but runtime enums remain body code', () => {
  assert.deepEqual(check({ 'types.ts': 'export interface Payload { id: string }\n' + source(500) }), [])
  assert.ok(check({ 'types.ts': 'export enum Status { Ready }\n' + source(500) }).length)
})
test('logical lines are stable for CRLF and a missing final newline', () => {
  assert.equal(lineCount('one\ntwo\n'), 2)
  assert.equal(lineCount('one\r\ntwo'), 2)
  assert.equal(lineCount('one\rtwo\r'), 2)
  assert.equal(lineCount(''), 0)
  assert.equal(lineCount('\n'), 1)
  assert.deepEqual(initialLimits(new Map([['x.ts', source(401)], ['x.test.ts', source(900)]])), { 'x.ts': 401 })
})
test('functions report full and body lengths without enforcing a function limit', () => {
  const [fn] = functionLengths('view.tsx', 'function View(\nprops: { title: string }\n) {\nreturn <div/>\n}\n')
  assert.equal(fn.name, 'View')
  assert.equal(fn.full, 5)
  assert.equal(fn.body, 3)
  assert.equal(fn.component, true)
})
