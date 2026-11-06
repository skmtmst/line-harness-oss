// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'

// Components may read storage during import, before any beforeEach hook runs.
const local = window.localStorage
const session = window.sessionStorage

afterEach(() => {
  vi.unstubAllGlobals()
  local.clear()
  session.clear()
})

it('provides isolated browser storage through both window and globalThis', () => {
  expect(globalThis.localStorage).toBe(local)
  expect(globalThis.sessionStorage).toBe(session)
  local.setItem('browser-storage-test', 'local')
  session.setItem('browser-storage-test', 'session')
  expect(local.getItem('browser-storage-test')).toBe('local')
  expect(session.getItem('browser-storage-test')).toBe('session')
  expect(local.length).toBe(1)
  expect(local.key(0)).toBe('browser-storage-test')
  local.removeItem('browser-storage-test')
  expect(local.getItem('browser-storage-test')).toBeNull()
  session.clear()
  expect(session.length).toBe(0)
})

it('restores usable storage after a test temporarily stubs a global', () => {
  vi.stubGlobal('localStorage', undefined)
  expect(window.localStorage).toBeUndefined()
  vi.unstubAllGlobals()
  expect(window.localStorage).toBe(local)
  local.setItem('restored', 'yes')
  expect(window.localStorage.getItem('restored')).toBe('yes')
})
