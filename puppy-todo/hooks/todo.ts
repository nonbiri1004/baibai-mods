// the parts with no $: ids, parsing transcripts and items, sorting. tests import these.
import type { Item, Kind, Pr, Talk } from '../types'

export const KINDS: readonly Kind[] = ['todo', 'ask', 'later']
// the puppy at the top of the pane, no headphones (a to-do isn't music, so no orange either):
// calm most of the time, hello while a conversation waits on you, happy when nothing is left
export type Mood = 'calm' | 'hello' | 'happy'
export const FACES: Record<Mood, string> = { calm: '•ᴥ•', hello: '°ᴥ°', happy: '^ᴥ^' }

export function mood(waiting: number, open: number): Mood {
  if (waiting > 0) {
    return 'hello'
  }

  return open === 0 ? 'happy' : 'calm'
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

// open first (oldest first, so nothing sinks), then recently done
export function shown(items: readonly Item[], now: number): Item[] {
  const open = items.filter(i => i.status === 'open').sort((a, b) => a.id.localeCompare(b.id))
  const done = items
    .filter(i => i.status === 'done' && i.doneAt && now - Date.parse(i.doneAt) < DONE_DAYS * DAY)
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))

  return [...open, ...done]
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
  const finish = () => {
    if (talk) {
      talks.push({ ...talk, ask: isOpen ? ask : undefined })
    }
  }
  for (const line of out.split('\n')) {
    if (line.startsWith('\x1e')) {
      finish()
      const path = line.slice(1)
      const id = path.slice(path.lastIndexOf('/') + 1).replace(/\.jsonl$/, '')
      talk = { id, title: '', project: '', prs: [], mtimeMs: mtimes.get(path) ?? 0 }
      isOpen = false
      ask = undefined
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
        isOpen = wrap.ask !== undefined
      }
    }
  }
  finish()

  return talks
}

function wrapUpOf(row: Record<string, unknown>): { recap?: string; ask?: string } | null {
  const content = (row.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) {
    return null
  }
  for (const block of content) {
    const b = block as { type?: string; name?: string; input?: { recap?: unknown; ask?: unknown } }
    if (b.type === 'tool_use' && b.name === 'mcp__ccd_turn__wrap_up' && b.input) {
      return {
        recap: typeof b.input.recap === 'string' ? b.input.recap : undefined,
        ask: typeof b.input.ask === 'string' && b.input.ask ? b.input.ask : undefined,
      }
    }
  }

  return null
}

// `gh search prs --json number,title,repository,url,isDraft`
export function parsePrs(out: string): Pr[] {
  try {
    const list = JSON.parse(out) as {
      number: number
      title: string
      url: string
      isDraft: boolean
      repository: { name: string }
    }[]

    return list.map(p => ({ repo: p.repository.name, number: p.number, title: p.title, url: p.url, isDraft: p.isDraft }))
  } catch {
    return []
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
