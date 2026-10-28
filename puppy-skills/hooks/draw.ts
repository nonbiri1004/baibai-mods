// The puppy at the top of the pane, as an SVG string: the bare puppy (no headphones) typing at
// its little laptop, keeping you company. Frames come from baibai-brand (puppy.ts, generated).
import { typing0, typing1, typing2, typing3, typing4, typing5 } from './puppy'

const FRAMES = [typing0, typing1, typing2, typing3, typing4, typing5]
// slower than the pet's 6 fps: motion stays slow and small
const SECONDS = 2.4
const SCALE = 2

// one frame shown at a time, swapped by SMIL; each frame is visible for its sixth of the loop
export function typingPuppy(): string {
  const w = 34 * SCALE
  const h = 26 * SCALE
  const n = FRAMES.length
  const keyTimes = FRAMES.map((_, i) => (i / n).toFixed(4)).join(';')
  const frames = FRAMES.map((rects, i) => {
    const values = FRAMES.map((_, j) => (j === i ? 'visible' : 'hidden')).join(';')

    return (
      `<g visibility="${i === 0 ? 'visible' : 'hidden'}">${rects}` +
      `<animate attributeName="visibility" values="${values}" keyTimes="${keyTimes}" dur="${SECONDS}s" repeatCount="indefinite" calcMode="discrete"/></g>`
    )
  }).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 34 26" shape-rendering="crispEdges">` +
    `${frames}</svg>`
  )
}
