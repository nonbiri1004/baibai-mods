import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Problem, Snapshot, Status } from '../types'
import { detailLines, picture, W } from './draw'
import { ago, expandHome, isStale, parseStatus, sortCards, textBar, titleOf } from './format'

const PANE = 'pipeline-cards'
const REFRESH_MS = 60_000

const snapshot = atom({ plugin: 'pipeline-cards', key: 'snapshot' } as const, null)

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

// Every *.json in the folder is one card. A file that does not parse becomes a problem line,
// never a missing card without a word: the writer may be halfway through, or on an old format.
export async function loadFolder($: EngineInterface, dir: string): Promise<Snapshot> {
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

// One refresh at a time: the timer and the button share the running one,
// so an older read can never finish last and overwrite a newer one.
let running: Promise<void> | null = null
function refresh($: EngineInterface, setting: string): Promise<void> {
  running ??= (async () => {
    const dir = expandHome(setting.trim(), await $.env.get('HOME'))
    const next = await loadFolder($, dir)
    await update($, snapshot, () => next)
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

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pipelines', description: 'Open the pipeline cards' })
    void refresh($, setting)
    // Like setInterval in a component's mount: each tick reads the folder again and the pane redraws.
    $.clock.every(REFRESH_MS, () => refresh($, setting))
    return next(e)
  })

  on('command.run', { command: 'pipelines' }, async $ => {
    await refresh($, setting)
    await $.ui.open({ id: PANE, title: 'pipelines' })
    return { text: 'pipeline cards opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const snap = await read($, snapshot)
    const now = await $.clock.now()
    if (!snap) return <Text dimColor>loading…</Text>

    // The pane reports its width in character cells; about 8 CSS px per cell.
    const svgWidth = Math.max(280, Math.min(W, ((e.viewport?.columns ?? 90) - 6) * 8))
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
            ? <ui.Svg source={pic.source} alt={pic.alt} width={svgWidth} height={Math.round((svgWidth * pic.height) / W)} isInteractive />
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
          {s.next && <Text dimColor>next: {s.next}</Text>}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>checked {ago(now - snap.loadedAt)}</Text>
          <Button key="refresh" label="refresh" hotkey="r" onPress={() => refresh($, setting)} />
        </Box>
        {snap.dirError && (
          <Box flexDirection="column">
            <Text color="error">can't read the status folder: {snap.dirError}</Text>
            <Text dimColor>set it in /config → pipeline-cards → status folder{snap.dir ? ` (now ${snap.dir})` : ''}</Text>
          </Box>
        )}
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
