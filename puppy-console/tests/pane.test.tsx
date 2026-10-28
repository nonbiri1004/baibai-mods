import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const T = Date.parse('2026-10-28T12:00:00+08:00')
const DAY = 24 * 3_600_000
const at = (ms: number) => new Date(T - ms).toISOString()
const status = (over: object) => JSON.stringify({
  format: 'pipeline-status', version: 1, pipeline: 'music', updated: at(60_000), state: 'running', headline: '05 · 42/70 usable', ...over,
})
const RUN = { command: 'console', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const PANE = {
  plugin: 'puppy-console',
  component: 'Pane',
  requestId: 'puppy-console',
  props: { title: 'console', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const rows = (bodyRows: number) => ({ ...PANE.props, scroll: { offset: 0, bodyRows } })

// The engine around the pane: a status folder /s holding `files` (changeable), the pane's
// open/closed record, toasts, and a store in a Map the test can look into.
function world(on: On, files: Record<string, string>, kept: Record<string, unknown> = {}) {
  const w = {
    files,
    reads: 0,
    panesAsked: 0,
    toasts: [] as string[],
    isOpen: false,
    store: new Map(Object.entries(kept)),
  }
  mock.env(on, { HOME: '/home/me' })
  const clock = mock.clock(on, { now: T })
  on('fs.list', (_, e) => {
    if (e.path !== '/s') return { value: [] }
    w.reads++
    return { value: Object.keys(w.files).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_, e) => {
    const text = w.files[e.path.replace('/s/', '')]
    if (text == null) throw new Error('missing')
    return { value: text }
  })
  on('ui.toast', (_, e) => { w.toasts.push(e.text); return { value: undefined } })
  on('ui.open', () => { w.isOpen = true; return { value: { isPlaced: true } } })
  on('ui.panes', () => {
    w.panesAsked++
    return { value: w.isOpen ? [{ id: 'puppy-console', title: 'console', isShown: true, isFocused: false, isPlaced: true }] : [] }
  })
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => { w.store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_, e) => { w.store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('command.register', () => ({ value: { command: 'console' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return { w, clock }
}

test('the folder is read only while the pane is open', { options: { status_dir: '/s' } }, async ($, on) => {
  const { w, clock } = world(on, { 'music.json': status({}) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(120_000)
  expect(w.reads).toBe(0)                       // a conversation without the pane reads nothing

  await $.command.run(RUN)
  expect(w.reads).toBe(1)                       // opening reads at once
  await clock.advance(60_000)
  expect(w.reads).toBe(2)                       // then every minute

  // a second /console starts the timer over: still one tick a minute, not two
  await $.command.run(RUN)
  const [reads, asked] = [w.reads, w.panesAsked]
  await clock.advance(60_000)
  expect(w.reads - reads).toBe(1)
  expect(w.panesAsked - asked).toBe(1)

  // closed: the next tick sees it gone and stops; nothing is read again
  w.isOpen = false
  const closedAt = w.reads
  await clock.advance(60_000)
  const askedAfter = w.panesAsked
  await clock.advance(180_000)
  expect(w.reads).toBe(closedAt)
  expect(w.panesAsked).toBe(askedAfter)        // the timer is gone, not just idle
})

test('a reload with the pane still up reads again and keeps reading', { options: { status_dir: '/s' } }, async ($, on) => {
  const { w, clock } = world(on, { 'music.json': status({}) })
  w.isOpen = true
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(w.reads).toBe(1)
  await clock.advance(60_000)
  expect(w.reads).toBe(2)
})

for (const notify of ['on', 'off'] as const)
test(`a toast only while the pane is open (notices ${notify})`, { options: { status_dir: '/s', notify } }, async ($, on) => {
  const { w, clock } = world(on, { 'music.json': status({ state: 'running' }) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(RUN)
  expect(w.toasts).toEqual([])

  w.files['music.json'] = status({ state: 'waiting', waiting: [{ id: 'l7', text: 'hear song 7' }] })
  await clock.advance(60_000)
  expect(w.toasts).toEqual(notify === 'on' ? ['music · waiting: hear song 7'] : [])
  await clock.advance(60_000)
  expect(w.toasts).toHaveLength(notify === 'on' ? 1 : 0)   // once, not every minute

  // closed: nothing read, nothing told
  w.isOpen = false
  w.files['music.json'] = status({ state: 'error', headline: 'comfy is down' })
  await clock.advance(180_000)
  expect(w.toasts).toHaveLength(notify === 'on' ? 1 : 0)
})

test('opening the pane shows what changed, without a toast', { options: { status_dir: '/s' } }, async ($, on) => {
  const { w, clock } = world(on, { 'music.json': status({ state: 'running' }) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(RUN)
  w.isOpen = false
  await clock.advance(60_000)
  w.files['music.json'] = status({ state: 'waiting', waiting: [{ id: 'l7', text: 'hear song 7' }] })
  await $.command.run(RUN)
  expect(w.toasts).toEqual([])
})

// music waits for you and is fresh; the jobs collector is idle and five days old; ai-video is
// ten days old but still has something waiting, so it never folds away.
const PIPELINES = {
  'music.json': status({ state: 'waiting', waiting: [{ id: 'l7', text: 'hear song 7' }] }),
  'collector-jobs.json': status({ pipeline: 'collector-jobs', state: 'idle', updated: at(5 * DAY), headline: 'jobs: 3 new' }),
  'ai-video.json': status({ pipeline: 'ai-video', state: 'idle', updated: at(10 * DAY), headline: '1 job at final', waiting: [{ id: 'f', text: 'check ep04' }] }),
  'broken.json': status({ pipeline: 'broken', state: 'error', updated: at(30 * DAY), headline: 'comfy is down' }),
}

for (const surface of ['terminal', 'desktop'] as const)
test(`an old card folds into "older" at the bottom; one that waits for you never does (${surface})`, { options: { status_dir: '/s' } }, async ($, on) => {
  const { w } = world(on, { ...PIPELINES })
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...PANE, surface })

  for (const p of ['music', 'ai-video', 'broken']) expect(await ui.find({ key: `card-${p}` })).toBeTruthy()
  expect(await ui.find({ key: 'card-collector-jobs' })).toBeFalsy()
  expect((await ui.find({ key: 'show-older' }))?.props.label).toBe('▸ older 1')

  await ui.press({ key: 'show-older' })
  expect((await ui.find({ key: 'show-older' }))?.props.label).toBe('▾ older 1')
  expect(w.store.get('isShowingOlder')).toBe(true)
  // inside the group a card starts folded: its name, no body
  expect(await ui.find({ key: 'card-collector-jobs' })).toBeTruthy()
  expect((await ui.find({ key: 'fold-collector-jobs' }))?.text).toMatch(/^▸ collector-jobs/)
  expect(await ui.find({ type: 'Text', text: 'jobs: 3 new' })).toBeFalsy()

  await ui.press({ key: 'fold-collector-jobs' })
  expect(await ui.find({ type: 'Text', text: 'jobs: 3 new' })).toBeTruthy()
  expect(w.store.get('fold:collector-jobs')).toBe(false)

  // the older group sits after the current cards
  const keys = (await ui.findAll({ type: 'Box' })).map(b => b.key).filter(Boolean)
  expect(keys.indexOf('older')).toBeGreaterThan(keys.indexOf('card-broken'))
  await ui.unmount()
})

test('a card folds to its header line and opens again; the store remembers', { options: { status_dir: '/s' } }, async ($, on) => {
  const { w } = world(on, { ...PIPELINES })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'fold-music' }))?.text).toMatch(/^▾ music/)
  expect(await ui.find({ type: 'Text', text: '05 · 42/70 usable' })).toBeTruthy()

  await ui.press({ key: 'fold-music' })
  expect((await ui.find({ key: 'fold-music' }))?.text).toMatch(/^▸ music/)
  expect(await ui.find({ type: 'Text', text: '05 · 42/70 usable' })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: 'hear song 7' })).toBeFalsy()
  // folded, the line still says what waits for you
  expect(await ui.find({ type: 'Text', text: /1 for you/ })).toBeTruthy()
  expect(w.store.get('fold:music')).toBe(true)

  await ui.press({ key: 'fold-music' })
  expect(await ui.find({ type: 'Text', text: '05 · 42/70 usable' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /1 for you/ })).toBeFalsy()
  expect(w.store.has('fold:music')).toBe(false)   // back to the default: nothing kept
  await ui.unmount()
})

test('folds made earlier (another conversation, a restart) are read when the pane opens', { options: { status_dir: '/s' } }, async ($, on) => {
  world(on, { ...PIPELINES }, { 'fold:music': true, 'fold:collector-jobs': false, isShowingOlder: true, 'fold:gone': true, other: 1 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // music waits for you, yet stays folded: the person's fold wins
  expect((await ui.find({ key: 'fold-music' }))?.text).toMatch(/^▸ music/)
  expect(await ui.find({ type: 'Text', text: '05 · 42/70 usable' })).toBeFalsy()
  expect((await ui.find({ key: 'show-older' }))?.props.label).toBe('▾ older 1')
  expect(await ui.find({ type: 'Text', text: 'jobs: 3 new' })).toBeTruthy()
  await ui.unmount()
})

test('the terminal puppy shows only when the pane has 26 rows or more', { options: { status_dir: '/s' } }, async ($, on) => {
  world(on, { 'music.json': status({}) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const [bodyRows, isShown] of [[20, false], [25, false], [26, true], [40, true]] as const) {
    await ui.redraw(rows(bodyRows))
    expect(Boolean(await ui.find({ key: 'puppy' }))).toBe(isShown)
    // never a smaller puppy: all 13 rows, or none
    expect((await ui.find({ key: 'puppy' }))?.children ?? []).toHaveLength(isShown ? 13 : 0)
  }
  await ui.unmount()

  // the desktop draws its puppy as a picture beside the first row, whatever the rows
  const desk = await $.ui.mount({ ...PANE, props: rows(40), surface: 'desktop' })
  expect(await desk.find({ key: 'puppy' })).toBeFalsy()
  await desk.redraw(rows(10))
  expect((await desk.findAll({ type: 'Svg' })).some(s => /^the puppy/.test(String(s.props.alt)))).toBe(true)
  await desk.unmount()
})

const COUNTS = { collected: 412, new: 58, scored: 58, sent: 9, unsent: 2, pending: 27 }

test('a collector card: a picture on the desktop, the same numbers as text on the terminal', { options: { status_dir: '/s' } }, async ($, on) => {
  world(on, {
    'collector-tech-news.json': status({ pipeline: 'collector-tech-news', state: 'waiting', headline: '收集 412 · 新 58 · 送進 Notion 9', detail: { counts: COUNTS, errors: [] } }),
    'collector-old.json': status({ pipeline: 'collector-old', state: 'waiting', headline: 'an older file', detail: { errors: ['x'] } }),
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(RUN)

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /collected 412/ }))?.text).toBe('collected 412 › new 58 › scored 58 › sent 9')
  expect((await term.find({ type: 'Text', text: /to review/ }))?.text).toBe('to review 27 · unsent 2')
  // an older file without counts: the card as before, no lines
  expect(await term.find({ type: 'Text', text: 'an older file' })).toBeTruthy()
  expect(await term.findAll({ type: 'Text', text: /collected/ })).toHaveLength(1)
  await term.unmount()

  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desk.find({ type: 'Text', text: /collected 412/ })).toBeFalsy()
  const pics = (await desk.findAll({ type: 'Svg' })).map(s => String(s.props.alt))
  expect(pics.filter(alt => /to review in notion/.test(alt))).toEqual(['collected 412, new 58, scored 58, sent 9; 27 to review in notion; 2 unsent'])
  await desk.unmount()
})
