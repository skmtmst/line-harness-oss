/** A dedicated fixture API keeps browser suites independent of other worktrees. */
export async function routeLocalApi({ page }) {
  const mock = process.env.VISUAL_QA_MOCK
  if (!mock) return
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    await route.fulfill({ response: await route.fetch({ url: `${mock}${url.pathname}${url.search}` }) })
  })
}
