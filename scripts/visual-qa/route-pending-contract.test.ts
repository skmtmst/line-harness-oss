import { describe, expect, it } from 'vitest'
import { inspectRoutePending, scanRoutePending } from './route-pending-contract.mjs'

describe('入口の待機表示', () => {
  it('全入口のSuspenseに空の待機表示が無い', () => {
    expect(scanRoutePending(process.cwd())).toEqual([])
  })
  it.each(['null', 'undefined', 'false', '<></>', "' '", 'ready ? <PagePending /> : null'])('空になる待機 %s は赤、共通の骨組みへ戻すと緑', fallback => {
    const prefix = "import { Suspense as Boundary } from 'react';"
    expect(inspectRoutePending(prefix + `const Page=()=> <Boundary fallback={${fallback}}><Screen/></Boundary>`)).toHaveLength(1)
    expect(inspectRoutePending(prefix + 'const Page=()=> <Boundary fallback={<PagePending/>}><Screen/></Boundary>')).toEqual([])
  })
  it('Reactの名前空間・変数で渡す空表示・省略したfallbackも赤', () => {
    expect(inspectRoutePending("import * as React from 'react';const pending=null;const Page=()=> <React.Suspense fallback={pending}><Screen/></React.Suspense>")).toHaveLength(1)
    expect(inspectRoutePending("import React from 'react';const Page=()=> <React.Suspense><Screen/></React.Suspense>")).toHaveLength(1)
  })
  it('認証カードの待機は通し、別の名前の部品と混同しない', () => {
    expect(inspectRoutePending("import {Suspense} from 'react';const Page=()=> <Suspense fallback={<AuthPending/>}><Screen/></Suspense>")).toEqual([])
    expect(inspectRoutePending('const Page=()=> <Suspense fallback={null}><Screen/></Suspense>')).toEqual([])
  })
})
