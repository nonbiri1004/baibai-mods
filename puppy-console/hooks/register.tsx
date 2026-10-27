import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Conversation, Problem, Snapshot, Status } from '../types'
import { detailLines, picture, W } from './draw'
import { ago, alerts, expandHome, isStale, parseStatus, sortCards, textBar, titleOf } from './format'
import { folderName, isWrapUp, KEEP_MS, nameOf, oneLine, parseConversation, plain, recent, SESSIONS, shownState, wrapOf } from './sessions'

const PANE = 'puppy-console'
const REFRESH_MS = 60_000
const MAX_NEEDS = 6
const MAX_OTHERS = 5

const snapshot = atom({ plugin: 'puppy-console', key: 'snapshot' } as const, null)

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

// Every *.json in the folder is one card. A file that does not parse becomes a problem line,
// never a missing card without a word: the writer may be halfway through, or on an old format.
export async function loadFolder($: EngineInterface, dir: string): Promise<Omit<Snapshot, 'conversations'>> {
  const loadedAt = await $.clock.now()
  if (!dir) return { dir, cards: [], problems: [], dirError: 'no status folder set', loadedAt }
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch (err) {
    return { dir, cards: [], problems: [], dirError: errorText(err), loadedAt }
  }
  const cards: Status[] = []
  const problems: Problem[] = []
  for (const f of entries) {
    if (f.kind !== 'file' || !f.name.endsWith('.json') || f.name.startsWith('.')) continue
    try {
      const s = parseStatus(await $.fs.read(`${dir}/${f.name}`))
      if (`${s.pipeline}.json` !== f.name) throw new Error(`"pipeline" is ${s.pipeline}, so the file should be ${s.pipeline}.json`)
      cards.push(s)
    } catch (err) {
      problems.push({ file: f.name, reason: errorText(err) })
    }
  }
  return { dir, cards: sortCards(cards), problems, dirError: null, loadedAt }
}

// The conversations' files. A file older than the card shows is not read at all, so the folder
// can grow without the refresh slowing down. One that does not parse (a write caught halfway)
// keeps what the last read had, and is read again at the next refresh.
async function loadConversations($: EngineInterface, dir: string, prev: Conversation[], now: number): Promise<Conversation[]> {
  const out: Conversation[] = []
  for (const f of await $.fs.list(dir).catch(() => [])) {
    if (f.kind !== 'file' || !f.name.endsWith('.json') || f.name.startsWith('.')) continue
    if (f.mtimeMs && now - f.mtimeMs > KEEP_MS) continue
    try {
      const c = parseConversation(await $.fs.read(`${dir}/${f.name}`))
      if (`${c.id}.json` === f.name) out.push(c)
    } catch {
      const kept = prev.find(c => `${c.id}.json` === f.name)
      if (kept) out.push(kept)
    }
  }
  return recent(out, now)
}

// This conversation's own file, `~/.claude/console/sessions/<session id>.json`; only this
// conversation writes it. `own` is what the file last said, kept by session id: /clear gives a
// new id without a new session.start, and a reload starts the module over and reads it back.
// Writes go one after another and never hold up the turn: a turn's hooks queue them and go on.
let own: Conversation | null = null
let writing: Promise<void> = Promise.resolve()
function save($: EngineInterface, change: (c: Conversation) => Conversation, prompt = '') {
  // The id is asked for now, not when the write's turn comes: a /clear in between must not
  // send this turn's recap into the next conversation's file.
  const asked = $.session.id()
  writing = writing.then(async () => {
    const [id, home, now] = await Promise.all([asked, $.env.get('HOME'), $.clock.now()])
    if (!home) return
    const path = `${home}/${SESSIONS}/${id}.json`
    if (own?.id !== id) {
      own = await $.fs.read(path).then(parseConversation).catch(() => null)
      if (!own) {
        const [messages, root] = await Promise.all([$.session.messages(), $.session.root()])
        const title = nameOf(messages)
        own = {
          format: 'session-status', version: 1, id, updated: '', state: 'running',
          title: title === 'new conversation' && plain(prompt) ? oneLine(plain(prompt), 60) : title,
          project: folderName(root), recap: '', ask: null,
        }
      }
    }
    own = change({ ...own, updated: new Date(now).toISOString() })
    await $.fs.write(path, `${JSON.stringify(own, null, 2)}\n`)
  }).catch(() => {})
}

// One refresh at a time: the timer and the button share the running one,
// so an older read can never finish last and overwrite a newer one.
let running: Promise<void> | null = null
function refresh($: EngineInterface, setting: string, isNotifying: boolean, isShowing: boolean): Promise<void> {
  running ??= (async () => {
    const home = await $.env.get('HOME')
    const dir = expandHome(setting.trim(), home)
    const prev = await read($, snapshot)
    const folder = await loadFolder($, dir)
    const conversations = isShowing && home
      ? await loadConversations($, `${home}/${SESSIONS}`, prev?.conversations ?? [], folder.loadedAt)
      : []
    const next: Snapshot = { ...folder, conversations }
    await update($, snapshot, () => next)
    // A toast shows in this conversation only, for ten seconds; each open conversation tells its own.
    if (isNotifying) for (const line of alerts(prev, next)) $.ui.toast(line, { timeoutMs: 10_000 })
  })().finally(() => { running = null })
  return running
}

// A detail of an unexpected shape loses its picture, not the whole pane.
function safePicture(s: Status, stale: boolean) {
  try {
    return picture(s, stale)
  } catch {
    return null
  }
}

function safeLines(s: Status): string[] {
  try {
    return detailLines(s)
  } catch {
    return []
  }
}

export const register: Register = (on, options) => {
  const setting = String(options.status_dir ?? '')
  const isNotifying = options.notify !== 'off'
  const isWriting = options.conversations !== 'off'

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'console', description: 'Open the pipeline cards' })
    void refresh($, setting, isNotifying, isWriting)
    // Like setInterval in a component's mount: each tick reads the folder again and the pane redraws.
    $.clock.every(REFRESH_MS, () => refresh($, setting, isNotifying, isWriting))
    return next(e)
  })

  // The main loop only: a subagent's turns are part of this conversation's turn.
  // `wrap` is this turn's wrap_up, caught as it is called, so an older turn's is never used.
  let wrap: ReturnType<typeof wrapOf> = null
  on('turn.start', async ($, e, next) => {
    if (isWriting && e.agentId === undefined) {
      wrap = null
      save($, c => ({ ...c, state: 'running', ask: null }), e.text)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (isWriting && e.agentId === undefined && isWrapUp(e.tool)) wrap = wrapOf(e as Record<string, unknown>) ?? wrap
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (isWriting && e.agentId === undefined) {
      const w = wrap
      const state = e.reason === 'error' || e.reason === 'refusal' ? 'error' : w?.ask ? 'waiting' : 'done'
      save($, c => ({ ...c, state, recap: w?.recap || oneLine(e.answer, 200) || c.recap, ask: w?.ask ?? null }))
    }
    return next(e)
  })

  on('command.run', { command: 'console' }, async $ => {
    await refresh($, setting, isNotifying, isWriting)
    await $.ui.open({ id: PANE, title: 'console' })
    return { text: 'pipeline cards opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const snap = await read($, snapshot)
    const now = await $.clock.now()
    if (!snap) return <Text dimColor>loading…</Text>

    const hasSvg = e.surface !== 'terminal' && 'Svg' in ui

    const card = (s: Status) => {
      const stale = isStale(s, now)
      const pic = hasSvg ? safePicture(s, stale) : null
      const stateColor = s.state === 'error' ? 'error' : s.state === 'waiting' ? 'warning' : s.state === 'running' ? 'success' : undefined
      return (
        <Box key={s.pipeline} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} gap="xs">
          <Box flexDirection="row" justifyContent="space-between">
            <Text weight="semibold">{titleOf(s)}</Text>
            <Text dimColor>
              <Text color={stateColor}>{stale ? 'quiet' : s.state}</Text>
              {' · '}{ago(now - Date.parse(s.updated))}{s.host ? ` · ${s.host}` : ''}
            </Text>
          </Box>
          <Text>{s.headline}</Text>
          {stale && <Text color="warning">no update for {ago(now - Date.parse(s.updated)).replace(' ago', '')}; is {s.host ?? 'the computer'} asleep?</Text>}
          {pic && 'Svg' in ui
            ? <ui.Svg source={pic.source} alt={pic.alt} isInteractive />
            : s.progress && <Text mono dimColor>{textBar(s.progress)}</Text>}
          {/* no picture (the terminal): the same details as text */}
          {!pic && safeLines(s).map(line => <Text dimColor>{line}</Text>)}
          {(s.waiting ?? []).length > 0 && (
            <Box flexDirection="column">
              <Text color="warning">waiting for you</Text>
              {(s.waiting ?? []).slice(0, 5).map(w => <Text key={w.id}>· {w.text}</Text>)}
              {(s.waiting ?? []).length > 5 && <Text dimColor>· and {(s.waiting ?? []).length - 5} more</Text>}
            </Box>
          )}
          {s.last_output && (
            <Text dimColor>last: {s.last_output.label}{s.last_output.at ? ` · ${ago(now - Date.parse(s.last_output.at))}` : ''}</Text>
          )}
          {s.next && !(s.waiting ?? []).some(w => w.text === s.next) && <Text dimColor>next: {s.next}</Text>}
        </Box>
      )
    }

    // Always first: the conversations that wait for you, each with where it stands and what it asks.
    // The rest get one quiet line each.
    const conversationsCard = (list: Conversation[]) => {
      const needs = list.filter(c => ['waiting', 'error'].includes(shownState(c, now)))
      const others = list.filter(c => !needs.includes(c))
      const running = others.filter(c => shownState(c, now) === 'running').length
      const since = (c: Conversation) => `${c.project ? `${c.project} · ` : ''}${ago(now - Date.parse(c.updated))}`
      return (
        <Box key="conversations" flexDirection="column" borderStyle="round" borderDimColor paddingX={1} gap="xs">
          <Box flexDirection="row" justifyContent="space-between">
            <Text weight="semibold">conversations</Text>
            <Text dimColor>
              {needs.length > 0 ? <Text color="warning">{needs.length} waiting</Text> : 'none waiting'}
              {running > 0 ? ` · ${running} running` : ''}
            </Text>
          </Box>
          {needs.slice(0, MAX_NEEDS).map(c => (
            <Box key={`c:${c.id}`} flexDirection="column">
              <Text>{c.title} <Text dimColor>· {since(c)}</Text></Text>
              {c.recap && <Text dimColor>{c.recap}</Text>}
              {c.state === 'error'
                ? <Text color="error">the last turn ended on an error</Text>
                : c.ask && <Text color="warning">→ {c.ask}</Text>}
            </Box>
          ))}
          {needs.length > MAX_NEEDS && <Text dimColor>and {needs.length - MAX_NEEDS} more waiting</Text>}
          {others.slice(0, MAX_OTHERS).map(c => (
            <Text key={`c:${c.id}`} dimColor>· {c.title} · {shownState(c, now)} · {since(c)}</Text>
          ))}
          {others.length > MAX_OTHERS && <Text dimColor>· and {others.length - MAX_OTHERS} more in the last 3 days</Text>}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>checked {ago(now - snap.loadedAt)}</Text>
          <Button key="refresh" label="refresh" hotkey="r" onPress={() => refresh($, setting, isNotifying, isWriting)} />
        </Box>
        {snap.dirError && (
          <Box flexDirection="column">
            <Text color="error">can't read the status folder: {snap.dirError}</Text>
            <Text dimColor>set it in /config → puppy-console → status folder{snap.dir ? ` (now ${snap.dir})` : ''}</Text>
          </Box>
        )}
        {snap.conversations.length > 0 && conversationsCard(snap.conversations)}
        {!snap.dirError && snap.cards.length === 0 && snap.problems.length === 0 && (
          <Text dimColor>no status files in {snap.dir} yet</Text>
        )}
        {snap.cards.map(card)}
        {snap.problems.map(p => (
          <Text key={`p:${p.file}`} dimColor>skipped {p.file}: {p.reason}</Text>
        ))}
      </Box>
    )
  })
}
