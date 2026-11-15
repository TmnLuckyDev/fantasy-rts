import type { Point } from '../shared/protocol.ts'

const cell = 64

export class SpatialIndex<T extends Point> {
  private buckets = new Map<number, Set<T>>()
  private locations = new Map<T, number>()
  private rank = new Map<T, number>()

  private key(x: number, y: number) { return x + 65536 * y }

  reset(items: Iterable<T>) {
    this.buckets.clear()
    this.locations.clear()
    this.rank.clear()
    for (const item of items) this.update(item)
  }

  update(item: T) {
    const key = this.key(Math.floor(item.x / cell), Math.floor(item.y / cell))
    const old = this.locations.get(item)
    if (key === old) return
    if (old !== undefined) this.buckets.get(old)?.delete(item)
    else this.rank.set(item, this.rank.size)
    let bucket = this.buckets.get(key)
    if (!bucket) this.buckets.set(key, bucket = new Set())
    bucket.add(item)
    this.locations.set(item, key)
  }

  remove(item: T) {
    const key = this.locations.get(item)
    if (key !== undefined) this.buckets.get(key)?.delete(item)
    this.locations.delete(item)
  }

  before(a: T, b: T) { return this.rank.get(a)! < this.rank.get(b)! }

  *near(point: Point, radius: number) {
    const right = Math.floor((point.x + radius) / cell)
    const bottom = Math.floor((point.y + radius) / cell)
    for (let y = Math.floor((point.y - radius) / cell); y <= bottom; y++) {
      for (let x = Math.floor((point.x - radius) / cell); x <= right; x++) {
        const bucket = this.buckets.get(this.key(x, y))
        if (bucket) yield* bucket
      }
    }
  }
}
