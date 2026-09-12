/** Test-only ownership of work that Vitest does not cancel on timeout. */
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

  /** A paused fake dependency must also be releasable by teardown. */
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
    // Include the test body itself, not only HTTP promises: assertions and
    // finally blocks may still run after the HTTP response has resolved.
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}
