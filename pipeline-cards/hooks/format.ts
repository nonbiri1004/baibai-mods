// Reading one status file (FORMAT.md). Pure functions, so the tests need no engine.
import type { State, Status } from '../types'

const STATES: readonly State[] = ['running', 'idle', 'waiting', 'error']

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// Only what the card needs is checked; a pipeline can add any field it likes.
export function parseStatus(text: string): Status {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    throw new Error('not json (maybe being written; next refresh reads it again)')
  }
  if (!isObject(v) || v.format !== 'pipeline-status') throw new Error('no "format": "pipeline-status" (an older status file?)')
  if (v.version !== 1) throw new Error(`format version ${String(v.version)}; this mod reads version 1`)
  if (typeof v.pipeline !== 'string' || !v.pipeline) throw new Error('no "pipeline"')
  if (typeof v.updated !== 'string' || Number.isNaN(Date.parse(v.updated))) throw new Error('"updated" is not a time')
  if (!STATES.includes(v.state as State)) throw new Error(`"state" must be one of ${STATES.join(', ')}`)
  if (typeof v.headline !== 'string') throw new Error('no "headline"')
  if (v.waiting != null && !Array.isArray(v.waiting)) throw new Error('"waiting" is not a list')
  return {
    ...(v as unknown as Status),
    waiting: ((v.waiting as unknown[] | undefined) ?? []).filter(isObject).map(w => ({
      id: String(w.id ?? ''),
      text: String(w.text ?? ''),
      ...(typeof w.since === 'string' ? { since: w.since } : {}),
    })),
  }
}

// Quiet for longer than the writer promised. A file without stale_after_sec is never stale.
export function isStale(s: Status, now: number): boolean {
  return s.stale_after_sec != null && now - Date.parse(s.updated) > s.stale_after_sec * 1000
}

// Cards that need you come first: waiting, then error, then running, then idle; ties by title.
const ORDER: Record<State, number> = { waiting: 0, error: 1, running: 2, idle: 3 }
export function sortCards(cards: Status[]): Status[] {
  return [...cards].sort((a, b) => ORDER[a.state] - ORDER[b.state] || titleOf(a).localeCompare(titleOf(b)))
}

export const titleOf = (s: Status) => s.title || s.pipeline

export function ago(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h}h ${min % 60}m ago`
  return `${Math.floor(h / 24)}d ago`
}

// A text progress bar for surfaces without Svg: ▓▓▓▓░░░░░░ 42/70 usable songs
export function textBar(p: NonNullable<Status['progress']>, width = 10): string {
  const unit = p.unit ? ` ${p.unit}` : ''
  if (!p.total) return `${p.done}${unit}`
  const filled = Math.round(Math.max(0, Math.min(1, p.done / p.total)) * width)
  return `${'▓'.repeat(filled)}${'░'.repeat(width - filled)} ${p.done}/${p.total}${unit}`
}

// "~/x" → "<home>/x"; the folder setting is typed by hand.
export function expandHome(path: string, home: string | undefined): string {
  return home && (path === '~' || path.startsWith('~/')) ? home + path.slice(1) : path
}
