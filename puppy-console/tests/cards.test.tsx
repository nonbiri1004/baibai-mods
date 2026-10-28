import { expect, mock, test } from 'claude-code/testing'

import { byStage, collectorCounts, cut, detailLines, MAX_SQUARES, picture } from '../hooks/draw'
import { alerts, expandHome, isFolded, isOlder, isStale, OLDER_MS, parseStatus, sortCards, splitCards, textBar, toggleFold } from '../hooks/format'
import type { Snapshot, Status } from '../types'

const base = {
  format: 'pipeline-status',
  version: 1,
  pipeline: 'music',
  updated: '2026-10-24T22:00:00+08:00',
  state: 'running',
  headline: '05 · 42/70 usable',
}
const file = (over: object) => JSON.stringify({ ...base, ...over })

test('a status file parses; a wrong one says why', () => {
  const s = parseStatus(file({ waiting: [{ id: 'l7', text: 'hear song 7' }, 'junk'] }))
  expect(s.pipeline).toBe('music')
  expect(s.waiting).toEqual([{ id: 'l7', text: 'hear song 7' }])
  expect(() => parseStatus('{"schema":1}')).toThrow(/pipeline-status/)
  expect(() => parseStatus(file({ version: 2 }))).toThrow(/version 2/)
  expect(() => parseStatus(file({ state: 'busy' }))).toThrow(/state/)
  expect(() => parseStatus('{"format": "pipel')).toThrow(/not json/)
})

test('a field of the wrong type is dropped, not fatal', () => {
  const odd = parseStatus(file({ title: 42, next: 7, progress: { done: 'x' }, last_output: { label: 1 } }))
  expect([odd.title, odd.next, odd.progress, odd.last_output]).toEqual([undefined, null, null, null])
  expect(sortCards([odd, parseStatus(file({ pipeline: 'b', title: 'b' }))]).map(s => s.pipeline)).toEqual(['b', 'music'])
  expect(picture(parseStatus(file({ detail: { batches: [{ name: 'x', strip: 5 }] } })), false)).toBeTruthy()
})

test('a huge batch keeps its squares a size and the svg small', () => {
  for (const c of ['e', 'o']) {
    const pic = picture(parseStatus(file({ detail: { batches: [{ name: 'x', strip: c.repeat(5000) }] } })), false)!
    expect(pic.source.length).toBeLessThan(131072)
    expect(pic.source).not.toMatch(/(width|height)="-/)
    expect(pic.source).toContain(`newest ${MAX_SQUARES} of 5000`)
  }
})

test('labels are cut by width; a CJK character counts as two', () => {
  expect(cut('demo_本機測試', 12)).toBe('demo_本機…')
  expect(cut('ep03', 12)).toBe('ep03')
  expect(cut('手勢模特兒', 12)).toBe('手勢模特兒')
  expect(cut('abcdefghijklmn', 12)).toBe('abcdefghijk…')
})

test('alerts: a card turning waiting, error or quiet, and new waiting items', () => {
  const t = Date.parse(base.updated)
  const snap = (at: number, ...cards: object[]): Snapshot =>
    ({ dir: '/s', cards: cards.map(c => parseStatus(file(c))), conversations: [], problems: [], dirError: null, loadedAt: at })
  const running = snap(t, { state: 'running', stale_after_sec: 360 })
  expect(alerts(null, running)).toEqual([])                                   // first read: baseline
  expect(alerts(running, snap(t + 60_000, { state: 'running', stale_after_sec: 360 }))).toEqual([])
  expect(alerts(running, snap(t, { state: 'waiting', waiting: [{ id: 'a', text: 'hear #7' }] })))
    .toEqual(['music · waiting: hear #7'])
  expect(alerts(running, snap(t, { state: 'error', headline: 'comfy is down' }))).toEqual(['music · error: comfy is down'])
  expect(alerts(running, snap(t + 600_000, { state: 'running', stale_after_sec: 360 }))[0]).toMatch(/^music · quiet: no update for 10m/)
  const w1 = snap(t, { state: 'waiting', waiting: [{ id: 'a', text: 'hear #7' }] })
  expect(alerts(w1, snap(t, { state: 'waiting', waiting: [{ id: 'a', text: 'hear #7' }] }))).toEqual([])   // nothing new
  expect(alerts(w1, snap(t, { state: 'waiting', waiting: [{ id: 'a', text: 'hear #7' }, { id: 'b', text: 'hear #9' }] })))
    .toEqual(['music · new: hear #9'])
  expect(alerts(running, snap(t, { state: 'idle' }))).toEqual([])               // back to idle is not news
})

test('stale only after the time the writer promised', () => {
  const s = parseStatus(file({ stale_after_sec: 360 }))
  const t = Date.parse(base.updated)
  expect(isStale(s, t + 300_000)).toBe(false)
  expect(isStale(s, t + 400_000)).toBe(true)
  expect(isStale(parseStatus(file({})), t + 9e9)).toBe(false)
})

test('cards that need you come first', () => {
  const mk = (pipeline: string, state: string) => parseStatus(file({ pipeline, state }))
  const order = sortCards([mk('b', 'idle'), mk('a', 'running'), mk('c', 'waiting'), mk('d', 'error')])
  expect(order.map(s => s.pipeline)).toEqual(['c', 'd', 'a', 'b'])
})

test('text bar and home folder', () => {
  expect(textBar({ done: 42, total: 70, unit: 'songs' })).toBe('▓▓▓▓▓▓░░░░ 42/70 songs')
  expect(textBar({ done: 3, total: null })).toBe('3')
  expect(expandHome('~/x/y', '/Users/a')).toBe('/Users/a/x/y')
  expect(expandHome('/abs', '/Users/a')).toBe('/abs')
})

test('video jobs group by stage', () => {
  const j = (job: string, stage: Status['state'] | string) => ({ job, stage, spend_usd: 0, cap_usd: 10 }) as never
  const lanes = byStage([j('a/1', 'final'), j('a/2', 'done'), j('a/3', 'final')])
  expect(lanes.final.map(x => (x as { job: string }).job)).toEqual(['a/1', 'a/3'])
  expect(lanes.plan).toEqual([])
})

const PANE = {
  plugin: 'puppy-console',
  component: 'Pane',
  requestId: 'puppy-console',
  props: {
    title: 'console',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('the pane draws one card per file and names the files it skipped', { options: { status_dir: '~/status' } }, async ($, on) => {
  const files: Record<string, string> = {
    '/home/me/status/music.json': file({ waiting: [{ id: 'l7', text: 'hear song 7' }], next: 'hear song 7' }),
    '/home/me/status/ai-video.json': file({
      pipeline: 'ai-video', state: 'idle', headline: '3 jobs, all done',
      detail: { spend_usd: 1, cap_usd: 10, jobs: [{ job: 'baibai/ep04', stage: 'final', spend_usd: 1, cap_usd: 10 }] },
    }),
    '/home/me/status/old.json': '{"schema": 1}',
  }
  mock.env(on, { HOME: '/home/me' })
  mock.clock(on, { now: Date.parse(base.updated) + 60_000 })
  on('fs.list', () => ({
    value: ['music.json', 'ai-video.json', 'old.json', '.music.json.tmp', 'notes.txt'].map(name => ({
      name, kind: 'file', size: 1, mtimeMs: 0, isLink: false,
    })),
  }))
  on('fs.read', (_, e) => {
    const text = files[(e as { path: string }).path]
    if (text == null) throw new Error('missing')
    return { value: text }
  })
  on('command.register', () => ({ value: { command: 'console' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'console', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /42\/70 usable/ }))?.text).toBe('05 · 42/70 usable')
    expect(await ui.findAll({ type: 'Text', text: /hear song 7/ })).toHaveLength(1)   // "next" repeating a waiting item is not shown
    expect(await ui.find({ type: 'Text', text: /3 jobs, all done/ })).toBeTruthy()
    // the terminal has no pictures: the details come as text there
    if (surface === 'terminal') expect((await ui.find({ type: 'Text', text: /ep04/ }))?.text).toBe('final (you): ep04')
    expect((await ui.find({ type: 'Text', text: /skipped old\.json/ }))?.text).toMatch(/pipeline-status/)
    expect(await ui.find({ type: 'Text', text: /tmp/ })).toBeFalsy()
    await ui.unmount()
  }
})

test('no folder set: the pane says where to set it', async ($, on) => {
  mock.env(on, { HOME: '/home/me' })
  mock.clock(on, { now: Date.parse(base.updated) + 60_000 })
  on('command.register', () => ({ value: { command: 'console' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'console', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /status folder/ }))?.text).toMatch(/no status folder set/)
  await ui.unmount()
})

test('older: more than three days without an update, and nothing waiting for you', () => {
  const t = Date.parse(base.updated)
  const idle = parseStatus(file({ state: 'idle' }))
  expect(isOlder(idle, t + OLDER_MS)).toBe(false)               // exactly three days: not yet
  expect(isOlder(idle, t + OLDER_MS + 1)).toBe(true)
  expect(isOlder(idle, t - 60_000)).toBe(false)                 // an "updated" in the future
  // quiet (stale) is not waiting: it folds away like any other old card
  expect(isOlder(parseStatus(file({ state: 'running', stale_after_sec: 360 })), t + 4 * 86_400_000)).toBe(true)
  // a card that waits for you never does, however old
  for (const over of [{ state: 'waiting' }, { state: 'error' }, { state: 'idle', waiting: [{ id: 'a', text: 'hear #7' }] }])
    expect(isOlder(parseStatus(file(over)), t + 10 * 86_400_000)).toBe(false)
})

test('the older cards go last, newest first; the rest keep their order', () => {
  const t = Date.parse(base.updated)
  const mk = (pipeline: string, state: string, daysOld: number) =>
    parseStatus(file({ pipeline, state, updated: new Date(t - daysOld * 86_400_000).toISOString() }))
  const cards = sortCards([mk('a', 'idle', 9), mk('b', 'idle', 4), mk('c', 'waiting', 30), mk('d', 'running', 0)])
  const { current, older } = splitCards(cards, t)
  expect(current.map(s => s.pipeline)).toEqual(['c', 'd'])
  expect(older.map(s => s.pipeline)).toEqual(['b', 'a'])
})

test('a fold is kept only where it differs from the default of its group', () => {
  expect(isFolded({}, 'music', false)).toBe(false)              // current cards start open
  expect(isFolded({}, 'old', true)).toBe(true)                  // older cards start folded
  expect(toggleFold({}, 'music', false)).toEqual({ music: true })
  expect(toggleFold({ music: true }, 'music', false)).toEqual({})
  expect(toggleFold({}, 'old', true)).toEqual({ old: false })
  expect(toggleFold({ old: false, music: true }, 'old', true)).toEqual({ music: true })
})

const collector = (detail: object, pipeline = 'collector-tech-news') =>
  parseStatus(file({ pipeline, state: 'waiting', detail }))
const COUNTS = { collected: 412, new: 58, scored: 58, sent: 9, unsent: 2, pending: 27 }

test('a collector card draws its counts', () => {
  const pic = picture(collector({ counts: COUNTS, errors: [] }), false)!
  expect(pic.height).toBe(62)
  expect(pic.alt).toContain('27 to review in notion')
  expect(pic.alt).toContain('2 unsent')
  expect(pic.source).toContain('stroke-dasharray="4 3"')
  expect(pic.source).toContain('var(--reject)')
  expect(pic.source.length).toBeLessThan(131072)
  expect(detailLines(collector({ counts: COUNTS }))).toEqual([
    'collected 412 › new 58 › scored 58 › sent 9',
    'to review 27 · unsent 2',
  ])
})

test('a collector card: notion not read, and the 100 cap', () => {
  const unread = collector({ counts: { ...COUNTS, unsent: 0, pending: null } })
  expect(picture(unread, false)!.alt).toContain('notion not read')
  expect(detailLines(unread)[1]).toBe('to review ? (notion not read) · unsent 0')
  for (const pending of [100, 140]) expect(detailLines(collector({ counts: { ...COUNTS, pending } }))[1]).toMatch(/^to review 100\+/)
  // a stage number that is missing or odd counts as 0
  expect(collectorCounts(collector({ counts: { collected: 3, new: 'x' } }))).toEqual({ collected: 3, new: 0, scored: 0, sent: 0, unsent: 0, pending: null })
})

test('an older collector file (no counts) draws as before', () => {
  for (const detail of [{ errors: ['x'] }, { counts: [] }, { counts: { collected: 'x' } }]) {
    expect(picture(collector(detail), false)).toBeNull()
    expect(detailLines(collector(detail))).toEqual([])
  }
  // only the prefix "collector-" is a collector
  for (const pipeline of ['info-collector', 'collectors']) {
    expect(picture(collector({ counts: COUNTS }, pipeline), false)).toBeNull()
    expect(detailLines(collector({ counts: COUNTS }, pipeline))).toEqual([])
  }
})
