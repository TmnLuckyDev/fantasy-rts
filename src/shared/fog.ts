export function decodeFog(mask: string, size: number): Uint8Array {
  const cells = new Uint8Array(size)
  let start = 0
  for (const run of mask.split('.')) {
    const value = Number.parseInt(run, 36)
    const length = Math.floor(value / 3)
    cells.fill(value % 3, start, start + length)
    start += length
  }
  return cells
}
