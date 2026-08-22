import { resolve } from 'node:path'
import { formatV4Report, inspectV4Registry } from './v4-architecture.mjs'

const webRoot = resolve(import.meta.dirname, '..')
const result = inspectV4Registry(webRoot)
console.log(formatV4Report(result))
process.exitCode = result.errors.length > 0 ? 1 : 0
