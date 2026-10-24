// The picture under each card, as an SVG string: a progress bar for any pipeline, and a richer
// picture for the details this mod knows (music, ai-video). Warm greys, light by day and dark by
// night, low contrast; the only orange is the puppy's headphones.
import type { MusicDetail, Stage, Status, VideoDetail, VideoJob } from '../types'
import { sit, sitBlink, sleep0, sleep1 } from './puppy'

export const W = 640

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Cut a label to fit; SVG text does not wrap.
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const STYLE = `<style>
  svg{--card:#f8f7f4;--line:#dcdad4;--text:#2a2926;--muted:#6d6a64;--ok:#7f9a72;--listen:#c2a768;--reject:#b98276}
  @media (prefers-color-scheme: dark){svg{--card:#232321;--line:#353431;--text:#e7e5e0;--muted:#9b9891;
    --ok:#86a078;--listen:#bfa66a;--reject:#b07e73}}
  .t{fill:var(--text);font-family:ui-sans-serif,system-ui,sans-serif}
  .m{fill:var(--muted);font-family:ui-sans-serif,system-ui,sans-serif}
  .px{font-family:ui-monospace,Menlo,monospace;letter-spacing:.5px}
</style>`

const svg = (h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}">${STYLE}${body}</svg>`

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
  const comfy = d.comfy ? (d.comfy.up ? 'comfy up' : 'comfy down') : ''
  body += `<text class="m px" x="0" y="${H - 4}" font-size="9">${esc([comfy, s.host ?? ''].filter(Boolean).join(' · ').toUpperCase())}</text>`

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
      `<text class="m" x="${x0 + 12 + i * 78}" y="${H - 5}" font-size="10">${name}</text>`
  })
  if (b.avg_gen_sec) body += `<text class="m px" x="${W}" y="${H - 5}" font-size="10" text-anchor="end">${Math.round(b.avg_gen_sec / 60)} min / song</text>`
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
  const H = 34 + shown * 18 + 30
  let body = ''
  STAGES.forEach((st, i) => {
    const x = i * colW
    body += `<rect x="${x + 2}" y="0.5" width="${colW - 4}" height="${H - 31}" rx="6" fill="var(--card)" stroke="var(--line)"${GATE.has(st) ? ' stroke-dasharray="4 3"' : ''}/>`
    body += `<text class="m px" x="${x + 10}" y="16" font-size="9">${st.toUpperCase()}${GATE.has(st) ? ' · YOU' : ''}</text>`
    const list = lanes[st]
    list.slice(0, shown).forEach((j, k) => {
      const name = j.job.split('/').pop() ?? j.job
      body += `<text class="${st === 'done' ? 'm' : 't'}" x="${x + 10}" y="${36 + k * 18}" font-size="11">${esc(cut(name, 12))}</text>`
    })
    if (list.length > shown) body += `<text class="m" x="${x + 10}" y="${36 + shown * 18}" font-size="10">+${list.length - shown} more</text>`
  })
  const spend = d.spend_usd ?? 0
  const cap = d.cap_usd ?? 0
  if (cap > 0) {
    body += bar(0, H - 14, W - 190, spend / cap, spend / cap > 0.8 ? 'var(--reject)' : 'var(--ok)')
    body += `<text class="m px" x="${W}" y="${H - 8}" font-size="11" text-anchor="end">spent $${spend.toFixed(2)} of $${cap.toFixed(2)}</text>`
  }
  const waiting = jobs.filter(j => GATE.has(j.stage)).length
  return {
    height: H,
    alt: `${jobs.length} jobs, ${waiting} at a review gate; spent $${spend.toFixed(2)} of $${cap.toFixed(2)}`,
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
  return []
}

export function picture(s: Status, isStale: boolean): Picture | null {
  if (s.pipeline === 'music') return musicPicture(s, isStale) ?? progressPicture(s)
  if (s.pipeline === 'ai-video') return videoPicture(s) ?? progressPicture(s)
  return progressPicture(s)
}
