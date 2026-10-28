import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Conversation, Problem, Snapshot, Status } from '../types'
import { cut, detailLines, MASCOT_SCALE, mascot, picture, PUPPY_MIN_ROWS, stillBlocks } from './draw'
import type { Mood } from './draw'
import { ago, alerts, expandHome, isFolded, isStale, parseStatus, sortCards, splitCards, textBar, titleOf, toggleFold } from './format'
import { folderName, isWrapUp, KEEP_MS, nameOf, oneLine, parseConversation, plain, recent, SESSIONS, shownState, wrapOf } from './sessions'

const PANE = 'puppy-console'
const REFRESH_MS = 60_000
const MAX_NEEDS = 6
const MAX_OTHERS = 5

const snapshot = atom({ plugin: 'puppy-console', key: 'snapshot' } as const, null)
// What the person folded or opened, and whether the "older" group is open. The atoms redraw the
// pane; $.store keeps them on this computer across conversations and restarts, one key per card
// ("fold:<pipeline>") so two conversations folding different cards never undo each other.
const folds = atom({ plugin: 'puppy-console', key: 'folds' } as const, {} as Record<string, boolean>)
const isShowingOlder = atom({ plugin: 'puppy-console', key: 'isShowingOlder' } as const, false)
const FOLD = 'fold:'
const SHOWING_OLDER = 'isShowingOlder'

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
        // the repository's name (a worktree's main checkout), not the folder: no "console-sessions"
        // for a worktree, no home folder's name for a conversation outside any repository
        const [messages, repo] = await Promise.all([$.session.messages(), $.session.repo().catch(() => null)])
        const title = nameOf(messages)
        own = {
          format: 'session-status', version: 1, id, updated: '', state: 'running',
          title: title === 'new conversation' && plain(prompt) ? oneLine(plain(prompt), 60) : title,
          project: repo ? folderName(repo.root) : undefined, recap: '', ask: null,
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

// The folds as the store has them, read when the pane opens, so a fold made in another
// conversation shows here too. A store that can't be read keeps what this session has.
async function loadFolds($: EngineInterface): Promise<void> {
  try {
    const kept: Record<string, boolean> = {}
    for (const key of await $.store.keys()) {
      if (!key.startsWith(FOLD)) continue
      const v = await $.store.get(key)
      if (typeof v === 'boolean') kept[key.slice(FOLD.length)] = v
    }
    const showing = (await $.store.get(SHOWING_OLDER)) === true
    await update($, folds, () => kept)
    await update($, isShowingOlder, () => showing)
  } catch {
    // nothing kept yet, or no store here: the defaults
  }
}

async function pressFold($: EngineInterface, pipeline: string, isOlderCard: boolean): Promise<void> {
  const next = await update($, folds, was => toggleFold(was, pipeline, isOlderCard))
  const key = `${FOLD}${pipeline}`
  await (pipeline in next ? $.store.set(key, next[pipeline]) : $.store.delete(key)).catch(() => {})
}

async function pressOlder($: EngineInterface): Promise<void> {
  const next = await update($, isShowingOlder, was => !was)
  await $.store.set(SHOWING_OLDER, next).catch(() => {})
}

async function isPaneUp($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes().catch(() => [])).some(p => p.id === PANE)
}

// The folder is read only while the pane is open: once when it opens, then every minute.
// A module variable, not $.state: a timer is not data, and a reload drops both together.
let reading: Timer | null = null
function stopReading() {
  reading?.cancel()
  reading = null
}

// Like setInterval in a component's mount, cleared on unmount: each tick first asks whether the
// pane is still up, and stops when it is not. Started over on every /console, so a second
// /console never leaves two timers. Only the ticks tell news with a toast: the read on opening
// is shown by the pane itself, and would compare against a read that may be hours old.
function startReading($: EngineInterface, setting: string, isNotifying: boolean, isShowing: boolean) {
  stopReading()
  reading = $.clock.every(REFRESH_MS, () => {
    void (async () => {
      if (!(await isPaneUp($))) return stopReading()
      await refresh($, setting, isNotifying, isShowing)
    })()
  })
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
    await $.command.register({ name: 'console', description: 'Open the console: your conversations, then the pipelines' })
    const started = await next(e)
    // the folder is read only on /console. a reload (or a new worker) with the pane still up reads again
    if (await isPaneUp($)) {
      await loadFolds($)
      void refresh($, setting, false, isWriting)
      startReading($, setting, isNotifying, isWriting)
    }
    return started
  })

  // Closing the pane stops the reading at once (the next tick would see it gone anyway).
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    if (!(await isPaneUp($))) stopReading()
    return closed
  }).catch(($, e, next) => next(e))

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
    await loadFolds($)
    // read before opening, so the first draw has the cards
    await refresh($, setting, false, isWriting)
    await $.ui.open({ id: PANE, title: 'console' })
    startReading($, setting, isNotifying, isWriting)
    return { text: 'console opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const snap = await read($, snapshot)
    const now = await $.clock.now()
    const folded = await read($, folds)
    const isShowingOlderCards = await read($, isShowingOlder)
    if (!snap) return <Text dimColor>loading…</Text>

    const hasSvg = e.surface !== 'terminal' && 'Svg' in ui
    const { current, older } = splitCards(snap.cards, now)
    // the puppy types while a conversation is running, sits while one waits for you, else sleeps
    const shown = snap.conversations.map(c => shownState(c, now))
    const mood: Mood = shown.includes('running') ? 'typing' : shown.includes('waiting') || shown.includes('error') ? 'sitting' : 'sleeping'

    // A card in the "older" group waits for nothing, so its state word has no color there.
    const card = (s: Status, isOlderCard: boolean) => {
      const stale = isStale(s, now)
      const isCardFolded = isFolded(folded, s.pipeline, isOlderCard)
      const word = stale ? 'quiet' : s.state
      const stateColor = isOlderCard ? undefined
        : word === 'error' ? 'error' : word === 'waiting' || word === 'quiet' ? 'warning' : word === 'running' ? 'success' : undefined
      const since = ago(now - Date.parse(s.updated))
      // folded, the line tells what waits for you instead of the computer, so it stays one line
      const forYou = isCardFolded ? (s.waiting ?? []).length : 0
      const after = isCardFolded ? ` · ${since}` : ` · ${since}${s.host ? ` · ${s.host}` : ''}`
      const facts = `${word}${forYou > 0 ? ` · ${forYou} for you` : ''}${after}`
      // the terminal clips the name by columns: the card's border and padding, the mark, the facts
      const title = e.surface === 'terminal' ? cut(titleOf(s), Math.max(8, e.props.bodyColumns - 4 - 2 - facts.length - 1)) : titleOf(s)
      // the card's name opens and folds it
      const header = (
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Box flexShrink={1} minWidth={0}>
            <Button key={`fold-${s.pipeline}`} plain onPress={() => pressFold($, s.pipeline, isOlderCard)}>
              <Text dimColor>{isCardFolded ? '▸' : '▾'}</Text>{' '}<Text weight="semibold">{title}</Text>
            </Button>
          </Box>
          <Box flexShrink={0} flexDirection="row">
            <Text dimColor><Text color={stateColor}>{word}</Text>{forYou > 0 ? ' · ' : ''}</Text>
            {forYou > 0 && <Text>{forYou} for you</Text>}
            <Text dimColor>{after}</Text>
          </Box>
        </Box>
      )
      if (isCardFolded) {
        return (
          <Box key={`card-${s.pipeline}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} gap="xs">
            {header}
          </Box>
        )
      }
      const pic = hasSvg ? safePicture(s, stale) : null
      return (
        <Box key={`card-${s.pipeline}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} gap="xs">
          {header}
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
        {/* no Svg here (the terminal): the puppy in block characters, on its own rows above, when they fit */}
        {!hasSvg && e.props.scroll.bodyRows >= PUPPY_MIN_ROWS && (
          <Box key="puppy" flexDirection="column">
            {stillBlocks(mood).map((runs, i) => (
              <Text key={`puppy-${i}`}>
                {runs.map(([text, fg, bg]) => <Text color={fg ?? undefined} backgroundColor={bg ?? undefined}>{text}</Text>)}
              </Text>
            ))}
          </Box>
        )}
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" alignItems="center" gap={1}>
            {hasSvg && 'Svg' in ui && (
              <ui.Svg source={mascot(mood)} alt={`the puppy ${mood} at its laptop`} width={34 * MASCOT_SCALE} height={26 * MASCOT_SCALE} />
            )}
            <Text dimColor>checked {ago(now - snap.loadedAt)}</Text>
          </Box>
          {/* no toast: what it finds shows right here */}
          <Button key="refresh" label="refresh" hotkey="r" onPress={() => refresh($, setting, false, isWriting)} />
        </Box>
        {snap.conversations.length > 0 && conversationsCard(snap.conversations)}
        {snap.dirError && (
          <Box flexDirection="column">
            <Text color="error">can't read the status folder: {snap.dirError}</Text>
            <Text dimColor>set it in /config → puppy-console → status folder{snap.dir ? ` (now ${snap.dir})` : ''}</Text>
          </Box>
        )}
        {!snap.dirError && snap.cards.length === 0 && snap.problems.length === 0 && (
          <Text dimColor>no status files in {snap.dir} yet</Text>
        )}
        {current.map(s => card(s, false))}
        {/* cards with no update for three days and nothing for you, folded away at the bottom */}
        {older.length > 0 && (
          <Box key="older" flexDirection="column" gap="xs">
            <Button
              key="show-older"
              label={`${isShowingOlderCards ? '▾' : '▸'} older ${older.length}`}
              dimColor
              onPress={() => pressOlder($)}
            />
            {isShowingOlderCards && older.map(s => card(s, true))}
          </Box>
        )}
        {snap.problems.map(p => (
          <Text key={`p:${p.file}`} dimColor>skipped {p.file}: {p.reason}</Text>
        ))}
      </Box>
    )
  })
}
