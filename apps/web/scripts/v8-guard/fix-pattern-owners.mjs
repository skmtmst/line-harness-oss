import { readdirSync, readFileSync } from 'node:fs'

/** Component ownership, derived from the actual shared/template stylesheets.
 * This is not a defect allowance: no board, finding, width or budget is waived. */
export function sharedControlOwners() {
  const owners = new Set()
  for (const folder of ['shared', 'templates']) {
    const directory = new URL(`../../src/components/${folder}/`, import.meta.url)
    for (const file of readdirSync(directory).filter(file => file.endsWith('.css'))) {
      if (file.endsWith('.module.css')) owners.add(file.replace(/\.module\.css$/, ''))
      else {
        const css = readFileSync(new URL(file, directory), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
        for (const match of css.matchAll(/\.([a-zA-Z_][\w-]*)/g)) owners.add(match[1])
      }
    }
  }
  return [...owners]
}
