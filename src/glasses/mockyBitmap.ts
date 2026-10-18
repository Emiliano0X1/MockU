import mockyUrl from '../assets/mocky.png'

const cache = new Map<number, Promise<number[]>>()

// Mocky as one grayscale byte per pixel (row-major) for an image container.
// The glasses light up bright pixels, so the white background is dropped and
// Mocky's dark outline becomes the brightest part of the drawing.
export function mockyBitmap(size: number): Promise<number[]> {
  let pending = cache.get(size)
  if (!pending) {
    pending = render(size)
    cache.set(size, pending)
  }
  return pending
}

async function render(size: number): Promise<number[]> {
  const image = new Image()
  image.src = mockyUrl
  await image.decode()

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')!
  context.fillStyle = '#fff'
  context.fillRect(0, 0, size, size)
  context.drawImage(image, 0, 0, size, size)

  const { data } = context.getImageData(0, 0, size, size)
  const pixels: number[] = new Array(size * size)
  for (let i = 0; i < pixels.length; i++) {
    const luminance = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    pixels[i] = luminance > 235 ? 0 : Math.round(255 - luminance * 0.7)
  }
  return pixels
}
