// A small cache keyed by palette name (or tier) that never grows past a fixed size: the zoom
// switches palettes, and a per-palette resource must not accumulate. Insertion order is age; the
// oldest entry goes when a new key arrives at capacity. Allocation happens only on a miss.

export class BoundedCache<T> {
  private readonly map = new Map<string, T>();

  constructor(readonly capacity: number) {}

  get size(): number {
    return this.map.size;
  }

  get(key: string): T | undefined {
    return this.map.get(key);
  }

  /** The cached value for `key`, building (and possibly evicting the oldest) on a miss. */
  getOrBuild(key: string, build: () => T): T {
    let v = this.map.get(key);
    if (v === undefined) {
      if (this.map.size >= this.capacity) {
        const oldest = this.map.keys().next().value;
        if (oldest !== undefined) this.map.delete(oldest);
      }
      v = build();
      this.map.set(key, v);
    }
    return v;
  }
}
