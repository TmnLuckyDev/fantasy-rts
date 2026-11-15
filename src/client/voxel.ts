export type Faces = readonly [top: string, front: string, side: string]

export function canvas(width: number, height: number) {
  const surface = document.createElement('canvas')
  surface.width = width
  surface.height = height
  return surface
}

export function brush(surface: HTMLCanvasElement) {
  const ctx = surface.getContext('2d')!
  function rect(color: string, x: number, y: number, w: number, h: number) {
    ctx.fillStyle = color
    ctx.fillRect(x, y, w, h)
  }
  function poly(color: string, ...points: number[]) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(points[0], points[1])
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1])
    ctx.closePath()
    ctx.fill()
  }
  function block(faces: Faces, x: number, y: number, w: number, h: number, depth: number) {
    const rise = Math.max(1, Math.round(depth * 0.6))
    poly(faces[2], x + w, y, x + w + depth, y - rise, x + w + depth, y + h - rise, x + w, y + h)
    rect(faces[1], x, y, w, h)
    poly(faces[0], x, y, x + depth, y - rise, x + w + depth, y - rise, x + w, y)
  }
  function shadow(x: number, y: number, width: number, height: number) {
    poly('#152e2960', x - width, y, x - width + 5, y - height,
      x + width - 6, y - height, x + width + 3, y - 1, x + width, y + height, x - width + 4, y + height)
    poly('#101a2450', x - width + 3, y, x - width + 9, y - height + 2,
      x + width - 6, y - height + 2, x + width - 1, y + height - 1, x - width + 6, y + height - 1)
  }
  return { rect, poly, block, shadow }
}
