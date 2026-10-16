import { beforeEach } from 'vitest'
import { setTestReducedMotion } from './reduced-motion'

// Node 26 exposes storage globals even when localStorage is unavailable. Vitest 3
// then keeps Node's globals instead of installing happy-dom's browser storage.
// Give DOM tests separate, in-memory browser stores on every supported Node version.
if (typeof window !== 'undefined') {
  const { Storage } = await import('happy-dom')
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: new Storage(),
    })
  }
}

beforeEach(() => setTestReducedMotion(true))
