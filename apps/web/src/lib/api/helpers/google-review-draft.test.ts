import { expect, test, vi } from 'vitest'
vi.mock('../../api', () => ({ fetchApi: vi.fn() }))
import { fetchApi } from '../../api'
import { generateGoogleReviewDraft } from './google-review-draft'
import { restaurantGoogleApi } from '../../restaurant-google-api'

test('the one-click action has no options and refinements remain available separately', async () => {
  await restaurantGoogleApi.generateDraft('shop/1', 'review/1')
  expect(fetchApi).toHaveBeenLastCalledWith('/api/restaurant-test/google/reviews/review%2F1/draft/generate?account_id=shop%2F1', {
    method: 'POST', body: '{}',
  })
  await generateGoogleReviewDraft('shop/1', 'review/1', { mode: 'polite', replyDraft: '元の下書き' })
  expect(fetchApi).toHaveBeenLastCalledWith(expect.any(String), {
    method: 'POST', body: JSON.stringify({ mode: 'polite', replyDraft: '元の下書き' }),
  })
})
