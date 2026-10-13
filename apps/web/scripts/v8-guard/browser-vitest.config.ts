import { defineConfig } from 'vitest/config'
import config from '../../vitest.config'

export default defineConfig({
  ...config,
  test: {
    ...config.test,
    include: ['scripts/v8-guard/automation-create-draft-safety.test.ts', 'scripts/v8-guard/automation-new-overflow-contract.test.ts'],
    maxWorkers: 1,
    minWorkers: 1,
  },
})
