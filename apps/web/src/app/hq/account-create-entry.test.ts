import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const hqPage = readFileSync(join(here, 'page.tsx'), 'utf8')
const hqOpenPage = readFileSync(join(here, 'open', 'page.tsx'), 'utf8')

describe('HQ account create entry', () => {
  it('HQ page links to the general account flow', () => {
    assert.match(hqPage, /href="\/accounts\/new"/)
    assert.match(hqPage, /LINEアカウントを新規登録/)
    assert.doesNotMatch(hqPage, /restaurant-test\/stores\/new/)
  })

  it('HQ open page links to the general account flow', () => {
    assert.match(hqOpenPage, /href="\/accounts\/new"/)
    assert.match(hqOpenPage, /LINEアカウントを新規登録/)
    assert.doesNotMatch(hqOpenPage, /restaurant-test\/stores\/new/)
  })
})
