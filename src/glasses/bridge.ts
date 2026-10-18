import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { mockyBitmap } from './mockyBitmap'

// G2 display: 576x288, monochrome. Image containers max 288x144.
const MOCKY = { id: 1, name: 'mocky', x: 24, y: 80, size: 128 }
const LABEL = { id: 2, name: 'label', x: 176, y: 56, width: 376, height: 36 }
const BODY = { id: 3, name: 'body', x: 176, y: 96, width: 376, height: 160 }

export type GlassesView = {
  mocky: boolean
  label: string
  text: string
}

let bridgePromise: Promise<EvenAppBridge | null> | null = null
let pageCreated = false
let lastView = ''
let currentView: GlassesView | null = null

// Resolves to null outside the Even App WebView (e.g. a desktop browser).
export function getBridge(): Promise<EvenAppBridge | null> {
  if (!bridgePromise) {
    const inWebView = typeof window !== 'undefined' && 'flutter_inappwebview' in window
    bridgePromise = inWebView
      ? Promise.race([
          waitForEvenAppBridge(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ])
      : Promise.resolve(null)
  }
  return bridgePromise
}

// Page updates run one at a time so two callers can't both create the startup page.
let queue: Promise<unknown> = Promise.resolve()

// Called after each page create/rebuild, e.g. to re-enable sensors the host
// may reset along with the page.
const pageListeners = new Set<() => void>()
export function onGlassesPageChange(listener: () => void) {
  pageListeners.add(listener)
  return () => pageListeners.delete(listener)
}

export function showOnGlasses(view: GlassesView): Promise<boolean> {
  const run = queue.then(() => render(view))
  queue = run.catch(() => {})
  return run
}

async function render(view: GlassesView): Promise<boolean> {
  const key = JSON.stringify(view)
  if (key === lastView) return true
  const bridge = await getBridge()
  if (!bridge) return false
  lastView = key
  currentView = view

  const textObject = [
    new TextContainerProperty({
      xPosition: view.mocky ? LABEL.x : 24,
      yPosition: LABEL.y,
      width: view.mocky ? LABEL.width : 528,
      height: LABEL.height,
      containerID: LABEL.id,
      containerName: LABEL.name,
      content: view.label,
      textColor: 2,
      isEventCapture: 0,
    }),
    new TextContainerProperty({
      xPosition: view.mocky ? BODY.x : 24,
      yPosition: BODY.y,
      width: view.mocky ? BODY.width : 528,
      height: BODY.height,
      containerID: BODY.id,
      containerName: BODY.name,
      content: view.text,
      isEventCapture: 1,
    }),
  ]
  const imageObject = view.mocky
    ? [
        new ImageContainerProperty({
          xPosition: MOCKY.x,
          yPosition: MOCKY.y,
          width: MOCKY.size,
          height: MOCKY.size,
          containerID: MOCKY.id,
          containerName: MOCKY.name,
        }),
      ]
    : []
  const page = { containerTotalNum: textObject.length + imageObject.length, textObject, imageObject }

  try {
    const ok = pageCreated
      ? await bridge.rebuildPageContainer(new RebuildPageContainer(page))
      : (await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page))) === StartUpPageCreateResult.success
    if (!ok) throw new Error('Glasses rejected the page')
    pageCreated = true
    pageListeners.forEach((listener) => listener())
    if (view.mocky) {
      await bridge.updateImageRawData(
        new ImageRawDataUpdate({
          containerID: MOCKY.id,
          containerName: MOCKY.name,
          imageData: await mockyBitmap(MOCKY.size),
        }),
      )
    }
    return true
  } catch (error) {
    console.error('Glasses update failed', error)
    lastView = ''
    return false
  }
}

// The glasses mic needs a page on the glasses before it can open.
export async function ensureGlassesPage() {
  await queue
  if (!pageCreated) await showOnGlasses({ mocky: false, label: 'MockU', text: '' })
}

// Changes only the small label line (used for countdowns and tilt feedback)
// without rebuilding the page or re-sending Mocky.
export async function setGlassesLabel(label: string): Promise<boolean> {
  const bridge = await getBridge()
  if (!bridge || !pageCreated || !currentView) return false
  currentView = { ...currentView, label }
  lastView = JSON.stringify(currentView)
  try {
    return await bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: LABEL.id, containerName: LABEL.name, content: label }),
    )
  } catch (error) {
    console.error('Glasses label update failed', error)
    return false
  }
}
