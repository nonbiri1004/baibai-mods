// what every conversation's pane shares through files in ~/.claude/todo, so twenty open
// conversations do the work of one: transcripts read once, each PR asked once. no $ here: tests import these.
import type { PrState, Talk } from '../types'

// what a transcript said when its file had this mtime
export type Read = { mtimeMs: number; talk: Talk }
// one conversation reads transcripts at a time; it holds this until `until`
export type Lease = { owner: string; until: number }
// what github last said about a PR (none when it couldn't be asked), and when it was asked
export type PrCheck = { state?: PrState; checkedAt: number }

// a lease outlives one slow pass, so a pane that quit mid-pass blocks the rest this long at most
export const LEASE_MS = 3 * 60_000
// transcripts per scan: a timeout loses one batch, and what came before it is kept
export const SCAN_BATCH = 8
// an open PR is asked again after this; a merged or closed one only when someone asks
export const PR_EVERY = 5 * 60_000

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const o: unknown = JSON.parse(text)

    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// half a file (read while another pane wrote it) is no file: the work is done again, nothing worse
export function parseReads(text: string): Map<string, Read> {
  const out = new Map<string, Read>()
  const o = parseObject(text)
  for (const [path, r] of Object.entries(o ?? {})) {
    const read = r as Partial<Read> | null
    if (read && typeof read.mtimeMs === 'number' && read.talk && typeof read.talk.id === 'string') {
      out.set(path, { mtimeMs: read.mtimeMs, talk: read.talk })
    }
  }

  return out
}

// what's kept for the next pane: transcripts changed since `since`
export function writeReads(reads: ReadonlyMap<string, Read>, since: number): string {
  return JSON.stringify(Object.fromEntries([...reads].filter(([, r]) => r.mtimeMs >= since)))
}

// takes what another pane read that is newer than ours
export function mergeReads(into: Map<string, Read>, from: ReadonlyMap<string, Read>): void {
  for (const [path, r] of from) {
    const mine = into.get(path)
    if (!mine || mine.mtimeMs < r.mtimeMs) {
      into.set(path, r)
    }
  }
}

export function parseLease(text: string): Lease | null {
  const o = parseObject(text)

  return o && typeof o.owner === 'string' && typeof o.until === 'number' ? { owner: o.owner, until: o.until } : null
}

// free when nobody holds it, it ran out, or it's ours already
export function canTake(lease: Lease | null, owner: string, now: number): boolean {
  return lease === null || lease.until <= now || lease.owner === owner
}

export function parsePrChecks(text: string): Record<string, PrCheck> {
  const out: Record<string, PrCheck> = {}
  for (const [key, c] of Object.entries(parseObject(text) ?? {})) {
    const check = c as Partial<PrCheck> | null
    if (check && typeof check.checkedAt === 'number') {
      out[key] = check.state ? { state: check.state, checkedAt: check.checkedAt } : { checkedAt: check.checkedAt }
    }
  }

  return out
}

// never asked: now. merged or closed: it stays so. open, or the last ask failed: after PR_EVERY
export function isPrDue(check: PrCheck | undefined, now: number): boolean {
  if (!check) {
    return true
  }
  if (check.state && check.state.state !== 'OPEN') {
    return false
  }

  return now - check.checkedAt >= PR_EVERY
}

// a failed ask keeps what github said before, so a PR doesn't blink to unknown
export function recordPr(was: PrCheck | undefined, state: PrState | null, now: number): PrCheck {
  const kept = state ?? was?.state

  return kept ? { state: kept, checkedAt: now } : { checkedAt: now }
}

export function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size))
  }

  return out
}

// runs `fn` on each, at most `limit` at once, in order
export async function mapLimit<T, U>(list: readonly T[], limit: number, fn: (x: T) => Promise<U>): Promise<U[]> {
  const out: U[] = []
  for (const batch of chunks(list, limit)) {
    out.push(...(await Promise.all(batch.map(fn))))
  }

  return out
}

// asked while a pass runs: one more pass after it, never two at once. asked by the person
// (isAsked) wins over a plain tick, so the next pass asks github too
export class Gate<O extends { isAsked?: boolean }> {
  private running: Promise<void> | null = null
  private queued: O | null = null

  constructor(private readonly run: (o: O) => Promise<void>) {}

  ask(o: O): Promise<void> {
    if (this.running) {
      this.queued = this.queued ? { ...this.queued, ...o, isAsked: Boolean(this.queued.isAsked || o.isAsked) } : o

      return this.running
    }
    this.running = (async () => {
      let next: O | null = o
      while (next) {
        this.queued = null
        await this.run(next).catch(() => undefined)
        next = this.queued
      }
      this.running = null
    })()

    return this.running
  }
}
