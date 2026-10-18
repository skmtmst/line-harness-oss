import { describe, expect, it } from 'vitest'
import { safeNavigationPath } from './safe-navigation'

describe('F19: form return navigation', () => {
  it.each(['https://evil.example/login', 'javascript:alert(1)', '//evil.example', '/\\evil.example', '/%09/evil.example', '/%5cevil.example'])('rejects %s', value => {
    expect(safeNavigationPath(value)).toBeNull()
  })
  it('keeps local paths, query filters and fragments', () => {
    expect(safeNavigationPath('/tags?tab=fields#selected')).toBe('/tags?tab=fields#selected')
    expect(safeNavigationPath('/tags?return=%2Ffriends')).toBe('/tags?return=%2Ffriends')
  })
})
