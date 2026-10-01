'use client'

import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'
import Button from '@/components/shared/button'

interface Props {
  /** 表示中の友だち。変わったら失敗の表示を捨てて、新しい相手で描き直す。 */
  resetKey: string | null
  children: ReactNode
}

interface State {
  failed: boolean
  /** 子を作り直すための番号。「もう一度試す」で1つ進め、子を最初から読み込ませる。 */
  attempt: number
  resetKey: string | null
}

/*
 * 受信箱の右の列（顧客情報）だけを包むエラー境界。
 *
 * 右の列が例外を投げると、境界が無ければ受信箱の画面全体がページの
 * エラー境界に落ち、一覧も会話も使えなくなる（2026-10-01、API が
 * 1人分ではなく一覧の形を返したときに発覚）。失敗は右の列の中に
 * 閉じ込め、会話と一覧はそのまま使えるようにする。
 */
export default class FriendInfoSidebarBoundary extends Component<Props, State> {
  state: State = { failed: false, attempt: 0, resetKey: this.props.resetKey }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null
    return { failed: false, resetKey: props.resetKey }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 原因を追えるよう開発者向けには残す。画面には内部の文言を出さない。
    console.error('FriendInfoSidebar crashed', error, info.componentStack)
  }

  private retry = () => {
    this.setState((state) => ({ failed: false, attempt: state.attempt + 1 }))
  }

  render() {
    if (this.state.failed) {
      return (
        <div role="alert" data-friend-info-sidebar-state="failed" className="h-full w-full space-y-2 bg-canvas p-4">
          <p className="text-xs text-danger">顧客情報を読み込めませんでした</p>
          <Button
            variant="secondary"
            className="text-ink-secondary items-center px-3 py-1.5 text-xs h-auto whitespace-normal"
            type="button"
            onClick={this.retry}
          >
            もう一度試す
          </Button>
        </div>
      )
    }
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
  }
}
