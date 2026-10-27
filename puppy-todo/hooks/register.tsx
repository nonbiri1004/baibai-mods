import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Convo, Item, PrSource, PrState, Session, Talk, View, WorktreeState } from '../types'
import { iconSvg, MARKS } from './icons'
import type { IconName } from './icons'
import { folderFiles, isWorktree, matchByTime, parseSessions, parseWorktree, pickByTitle, sortConvos, verdictOf } from './convos'
import {
  Gate,
  LEASE_MS,
  LEASE_SETTLE_MS,
  SCAN_BATCH,
  canTake,
  chunks,
  isPrDue,
  mapLimit,
  mergeReads,
  parseLease,
  parsePrChecks,
  parseReads,
  recordPrs,
  writeReads,
} from './shared'
import type { Read } from './shared'
import {
  FACES,
  ago,
  bornAt,
  byProject,
  clip,
  clockTime,
  declareDone,
  deleteItem,
  isHere,
  isOpenItem,
  mood,
  newId,
  newestTalks,
  outcomeOf,
  parseItem,
  parsePrState,
  parsePrUrl,
  parseScan,
  prAnswer,
  prKey,
  prUrl,
  projectOf,
  recentAsks,
  reopen,
  saying,
  shortLink,
  shown,
  similarOpen,
  sourceOf,
} from './todo'

const PANE = 'puppy-todo'
// conversations older than this, or past this many, are left out of "asked you"
const TALK_DAYS = 14
const TALK_MAX = 40
// how often the pane looks again (the shared list, transcripts); gh only when a PR is due (shared.ts)
const TICK = 60_000
const TICK_JITTER = 10_000

const EMPTY: View = {
  here: { id: '', title: '', project: '', cwd: '' },
  talks: [],
  items: [],
  prStates: {},
  convos: null,
  isShowingDone: false,
  isShowingConvos: false,
  isShowingAllAsks: false,
  isShowingInProject: false,
  openProjects: [],
  openItem: null,
  at: null,
  notes: [],
}
const view = atom({ plugin: 'puppy-todo', key: 'view' } as const, EMPTY)

// per transcript: what it said, read again only when the file changes. a reload starts from
// what the other panes shared in talks.json
const talkCache = new Map<string, Read>()
// the mtime of talks.json when it was last loaded
let sharedAt: number | null = null
// the gh that ran last time
let ghBin: string | null = null
let ticking = false

// reads the end of each transcript and prints only what parseScan needs (X for a file it can't read): titles, PR links,
// wrap-up rows (recap + question), "U" for each typed prompt (not the notes the app slips in,
// which start with "<"), and the last working folder
const SCAN = `for f in "$@"; do
printf '\\036%s\\n' "$f"
if [ ! -r "$f" ]; then printf 'X\\n'; continue; fi
tail -c 1500000 "$f" | LC_ALL=C grep -a -F -e '"type":"custom-title"' -e '"type":"pr-link"' -e '"name":"mcp__ccd_turn__wrap_up","input"' -e '"message":{"role":"user","content":"' | LC_ALL=C grep -a -v '"type":"api-request' | LC_ALL=C awk '/"name":"mcp__ccd_turn__wrap_up","input"/ {print; next} /"message":\\{"role":"user","content":"</ {next} /"message":\\{"role":"user","content":"/ {print "U"; next} {print}'
c=$(tail -c 30000 "$f" | LC_ALL=C grep -a -o '"cwd":"[^"]*"' | tail -1)
printf 'C:%s\\n' "$c"
done`
const LIST = `find "$1" -maxdepth 2 -name '*.jsonl' -mtime -${TALK_DAYS} -not -path '*scratch-workspaces*' -print0 | xargs -0 stat -f '%Fm %N'`

async function home($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) ?? ''
}

async function todoDir($: EngineInterface, part: 'items'): Promise<string> {
  return `${await home($)}/.claude/todo/${part}`
}

// the files every pane shares (shared.ts)
async function todoPath($: EngineInterface, name: 'talks.json' | 'prs.json' | Lock): Promise<string> {
  return `${await home($)}/.claude/todo/${name}`
}

async function readJsonDir<T>($: EngineInterface, dir: string, parse: (text: string, name: string) => T | null): Promise<T[]> {
  if (!(await $.fs.exists(dir))) {
    return []
  }
  const files = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.json'))
  const read: (T | null)[] = await Promise.all(
    files.map(f =>
      $.fs
        .read(`${dir}/${f.name}`)
        .then(text => parse(text, f.name))
        .catch(() => null),
    ),
  )

  return read.filter((x): x is T => x !== null)
}

async function readItems($: EngineInterface): Promise<Item[]> {
  return readJsonDir($, await todoDir($, 'items'), parseItem)
}

async function writeItem($: EngineInterface, item: Item): Promise<void> {
  await $.fs.write(`${await todoDir($, 'items')}/${item.id}.json`, `${JSON.stringify(item, null, 2)}\n`)
}

async function projectHere($: EngineInterface): Promise<string> {
  const repo = await $.session.repo()
  const fromRemote = repo?.remote?.replace(/\.git$/, '').split(/[/:]/).pop()

  return fromRemote || projectOf(repo?.root ?? (await $.session.cwd()))
}

type TranscriptFile = { path: string; mtimeMs: number }

// every transcript changed in the last TALK_DAYS days, newest first
async function listTranscripts($: EngineInterface): Promise<TranscriptFile[]> {
  const listed = await $.process.run(['sh', '-c', LIST, 'sh', `${await home($)}/.claude/projects`])

  return listed.stdout
    .split('\n')
    .map(line => {
      const cut = line.indexOf(' ')

      return { mtimeMs: Number(line.slice(0, cut)) * 1000, path: line.slice(cut + 1) }
    })
    .filter(f => f.path.endsWith('.jsonl') && Number.isFinite(f.mtimeMs))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

// reads one batch into talkCache. a batch that fails or runs out of time keeps what was read
// before, so the pane shows older words rather than none
async function scanBatch($: EngineInterface, batch: readonly TranscriptFile[]): Promise<void> {
  const mtimes = new Map(batch.map(f => [f.path, f.mtimeMs]))
  const scanned = await $.process.run(['sh', '-c', SCAN, 'sh', ...batch.map(f => f.path)], { timeoutMs: 30_000 }).catch(() => null)
  if (!scanned) {
    return
  }
  const talks = parseScan(scanned.stdout, mtimes)
  batch.forEach((f, i) => {
    const talk = talks[i]
    // a file that couldn't be read is read again next time, and until then is no transcript
    if (talk && !talk.isUnread) {
      talkCache.set(f.path, { mtimeMs: f.mtimeMs, talk })
    } else {
      talkCache.delete(f.path)
    }
  })
}

// what other panes read: loaded again only when the file changed
async function loadShared($: EngineInterface): Promise<void> {
  const path = await todoPath($, 'talks.json')
  const stat = await $.fs.stat(path).catch(() => null)
  if (!stat || stat.mtimeMs === sharedAt) {
    return
  }
  sharedAt = stat.mtimeMs
  mergeReads(talkCache, parseReads(await $.fs.read(path).catch(() => '')))
}

// what's on disk first: a pane that scanned at the same moment keeps what it read
async function saveShared($: EngineInterface): Promise<void> {
  const path = await todoPath($, 'talks.json')
  mergeReads(talkCache, parseReads(await $.fs.read(path).catch(() => '')))
  const since = (await $.clock.now()) - TALK_DAYS * 86_400_000
  await $.fs.write(path, writeReads(talkCache, since))
}

type Lock = 'scan.lease' | 'prs.lease'

// written, then after a moment read back: of panes that wrote at nearly the same time, only the
// last one read back goes on. no file call is atomic, so rarely two go on at once; that only
// costs a scan done twice (saveShared and recordPrs merge, so nothing read is lost)
async function takeLease($: EngineInterface, lock: Lock, owner: string): Promise<boolean> {
  const path = await todoPath($, lock)
  const now = await $.clock.now()
  const held = parseLease(await $.fs.read(path).catch(() => ''))
  if (!canTake(held, owner, now)) {
    return false
  }
  await $.fs.write(path, JSON.stringify({ owner, until: now + LEASE_MS }))
  if (held?.owner !== owner) {
    await $.clock.sleep(LEASE_SETTLE_MS)
  }

  return parseLease(await $.fs.read(path).catch(() => ''))?.owner === owner
}

async function dropLease($: EngineInterface, lock: Lock, owner: string): Promise<void> {
  const path = await todoPath($, lock)
  if (parseLease(await $.fs.read(path).catch(() => ''))?.owner === owner) {
    await $.fs.write(path, JSON.stringify({ owner, until: 0 }))
  }
}

// what each transcript says, read again only when the file changed. this conversation's own
// transcript it reads itself; the rest only the pane holding the lease reads, for every pane
async function scanTalks($: EngineInterface, files: readonly TranscriptFile[]): Promise<Map<string, Talk>> {
  const ownId = await $.session.id()
  await loadShared($).catch(() => undefined)
  const isStale = (f: TranscriptFile) => talkCache.get(f.path)?.mtimeMs !== f.mtimeMs
  const own = files.filter(f => isStale(f) && f.path.endsWith(`/${ownId}.jsonl`))
  if (own.length > 0) {
    await scanBatch($, own)
  }
  if (files.some(isStale) && (await takeLease($, 'scan.lease', ownId).catch(() => false))) {
    try {
      // another pane may have shared these while this one waited for the lease
      await loadShared($).catch(() => undefined)
      for (const batch of chunks(files.filter(isStale), SCAN_BATCH)) {
        await scanBatch($, batch)
        await saveShared($)
        // held a little longer each batch; lost (another pane took it) means stop
        if (!(await takeLease($, 'scan.lease', ownId))) {
          break
        }
      }
    } finally {
      await dropLease($, 'scan.lease', ownId).catch(() => undefined)
    }
  }
  const out = new Map<string, Talk>()
  for (const f of files) {
    const talk = talkCache.get(f.path)?.talk
    if (talk) {
      out.set(f.path, talk)
    }
  }

  return out
}

// the app's open (not archived) conversations; null away from the desktop app. a big list comes back
// as something other than JSON (the app caps what one call returns), so ask for fewer until it parses
const SESSION_LIMITS = [150, 80, 40]

async function readSessions($: EngineInterface): Promise<{ list: Session[]; limit: number } | null> {
  for (const limit of SESSION_LIMITS) {
    try {
      const got = await $.mcp.call('ccd_session_mgmt', 'list_sessions', { limit })
      const block = got.content[0] as { type?: string; text?: string } | undefined
      if (got.isError || block?.type !== 'text' || !block.text) {
        return null
      }
      const list = parseSessions(block.text)
      if (list.length > 0 || block.text.trim() === '[]') {
        return { list, limit }
      }
    } catch {
      return null
    }
  }

  return null
}

// "asked you" shows a question only from a conversation that is still open in the app (matched
// by title: transcripts don't carry the app's id); away from the app, every conversation counts
function isLiveTitle(sessions: readonly Session[] | null, title: string): boolean {
  return sessions === null || sessions.some(s => s.title === title)
}

// a worktree's uncommitted changes and commits on no remote; null when it isn't a worktree or is gone
async function readWorktree($: EngineInterface, cwd: string): Promise<WorktreeState | null> {
  if (!isWorktree(cwd) || !(await $.fs.exists(cwd))) {
    return null
  }
  try {
    const [status, unpushed] = await Promise.all([
      $.process.run(['git', '-C', cwd, 'status', '--porcelain']),
      $.process.run(['git', '-C', cwd, 'rev-list', '--count', 'HEAD', '--not', '--remotes']),
    ])

    return parseWorktree(status, unpushed)
  } catch {
    return { state: 'unknown' }
  }
}

// one row per conversation the app has open, with what is still open in it
async function readConvos(
  $: EngineInterface,
  c: { sessions: readonly Session[]; files: readonly TranscriptFile[]; items: readonly Item[]; prStates: Record<string, PrState>; here: View['here'] },
): Promise<Convo[]> {
  const projects = `${await home($)}/.claude/projects`
  const live = c.sessions.filter(s => !s.isArchived)
  const paths = matchByTime(live, c.files, projects)
  // no file at the moment of the last activity: match the rest by title, leaving out files another
  // conversation already matched
  let unmatched = live.filter(s => paths.get(s.id) === null)
  const claimed = new Set([...paths.values()].filter((p): p is string => p !== null))
  const wanted = new Set([...claimed, ...unmatched.flatMap(s => folderFiles(s, c.files, projects).map(f => f.path))])
  const talks = await scanTalks(
    $,
    c.files.filter(f => wanted.has(f.path)),
  )
  // a file matched by time whose titles don't include the conversation's is someone else's
  for (const s of live) {
    const path = paths.get(s.id)
    const titles = path ? talks.get(path)?.titles : undefined
    if (path && titles && titles.length > 0 && !titles.includes(s.title)) {
      paths.set(s.id, null)
      claimed.delete(path)
      unmatched = [...unmatched, s]
    }
  }
  // the folders of conversations sent back here may not have been read yet
  const more = c.files.filter(f => !talks.has(f.path) && unmatched.some(s => folderFiles(s, [f], projects).length > 0))
  if (more.length > 0) {
    for (const [path, talk] of await scanTalks($, more)) {
      talks.set(path, talk)
    }
  }
  for (const s of unmatched) {
    const candidates = folderFiles(s, c.files, projects).map(f => ({ ...f, titles: talks.get(f.path)?.titles ?? [] }))
    const path = pickByTitle(s, candidates, claimed)
    paths.set(s.id, path)
    if (path) {
      claimed.add(path)
    }
  }

  // git once per folder, four at a time: conversations often share a worktree
  const folders = [...new Set(live.map(s => s.cwd))]
  const worktrees = new Map(await mapLimit(folders, 4, async cwd => [cwd, await readWorktree($, cwd)] as const))

  return Promise.all(
    live.map(async session => {
      const path = paths.get(session.id)
      const talk = path ? (talks.get(path) ?? null) : null
      const worktree = worktrees.get(session.cwd) ?? null
      const isThis = session.title === c.here.title && session.cwd === c.here.cwd && talk?.id === c.here.id

      return {
        session,
        ...(talk?.recap ? { recap: talk.recap } : {}),
        verdict: verdictOf({
          session,
          talk,
          items: c.items,
          isOpenItem: i => isOpenItem(i, c.prStates),
          worktree,
          isHere: isThis || (path !== null && path !== undefined && path.endsWith(`/${c.here.id}.jsonl`)),
        }),
      }
    }),
  )
}

// runs gh from where it is: the app may not have homebrew on its PATH
async function gh($: EngineInterface, args: readonly string[]): Promise<{ ok: boolean; out: string } | null> {
  for (const bin of ghBin ? [ghBin] : ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']) {
    try {
      const ran = await $.process.run([bin, ...args])
      ghBin = bin

      return { ok: ran.exitCode === 0, out: ran.exitCode === 0 ? ran.stdout : ran.stderr }
    } catch {
      // not at this path; try the next
    }
  }

  return null
}

// asks github about each PR an item waits on, one by one: a PR missing from the open-PR search
// proves nothing (past the limit, or someone else's), so every tracked PR is asked by its URL.
// what github said is shared in prs.json: a PR is asked when it's due (isPrDue) for all panes,
// or now when the person asked (isAsked)
async function readPrStates($: EngineInterface, items: readonly Item[], isAsked = false): Promise<Record<string, PrState>> {
  const sources = new Map<string, PrSource>()
  for (const i of items) {
    const s = sourceOf(i)
    if (s) {
      sources.set(prKey(s), s)
    }
  }
  const path = await todoPath($, 'prs.json')
  const now = await $.clock.now()
  const checks = parsePrChecks(await $.fs.read(path).catch(() => ''))
  // a PR whose items are all deleted keeps what was last said, and isn't asked again by itself
  const isKept = (key: string) => items.some(i => !i.deletedAt && sourceOf(i) && prKey(sourceOf(i) as PrSource) === key)
  const due = [...sources].filter(([key]) => isAsked || (isPrDue(checks[key], now) && (isKept(key) || !checks[key])))
  // on its own beat one pane asks for all (prs.lease); asked by the person, this pane asks now
  if (due.length > 0 && (isAsked || (await takeLease($, 'prs.lease', await $.session.id()).catch(() => false)))) {
    try {
      const got = await mapLimit(due, 4, async ([key, s]) => {
        const ran = await gh($, ['pr', 'view', prUrl(s), '--json', 'state,mergedAt,closedAt'])

        return [key, ran?.ok ? parsePrState(ran.out) : null] as const
      })
      // read again just before writing: another pane may have asked about other PRs meanwhile
      const latest = parsePrChecks(await $.fs.read(path).catch(() => ''))
      recordPrs(latest, got, now)
      Object.assign(checks, latest)
      await $.fs.write(path, JSON.stringify(latest)).catch(() => undefined)
    } finally {
      if (!isAsked) {
        await dropLease($, 'prs.lease', await $.session.id()).catch(() => undefined)
      }
    }
  }
  const out: Record<string, PrState> = {}
  for (const key of sources.keys()) {
    const state = checks[key]?.state
    if (state) {
      out[key] = state
    }
  }

  return out
}


// reads every source again. github: each PR when it's due, every PR when the person asked (isAsked)
async function refresh($: EngineInterface, { isAsked = false }: { isAsked?: boolean }): Promise<void> {
  const now = await $.clock.now()
  const ownId = await $.session.id()
  const notes: string[] = []
  const [items, files, got, project, cwd] = await Promise.all([
    readItems($).catch(() => {
      notes.push('could not read ~/.claude/todo/items')

      return [] as Item[]
    }),
    listTranscripts($).catch(() => {
      notes.push('could not read the transcripts')

      return [] as TranscriptFile[]
    }),
    readSessions($),
    projectHere($),
    $.session.cwd(),
  ])
  const sessions = got?.list ?? null
  if (got && got.list.length >= got.limit) {
    notes.push(`showing the newest ${got.limit} conversations`)
  }
  const recent = files.filter((f, i) => i < TALK_MAX || f.path.endsWith(`/${ownId}.jsonl`))
  const talks = [...(await scanTalks($, recent).catch(() => new Map<string, Talk>())).values()]
  const was = await read($, view)
  const prStates = await readPrStates($, items, isAsked).catch(() => was.prStates)
  const own = talks.find(t => t.id === ownId)
  const others = newestTalks(talks).filter(
    t => t.id !== ownId && t.title !== '' && !(own && t.title === own.title && t.cwd === own.cwd) && isLiveTitle(sessions, t.title),
  )
  const here = { id: ownId, title: own?.title || (await firstPrompt($)) || '', project, cwd, recap: own?.recap }
  // tidy up reads every conversation's folder and asks git about each worktree: only while it's
  // unfolded or when the person asked. folded, it keeps what it had (or nothing yet)
  const isConvosWanted = isAsked || was.isShowingConvos
  const convos = !sessions
    ? null
    : isConvosWanted
      ? await readConvos($, { sessions, files, items, prStates, here }).catch(() => {
          notes.push('could not read the conversations')

          return null
        })
      : (was.convos ?? [])
  const convosAt = isConvosWanted && convos !== null ? now : was.convosAt
  await update($, view, v => ({ ...v, here, talks: others, convos, convosAt, items, prStates, at: now, notes }))
}

// what the person first asked here, as a title when the app gave the conversation none
async function firstPrompt($: EngineInterface): Promise<string | undefined> {
  const messages = await $.session.messages()
  const first = messages.find(m => m.role === 'user' && m.text.trim() !== '' && !m.text.startsWith('<'))

  return first ? clip(first.text, 40) : undefined
}

// one pass at a time; asked during one, one more after it
let gate: Gate<{ isAsked?: boolean }> | null = null

function requestRefresh($: EngineInterface, o: { isAsked?: boolean } = {}): Promise<void> {
  gate ??= new Gate(next => refresh($, next))

  return gate.ask(o)
}

// the next look is set when this one ends, never on a fixed beat: a slow pass can't pile up.
// a few seconds either way, so panes started together don't all look in the same second
function startTicking($: EngineInterface): void {
  if (ticking) {
    return
  }
  ticking = true
  const next = () => {
    $.clock.after(TICK + Math.round((Math.random() - 0.5) * 2 * TICK_JITTER), () => {
      void requestRefresh($).finally(next)
    })
  }
  next()
}

async function add($: EngineInterface, text: string, extra: { project?: string; link?: string; pr?: PrSource; by?: string } = {}): Promise<Item> {
  const now = await $.clock.now()
  const v = await read($, view)
  const item: Item = {
    schemaVersion: 2,
    id: newId(now),
    text: text.trim(),
    project: extra.project || v.here.project || projectOf(await $.session.cwd()),
    kind: 'todo',
    status: 'open',
    session: { id: await $.session.id(), title: v.here.title || undefined, cwd: await $.session.cwd() },
    ...(extra.pr ? { link: prUrl(extra.pr) } : extra.link ? { link: extra.link } : {}),
    by: extra.by ?? 'claude',
    createdAt: new Date(now).toISOString(),
    ...(extra.pr
      ? { source: extra.pr, completion: { mode: 'source', condition: 'merged' } as const }
      : { completion: { mode: 'declared' } as const }),
  }
  await writeItem($, item)
  const prStates = extra.pr ? { ...v.prStates, ...(await readPrStates($, [item], true)) } : v.prStates
  await update($, view, was => ({ ...was, items: [...was.items, item], prStates }))

  return item
}


// records that someone says an item is done (or open again). a PR item can't be declared:
// github is asked instead, and the answer comes back
async function declare(
  $: EngineInterface,
  id: string,
  how: { isDone: boolean; by: string; recordedBy?: string; note?: string },
): Promise<{ item: Item; said: string } | null> {
  const item = (await readItems($)).find(i => i.id === id)
  if (!item) {
    return null
  }
  if (sourceOf(item) || item.completion?.mode === 'source') {
    const fresh = await readPrStates($, [item], true)
    const answer = prAnswer(item, fresh, (await read($, view)).prStates)
    await update($, view, was => ({ ...was, prStates: { ...was.prStates, ...answer.states } }))

    return { item, said: answer.said }
  }
  const at = new Date(await $.clock.now()).toISOString()
  const next = how.isDone ? declareDone(item, { by: how.by, recordedBy: how.recordedBy, note: how.note, at }) : reopen(item, at)
  await writeItem($, next)
  await update($, view, was => ({ ...was, items: was.items.map(i => (i.id === id ? next : i)) }))

  return { item: next, said: next.status === 'done' ? `done (${how.by} said so)` : 'open again' }
}


// a tick or ✕ in the pane: the person did it, so the person is who said so
async function press($: EngineInterface, id: string, what: 'done' | 'open' | 'delete'): Promise<void> {
  const item = (await readItems($)).find(i => i.id === id)
  if (!item || sourceOf(item)) {
    return
  }
  const at = new Date(await $.clock.now()).toISOString()
  const next = what === 'done' ? declareDone(item, { by: 'person', at }) : what === 'open' ? reopen(item, at) : deleteItem(item, { by: 'person', at })
  await writeItem($, next)
  await update($, view, was => ({ ...was, items: was.items.map(i => (i.id === id ? next : i)) }))
}

// the folded count only while it's recent: folded, tidy up isn't worked out again
const CONVOS_FRESH_MS = 5 * 60_000

function isConvosFresh(v: View, now: number): boolean {
  return v.convosAt !== undefined && (v.isShowingConvos || now - v.convosAt < CONVOS_FRESH_MS)
}

function line(i: Item, prStates: Readonly<Record<string, PrState>>): string {
  const o = outcomeOf(i, prStates)
  const from = i.session?.title ? ` · from ${i.session.title}` : ''
  const state = o.state === 'open' ? '' : ` {${o.state}${o.why ? `: ${o.why}` : ''}}`

  return `${i.id} ${i.project}: ${i.text}${i.link ? ` (${i.link})` : ''}${state}${from}`
}

const field = (e: unknown, name: string): unknown => (e as Record<string, unknown>)[name]
const text = (e: unknown, name: string): string | undefined => {
  const v = field(e, name)

  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'todo',
      description: 'open the to-do pane; /todo <text> adds one for this conversation',
      argumentHint: '[text]',
    })
    await $.tool.register({
      name: 'todo_add',
      description:
        'Add a to-do to the shared list every conversation sees (~/.claude/todo/items): something the person asked for ' +
        'that is still left after this turn, one short sentence. Check todo_list first and do not add the same thing twice. ' +
        'Not every work step, not optional ideas, not "shall I go on". When it is done exactly when a GitHub PR merges, ' +
        'pass the PR as `pr`: GitHub then ticks it. This conversation and project are filled in.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'what is left, one short sentence' },
          project: { type: 'string', description: 'repo name; defaults to this conversation’s repo' },
          pr: { type: 'string', description: 'https://github.com/<owner>/<repo>/pull/<n>; the item is done when it merges' },
          link: { type: 'string', description: 'a PR, issue or doc URL to show; it decides nothing' },
        },
        required: ['text'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'todo_done',
      description:
        'Tick a shared to-do as done, or open it again with reopen: true. Only when the person said it is done ' +
        '(by: "person", their words in note) or you did it yourself and checked the result (by: "claude"). Never because ' +
        'it looks likely. Items tied to a PR are ticked by GitHub; this only returns what GitHub says.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          by: { type: 'string', enum: ['person', 'claude'] },
          note: { type: 'string', description: 'why it is done, in a few words' },
          reopen: { type: 'boolean' },
        },
        required: ['id', 'by'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'todo_list',
      description: 'List the open shared to-dos with their ids, optionally for one project.',
      inputSchema: { type: 'object', properties: { project: { type: 'string' } } },
      isDeferred: false,
    })
    const started = await next(e)
    void $.ui.open({ id: PANE, title: 'todo' })
    void requestRefresh($)
    startTicking($)

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void requestRefresh($)

    return done
  })

  on('tool.call', { tool: 'mcp__puppy-todo__todo_add' }, async ($, e) => {
    try {
      const said = text(e, 'text')
      if (!said) {
        return { deny: 'text is required' }
      }
      const prText = text(e, 'pr')
      const pr = prText ? parsePrUrl(prText) : null
      if (prText && !pr) {
        return { deny: 'pr must look like https://github.com/<owner>/<repo>/pull/<n>' }
      }
      // one thing, one item: the same words (or the same PR) already open in this project is not added again
      const v = await read($, view)
      const project = text(e, 'project') || v.here.project || projectOf(await $.session.cwd())
      // the files and the shared PR answers, not the view: the view may not have looked yet, or may
      // still think a merged PR is open
      const items = (await readItems($)).filter(i => i.project === project)
      const prStates = { ...v.prStates, ...(await readPrStates($, items)) }
      const twin = similarOpen(items, prStates, { project, text: said, source: pr ?? undefined })
      if (twin?.kind === 'same') {
        return { deny: `already on the list, not added: ${line(twin.item, prStates)}` }
      }
      const item = await add($, said, { project, link: text(e, 'link'), pr: pr ?? undefined })
      const note = twin ? `\nlooks like an open item; if it is the same thing, say so to the person instead of keeping both: ${line(twin.item, prStates)}` : ''

      return { result: `added ${line(item, (await read($, view)).prStates)}${note}` }
    } catch (err) {
      return { deny: `could not add: ${String(err)}` }
    }
  })

  on('tool.call', { tool: 'mcp__puppy-todo__todo_done' }, async ($, e) => {
    try {
      const id = text(e, 'id')
      const by = text(e, 'by')
      if (!id || (by !== 'person' && by !== 'claude')) {
        return { deny: 'id and by (person or claude) are required' }
      }
      const got = await declare($, id, {
        isDone: field(e, 'reopen') !== true,
        by,
        // the person said it in a conversation; Claude wrote it down
        recordedBy: by === 'person' ? 'claude' : undefined,
        note: text(e, 'note'),
      })

      return got ? { result: `${got.said}: ${line(got.item, (await read($, view)).prStates)}` } : { deny: `no item with id ${id}` }
    } catch (err) {
      return { deny: `could not record it: ${String(err)}` }
    }
  })

  on('tool.call', { tool: 'mcp__puppy-todo__todo_list' }, async ($, e) => {
    try {
      const project = text(e, 'project')
      const items = (await readItems($)).filter(i => !project || i.project === project)
      const prStates = await readPrStates($, items)
      const open = shown(items, prStates, 0).filter(i => isOpenItem(i, prStates))

      return { result: open.length === 0 ? 'nothing open' : open.map(i => line(i, prStates)).join('\n') }
    } catch (err) {
      return { deny: `could not read the list: ${String(err)}` }
    }
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'todo' })
    if (e.args.trim() === '') {
      void requestRefresh($, { isAsked: true })

      return { text: 'the to-do pane is open.' }
    }
    const item = await add($, e.args, { by: 'person' })

    return { text: `added: ${item.text}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Link } = table
    // the phone app draws no field yet
    const Input = 'Input' in table ? table.Input : undefined
    // a view kept from an older version lacks the newer fields (the session's state outlives a reload)
    const v: View = { ...EMPTY, ...(await read($, view)) }
    if (v.at === null) {
      return <Text dimColor>{FACES.calm} sniffing around…</Text>
    }
    const now = v.at
    const width = Math.max(30, (e.viewport?.columns ?? 60) - 4)

    const all = shown(v.items, v.prStates, now)
    const open = all.filter(i => isOpenItem(i, v.prStates))
    const done = all.filter(i => !isOpenItem(i, v.prStates))
    const mine = open.filter(i => isHere(i, v.here))
    const asks = recentAsks(v.talks, now)
    const clear = (v.convos ?? []).filter(c => c.verdict.state === 'clear')

    // inside a card: the border and padding take 4 columns (STYLE.md)
    const inner = width - 4
    // the terminal cuts by columns; a graphical surface measures the words and cuts at the edge itself
    const isGraphical = e.surface !== 'terminal'
    const fit = (text: string, max: number) => clip(text, isGraphical ? 300 : max)
    // a card: a rounded dim border, the name on the left, quiet facts on the right
    const card = (key: string, name: string, right: RenderChildren, body: RenderChildren) => (
      <Box key={`card-${key}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} gap="xs">
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Box flexShrink={1} minWidth={0}>
            <Text weight="semibold" wrap="truncate-end">{name}</Text>
          </Box>
          <Text dimColor>{right}</Text>
        </Box>
        {body}
      </Box>
    )
    // the ⋯ shows when the pointer is on the row (the desktop); with no pointer it always shows
    const hasPointer = e.surface === 'desktop'
    // a grey pixel icon where the surface draws pictures, its text mark elsewhere (the terminal)
    const hasSvg = isGraphical && 'Svg' in table
    const icon = (name: IconName, alt: string) =>
      hasSvg && 'Svg' in table ? <table.Svg source={iconSvg(name)} alt={alt} width={14} height={14} /> : <Text dimColor>{MARKS[name]}</Text>
    const toggle = (pick: (was: View) => Partial<View>) => () => update($, view, was => ({ ...EMPTY, ...was, ...pick({ ...EMPTY, ...was }) }))
    // an open to-do: ○ to tick it, its words, its link and age on the right, and ⋯ for the rest.
    // a PR item has ↗ and no tick: github ticks it
    const row = (i: Item) => {
      const isPr = sourceOf(i) !== null
      const scope = `row-${i.id}`
      const born = bornAt(i)
      const link = i.link?.startsWith('https://') ? i.link : undefined
      const age = Number.isNaN(born) ? '' : ago(now, born)
      const isOpen = v.openItem === i.id
      // the columns the mark and the facts on the right take, each with its gap
      const right = 4 + (link ? shortLink(link).length + 1 : 0) + (age ? age.length + 1 : 0) + 2

      return (
        <Box key={`i-${i.id}`} flexDirection="column">
          {/* the row may get narrower than its words: the words cut, the facts stay at the right */}
          <Box key={`r-${i.id}`} flexDirection="row" gap={1} alignItems="center" flexGrow={1} flexShrink={1} minWidth={0} hover={{ scope }}>
            {/* one width for the tick and the arrow, so the words line up */}
            <Box width={3} flexShrink={0} justifyContent="center">
              {isPr ? icon('pr', 'waiting for merge') : <Button key={`tick-${i.id}`} label="○" plain dimColor onPress={() => press($, i.id, 'done')} />}
            </Box>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text wrap="truncate-end">{fit(i.text, inner - right)}</Text>
            </Box>
            {/* the facts on the right never shrink or wrap: the words in the middle give way */}
            <Box flexDirection="row" gap={1} flexShrink={0}>
              {link ? (
                // a short name (#78), not the address: the terminal prints a link's whole address
                isGraphical ? <Link href={link} label={shortLink(link)} /> : <Text dimColor>{shortLink(link)}</Text>
              ) : null}
              {age ? <Text dimColor>{age}</Text> : null}
            </Box>
            <Box {...(hasPointer && !isOpen ? { display: 'none', hover: { scope, display: 'flex' } } : {})}>
              <Button key={`more-${i.id}`} label="⋯" plain dimColor onPress={toggle(was => ({ openItem: was.openItem === i.id ? null : i.id }))} />
            </Box>
          </Box>
          {isOpen ? (
            // the rest, only for the row asked about: the whole text, where it came from, delete
            <Box key={`detail-${i.id}`} flexDirection="column" paddingLeft={4}>
              <Text>{i.text}</Text>
              <Text dimColor wrap="truncate-end">
                {i.session?.title ? `from ${i.session.title} · ` : ''}
                {Number.isNaN(born) ? '' : `added ${new Date(born).toISOString().slice(0, 10)}`}
                {isPr ? ' · done when github merges it' : ''}
              </Text>
              {isPr ? null : <Button key={`del-${i.id}`} label="delete" plain dimColor onPress={() => press($, i.id, 'delete')} />}
            </Box>
          ) : null}
        </Box>
      )
    }
    const rows = (list: readonly Item[]) => list.map(i => row(i))
    // a fold: ▸ closed, ▾ open, the name to press, its count on the right like a card's
    const fold = (key: string, isOpen: boolean, name: string, count: number, onPress: () => unknown) => (
      <Box key={`row-${key}`} flexDirection="row" justifyContent="space-between" gap={1}>
        <Button key={key} label={`${isOpen ? '▾' : '▸'} ${name}`} plain dimColor onPress={onPress} />
        <Text dimColor>{count}</Text>
      </Box>
    )
    // this project first: this conversation's items, then (folded) the project's other conversations.
    // every other project is one line with its count, opened on a press
    const hereProject = v.here.project
    const inProject = open.filter(i => !isHere(i, v.here) && i.project === hereProject)
    const elsewhere = open.filter(i => !isHere(i, v.here) && i.project !== hereProject)
    const projects = byProject(elsewhere)
    const ASKS_SHOWN = 3
    const askList = v.isShowingAllAsks ? asks : asks.slice(0, ASKS_SHOWN)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Box flexShrink={1} minWidth={0}>
            <Text>
              {FACES[mood(asks.length, open.length)]}
              <Text dimColor> {saying(asks.length, open.length)}</Text>
            </Text>
          </Box>
          <Button key="refresh" label="refresh" dimColor onPress={() => requestRefresh($, { isAsked: true })} />
        </Box>

        {asks.length > 0 &&
          card(
            'asks',
            'asked you',
            <Text color="warning">{asks.length} waiting</Text>,
            <Box flexDirection="column">
              {askList.map(t => (
                <Box key={`ask-${t.id}`} flexDirection="column">
                  <Text wrap="truncate-end">
                    {fit(t.title, inner - 16)}
                    <Text dimColor> · {ago(now, t.mtimeMs)}</Text>
                  </Text>
                  <Text dimColor wrap="truncate-end">  {fit(t.ask ?? '', inner - 2)}</Text>
                </Box>
              ))}
              {asks.length > ASKS_SHOWN
                ? fold('more-asks', v.isShowingAllAsks, v.isShowingAllAsks ? 'fewer' : 'more', asks.length - ASKS_SHOWN, toggle(was => ({ isShowingAllAsks: !was.isShowingAllAsks })))
                : null}
            </Box>,
          )}

        {card(
          'here',
          fit(hereProject || v.here.title || 'this conversation', inner - 8),
          `${mine.length + inProject.length}`,
          <Box flexDirection="column" gap={1}>
            {v.here.recap ? <Text dimColor wrap="truncate-end">last: {fit(v.here.recap, inner - 6)}</Text> : null}
            {Input ? (
              <Input
                key="add"
                placeholder="add a to-do…"
                submitLabel="add"
                onSubmit={said => {
                  if (said.trim() !== '') {
                    void add($, said, { by: 'person' })
                  }
                }}
              />
            ) : null}
            {mine.length > 0 ? (
              <Box key="mine" flexDirection="column">
                <Text dimColor>this conversation</Text>
                {rows(mine)}
              </Box>
            ) : null}
            {inProject.length > 0 && mine.length > 0 ? (
              <Box key="in-project" flexDirection="column">
                {fold('show-in-project', v.isShowingInProject, 'other conversations', inProject.length, toggle(was => ({ isShowingInProject: !was.isShowingInProject })))}
                {v.isShowingInProject ? rows(inProject) : null}
              </Box>
            ) : inProject.length > 0 ? (
              // nothing written here yet: the project's other items are what this conversation picks up
              <Box key="in-project" flexDirection="column">
                {rows(inProject)}
              </Box>
            ) : null}
            {open.length === 0 ? <Text dimColor>nothing to do. the puppy naps.</Text> : null}
          </Box>,
        )}

        {projects.length > 0 &&
          card(
            'projects',
            'other projects',
            `${elsewhere.length}`,
            <Box flexDirection="column">
              {projects.map(([project, list]) => {
                const isOpen = v.openProjects.includes(project)

                return (
                  <Box key={`p-${project}`} flexDirection="column">
                    {fold(
                      `show-p-${project}`,
                      isOpen,
                      project,
                      list.length,
                      toggle(was => ({
                        openProjects: was.openProjects.includes(project) ? was.openProjects.filter(p => p !== project) : [...was.openProjects, project],
                      })),
                    )}
                    {isOpen ? <Box paddingLeft={2} flexDirection="column">{rows(list)}</Box> : null}
                  </Box>
                )
              })}
            </Box>,
          )}

        {done.length > 0 && (
          <Box flexDirection="column">
            <Button
              key="show-done"
              label={`${v.isShowingDone ? '▾' : '▸'} done ${done.length}`}
              dimColor
              onPress={() => update($, view, was => ({ ...was, isShowingDone: !was.isShowingDone }))}
            />
            {v.isShowingDone
              ? done.map(i => (
                  <Box key={`d-${i.id}`} flexDirection="row" gap={1}>
                    {sourceOf(i) ? (
                      <Text dimColor>{outcomeOf(i, v.prStates).state === 'canceled' ? '✕' : '✓'}</Text>
                    ) : (
                      <Button key={`untick-${i.id}`} label="☑" dimColor onPress={() => press($, i.id, 'open')} />
                    )}
                    <Text dimColor strikethrough>
                      {fit(i.text, width - 8)}
                    </Text>
                  </Box>
                ))
              : null}
          </Box>
        )}

        {v.convos !== null && (
          <Box flexDirection="column">
            <Button
              key="show-convos"
              label={
                isConvosFresh(v, now)
                  ? `${v.isShowingConvos ? '▾' : '▸'} tidy up: ${clear.length} of ${v.convos.length} conversations have nothing open`
                  : `${v.isShowingConvos ? '▾' : '▸'} tidy up`
              }
              dimColor
              onPress={async () => {
                const v = await update($, view, was => ({ ...was, isShowingConvos: !was.isShowingConvos }))
                // unfolded: work it out now, not at the next look
                if (v.isShowingConvos) {
                  void requestRefresh($)
                }
              }}
            />
            {v.isShowingConvos ? (
              <Box flexDirection="column">
                <Text dimColor>nothing open found is a hint, not a promise. archive from the sidebar.</Text>
                {sortConvos(v.convos).map(c => (
                  <Box key={`c-${c.session.id}`} flexDirection="column">
                    <Text dimColor={c.verdict.state !== 'clear'}>
                      {{ clear: '✓', open: '●', unknown: '?' }[c.verdict.state]} {fit(c.session.title, width - 24)}
                      <Text dimColor>
                        {' '}
                        · {ago(now, c.session.lastActivityMs)}
                        {c.session.isPinned ? ' · pinned' : ''}
                      </Text>
                    </Text>
                    <Text dimColor>
                      {'  '}
                      {fit(c.verdict.reasons.length > 0 ? c.verdict.reasons.join(' · ') : 'nothing open found', width * 2)}
                    </Text>
                    {c.recap ? <Text dimColor>  last: {fit(c.recap, width * 2)}</Text> : null}
                  </Box>
                ))}
              </Box>
            ) : null}
          </Box>
        )}

        <Text dimColor>
          looked at {clockTime(now)}
          {v.notes.length > 0 ? ` · ${v.notes.join(' · ')}` : ''}
        </Text>
      </Box>
    )
  })
}
