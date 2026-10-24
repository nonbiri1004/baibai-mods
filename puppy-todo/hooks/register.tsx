import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Item, Kind, Pr, Talk, View } from '../types'
import { KINDS, ago, byProject, clip, clockTime, newId, parseItem, parsePrs, parseScan, projectOf, shown } from './todo'

const PANE = 'puppy-todo'
// the puppy's orange (--phones in shared/theme.css): the one accent
const PHONES = '#e07b35'
// conversations older than this, or past this many, are left out of "waiting on you"
const TALK_DAYS = 14
const TALK_MAX = 40
// how often the pane looks again (the shared list, transcripts); gh only every GH_EVERY
const TICK = 60_000
const GH_EVERY = 5 * 60_000

const EMPTY: View = { here: { id: '', title: '', project: '' }, talks: [], prs: [], items: [], at: null, notes: [] }
const view = atom({ plugin: 'puppy-todo', key: 'view' } as const, EMPTY)

// per transcript: what it said, read again only when the file changes (a reload starts over)
const talkCache = new Map<string, { mtimeMs: number; talk: Talk }>()
let ghAt = 0
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

async function itemsDir($: EngineInterface): Promise<string> {
  return `${await home($)}/.claude/todo/items`
}

async function readItems($: EngineInterface): Promise<Item[]> {
  const dir = await itemsDir($)
  if (!(await $.fs.exists(dir))) {
    return []
  }
  const files = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.json'))
  const items = await Promise.all(
    files.map(f =>
      $.fs
        .read(`${dir}/${f.name}`)
        .then(parseItem)
        .catch(() => null),
    ),
  )

  return items.filter((i): i is Item => i !== null)
}

async function writeItem($: EngineInterface, item: Item): Promise<void> {
  await $.fs.write(`${await itemsDir($)}/${item.id}.json`, `${JSON.stringify(item, null, 2)}\n`)
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

// the desktop app's own list says which conversations are archived; away from it, nothing is
async function archivedTitles($: EngineInterface): Promise<Set<string> | null> {
  try {
    const got = await $.mcp.call('ccd_session_mgmt', 'list_sessions', { include_archived: true, limit: 200 })
    const block = got.content[0] as { type?: string; text?: string } | undefined
    if (got.isError || block?.type !== 'text' || !block.text) {
      return null
    }
    const rows = JSON.parse(block.text) as { title?: string; isArchived?: boolean }[]

    return new Set(rows.filter(r => r.isArchived && r.title).map(r => r.title as string))
  } catch {
    return null
  }
}

async function readPrs($: EngineInterface): Promise<Pr[] | string> {
  const argv = ['search', 'prs', '--author=@me', '--state=open', '--json', 'number,title,repository,url,isDraft', '--limit', '50']
  for (const gh of ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']) {
    try {
      const ran = await $.process.run([gh, ...argv])
      if (ran.exitCode === 0) {
        return parsePrs(ran.stdout)
      }

      return `gh: ${clip(ran.stderr, 80)}`
    } catch {
      // not at this path; try the next
    }
  }

  return 'gh is not installed, so open PRs are not listed'
}

// reads every source again; gh only when asked or every few minutes
async function refresh($: EngineInterface, isFull = false): Promise<void> {
  const now = await $.clock.now()
  const ownId = await $.session.id()
  const notes: string[] = []
  const [items, talks, archived, project] = await Promise.all([
    readItems($).catch(() => {
      notes.push('could not read ~/.claude/todo/items')

      return [] as Item[]
    }),
    readTalks($, ownId).catch(() => {
      notes.push('could not read the transcripts')

      return [] as Talk[]
    }),
    archivedTitles($),
    projectHere($),
  ])
  let prs = (await read($, view)).prs
  if (isFull || now - ghAt > GH_EVERY) {
    const got = await readPrs($)
    ghAt = now
    if (typeof got === 'string') {
      notes.push(got)
    } else {
      prs = got
    }
  }
  const own = talks.find(t => t.id === ownId)
  const goal = await firstPrompt($)
  const others = talks.filter(t => t.id !== ownId && t.title !== '' && !archived?.has(t.title))
  await update($, view, () => ({
    here: { id: ownId, title: own?.title || clip(goal ?? '', 40), project, goal, recap: own?.recap },
    talks: others,
    prs,
    items,
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

async function add($: EngineInterface, text: string, kind: Kind, extra: Partial<Item> = {}): Promise<Item> {
  const now = await $.clock.now()
  const v = await read($, view)
  const item: Item = {
    id: newId(now),
    text: text.trim(),
    project: extra.project || v.here.project || projectOf(await $.session.cwd()),
    kind,
    status: 'open',
    session: { id: await $.session.id(), title: v.here.title || undefined, cwd: await $.session.cwd() },
    ...(extra.link ? { link: extra.link } : {}),
    by: extra.by ?? 'claude',
    createdAt: new Date(now).toISOString(),
  }
  await writeItem($, item)
  await update($, view, was => ({ ...was, items: [...was.items, item] }))

  return item
}

async function markDone($: EngineInterface, id: string, isDone = true): Promise<Item | null> {
  const item = (await readItems($)).find(i => i.id === id)
  if (!item) {
    return null
  }
  const now = await $.clock.now()
  const next: Item = isDone
    ? { ...item, status: 'done', doneAt: new Date(now).toISOString() }
    : { ...item, status: 'open', doneAt: undefined }
  await writeItem($, next)
  await update($, view, was => ({ ...was, items: was.items.map(i => (i.id === id ? next : i)) }))

  return next
}

function line(i: Item): string {
  const from = i.session?.title ? ` · from ${i.session.title}` : ''

  return `${i.id} [${i.kind}] ${i.project}: ${i.text}${i.link ? ` (${i.link})` : ''}${from}`
}

const field = (e: unknown, name: string): unknown => (e as Record<string, unknown>)[name]

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
        'The current conversation and project are filled in.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'what is left, one short sentence' },
          kind: { type: 'string', enum: [...KINDS] },
          project: { type: 'string', description: 'repo name; defaults to this conversation’s repo' },
          link: { type: 'string', description: 'a PR, issue or doc URL' },
        },
        required: ['text'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'todo_done',
      description: 'Mark a shared to-do item done (or open again with reopen: true) by its id.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, reopen: { type: 'boolean' } },
        required: ['id'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'todo_list',
      description: 'List the open items in the shared to-do list, optionally for one project.',
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
    const text = field(e, 'text')
    if (typeof text !== 'string' || text.trim() === '') {
      return { deny: 'text is required' }
    }
    const asked = field(e, 'kind')
    const kind = KINDS.includes(asked as Kind) ? (asked as Kind) : 'todo'
    const project = field(e, 'project')
    const link = field(e, 'link')
    const item = await add($, text, kind, {
      project: typeof project === 'string' ? project : undefined,
      link: typeof link === 'string' ? link : undefined,
    })

    return { result: `added ${line(item)}` }
    } catch (err) {
      return { deny: `could not add: ${String(err)}` }
    }
  })

  on('tool.call', { tool: 'mcp__puppy-todo__todo_done' }, async ($, e) => {
    const id = field(e, 'id')
    const item =
      typeof id === 'string' ? await markDone($, id, field(e, 'reopen') !== true).catch(() => null) : null

    return item ? { result: `${item.status}: ${line(item)}` } : { deny: `no item with id ${String(id)}` }
  })

  on('tool.call', { tool: 'mcp__puppy-todo__todo_list' }, async ($, e) => {
    const project = field(e, 'project')
    const open = (await readItems($).catch(() => [] as Item[])).filter(i => i.status === 'open' && (typeof project !== 'string' || i.project === project))

    return { result: open.length === 0 ? 'nothing open' : shown(open, 0).map(line).join('\n') }
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
    const now = v.at ?? 0
    const width = Math.max(30, (e.viewport?.columns ?? 60) - 4)
    const list = shown(v.items, now)
    const mine = list.filter(i => i.session?.id === v.here.id)
    const others = list.filter(i => i.session?.id !== v.here.id)
    const waiting = v.talks.filter(t => t.ask)
    const head = (text: string, count?: number) => (
      <Text bold color={PHONES}>
        {text}
        {count !== undefined ? <Text dimColor> {count}</Text> : null}
      </Text>
    )
    const row = (i: Item, isFromShown = true) => (
      <Box key={i.id} flexDirection="row" gap={1}>
        <Button
          key={`done-${i.id}`}
          label={i.status === 'done' ? '✓' : '○'}
          onPress={() => markDone($, i.id, i.status !== 'done')}
        />
        <Text dimColor={i.status === 'done'} strikethrough={i.status === 'done'}>
          {clip(i.text, width - 6)}
          {i.kind !== 'todo' ? <Text dimColor> · {i.kind}</Text> : null}
          {isFromShown && i.session?.title ? <Text dimColor> · {clip(i.session.title, 30)}</Text> : null}
        </Text>
        {i.link?.startsWith('https://') ? <Link href={i.link} label="link" /> : null}
      </Box>
    )

    if (v.at === null) {
      return <Text dimColor>the puppy is sniffing around…</Text>
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          {head('this conversation')}
          <Text>
            {clip(v.here.title || 'untitled', width)}
            <Text dimColor> · {v.here.project}</Text>
          </Text>
          {v.here.goal ? <Text dimColor>for: {clip(v.here.goal, width * 2)}</Text> : null}
          {v.here.recap ? <Text dimColor>last: {clip(v.here.recap, width * 3)}</Text> : null}
          {mine.map(i => row(i, false))}
          {mine.length === 0 ? <Text dimColor>nothing left here on the list.</Text> : null}
        </Box>

        {waiting.length > 0 && (
          <Box flexDirection="column">
            {head('waiting on you', waiting.length)}
            {waiting.map(t => (
              <Box key={`ask-${t.id}`} flexDirection="column">
                <Text>
                  {clip(t.title, width - 12)}
                  <Text dimColor>
                    {' '}
                    · {t.project} · {ago(now, t.mtimeMs)}
                  </Text>
                </Text>
                <Text dimColor>  {clip(t.ask ?? '', width * 2)}</Text>
              </Box>
            ))}
          </Box>
        )}

        {v.prs.length > 0 && (
          <Box flexDirection="column">
            {head('prs to merge', v.prs.length)}
            {v.prs.map(p => (
              <Box key={`pr-${p.url}`} flexDirection="row" gap={1}>
                <Link href={p.url} label={`${p.repo}#${p.number}`} />
                <Text dimColor>
                  {clip(p.title, width - p.repo.length - 8)}
                  {p.isDraft ? ' · draft' : ''}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        <Box flexDirection="column">
          {head('to-do', others.filter(i => i.status === 'open').length)}
          {byProject(others).map(([project, group]) => (
            <Box key={`p-${project}`} flexDirection="column">
              <Text dimColor>{project}</Text>
              {group.map(i => row(i))}
            </Box>
          ))}
          {others.length === 0 ? <Text dimColor>all clear. the puppy naps.</Text> : null}
        </Box>

        {Input ? (
          <Input
            key="add"
            placeholder="add a to-do for this conversation…"
            submitLabel="add"
            onSubmit={text => {
              if (text.trim() !== '') {
                void add($, text, 'todo', { by: 'person' })
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
