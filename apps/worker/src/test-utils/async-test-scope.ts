/** タイムアウトで Vitest が止めない処理も、試験側で完了まで管理する。 */
export class AsyncTestScope {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly releases = new Set<() => void>();
  private closing = false;

  track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work);
    void work.then(() => this.pending.delete(work), () => this.pending.delete(work));
    return work;
  }

  run<T>(body: () => Promise<T>): Promise<T> {
    return this.track(Promise.resolve().then(body));
  }

  /** 停止中の偽依存は、後片付けからも解放できるようにする。 */
  gate<T>(fallback: () => T): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolvePromise!: (value: T) => void;
    const promise = new Promise<T>(resolve => { resolvePromise = resolve; });
    const resolve = (value: T) => {
      this.releases.delete(release);
      resolvePromise(value);
    };
    const release = () => resolve(fallback());
    if (this.closing) release();
    else this.releases.add(release);
    return { promise, resolve };
  }

  async dispose(): Promise<void> {
    this.closing = true;
    for (const release of [...this.releases]) release();
    // HTTP 応答後も期待値や finally が続くため、要求の Promise だけでなく試験本文も完了待ちへ含める。
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}
