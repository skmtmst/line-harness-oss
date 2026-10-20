import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

describe('unpatched braces development-tool exposure', () => {
  it('the actual resolved Next lint config bypasses the glob parser', async () => {
    const eslint = new ESLint({ overrideConfigFile: resolve('eslint.config.mjs') });
    const config = await eslint.calculateConfigForFile(resolve('apps/web/src/app/page.tsx'));
    expect(config).toBeDefined();
    expect(config.settings?.next?.rootDir).toBeUndefined();
    const require = createRequire(import.meta.url);
    const nextRequire = createRequire(require.resolve('eslint-config-next'));
    const getRootDirs = nextRequire('@next/eslint-plugin-next/dist/utils/get-root-dirs.js').getRootDirs;
    // Nonexistent directory deliberately containing brace syntax. Returning it
    // unchanged demonstrates that the production lint config takes no glob path.
    const cwd = '/fixture/{literal}/workspace';
    expect(getRootDirs({ cwd, settings: config.settings ?? {} })).toEqual([cwd]);
  });
});
