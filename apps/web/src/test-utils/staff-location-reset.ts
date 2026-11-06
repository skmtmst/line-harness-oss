import { beforeEach } from 'vitest'
import { flushListUrlState } from '@/components/shared/list-url-state'
beforeEach(() => {
  flushListUrlState()
  window.history.replaceState(null, '', '/staff')
  window.dispatchEvent(new Event('popstate'))
})
