// The picture under each card, as an SVG string: a progress bar for any pipeline, and a richer
// picture for the details this mod knows (music, ai-video, collector-*). Warm greys, light by day and dark by
// night, low contrast. The puppy is the bare one (no headphones): a coding tool.
import type { CollectorCounts, CollectorDetail, MusicDetail, Stage, Status, VideoDetail, VideoJob } from '../types'
import { sit, sitBlink, sleep0, sleep1, typing0, typing1, typing2, typing3, typing4, typing5 } from './puppy'
import { sit as blockSit, sleep0 as blockSleep0, typing0 as blockTyping0 } from './puppy-blocks'
import type { BlockRun } from './puppy-blocks'

export const W = 640

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Cut a label to fit; SVG text does not wrap. n is in Latin letters; a CJK character counts as two.
const wide = (c: string) => /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(c)
export function cut(s: string, n: number): string {
  let used = 0
  const chars = [...s]
  for (let i = 0; i < chars.length; i++) {
    used += wide(chars[i]!) ? 2 : 1
    if (used > n) return `${chars.slice(0, i).join('').slice(0, Math.max(0, i - 1))}…`
  }
  return s
}

const STYLE = `<style>
  svg{--card:#f8f7f4;--line:#dcdad4;--text:#2a2926;--muted:#6d6a64;--ok:#7f9a72;--listen:#c2a768;--reject:#b98276}
  @media (prefers-color-scheme: dark){svg{--card:#232321;--line:#353431;--text:#e7e5e0;--muted:#9b9891;
    --ok:#86a078;--listen:#bfa66a;--reject:#b07e73}}
  .t{fill:var(--text);font-family:ui-sans-serif,system-ui,sans-serif}
  .m{fill:var(--muted);font-family:ui-sans-serif,system-ui,sans-serif}
  .px{font-family:ui-monospace,Menlo,monospace;letter-spacing:.5px}
</style>`

// The width and height in the markup let the pane fit the picture to its own width (never wider
// than W) and keep the shape; guessing the pane's pixel width from its columns left empty space.
const svg = (h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">${STYLE}${body}</svg>`

function bar(x: number, y: number, w: number, part: number, fill = 'var(--ok)') {
  const f = Math.max(0, Math.min(1, part)) * w
  return `<rect x="${x}" y="${y}" width="${w}" height="4" rx="2" fill="var(--line)"/>` +
    `<rect x="${x}" y="${y}" width="${f.toFixed(1)}" height="4" rx="2" fill="${fill}"/>`
}

export type Picture = { source: string; height: number; alt: string }

function progressPicture(s: Status): Picture | null {
  const p = s.progress
  if (!p || !p.total) return null
  const label = `${p.done}/${p.total}${p.unit ? ` ${p.unit}` : ''}`
  return {
    height: 24,
    alt: label,
    source: svg(24, bar(0, 10, W - 150, p.done / p.total) +
      `<text class="m px" x="${W}" y="16" font-size="11" text-anchor="end">${esc(cut(label, 22))}</text>`),
  }
}

// Two frames swapped by SMIL: the puppy blinks while it works and breathes while it sleeps.
function puppy(x: number, y: number, scale: number, isWorking: boolean) {
  const [a, b, dur, keyTimes] = isWorking ? [sit, sitBlink, '4s', '0;0.94'] : [sleep0, sleep1, '3s', '0;0.5']
  const frame = (rects: string, values: string) =>
    `<g visibility="visible">${rects}<set attributeName="visibility" to="visible"/>` +
    `<animate attributeName="visibility" values="${values}" keyTimes="${keyTimes}" dur="${dur}" repeatCount="indefinite" calcMode="discrete"/></g>`
  return `<g transform="translate(${x} ${y}) scale(${scale})" shape-rendering="crispEdges">` +
    frame(a, 'visible;hidden') + frame(b, 'hidden;visible') + '</g>'
}

function notes(x: number, y: number) {
  return [0, 1.3, 2.6].map((delay, i) =>
    `<text class="m" x="${x + i * 10}" y="${y}" font-size="13" opacity="0">♪` +
    `<animate attributeName="y" values="${y};${y - 30}" dur="3.9s" begin="${delay}s" repeatCount="indefinite"/>` +
    `<animate attributeName="opacity" values="0;.8;0" dur="3.9s" begin="${delay}s" repeatCount="indefinite"/></text>`,
  ).join('')
}

export const MAX_SQUARES = 300

const STRIP_COLOR: Record<string, string> = {
  o: 'var(--ok)', l: 'var(--listen)', r: 'var(--reject)', x: 'var(--line)', '?': 'var(--muted)',
}

// The puppy at work (or asleep), then one square per song made.
function musicPicture(s: Status, isStale: boolean): Picture | null {
  const d = (s.detail ?? {}) as MusicDetail
  const b = d.batches?.[0]
  if (!b) return null
  const H = 120
  const isWorking = s.state === 'running' && !isStale
  let body = puppy(0, H - 26 * 2.6 - 18, 2.6, isWorking)
  if (isWorking) body += notes(70, 40)
  // the host is already in the card's header; the picture keeps to the studio itself
  const comfy = d.comfy ? (d.comfy.up ? 'comfy up' : 'comfy down') : ''

  // 30 squares per row; they shrink so a batch of 220 songs still fits. Past MAX_SQUARES only the
  // newest are drawn, so the squares keep a size and the SVG stays under the element's size limit.
  const all = typeof b.strip === 'string' ? b.strip : ''
  const strip = all.slice(-MAX_SQUARES)
  const [x0, y0, per] = [120, 6, 30]
  const rows = Math.max(1, Math.ceil(strip.length / per))
  const step = Math.min(16, 86 / rows)
  const size = step - 2
  ;[...strip].forEach((c, i) => {
    const [x, y] = [x0 + (i % per) * step, y0 + Math.floor(i / per) * step]
    body += c === 'e'
      ? `<rect x="${(x + 0.5).toFixed(1)}" y="${(y + 0.5).toFixed(1)}" width="${(size - 1).toFixed(1)}" height="${(size - 1).toFixed(1)}" rx="1" fill="none" stroke="var(--reject)"/>`
      : `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" rx="1" fill="${STRIP_COLOR[c] ?? 'var(--line)'}"/>`
  })
  if (!strip) body += `<text class="m" x="${x0}" y="40" font-size="11">no songs yet</text>`
  if (all.length > strip.length) body += `<text class="m" x="${W}" y="${H - 18}" font-size="9" text-anchor="end">newest ${strip.length} of ${all.length}</text>`
  const legend: [string, string][] = [['ok', 'var(--ok)'], ['to hear', 'var(--listen)'], ['rejected', 'var(--reject)']]
  legend.forEach(([name, fill], i) => {
    body += `<rect x="${x0 + i * 78}" y="${H - 12}" width="8" height="8" rx="1" fill="${fill}"/>` +
      `<text class="m" x="${x0 + 12 + i * 78}" y="${H - 4}" font-size="12">${name}</text>`
  })
  const pace = b.avg_gen_sec ? `${Math.round(b.avg_gen_sec / 60)} min / song` : ''
  const right = [comfy, pace].filter(Boolean).join(' · ')
  if (right) body += `<text class="m px" x="${W}" y="${H - 4}" font-size="12" text-anchor="end">${esc(right)}</text>`
  return {
    height: H,
    alt: `${b.name}: ${b.ok ?? 0} ok, ${b.needs_listen ?? 0} to hear, ${b.rejected ?? 0} rejected`,
    source: svg(H, body),
  }
}

export const STAGES: readonly Stage[] = ['plan', 'clips', 'voice', 'compose', 'final', 'done']
// The two review gates only you can pass.
const GATE: ReadonlySet<Stage> = new Set(['plan', 'final'])

export function byStage(jobs: VideoJob[]): Record<Stage, VideoJob[]> {
  const out = Object.fromEntries(STAGES.map(st => [st, [] as VideoJob[]])) as Record<Stage, VideoJob[]>
  for (const j of jobs) (out[j.stage] ?? out.plan).push(j)
  return out
}

// One column per stage, a chip per job; the review gates have a dashed outline.
function videoPicture(s: Status): Picture | null {
  const d = (s.detail ?? {}) as VideoDetail
  const jobs = d.jobs ?? []
  if (!jobs.length) return null
  const lanes = byStage(jobs)
  const colW = W / STAGES.length
  const shown = 4
  const H = 36 + shown * 20 + 30
  let body = ''
  STAGES.forEach((st, i) => {
    const x = i * colW
    body += `<rect x="${x + 2}" y="0.5" width="${colW - 4}" height="${H - 31}" rx="6" fill="var(--card)" stroke="var(--line)"${GATE.has(st) ? ' stroke-dasharray="4 3"' : ''}/>`
    body += `<text class="m px" x="${x + 10}" y="16" font-size="11">${st.toUpperCase()}${GATE.has(st) ? ' · YOU' : ''}</text>`
    const list = lanes[st]
    list.slice(0, shown).forEach((j, k) => {
      const name = j.job.split('/').pop() ?? j.job
      body += `<text class="${st === 'done' ? 'm' : 't'}" x="${x + 10}" y="${38 + k * 20}" font-size="14">${esc(cut(name, 12))}</text>`
    })
    if (list.length > shown) body += `<text class="m" x="${x + 10}" y="${38 + shown * 20}" font-size="12">+${list.length - shown} more</text>`
  })
  const spend = d.spend_usd ?? 0
  const cap = d.cap_usd ?? 0
  if (cap > 0) {
    body += bar(0, H - 14, W - 190, spend / cap, spend / cap > 0.8 ? 'var(--reject)' : 'var(--ok)')
    body += `<text class="m px" x="${W}" y="${H - 8}" font-size="13" text-anchor="end">spent $${spend.toFixed(2)} of $${cap.toFixed(2)}</text>`
  }
  const waiting = jobs.filter(j => GATE.has(j.stage)).length
  return {
    height: H,
    alt: `${jobs.length} jobs, ${waiting} at a review gate; spent $${spend.toFixed(2)} of $${cap.toFixed(2)}`,
    source: svg(H, body),
  }
}

// info-collector writes one file per profile: collector-tech-news.json, collector-jobs.json, …
export const COLLECTOR = 'collector-'
// info-collector counts one page of notion results, so 100 means "100 or more"
export const PENDING_CAP = 100

const count = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x) : null)

// detail.counts of a collector-<profile> card; null for an older file without it (or a broken one).
// A stage number that is missing or odd counts as 0; a pending that is not a number means
// notion was not read.
export function collectorCounts(s: Status): CollectorCounts | null {
  const c = ((s.detail ?? {}) as CollectorDetail).counts
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return null
  const collected = count(c.collected)
  if (collected == null) return null
  return { collected, new: count(c.new) ?? 0, scored: count(c.scored) ?? 0, sent: count(c.sent) ?? 0, unsent: count(c.unsent) ?? 0, pending: count(c.pending) }
}

const toReview = (p: number | null) => (p == null ? '?' : p >= PENDING_CAP ? `${PENDING_CAP}+` : String(p))

// This run's four stages left to right, then two boxes: what waits for your review in notion
// (dashed, like ai-video's review gates only you pass) and what scored high but is not in notion
// yet. The bars are scaled to the run's largest count, not the stage before: older unscored items
// are scored too, and earlier runs' picks are sent too, so it is not a strict funnel.
function collectorPicture(s: Status): Picture | null {
  const c = collectorCounts(s)
  if (!c) return null
  const H = 62
  const COL = 96
  const BOX = 112
  const stages: [string, number][] = [['collected', c.collected], ['new', c.new], ['scored', c.scored], ['sent', c.sent]]
  const top = Math.max(1, ...stages.map(([, n]) => n))
  let body = ''
  stages.forEach(([name, n], i) => {
    const x = i * COL
    // a count above 0 always shows a little fill
    const part = n > 0 ? Math.max(n / top, 4 / (COL - 20)) : 0
    body += `<text class="m px" x="${x}" y="14" font-size="12">${name}</text>` +
      `<text class="t" x="${x}" y="40" font-size="22">${n}</text>` + bar(x, 50, COL - 20, part)
    if (i < stages.length - 1) body += `<text class="m" x="${x + COL - 14}" y="37" font-size="16">›</text>`
  })
  const box = (x: number, name: string, value: string, color: string, isOn: boolean, isGate: boolean) =>
    `<rect x="${x + 0.5}" y="0.5" width="${BOX - 1}" height="${H - 1}" rx="6" fill="var(--card)" stroke="${isOn ? color : 'var(--line)'}"${isGate ? ' stroke-dasharray="4 3"' : ''}/>` +
    `<rect x="${x + 10}" y="6" width="8" height="8" rx="1" fill="${isOn ? color : 'var(--line)'}"/>` +
    `<text class="m px" x="${x + 22}" y="14" font-size="12">${name}</text>` +
    `<text class="${isOn ? 't' : 'm'}" x="${x + 10}" y="40" font-size="22">${value}</text>`
  const review = W - 2 * BOX - 12
  body += box(review, 'to review', toReview(c.pending), 'var(--listen)', (c.pending ?? 0) > 0, true)
  if (c.pending == null) body += `<text class="m" x="${review + 10}" y="54" font-size="10">notion not read</text>`
  body += box(W - BOX, 'unsent', String(c.unsent), 'var(--reject)', c.unsent > 0, false)
  const notion = c.pending == null ? 'notion not read' : `${toReview(c.pending)} to review in notion`
  return {
    height: H,
    alt: `collected ${c.collected}, new ${c.new}, scored ${c.scored}, sent ${c.sent}; ${notion}; ${c.unsent} unsent`,
    source: svg(H, body),
  }
}

// The same details as text, for surfaces without Svg (the terminal).
export function detailLines(s: Status): string[] {
  if (s.pipeline === 'music') {
    const d = (s.detail ?? {}) as MusicDetail
    const b = d.batches?.[0]
    if (!b) return []
    const failed = b.errors ? ` · failed ${b.errors}` : ''
    const comfy = d.comfy ? ` · comfy ${d.comfy.up ? 'up' : 'down'}` : ''
    return [`${b.name}: made ${b.generated ?? 0} · ok ${b.ok ?? 0} · to hear ${b.needs_listen ?? 0} · rejected ${b.rejected ?? 0}${failed}${comfy}`]
  }
  if (s.pipeline === 'ai-video') {
    const d = (s.detail ?? {}) as VideoDetail
    const jobs = d.jobs ?? []
    if (!jobs.length) return []
    const lanes = byStage(jobs)
    const lines = STAGES.filter(st => lanes[st].length).map(st =>
      `${st}${GATE.has(st) ? ' (you)' : ''}: ${lanes[st].map(j => j.job.split('/').pop() ?? j.job).join(', ')}`)
    if (d.cap_usd) lines.push(`spent $${(d.spend_usd ?? 0).toFixed(2)} of $${d.cap_usd.toFixed(2)}`)
    return lines
  }
  if (s.pipeline.startsWith(COLLECTOR)) {
    const c = collectorCounts(s)
    if (!c) return []
    return [
      `collected ${c.collected} › new ${c.new} › scored ${c.scored} › sent ${c.sent}`,
      `to review ${c.pending == null ? '? (notion not read)' : toReview(c.pending)} · unsent ${c.unsent}`,
    ]
  }
  return []
}

export function picture(s: Status, isStale: boolean): Picture | null {
  if (s.pipeline === 'music') return musicPicture(s, isStale) ?? progressPicture(s)
  if (s.pipeline === 'ai-video') return videoPicture(s) ?? progressPicture(s)
  if (s.pipeline.startsWith(COLLECTOR)) return collectorPicture(s) ?? progressPicture(s)
  return progressPicture(s)
}

// The puppy beside the pane's first row, as puppy-skills draws it: typing at its laptop while a
// conversation is running, sitting (and blinking) while one waits for you, asleep when nothing goes on.
export type Mood = 'typing' | 'sitting' | 'sleeping'
const MOODS: Record<Mood, { frames: string[]; seconds: number }> = {
  // slower than the pet's 6 fps: motion stays slow and small
  typing: { frames: [typing0, typing1, typing2, typing3, typing4, typing5], seconds: 2.4 },
  sitting: { frames: [sit, sit, sit, sit, sit, sit, sit, sit, sit, sitBlink], seconds: 4 },
  sleeping: { frames: [sleep0, sleep1], seconds: 3 },
}
export const MASCOT_SCALE = 2

// one frame shown at a time, swapped by SMIL; each frame is visible for its share of the loop
export function mascot(mood: Mood): string {
  const { frames, seconds } = MOODS[mood]
  const n = frames.length
  const keyTimes = frames.map((_, i) => (i / n).toFixed(4)).join(';')
  const body = frames.map((rects, i) => {
    const values = frames.map((_, j) => (j === i ? 'visible' : 'hidden')).join(';')
    return `<g visibility="${i === 0 ? 'visible' : 'hidden'}">${rects}` +
      `<animate attributeName="visibility" values="${values}" keyTimes="${keyTimes}" dur="${seconds}s" repeatCount="indefinite" calcMode="discrete"/></g>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${34 * MASCOT_SCALE}" height="${26 * MASCOT_SCALE}" viewBox="0 0 34 26" shape-rendering="crispEdges">${body}</svg>`
}

// The same puppy for a surface with no Svg (the terminal), from baibai-brand's block output:
// each character holds two pixels stacked, as Claude Code draws its mascot. One still frame per
// mood: redrawing the pane a few times a second would flicker, and the puppy moves slowly anyway.
// The pane's rows (e.props.scroll.bodyRows) the block puppy needs: its 13 rows take at most half.
// Shorter, it is left out, never shrunk. puppy-todo and puppy-skills use the same number.
export const PUPPY_MIN_ROWS = 26
const STILLS: Record<Mood, BlockRun[][]> = { typing: blockTyping0, sitting: blockSit, sleeping: blockSleep0 }
export const stillBlocks = (mood: Mood): BlockRun[][] => STILLS[mood]
