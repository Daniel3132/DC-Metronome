// Per-browser UI conveniences (what is minimized, which view is shown). Storage failures are ignored: the default
// applies next time.

export function readItem(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writeItem(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // Storage blocked or full.
  }
}
