import { expect, test } from 'claude-code/testing'

import type { Talk } from '../types'
import { Gate, PR_EVERY, canTake, chunks, isPrDue, mapLimit, mergeReads, parseLease, parsePrChecks, parseReads, recordPr, writeReads } from '../hooks/shared'
import type { Read } from '../hooks/shared'

const NOW = Date.parse('2026-10-27T10:00:00Z')
const talk = (id: string, mtimeMs: number): Talk => ({ id, title: id, titles: [id], project: 'p', cwd: '/p', prs: [], mtimeMs })
const read = (id: string, mtimeMs: number): Read => ({ mtimeMs, talk: talk(id, mtimeMs) })

test('shared reads: another pane’s newer read wins, an older one doesn’t', () => {
  const mine = new Map([
    ['/a.jsonl', read('a', 2)],
    ['/b.jsonl', read('b', 5)],
  ])
  mergeReads(
    mine,
    new Map([
      ['/a.jsonl', read('a', 3)],
      ['/b.jsonl', read('b', 4)],
      ['/c.jsonl', read('c', 1)],
    ]),
  )
  expect(mine.get('/a.jsonl')?.mtimeMs).toBe(3)
  expect(mine.get('/b.jsonl')?.mtimeMs).toBe(5)
  expect(mine.get('/c.jsonl')?.talk.id).toBe('c')
})

test('shared reads: written and read back, old transcripts left out, half a file is nothing', () => {
  const text = writeReads(
    new Map([
      ['/new.jsonl', read('new', NOW)],
      ['/old.jsonl', read('old', NOW - 20 * 86_400_000)],
    ]),
    NOW - 14 * 86_400_000,
  )
  const back = parseReads(text)
  expect([...back.keys()]).toEqual(['/new.jsonl'])
  expect(back.get('/new.jsonl')?.talk.title).toBe('new')
  expect(parseReads(text.slice(0, text.length / 2)).size).toBe(0)
  expect(parseReads('').size).toBe(0)
})

test('the lease: free when nobody holds it, it ran out, or it is ours', () => {
  expect(canTake(null, 'me', NOW)).toBe(true)
  expect(canTake({ owner: 'you', until: NOW - 1 }, 'me', NOW)).toBe(true)
  expect(canTake({ owner: 'me', until: NOW + 60_000 }, 'me', NOW)).toBe(true)
  expect(canTake({ owner: 'you', until: NOW + 60_000 }, 'me', NOW)).toBe(false)
  expect(parseLease('{"owner":"you","until":5}')).toEqual({ owner: 'you', until: 5 })
  expect(parseLease('{"owner":"you"')).toBe(null)
})

test('PRs: never asked is due; open after PR_EVERY; merged or closed never; a failed ask waits too', () => {
  expect(isPrDue(undefined, NOW)).toBe(true)
  expect(isPrDue({ state: { state: 'OPEN' }, checkedAt: NOW - 60_000 }, NOW)).toBe(false)
  expect(isPrDue({ state: { state: 'OPEN' }, checkedAt: NOW - PR_EVERY }, NOW)).toBe(true)
  expect(isPrDue({ state: { state: 'MERGED' }, checkedAt: 0 }, NOW)).toBe(false)
  expect(isPrDue({ state: { state: 'CLOSED' }, checkedAt: 0 }, NOW)).toBe(false)
  // gh failed a minute ago: not asked again every refresh
  expect(isPrDue({ checkedAt: NOW - 60_000 }, NOW)).toBe(false)
})

test('PRs: a failed ask keeps what github said before', () => {
  expect(recordPr({ state: { state: 'OPEN' }, checkedAt: 1 }, null, NOW)).toEqual({ state: { state: 'OPEN' }, checkedAt: NOW })
  expect(recordPr(undefined, null, NOW)).toEqual({ checkedAt: NOW })
  expect(recordPr({ state: { state: 'OPEN' }, checkedAt: 1 }, { state: 'MERGED' }, NOW)).toEqual({ state: { state: 'MERGED' }, checkedAt: NOW })
  expect(parsePrChecks('{"a":{"checkedAt":3},"b":{"state":{"state":"OPEN"},"checkedAt":4},"c":{}}')).toEqual({
    a: { checkedAt: 3 },
    b: { state: { state: 'OPEN' }, checkedAt: 4 },
  })
})

test('batches: in order, at most this many at once', async () => {
  expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  let running = 0
  let most = 0
  const out = await mapLimit([1, 2, 3, 4, 5, 6], 4, async x => {
    running++
    most = Math.max(most, running)
    await Promise.resolve()
    running--

    return x * 2
  })
  expect(out).toEqual([2, 4, 6, 8, 10, 12])
  expect(most).toBe(4)
})

test('the gate: never two passes at once; asked during one, one more after it', async () => {
  let release: () => void = () => undefined
  const runs: boolean[] = []
  let running = 0
  let most = 0
  const gate = new Gate<{ isAsked?: boolean }>(async o => {
    running++
    most = Math.max(most, running)
    runs.push(Boolean(o.isAsked))
    if (runs.length === 1) {
      await new Promise<void>(r => (release = r))
    }
    running--
  })
  const first = gate.ask({})
  // three asks while the first pass runs: one more pass, asked by the person since one was
  void gate.ask({})
  void gate.ask({ isAsked: true })
  void gate.ask({})
  release()
  await first
  expect(runs).toEqual([false, true])
  expect(most).toBe(1)
  // idle again: the next ask runs at once
  await gate.ask({})
  expect(runs).toEqual([false, true, false])
})

test('the gate: a pass that throws doesn’t stop the next', async () => {
  let n = 0
  const gate = new Gate<{ isAsked?: boolean }>(async () => {
    n++
    if (n === 1) {
      throw new Error('scan failed')
    }
  })
  await gate.ask({})
  await gate.ask({})
  expect(n).toBe(2)
})
