# puppy mods style

How every puppy mod looks, so they feel like one family. `puppy-pipelines` is the reference: when this file and that mod disagree, fix one of them.

## Panes are cards

- The pane is one column: `<Box flexDirection="column" gap={1}>`.
- The first row is the pane's own status: a short dim line on the left (when it last looked, or the puppy's line), the `refresh` button on the right.
- Each part of the pane is a card:

  ```tsx
  <Box key="card-…" flexDirection="column" borderStyle="round" borderDimColor paddingX={1} gap="xs">
    <Box flexDirection="row" justifyContent="space-between">
      <Text weight="semibold">name</Text>
      <Text dimColor>state · time</Text>
    </Box>
    …
  </Box>
  ```

- The card header: the name on the left in `weight="semibold"`, and on the right, dim, the state, a count or a time, joined by ` · `.
- Give each card a `key` that starts with `card-`, so tests can find it.
- Lists inside a card get a dim label above each group, not another border. One border level only.
- Extra lists (done items, old things) stay folded below the cards: a dim button `▸ done 3`, `▾` when open.
- Long text: on the terminal, clip by columns (a card has 4 fewer than the pane: border and padding). On the desktop, give the `Text` `wrap="truncate-end"` and let it cut at the edge; counting columns there cuts too early, most of all for Chinese.
- Rows with a mark in front (☐, ↗, ✓): put the mark in a `<Box width={3}>`, so the words line up.

## Colors

- In `Text` and `Box`, use only the app's color names. Never a hex color: the app picks them for light and dark.
  - `warning`: something waits for you.
  - `error`: something broke.
  - `success`: something is working right now.
  - Everything else: `dimColor`, or the normal text color.
- One color word per line at most. Color the word that matters (the state, the label), not the whole line.

## Pictures (SVG)

- Only where the surface has `Svg` (the desktop app). The terminal gets the same facts as text lines: never drop a fact because there is no picture.
- Warm greys, light by day and dark by night with `prefers-color-scheme`. Copy the palette from `puppy-pipelines/hooks/draw.ts` (`--card`, `--line`, `--text`, `--muted`, and the soft `--ok` / `--listen` / `--reject`).
- Pixel art keeps `shape-rendering="crispEdges"`.
- The puppy's drawing comes from baibai-brand (generated, see `brand.lock.json`). Never draw or edit the puppy by hand here.
- The puppy wears headphones only for music things. The orange is only for the headphones; no other orange.
- Motion is slow and small (a blink, breathing, floating notes). Nothing flashes.

## Words

- lowercase, short, plain words: `refresh`, `add a to-do…`, `waiting for you`.
- Quiet: a toast only for something new that waits for you, and only once.
- When something fails, say it in one dim or `error` line in the pane. Never hide a card or a file without a word.
- Loading: one dim line, like `loading…`.

## Code

- Draw with `$.ui.resolve(e)`; check for an element before using it (`'Svg' in ui`, `'Input' in table`): the phone and the terminal have fewer.
- Buttons have a `key`. Plain buttons (`plain`) for small icons like ☐ and ✕.
- A part that can fail to draw (a picture from outside data) is wrapped, so one bad file loses its picture, not the pane.
- Shared code: none yet. When a third mod needs the same code, add a small script that copies it from one place (like `brand.lock.json` does for the puppy).
