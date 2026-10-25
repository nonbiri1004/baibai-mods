import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Attention, Convo, Item, Kind, Pr, PrSource, PrState, Session, Talk, View, WorktreeState } from '../types'
import { folderFiles, isWorktree, parseSessions, parseWorktree, pickByTitle, pickTranscript, sortConvos, verdictOf } from './convos'
import {
  FACES,
  KINDS,
  ago,
  attentionFile,
  byProject,
  clip,
  clockTime,
  declareDone,
  isHere,
  isOpenItem,
  isSkipped,
  mood,
  newId,
  newestTalks,
  occurrence,
  outcomeOf,
  parseAttention,
  parseItem,
  parsePrState,
  parsePrUrl,
  parsePrs,
  parseScan,
  prAnswer,
  prKey,
  prUrl,
  projectOf,
  reopen,
  saying,
  shown,
  sourceOf,
  target,
} from './todo'

const PANE = 'puppy-todo'
// conversations older than this, or past this many, are left out of "waiting on you"
const TALK_DAYS = 14
const TALK_MAX = 40
// how often the pane looks again (the shared list, transcripts); gh only every GH_EVERY
const TICK = 60_000
const GH_EVERY = 5 * 60_000

const EMPTY: View = {
  here: { id: '', title: '', project: '', cwd: '' },
  talks: [],
  prs: [],
  items: [],
  prStates: {},
  attention: {},
  isShowingSkipped: false,
  convos: null,
  archiving: {},
  at: null,
  notes: [],
}
const view = atom({ plugin: 'puppy-todo', key: 'view' } as const, EMPTY)

// per transcript: what it said, read again only when the file changes (a reload starts over)
const talkCache = new Map<string, { mtimeMs: number; talk: Talk }>()
let ghAt = 0
// the gh that ran last time
let ghBin: string | null = null
let ticking = false

// reads the end of each transcript and prints only what parseScan needs: titles, PR links,
// wrap-up rows (recap + question), "U" for each typed prompt (not the notes the app slips in,
// which start with "<"), and the last working folder
const SCAN = `for f in "$@"; do
printf '\\036%s\\n' "$f"
tail -c 1500000 "$f" | LC_ALL=C grep -a -F -e '"type":"custom-title"' -e '"type":"pr-link"' -e '"name":"mcp__ccd_turn__wrap_up","input"' -e '"message":{"role":"user","content":"' | LC_ALL=C grep -a -v '"type":"api-request' | LC_ALL=C awk '/"name":"mcp__ccd_turn__wrap_up","input"/ {print; next} /"message":\\{"role":"user","content":"</ {next} /"message":\\{"role":"user","content":"/ {print "U"; next} {print}'
c=$(tail -c 30000 "$f" | LC_ALL=C grep -a -o '"cwd":"[^"]*"' | tail -1)
printf 'C:%s\\n' "$c"
done`
const LIST = `find "$1" -maxdepth 2 -name '*.jsonl' -mtime -${TALK_DAYS} -not -path '*scratch-workspaces*' -print0 | xargs -0 stat -f '%Fm %N'`

async function home($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) ?? ''
}

async function todoDir($: EngineInterface, part: 'items' | 'attention'): Promise<string> {
  return `${await home($)}/.claude/todo/${part}`
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

// a skip lives in a file of its own, so pressing "skip" never rewrites an item another
// conversation may be writing at the same time
async function readAttention($: EngineInterface): Promise<Record<string, Attention>> {
  const list = await readJsonDir($, await todoDir($, 'attention'), (text, name) => {
    const a = parseAttention(text)

    return a && attentionFile(a.target) === name ? a : null
  })

  return Object.fromEntries(list.map(a => [a.target, a]))
}

async function setAttention($: EngineInterface, what: string, occ: string, state: Attention['state']): Promise<void> {
  const a: Attention = {
    version: 1,
    target: what,
    state,
    occurrence: occ,
    at: new Date(await $.clock.now()).toISOString(),
    by: 'person',
  }
  await $.fs.write(`${await todoDir($, 'attention')}/${attentionFile(what)}`, `${JSON.stringify(a, null, 2)}\n`)
  await update($, view, was => ({ ...was, attention: { ...was.attention, [what]: a } }))
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

// what each transcript says, read again only when the file changed
async function scanTalks($: EngineInterface, files: readonly TranscriptFile[]): Promise<Map<string, Talk>> {
  const stale = files.filter(f => talkCache.get(f.path)?.mtimeMs !== f.mtimeMs)
  if (stale.length > 0) {
    const mtimes = new Map(stale.map(f => [f.path, f.mtimeMs]))
    const scanned = await $.process.run(['sh', '-c', SCAN, 'sh', ...stale.map(f => f.path)], { timeoutMs: 120_000 })
    const talks = parseScan(scanned.stdout, mtimes)
    stale.forEach((f, i) => {
      const talk = talks[i]
      if (talk) {
        talkCache.set(f.path, { mtimeMs: f.mtimeMs, talk })
      }
    })
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

// "waiting on you" shows a question only from a conversation that is still open in the app (matched
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

// one row per conversation the app has open, each with whether it can be archived
async function readConvos(
  $: EngineInterface,
  c: { sessions: readonly Session[]; files: readonly TranscriptFile[]; items: readonly Item[]; prStates: Record<string, PrState>; here: View['here'] },
): Promise<Convo[]> {
  const projects = `${await home($)}/.claude/projects`
  const live = c.sessions.filter(s => !s.isArchived)
  const paths = new Map(live.map(s => [s.id, pickTranscript(s, c.files, projects)]))
  // no file at the moment of the last activity: match the rest by title, leaving out files another
  // conversation already matched
  const unmatched = live.filter(s => paths.get(s.id) === null)
  const claimed = new Set([...paths.values()].filter((p): p is string => p !== null))
  const wanted = new Set([...claimed, ...unmatched.flatMap(s => folderFiles(s, c.files, projects).map(f => f.path))])
  const talks = await scanTalks(
    $,
    c.files.filter(f => wanted.has(f.path)),
  )
  for (const s of unmatched) {
    const candidates = folderFiles(s, c.files, projects).map(f => ({ ...f, titles: talks.get(f.path)?.titles ?? [] }))
    const path = pickByTitle(s, candidates, claimed)
    paths.set(s.id, path)
    if (path) {
      claimed.add(path)
    }
  }

  return Promise.all(
    live.map(async session => {
      const path = paths.get(session.id)
      const talk = path ? (talks.get(path) ?? null) : null
      const worktree = await readWorktree($, session.cwd)
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

async function readPrs($: EngineInterface): Promise<Pr[] | string> {
  const ran = await gh($, [
    'search',
    'prs',
    '--author=@me',
    '--state=open',
    '--json',
    'number,title,repository,url,isDraft,updatedAt',
    '--limit',
    '50',
  ])
  if (!ran) {
    return 'gh is not installed, so PRs are not checked'
  }

  return ran.ok ? parsePrs(ran.out) : `gh: ${clip(ran.out, 80)}`
}

// asks github about each PR an item waits on, one by one: a PR missing from the open-PR search
// proves nothing (past the limit, or someone else's), so every tracked PR is asked by its URL
async function readPrStates($: EngineInterface, items: readonly Item[]): Promise<Record<string, PrState>> {
  const sources = new Map<string, PrSource>()
  for (const i of items) {
    const s = sourceOf(i)
    if (s) {
      sources.set(prKey(s), s)
    }
  }
  const got = await Promise.all(
    [...sources.entries()].map(async ([key, s]) => {
      const ran = await gh($, ['pr', 'view', prUrl(s), '--json', 'state,mergedAt,closedAt'])
      const state = ran?.ok ? parsePrState(ran.out) : null

      return state ? ([key, state] as const) : null
    }),
  )

  return Object.fromEntries(got.filter(x => x !== null))
}

// reads every source again; github only when asked or every few minutes
async function refresh($: EngineInterface, isFull = false): Promise<void> {
  const now = await $.clock.now()
  const ownId = await $.session.id()
  const notes: string[] = []
  const [items, attention, files, got, project, cwd] = await Promise.all([
    readItems($).catch(() => {
      notes.push('could not read ~/.claude/todo/items')

      return [] as Item[]
    }),
    readAttention($).catch(() => ({}) as Record<string, Attention>),
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
  let { prs, prStates } = was
  if (isFull || now - ghAt > GH_EVERY) {
    ghAt = now
    const [got, states] = await Promise.all([readPrs($), readPrStates($, items)])
    if (typeof got === 'string') {
      notes.push(got)
    } else {
      prs = got
    }
    prStates = states
  } else if (items.some(i => sourceOf(i) && !prStates[prKey(sourceOf(i) as PrSource)])) {
    // a new PR item: check it now rather than in five minutes
    prStates = { ...prStates, ...(await readPrStates($, items.filter(i => !prStates[prKey(sourceOf(i) ?? ({} as PrSource))]))) }
  }
  const own = talks.find(t => t.id === ownId)
  const goal = await firstPrompt($)
  const others = newestTalks(talks).filter(
    t => t.id !== ownId && t.title !== '' && !(own && t.title === own.title && t.cwd === own.cwd) && isLiveTitle(sessions, t.title),
  )
  const here = { id: ownId, title: own?.title || clip(goal ?? '', 40), project, cwd, goal, recap: own?.recap }
  const convos = sessions
    ? await readConvos($, { sessions, files, items, prStates, here }).catch(() => {
        notes.push('could not read the conversations')

        return null
      })
    : null
  await update($, view, v => ({
    ...v,
    here,
    talks: others,
    convos,
    prs,
    items,
    prStates,
    attention,
    at: now,
    notes,
  }))
}

// what the person first asked here: what this conversation is for
async function firstPrompt($: EngineInterface): Promise<string | undefined> {
  const messages = await $.session.messages()
  const first = messages.find(m => m.role === 'user' && m.text.trim() !== '' && !m.text.startsWith('<'))

  return first ? clip(first.text, 200) : undefined
}

function startTicking($: EngineInterface): void {
  if (ticking) {
    return
  }
  ticking = true
  $.clock.every(TICK, () => {
    void refresh($).catch(() => undefined)
  })
}

async function add($: EngineInterface, text: string, kind: Kind, extra: { project?: string; link?: string; pr?: PrSource; by?: string } = {}): Promise<Item> {
  const now = await $.clock.now()
  const v = await read($, view)
  const item: Item = {
    schemaVersion: 2,
    id: newId(now),
    text: text.trim(),
    project: extra.project || v.here.project || projectOf(await $.session.cwd()),
    kind,
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
  const prStates = extra.pr ? { ...v.prStates, ...(await readPrStates($, [item])) } : v.prStates
  await update($, view, was => ({ ...was, items: [...was.items, item], prStates }))

  return item
}

// records that someone says an item is done (or open again). a PR item can't be declared:
// github is asked instead, and the answer comes back
async function declare(
  $: EngineInterface,
  id: string,
  how: { isDone: boolean; by: string; note?: string },
): Promise<{ item: Item; said: string } | null> {
  const item = (await readItems($)).find(i => i.id === id)
  if (!item) {
    return null
  }
  if (sourceOf(item) || item.completion?.mode === 'source') {
    const fresh = await readPrStates($, [item])
    const answer = prAnswer(item, fresh, (await read($, view)).prStates)
    await update($, view, was => ({ ...was, prStates: { ...was.prStates, ...answer.states } }))

    return { item, said: answer.said }
  }
  const at = new Date(await $.clock.now()).toISOString()
  const next = how.isDone ? declareDone(item, { by: how.by, note: how.note, at }) : reopen(item, at)
  await writeItem($, next)
  await update($, view, was => ({ ...was, items: was.items.map(i => (i.id === id ? next : i)) }))

  return { item: next, said: next.status === 'done' ? `done (${how.by} said so)` : 'open again' }
}

const textOf = (got: { content: unknown[] }) =>
  got.content.map(b => ((b as { type?: string; text?: string }).type === 'text' ? (b as { text: string }).text : '')).join(' ')

// one call to the app, given up after a while: an app call that waits on a permission nobody sees
// would otherwise leave the row stuck
const APP_WAIT_MS = 20_000

async function appCall($: EngineInterface, server: string, tool: string, args: Record<string, unknown>) {
  let timer: { cancel: () => void } | undefined
  const late = new Promise<never>((_, reject) => {
    timer = $.clock.after(APP_WAIT_MS, () => reject(new Error('the app did not answer')))
  })
  try {
    return await Promise.race([$.mcp.call(server, tool, args), late])
  } finally {
    timer?.cancel()
  }
}

// archives one conversation the person pressed archive on. it looks again first (the row may be a
// minute old), unpins it (the app won't archive a pinned one), and pins it back if archiving fails.
// each step is written on the row, so a step that hangs shows where
async function archiveConvo($: EngineInterface, id: string): Promise<void> {
  const say = (text: string) => update($, view, was => ({ ...was, archiving: { ...was.archiving, [id]: text } }))
  // the app may refuse a mod's archive (auto mode wants a request from the person behind each
  // archive): then the pin goes back and the row says to archive from the sidebar
  const refused = (why: string) =>
    /classifier|refused|denied|not allowed|permission/i.test(why)
      ? 'the app did not let the mod archive it; archive it from the sidebar'
      : `not archived: ${clip(why, 80)}`
  let isUnpinned = false
  try {
    await say('checking again…')
    await refresh($)
    const c = (await read($, view)).convos?.find(x => x.session.id === id)
    if (!c || c.verdict.state !== 'ready') {
      await say(c ? `not archived: ${c.verdict.reasons.join(', ') || 'no longer ready'}` : 'not archived: it is gone from the list')

      return
    }
    if (c.session.isPinned) {
      await say('unpinning…')
      const un = await appCall($, 'ccd_sidebar', 'set_pinned', { session_id: id, pinned: false })
      if (un.isError) {
        throw new Error(textOf(un))
      }
      isUnpinned = true
    }
    await say('archiving…')
    const got = await appCall($, 'ccd_session_mgmt', 'archive_session', { session_id: id, reason: 'puppy-todo: nothing left in it' })
    if (got.isError) {
      throw new Error(textOf(got))
    }
    await say('archived')
  } catch (err) {
    if (isUnpinned) {
      await appCall($, 'ccd_sidebar', 'set_pinned', { session_id: id, pinned: true }).catch(() => undefined)
    }
    await say(refused(err instanceof Error ? err.message : String(err)))
  }
  void refresh($).catch(() => undefined)
}

function line(i: Item, prStates: Readonly<Record<string, PrState>>): string {
  const o = outcomeOf(i, prStates)
  const from = i.session?.title ? ` · from ${i.session.title}` : ''
  const state = o.state === 'open' ? '' : ` {${o.state}${o.why ? `: ${o.why}` : ''}}`

  return `${i.id} [${i.kind}] ${i.project}: ${i.text}${i.link ? ` (${i.link})` : ''}${state}${from}`
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
      description: 'open the shared to-do pane; /todo <text> adds one for this conversation',
      argumentHint: '[text]',
    })
    await $.tool.register({
      name: 'todo_add',
      description:
        'Add an open item to the shared to-do list every conversation and project sees (~/.claude/todo/items). ' +
        'Use before ending a conversation for what is left: kind "todo" = the person must do it, "ask" = a question ' +
        'waiting for the person, "later" = something a conversation said it would do later. One short sentence each. ' +
        'When the item is done exactly when a GitHub PR merges, pass the PR as `pr`: GitHub then decides, nobody ticks it. ' +
        'The current conversation and project are filled in.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'what is left, one short sentence' },
          kind: { type: 'string', enum: [...KINDS] },
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
        'Record that a shared to-do item is done, or open again with reopen: true. Only when the person said it is done ' +
        '(by: "person", put their words in note) or you did it yourself and checked the result (by: "claude"). ' +
        'Never mark something done because it looks likely. Items tied to a PR are not changed: GitHub decides, and this ' +
        'returns what GitHub says.',
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
      description: 'List the open items in the shared to-do list, optionally for one project. PR items are checked on GitHub.',
      inputSchema: { type: 'object', properties: { project: { type: 'string' } } },
      isDeferred: false,
    })
    const started = await next(e)
    void $.ui.open({ id: PANE, title: 'todo' })
    void refresh($, true).catch(() => undefined)
    startTicking($)

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void refresh($).catch(() => undefined)

    return done
  })

  on('tool.call', { tool: 'mcp__puppy-todo__todo_add' }, async ($, e) => {
    try {
      const said = text(e, 'text')
      if (!said) {
        return { deny: 'text is required' }
      }
      const asked = field(e, 'kind')
      const kind = KINDS.includes(asked as Kind) ? (asked as Kind) : 'todo'
      const prText = text(e, 'pr')
      const pr = prText ? parsePrUrl(prText) : null
      if (prText && !pr) {
        return { deny: 'pr must look like https://github.com/<owner>/<repo>/pull/<n>' }
      }
      const item = await add($, said, kind, { project: text(e, 'project'), link: text(e, 'link'), pr: pr ?? undefined })

      return { result: `added ${line(item, (await read($, view)).prStates)}` }
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
      const got = await declare($, id, { isDone: field(e, 'reopen') !== true, by, note: text(e, 'note') })

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
      void refresh($, true).catch(() => undefined)

      return { text: 'the to-do pane is open.' }
    }
    const item = await add($, e.args, 'todo', { by: 'person' })

    return { text: `added: ${item.text}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Link } = table
    // the phone app draws no field yet
    const Input = 'Input' in table ? table.Input : undefined
    const v = await read($, view)
    if (v.at === null) {
      return <Text dimColor>{FACES.calm} sniffing around…</Text>
    }
    const now = v.at
    const width = Math.max(30, (e.viewport?.columns ?? 60) - 4)

    // every row with its skip target and occurrence, split into shown and skipped
    const items = shown(v.items, v.prStates, now).map(i => ({ i, what: target.item(i), occ: occurrence.item(i) }))
    const asks = v.talks.filter(t => t.ask).map(t => ({ t, what: target.ask(t), occ: occurrence.ask(t) }))
    const prs = v.prs.map(p => ({ p, what: target.pr(p), occ: occurrence.pr(p) }))
    const skipped = (x: { what: string; occ: string }) => isSkipped(v.attention, x.what, x.occ)
    // a skip hides a reminder; an item that ended (merged, closed, said done) reminds of nothing,
    // so it shows as ended and is not counted as skipped
    const skippedItem = (x: { i: Item; what: string; occ: string }) => isOpenItem(x.i, v.prStates) && skipped(x)
    const liveItems = items.filter(x => !skippedItem(x))
    const liveAsks = asks.filter(x => !skipped(x))
    const livePrs = prs.filter(x => !skipped(x))
    const skippedRows = [
      ...items.filter(skippedItem).map(x => ({ what: x.what, occ: x.occ, label: x.i.text })),
      ...asks.filter(skipped).map(x => ({ what: x.what, occ: x.occ, label: `${x.t.title}: ${x.t.ask ?? ''}` })),
      ...prs.filter(skipped).map(x => ({ what: x.what, occ: x.occ, label: `${x.p.repo}#${x.p.number} ${x.p.title}` })),
    ]
    const mine = liveItems.filter(x => isHere(x.i, v.here))
    const others = liveItems.filter(x => !isHere(x.i, v.here))
    const openCount = liveItems.filter(x => isOpenItem(x.i, v.prStates)).length + livePrs.length
    const face = mood(liveAsks.length, openCount, skippedRows.length)

    const head = (label: string, count?: number) => (
      <Text bold>
        {label}
        {count !== undefined ? <Text dimColor> {count}</Text> : null}
      </Text>
    )
    const skip = (key: string, what: string, occ: string) => (
      <Button key={key} label="skip" dimColor onPress={() => setAttention($, what, occ, 'dismissed')} />
    )
    const row = (x: { i: Item; what: string; occ: string }, isFromShown = true) => {
      const o = outcomeOf(x.i, v.prStates)
      const isEnded = o.state === 'done' || o.state === 'canceled'
      const mark = { open: '·', unknown: '?', done: '✓', canceled: '✕' }[o.state]

      return (
        <Box key={x.what} flexDirection="row" gap={1}>
          <Text dimColor={isEnded}>{mark}</Text>
          <Text dimColor={isEnded} strikethrough={isEnded}>
            {clip(x.i.text, width - 14)}
            {x.i.kind !== 'todo' ? <Text dimColor> · {x.i.kind}</Text> : null}
            {o.why ? <Text dimColor> · {o.why}</Text> : null}
            {isFromShown && x.i.session?.title ? <Text dimColor> · {clip(x.i.session.title, 30)}</Text> : null}
          </Text>
          {x.i.link?.startsWith('https://') ? <Link href={x.i.link} label="link" /> : null}
          {isEnded ? null : skip(`skip-${x.what}`, x.what, x.occ)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text>
          {FACES[face]}
          <Text dimColor> {saying(face, liveAsks.length, openCount, skippedRows.length)}</Text>
        </Text>

        <Box flexDirection="column">
          {head('this conversation')}
          <Text>
            {clip(v.here.title || 'untitled', width)}
            <Text dimColor> · {v.here.project}</Text>
          </Text>
          {v.here.goal ? <Text dimColor>for: {clip(v.here.goal, width * 2)}</Text> : null}
          {v.here.recap ? <Text dimColor>last: {clip(v.here.recap, width * 3)}</Text> : null}
          {mine.map(x => row(x, false))}
          {mine.length === 0 ? <Text dimColor>nothing left here on the list.</Text> : null}
        </Box>

        {liveAsks.length > 0 && (
          <Box flexDirection="column">
            {head('waiting on you', liveAsks.length)}
            {liveAsks.map(x => (
              <Box key={x.what} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Text>
                    {clip(x.t.title, width - 20)}
                    <Text dimColor>
                      {' '}
                      · {x.t.project} · {ago(now, x.t.mtimeMs)}
                    </Text>
                  </Text>
                  {skip(`skip-${x.what}`, x.what, x.occ)}
                </Box>
                <Text dimColor>  {clip(x.t.ask ?? '', width * 2)}</Text>
              </Box>
            ))}
          </Box>
        )}

        {livePrs.length > 0 && (
          <Box flexDirection="column">
            {head('prs to merge', livePrs.length)}
            {livePrs.map(x => (
              <Box key={x.what} flexDirection="row" gap={1}>
                <Link href={x.p.url} label={`${x.p.repo}#${x.p.number}`} />
                <Text dimColor>
                  {clip(x.p.title, width - x.p.repo.length - 14)}
                  {x.p.isDraft ? ' · draft' : ''}
                </Text>
                {skip(`skip-${x.what}`, x.what, x.occ)}
              </Box>
            ))}
          </Box>
        )}

        <Box flexDirection="column">
          {head('to-do', others.filter(x => isOpenItem(x.i, v.prStates)).length)}
          {byProject(others.map(x => ({ ...x, project: x.i.project }))).map(([project, group]) => (
            <Box key={`p-${project}`} flexDirection="column">
              <Text dimColor>{project}</Text>
              {group.map(x => row(x))}
            </Box>
          ))}
          {others.length === 0 ? <Text dimColor>nothing here.</Text> : null}
          <Text dimColor>done is said in a conversation (“the call is done”), or by github for PR items.</Text>
        </Box>

        {v.convos === null ? (
          <Text dimColor>conversations: the app's session list can't be read here.</Text>
        ) : (
          <Box flexDirection="column">
            {head('conversations', v.convos.length)}
            <Text dimColor>
              {v.convos.filter(c => c.verdict.state === 'ready').length} can be archived · nothing left in them, folder clean
            </Text>
            {sortConvos(v.convos).map(c => {
              const mark = { ready: '✓', open: '●', unknown: '?' }[c.verdict.state]
              const said = v.archiving[c.session.id]

              return (
                <Box key={`c-${c.session.id}`} flexDirection="column">
                  <Box flexDirection="row" gap={1}>
                    <Text dimColor={c.verdict.state === 'unknown'}>
                      {mark} {clip(c.session.title, width - 30)}
                      <Text dimColor>
                        {' '}
                        · {ago(now, c.session.lastActivityMs)}
                        {c.session.isPinned ? ' · pinned' : ''}
                      </Text>
                    </Text>
                    {c.verdict.state === 'ready' ? (
                      <Button key={`archive-${c.session.id}`} label="archive" onPress={() => archiveConvo($, c.session.id)} />
                    ) : null}
                  </Box>
                  {c.verdict.reasons.length > 0 ? <Text dimColor>  {clip(c.verdict.reasons.join(' · '), width * 2)}</Text> : null}
                  {c.verdict.state === 'ready' && c.recap ? <Text dimColor>  last: {clip(c.recap, width * 2)}</Text> : null}
                  {said ? <Text dimColor>  {said}</Text> : null}
                </Box>
              )
            })}
          </Box>
        )}

        {skippedRows.length > 0 && (
          <Box flexDirection="column">
            <Button
              key="show-skipped"
              label={v.isShowingSkipped ? `hide skipped (${skippedRows.length})` : `skipped (${skippedRows.length})`}
              dimColor
              onPress={() => update($, view, was => ({ ...was, isShowingSkipped: !was.isShowingSkipped }))}
            />
            {v.isShowingSkipped
              ? skippedRows.map(r => (
                  <Box key={`back-${r.what}`} flexDirection="row" gap={1}>
                    <Text dimColor>{clip(r.label, width - 14)}</Text>
                    <Button key={`bring-${r.what}`} label="bring back" onPress={() => setAttention($, r.what, r.occ, 'active')} />
                  </Box>
                ))
              : null}
          </Box>
        )}

        {Input ? (
          <Input
            key="add"
            placeholder="add a to-do for this conversation…"
            submitLabel="add"
            onSubmit={said => {
              if (said.trim() !== '') {
                void add($, said, 'todo', { by: 'person' })
              }
            }}
          />
        ) : null}

        <Box flexDirection="row" gap={1}>
          <Button key="refresh" label="refresh" onPress={() => refresh($, true)} />
          <Text dimColor>
            looked at {clockTime(now)}
            {v.notes.length > 0 ? ` · ${v.notes.join(' · ')}` : ''}
          </Text>
        </Box>
      </Box>
    )
  })
}
