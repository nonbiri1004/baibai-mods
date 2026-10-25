// the parts with no $: ids, parsing transcripts and items, sorting. tests import these.
import type { Attention, Item, Kind, Outcome, Pr, PrSource, PrState, Talk } from '../types'

export const KINDS: readonly Kind[] = ['todo', 'ask', 'later']
// the puppy at the top of the pane, no headphones (a to-do isn't music, so no orange either):
// calm most of the time, hello while a conversation waits on you, happy only when nothing is left,
// skipped rows included (a skipped row is hidden, not done)
export type Mood = 'calm' | 'hello' | 'happy'
export const FACES: Record<Mood, string> = { calm: '•ᴥ•', hello: '°ᴥ°', happy: '^ᴥ^' }

export function mood(waiting: number, open: number, skipped = 0): Mood {
  if (waiting > 0) {
    return 'hello'
  }

  return open === 0 && skipped === 0 ? 'happy' : 'calm'
}

// the words beside the face
export function saying(face: Mood, waiting: number, open: number, skipped: number): string {
  const tail = skipped > 0 ? ` · ${skipped} skipped` : ''
  if (face === 'hello') {
    return `${waiting} waiting on you${tail}`
  }
  if (face === 'happy') {
    return 'all clear'
  }

  return open > 0 ? `${open} open${tail}` : `nothing to show${tail}`
}

// done items stay visible this long, then only the file remains
export const DONE_DAYS = 3
const DAY = 86_400_000

// 20261024-1432-k3f9: sorts by time, short enough to type
export function newId(now: number, rand: () => number = Math.random): string {
  const d = new Date(now)
  const two = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`
  const tail = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0')

  return `${stamp}-${tail}`
}

// a repo's name from its working folder: worktrees count as their repo
export function projectOf(cwd: string): string {
  const repo = cwd.replace(/\/\.claude\/worktrees\/[^/]+\/?$/, '').replace(/\/+$/, '')

  return repo.slice(repo.lastIndexOf('/') + 1) || repo
}

// a file someone (or another AI) wrote by hand: keep what is usable, drop the rest
export function parseItem(text: string): Item | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.text !== 'string' || o.text.trim() === '') {
    return null
  }
  const kind = KINDS.includes(o.kind as Kind) ? (o.kind as Kind) : 'todo'

  return {
    ...(o as Partial<Item>),
    id: o.id,
    text: o.text.trim(),
    project: typeof o.project === 'string' && o.project ? o.project : 'misc',
    kind,
    status: o.status === 'done' ? 'done' : 'open',
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
  }
}

// https://github.com/<owner>/<repo>/pull/<n>, nothing else
export function parsePrUrl(url: string): PrSource | null {
  const m = /^https:\/\/(github\.com)\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\/?$/.exec(url.trim())

  return m && m[1] && m[2] && m[3] ? { type: 'github-pr', host: m[1], repo: m[2], number: Number(m[3]) } : null
}

export function prKey(s: PrSource): string {
  return `${s.host}/${s.repo}#${s.number}`
}

export function prUrl(s: PrSource): string {
  return `https://${s.host}/${s.repo}/pull/${s.number}`
}

// the PR an item waits on, when its completion says so
export function sourceOf(item: Item): PrSource | null {
  const s = item.source
  if (item.completion?.mode !== 'source' || s?.type !== 'github-pr') {
    return null
  }

  return typeof s.repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(s.repo) && Number.isInteger(s.number) && s.number > 0
    ? { type: 'github-pr', host: 'github.com', repo: s.repo, number: s.number }
    : null
}

// is it done? a source item asks its source and ignores what the file says;
// a declared item believes the file, and says who said it
export function outcomeOf(item: Item, prStates: Readonly<Record<string, PrState>>): Outcome {
  if (item.completion?.mode === 'source') {
    const source = sourceOf(item)
    if (!source || (item.completion.condition ?? 'merged') !== 'merged') {
      return { state: 'unknown', basis: 'source', why: 'the done rule in the file is not understood' }
    }
    const pr = prStates[prKey(source)]
    if (!pr) {
      return { state: 'unknown', basis: 'source', why: 'not checked on github yet' }
    }
    if (pr.state === 'MERGED') {
      return { state: 'done', basis: 'source', why: 'merged', endedAt: pr.endedAt }
    }
    if (pr.state === 'CLOSED') {
      return { state: 'canceled', basis: 'source', why: 'closed without merge', endedAt: pr.endedAt }
    }

    return { state: 'open', basis: 'source', why: 'done when the PR merges' }
  }
  if (item.completion !== undefined && item.completion.mode !== 'declared') {
    return { state: 'unknown', basis: 'declared', why: 'the done rule in the file is not understood' }
  }
  if (item.status !== 'done') {
    return { state: 'open', basis: item.completion ? 'declared' : 'legacy' }
  }
  const d = item.declaration
  if (d && typeof d.by === 'string') {
    const said = d.recordedBy && d.recordedBy !== d.by ? `${d.by} said done (noted by ${d.recordedBy})` : `${d.by} said done`

    return { state: 'done', basis: 'declared', why: said, endedAt: d.at || item.doneAt }
  }

  return { state: 'done', basis: 'legacy', why: 'marked done, nobody recorded who', endedAt: item.doneAt }
}

// the item after someone says it is done: who said it, who wrote it down, when
export function declareDone(item: Item, how: { by: string; note?: string; at?: string } = { by: 'person' }): Item {
  const at = how.at ?? new Date().toISOString()
  const { declaration: _gone, doneAt: _alsoGone, ...rest } = item

  return {
    ...rest,
    schemaVersion: 2,
    completion: item.completion ?? { mode: 'declared' },
    status: 'done',
    doneAt: at,
    declaration: { by: how.by, ...(how.by !== 'claude' ? { recordedBy: 'claude' } : {}), at, ...(how.note ? { note: how.note } : {}) },
  }
}

// the item open again: the old declaration no longer holds
export function reopen(item: Item): Item {
  const { declaration: _gone, doneAt: _alsoGone, ...rest } = item

  return { ...rest, schemaVersion: 2, completion: item.completion ?? { mode: 'declared' }, status: 'open' }
}

// what to say when someone tries to mark a PR item done: github is asked instead.
// fresh is what github just said (empty when it could not be asked); known is what the pane knew
export function prAnswer(item: Item, fresh: Readonly<Record<string, PrState>>, known: Readonly<Record<string, PrState>>): { states: Record<string, PrState>; said: string } {
  const states = { ...known, ...fresh }
  const o = outcomeOf(item, fresh)

  return { states, said: `not changed: this item is done when github says so. github: ${o.state} (${o.why ?? ''})` }
}

const isOpen = (o: Outcome) => o.state === 'open' || o.state === 'unknown'

// open first (oldest first, so nothing sinks), then what ended in the last few days
export function shown(items: readonly Item[], prStates: Readonly<Record<string, PrState>>, now: number): Item[] {
  const withOutcome = items.map(i => ({ i, o: outcomeOf(i, prStates) }))
  const open = withOutcome.filter(x => isOpen(x.o)).sort((a, b) => a.i.id.localeCompare(b.i.id))
  const ended = withOutcome
    .filter(x => !isOpen(x.o) && x.o.endedAt && now - Date.parse(x.o.endedAt) < DONE_DAYS * DAY)
    .sort((a, b) => (b.o.endedAt ?? '').localeCompare(a.o.endedAt ?? ''))

  return [...open, ...ended].map(x => x.i)
}

export function isOpenItem(item: Item, prStates: Readonly<Record<string, PrState>>): boolean {
  return isOpen(outcomeOf(item, prStates))
}

// a conversation as a person knows it: its title and folder. the engine's session id changes
// each time the app opens it again, so it can't tie rows to one conversation on its own
export function talkKey(title: string, cwd: string): string {
  return `${title}\u0000${cwd}`
}

// the newest transcript of each conversation; older ones of the same conversation are past turns
export function newestTalks(talks: readonly Talk[]): Talk[] {
  const best = new Map<string, Talk>()
  for (const t of talks) {
    const key = talkKey(t.title, t.cwd)
    const was = best.get(key)
    if (!was || t.mtimeMs > was.mtimeMs) {
      best.set(key, t)
    }
  }

  return talks.filter(t => best.get(talkKey(t.title, t.cwd)) === t)
}

// an item belongs to this conversation when this session wrote it, or a past session of the same
// conversation did (same title and folder)
export function isHere(item: Item, here: { id: string; title: string; cwd: string }): boolean {
  const s = item.session
  if (!s) {
    return false
  }

  return s.id === here.id || (here.title !== '' && s.title === here.title && s.cwd === here.cwd)
}

// skips: one row each, and each skip covers one occurrence of it
export const target = {
  item: (i: Item) => `item:${i.id}`,
  ask: (t: Talk) => `ask:${talkKey(t.title, t.cwd)}`,
  pr: (p: Pr) => `pr:${p.url}`,
}

// a changed text, a reopened item or a new done rule is a new occurrence
export function itemOccurrence(i: Item): string {
  return [i.text, i.status, i.completion?.mode ?? '', i.source ? prKey(i.source as PrSource) : ''].join('\u0000')
}

export const occurrence = {
  item: itemOccurrence,
  // a new wrap-up question has a new tool use id
  ask: (t: Talk) => t.askId ?? t.ask ?? '',
  // new activity on the PR brings it back
  pr: (p: Pr) => p.updatedAt,
}

export function isSkipped(attention: Readonly<Record<string, Attention>>, what: string, now: string): boolean {
  const a = attention[what]

  return a?.state === 'dismissed' && a.occurrence === now
}

export function parseAttention(text: string): Attention | null {
  try {
    const o = JSON.parse(text) as Partial<Attention>
    if (o.version !== 1 || typeof o.target !== 'string' || typeof o.occurrence !== 'string') {
      return null
    }
    if (o.state !== 'dismissed' && o.state !== 'active') {
      return null
    }

    return { version: 1, target: o.target, state: o.state, occurrence: o.occurrence, at: String(o.at ?? ''), by: String(o.by ?? '') }
  } catch {
    return null
  }
}

// the attention file's name: a hash of the target, so a URL or a title never becomes a path.
// the file holds the target too, and a file whose target doesn't match is ignored
export function attentionFile(what: string): string {
  // FNV-1a, 64 bit
  let h = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(what)) {
    h ^= BigInt(byte)
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }

  return `${h.toString(16).padStart(16, '0')}.json`
}

export function byProject<T extends { project: string }>(list: readonly T[]): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const one of list) {
    groups.set(one.project, [...(groups.get(one.project) ?? []), one])
  }

  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

// the lines SCAN prints: \x1e<path> starts a file, U stands for something the person typed,
// C:"<cwd>" is the last working folder, every other line is a whole transcript row
export function parseScan(out: string, mtimes: ReadonlyMap<string, number>): Talk[] {
  const talks: Talk[] = []
  let talk: Talk | null = null
  // whether the last wrap-up still waits: nothing typed after it
  let isOpen = false
  let ask: string | undefined
  let askId: string | undefined
  const finish = () => {
    if (talk) {
      talks.push({ ...talk, ask: isOpen ? ask : undefined, askId: isOpen ? askId : undefined })
    }
  }
  for (const line of out.split('\n')) {
    if (line.startsWith('\x1e')) {
      finish()
      const path = line.slice(1)
      const id = path.slice(path.lastIndexOf('/') + 1).replace(/\.jsonl$/, '')
      talk = { id, title: '', project: '', cwd: '', prs: [], mtimeMs: mtimes.get(path) ?? 0 }
      isOpen = false
      ask = undefined
      askId = undefined
      continue
    }
    if (!talk || line === '') {
      continue
    }
    if (line === 'U') {
      isOpen = false
      continue
    }
    if (line.startsWith('C:')) {
      const cwd = line.slice(2).replace(/^"cwd":"|"$/g, '')
      talk.cwd = cwd
      talk.project = projectOf(cwd)
      continue
    }
    let row: Record<string, unknown>
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row.type === 'custom-title' && typeof row.customTitle === 'string') {
      talk.title = row.customTitle
    } else if (row.type === 'pr-link' && typeof row.prUrl === 'string') {
      if (!talk.prs.includes(row.prUrl)) {
        talk.prs.push(row.prUrl)
      }
    } else if (row.type === 'assistant') {
      const wrap = wrapUpOf(row)
      if (wrap) {
        talk.recap = wrap.recap
        ask = wrap.ask
        askId = wrap.id
        isOpen = wrap.ask !== undefined
      }
    }
  }
  finish()

  return talks
}

function wrapUpOf(row: Record<string, unknown>): { recap?: string; ask?: string; id?: string } | null {
  const content = (row.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) {
    return null
  }
  for (const block of content) {
    const b = block as { type?: string; id?: unknown; name?: string; input?: { recap?: unknown; ask?: unknown } }
    if (b.type === 'tool_use' && b.name === 'mcp__ccd_turn__wrap_up' && b.input) {
      return {
        id: typeof b.id === 'string' ? b.id : undefined,
        recap: typeof b.input.recap === 'string' ? b.input.recap : undefined,
        ask: typeof b.input.ask === 'string' && b.input.ask ? b.input.ask : undefined,
      }
    }
  }

  return null
}

// `gh search prs --json number,title,repository,url,isDraft,updatedAt`
export function parsePrs(out: string): Pr[] {
  try {
    const list = JSON.parse(out) as {
      number: number
      title: string
      url: string
      isDraft: boolean
      updatedAt?: string
      repository: { name: string }
    }[]

    return list.map(p => ({
      repo: p.repository.name,
      number: p.number,
      title: p.title,
      url: p.url,
      isDraft: p.isDraft,
      updatedAt: p.updatedAt ?? '',
    }))
  } catch {
    return []
  }
}

// `gh pr view --json state,mergedAt,closedAt`
export function parsePrState(out: string): PrState | null {
  try {
    const o = JSON.parse(out) as { state?: string; mergedAt?: string | null; closedAt?: string | null }
    if (o.state === 'MERGED') {
      return { state: 'MERGED', endedAt: o.mergedAt ?? o.closedAt ?? undefined }
    }
    if (o.state === 'CLOSED') {
      return { state: 'CLOSED', endedAt: o.closedAt ?? undefined }
    }

    return o.state === 'OPEN' ? { state: 'OPEN' } : null
  } catch {
    return null
  }
}

export function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()

  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

export function clockTime(ms: number): string {
  const d = new Date(ms)

  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function ago(now: number, ms: number): string {
  const m = Math.round((now - ms) / 60_000)
  if (m < 60) {
    return `${Math.max(m, 0)}m`
  }
  const hours = Math.round(m / 60)

  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}
