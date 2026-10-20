import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mockFetch } from './mock-local.mjs'

test('style GET is a real empty request stream and finishes successfully', async () => {
  const response = await mockFetch('GET', '/api/dashboard/style?account_id=visual-qa-account')
  assert.equal(response.status, 200)
  const body = JSON.parse(response.body)
  assert.equal(body.success, true)
  assert.equal(body.data.style, 'standard')
  assert.equal(typeof body.data.version, 'number')
})

test('style summary and existing GET routes still complete', async () => {
  for (const path of ['/api/dashboard/style/summary?account_id=visual-qa-account&style=restaurant', '/api/entry-routes?accountId=visual-qa-account']) {
    const response = await mockFetch('GET', path)
    assert.equal(response.status, 200)
    assert.equal(JSON.parse(response.body).success, true)
  }
})
