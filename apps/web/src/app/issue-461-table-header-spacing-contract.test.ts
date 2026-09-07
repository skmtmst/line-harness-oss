import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP = dirname(fileURLToPath(import.meta.url))

const targets = [
  'auto-replies/page.tsx',
  'health/page.tsx',
  'mileage/earning-rules/new/page.tsx',
  'webinars/edit/page.tsx',
]

describe('Issue #461 表見出しの余白', () => {
  it.each(targets)('%s の全thを共通余白にそろえる', (path) => {
    const source = readFileSync(join(APP, path), 'utf8')
    const headers = [...source.matchAll(/<th\b[^>]*className="([^"]*)"/g)]

    expect(headers.length).toBeGreaterThan(0)
    for (const [, classes] of headers) {
      expect(classes.split(/\s+/), `${path}: ${classes}`).toEqual(
        expect.arrayContaining(['px-4', 'py-3']),
      )
    }
  })
})
