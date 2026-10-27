// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { BroadcastBlockedExclusion } from './broadcast-blocked-exclusion'

afterEach(cleanup)

it('ブロック中の人は押せるチェックの形にせず、「いつも除きます」の札で言い切る', () => {
  const view = render(<BroadcastBlockedExclusion />)
  expect(view.queryByRole('checkbox')).toBeNull()
  expect(view.getByText('いつも除きます')).not.toBeNull()
  expect(view.getByText('ブロック中の人')).not.toBeNull()
})
