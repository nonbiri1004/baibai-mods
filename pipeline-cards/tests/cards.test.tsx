import { expect, mock, test } from 'claude-code/testing'

import { byStage, picture } from '../hooks/draw'
import { expandHome, isStale, parseStatus, sortCards, textBar } from '../hooks/format'
import type { Status } from '../types'

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
  plugin: 'pipeline-cards',
  component: 'Pane',
  requestId: 'pipeline-cards',
  props: {
    title: 'pipelines',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('the pane draws one card per file and names the files it skipped', { options: { status_dir: '~/status' } }, async ($, on) => {
  const files: Record<string, string> = {
    '/home/me/status/music.json': file({ waiting: [{ id: 'l7', text: 'hear song 7' }] }),
    '/home/me/status/ai-video.json': file({ pipeline: 'ai-video', state: 'idle', headline: '3 jobs, all done' }),
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
  on('command.register', () => ({ value: { command: 'pipelines' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'pipelines', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /42\/70 usable/ }))?.text).toBe('05 · 42/70 usable')
    expect(await ui.find({ type: 'Text', text: /hear song 7/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /3 jobs, all done/ })).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /skipped old\.json/ }))?.text).toMatch(/pipeline-status/)
    expect(await ui.find({ type: 'Text', text: /tmp/ })).toBeFalsy()
    await ui.unmount()
  }
})

test('no folder set: the pane says where to set it', async ($, on) => {
  mock.env(on, { HOME: '/home/me' })
  mock.clock(on, { now: Date.parse(base.updated) + 60_000 })
  on('command.register', () => ({ value: { command: 'pipelines' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'pipelines', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /status folder/ }))?.text).toMatch(/no status folder set/)
  await ui.unmount()
})
