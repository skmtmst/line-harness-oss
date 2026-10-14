import { defineConfig } from 'vitest/config'
import config from './browser-vitest.config'

export default defineConfig({
  ...config,
  test: {
    ...config.test,
    include: ['scripts/v8-guard/rich-menu-template-preview.test.tsx'],
  },
})
