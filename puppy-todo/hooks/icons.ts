// small pixel icons for the desktop pane, drawn like the tools' icons (lofipuppy.app's PixelIcon):
// 14×14 squares written as text rows, grey only, light by day and dark by night. "." is see-through.
// the terminal has no pictures: it shows the same fact as a text mark (see MARKS).

const ICONS = {
  // a PR waiting for merge: two branches meeting, an arrow going up and right
  pr: [
    '..............',
    '.......oooooo.',
    '.........oooo.',
    '........oo.oo.',
    '.......oo..oo.',
    '..o...oo......',
    '.ooo.oo.......',
    '..o.oo........',
    '..ooo.........',
    '..oo..........',
    '..o...........',
    '.ooo..........',
    '..o...........',
    '..............',
  ],
  // an item that waited too long: an hourglass, the sand at the bottom
  old: [
    '..............',
    '...oooooooo...',
    '....o....o....',
    '....o....o....',
    '.....o..o.....',
    '......oo......',
    '......oo......',
    '.....o..o.....',
    '....o.ss.o....',
    '....ossssoo...',
    '...oooooooo...',
    '..............',
    '..............',
    '..............',
  ],
} as const

export type IconName = keyof typeof ICONS

// the text marks the terminal shows in their place
export const MARKS: Record<IconName, string> = { pr: '↗', old: '▪' }

// the warm greys of lofipuppy.app and puppy notes (baibai-brand 品牌風格.md, 網站): muted for the
// lines, text for the sand, so the icon stays quiet next to the words
const STYLE =
  '<style>svg{--text:#2a2926;--muted:#6a6761}' +
  '@media (prefers-color-scheme: dark){svg{--text:#e7e5e0;--muted:#9b9891}}</style>'
const FILL: Record<string, string> = { o: 'var(--muted)', s: 'var(--text)' }

export function iconSvg(name: IconName): string {
  const rects = ICONS[name].flatMap((row, y) =>
    [...row].map((c, x) => (c === '.' ? '' : `<rect x="${x}" y="${y}" width="1" height="1" fill="${FILL[c] ?? 'var(--muted)'}"/>`)),
  )

  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" shape-rendering="crispEdges">${STYLE}${rects.join('')}</svg>`
}
