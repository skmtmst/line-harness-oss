import { chromium } from '@playwright/test'

export function connectGuardBrowser() {
  const endpoint = process.env.V8_GUARD_BROWSER_WS
  if (!endpoint) throw new Error('Run the guard through apps/web/scripts/v8-guard/browser-host.mjs')
  return chromium.connect(endpoint)
}
