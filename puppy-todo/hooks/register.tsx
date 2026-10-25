import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Attention, Item, Kind, Pr, PrSource, PrState, Talk, View } from '../types'
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
const LIST = `find "$1" -maxdepth 2 -name '*.jsonl' -mtime -${TALK_DAYS} -not -path '*scratch-workspaces*' -print0 | xargs -0 stat -f '%m %N'`

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

async function readTalks($: EngineInterface, ownId: string): Promise<Talk[]> {
  const listed = await $.process.run(['sh', '-c', LIST, 'sh', `${await home($)}/.claude/projects`])
  const files = listed.stdout
    .split('\n')
    .map(line => {
      const cut = line.indexOf(' ')

      return { mtimeMs: Number(line.slice(0, cut)) * 1000, path: line.slice(cut + 1) }
    })
    .filter(f => f.path.endsWith('.jsonl') && Number.isFinite(f.mtimeMs))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  const picked = files.filter((f, i) => i < TALK_MAX || f.path.endsWith(`/${ownId}.jsonl`))
  const stale = picked.filter(f => talkCache.get(f.path)?.mtimeMs !== f.mtimeMs)
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

  return picked.map(f => talkCache.get(f.path)?.talk).filter((t): t is Talk => t !== undefined)
}

// the desktop app's own list says which conversations are archived; away from it, nothing is.
// transcripts don't carry the app's session id, so the title is all there is to match on
async function archivedTitles($: EngineInterface): Promise<Set<string> | null> {
  try {
    const got = await $.mcp.call('ccd_session_mgmt', 'list_sessions', { include_archived: true, limit: 200 })
    const block = got.content[0] as { type?: string; text?: string } | undefined
    if (got.isError || block?.type !== 'text' || !block.text) {
      return null
    }
    const rows = JSON.parse(block.text) as { title?: string; isArchived?: boolean }[]
    const live = new Set(rows.filter(r => !r.isArchived && r.title).map(r => r.title as string))

    // a title that is both archived and live stays shown: hiding a live conversation is worse
    return new Set(rows.filter(r => r.isArchived && r.title && !live.has(r.title)).map(r => r.title as string))
  } catch {
    return null
  }
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
  const [items, attention, talks, archived, project, cwd] = await Promise.all([
    readItems($).catch(() => {
      notes.push('could not read ~/.claude/todo/items')

      return [] as Item[]
    }),
    readAttention($).catch(() => ({}) as Record<string, Attention>),
    readTalks($, ownId).catch(() => {
      notes.push('could not read the transcripts')

      return [] as Talk[]
    }),
    archivedTitles($),
    projectHere($),
    $.session.cwd(),
  ])
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
    t => t.id !== ownId && t.title !== '' && !(own && t.title === own.title && t.cwd === own.cwd) && !archived?.has(t.title),
  )
  await update($, view, v => ({
    ...v,
    here: { id: ownId, title: own?.title || clip(goal ?? '', 40), project, cwd, goal, recap: own?.recap },
    talks: others,
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
    const liveItems = items.filter(x => !skipped(x))
    const liveAsks = asks.filter(x => !skipped(x))
    const livePrs = prs.filter(x => !skipped(x))
    const skippedRows = [
      ...items.filter(skipped).map(x => ({ what: x.what, occ: x.occ, label: x.i.text })),
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
