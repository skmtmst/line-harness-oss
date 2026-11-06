import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'

const children: ChildProcess[] = []
let normal: string
let long: string
async function start(stress: boolean) {
  const port = await new Promise<number>((done, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number }
      server.close(error => error ? reject(error) : done(address.port))
    })
  })
  const child = spawn(process.execPath, [resolve('scripts/visual-qa/mock-api.mjs')], { env: { ...process.env, PORT: String(port), VISUAL_QA_LONG: stress ? '1' : '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  await new Promise<void>((done, reject) => {
    child.stdout!.on('data', data => { if (String(data).includes('mock API on')) done() })
    child.once('error', reject)
    child.once('exit', code => reject(new Error(`mock exited ${code}`)))
  })
  return `http://127.0.0.1:${port}`
}
beforeAll(async () => { normal = await start(false); long = await start(true) }, 15_000)
afterAll(async () => { await Promise.all(children.map(child => new Promise<void>(done => { child.once('exit', () => done()); child.kill() }))) })
type MockFriend = { id: string; isFollowing: boolean; displayName: string; tags: Array<{ id: string }>; items?: unknown }
type MockLinks = { items?: Array<{ originalUrl: string }>; [index: number]: { originalUrl: string } }
const get = async <T>(base: string, path: string): Promise<T> => {
  const response = await fetch(base + path)
  return ((await response.json()) as { data: T }).data
}
it('会話だけに登場する相手にも一致するIDの1人分を返し、既知の相手は変えない', async () => {
  const known = await get<MockFriend>(normal, '/api/friends/friend-1')
  const fallback = await get<MockFriend>(normal, '/api/friends/friend-42')
  expect(fallback).toEqual({ ...known, id: 'friend-42' })
  expect(fallback.items).toBeUndefined()
  expect(Array.isArray(fallback.tags)).toBe(true)
})
it('長文化はオンの時だけ名前・URL・タグを加工し、ID・状態と元データを保つ', async () => {
  const known = await get<MockFriend>(normal, '/api/friends/friend-1')
  const stress = await get<MockFriend>(long, '/api/friends/friend-1')
  expect(stress.id).toBe(known.id)
  expect(stress.isFollowing).toBe(known.isFollowing)
  expect(stress.displayName.length).toBeGreaterThan(known.displayName.length)
  expect(stress.tags).toHaveLength(10)
  expect(new Set(stress.tags.map((tag: { id: string }) => tag.id)).size).toBe(10)
  expect(await get<MockFriend>(normal, '/api/friends/friend-1')).toEqual(known)
  const links = await get<MockLinks>(normal, '/api/tracked-links')
  const stressedLinks = await get<MockLinks>(long, '/api/tracked-links')
  const url = links.items?.[0]?.originalUrl ?? links[0]?.originalUrl
  const stressedUrl = stressedLinks.items?.[0]?.originalUrl ?? stressedLinks[0]?.originalUrl
  expect(url).toBeTruthy()
  expect(stressedUrl.length).toBeGreaterThan(url.length)
})
