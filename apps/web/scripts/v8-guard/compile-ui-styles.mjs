import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { compile } from 'tailwindcss'

const require = createRequire(import.meta.url)

export async function compileUiStyles(path) {
  const compiler = await compile(readFileSync(path, 'utf8').replace('@theme {', '@theme static {'), {
    base: dirname(path),
    loadStylesheet: async (id, base) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : resolve(base, id)
      return { path: file, base: dirname(file), content: readFileSync(file, 'utf8') }
    },
  })
  return compiler.build([])
}
