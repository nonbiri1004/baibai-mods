import { expect, test } from 'claude-code/testing'

import type { Item, Session, Talk } from '../types'
import { folderFiles, isWorktree, matchByTime, parseSessions, parseWorktree, pickByTitle, pickTranscript, projectDir, sortConvos, verdictOf } from '../hooks/convos'

const P = '/h/.claude/projects'
const session = (over: Partial<Session> = {}): Session => ({
  id: 'local_aaaa',
  title: 'notes',
  cwd: '/Users/a/dev/Projects/tools',
  isArchived: false,
  isPinned: false,
  lastActivityMs: 1_000_000,
  ...over,
})
const talk = (over: Partial<Talk> = {}): Talk => ({ id: 't1', title: 'notes', titles: ['notes'], project: 'tools', cwd: '/Users/a/dev/Projects/tools', prs: [], mtimeMs: 0, ...over })
const base = { items: [] as Item[], isOpenItem: () => true, worktree: null, isHere: false }

test('a transcript folder is the working folder with - for everything else', () => {
  expect(projectDir('/Users/a/dev/Projects/lofi-puppy/.claude/worktrees/x')).toBe('-Users-a-dev-Projects-lofi-puppy--claude-worktrees-x')
})

test('the transcript written at the last activity is the one, even among forks with the same title', () => {
  const dir = `${P}/-Users-a-dev-Projects-tools/`
  const files = [
    { path: `${dir}fork1.jsonl`, mtimeMs: 900_000 },
    { path: `${dir}fork2.jsonl`, mtimeMs: 1_000_400 },
    { path: `${P}/-Users-a-dev-Projects-other/x.jsonl`, mtimeMs: 1_000_000 },
  ]
  expect(pickTranscript(session(), files, P)).toBe(`${dir}fork2.jsonl`)
  // nothing near the time: the file named after the app's id, else none
  expect(pickTranscript(session({ lastActivityMs: 5_000_000 }), files, P)).toBe(null)
  expect(pickTranscript(session({ id: 'local_fork1', lastActivityMs: 5_000_000 }), files, P)).toBe(`${dir}fork1.jsonl`)
})

test('the app list is read loosely', () => {
  const list = parseSessions(
    '[{"sessionId":"local_a","title":"t","cwd":"/x","pinned":true,"prNumber":3,"prState":"OPEN","lastActivityAt":"2026-10-25T10:00:00Z"},{"title":"no id"}]',
  )
  expect(list).toHaveLength(1)
  expect(list[0]).toMatchObject({ id: 'local_a', isPinned: true, isArchived: false, prNumber: 3, prState: 'OPEN' })
  expect(parseSessions('nope')).toEqual([])
})

test('clear only when nothing open is found and the folder is clean', () => {
  expect(verdictOf({ ...base, session: session(), talk: talk() })).toEqual({ state: 'clear', reasons: [] })
  expect(verdictOf({ ...base, session: session(), talk: talk({ ask: 'merge it?' }) }).reasons).toEqual(['asked you: merge it?'])
  expect(verdictOf({ ...base, session: session({ prNumber: 4, prState: 'OPEN' }), talk: talk() }).reasons).toEqual(['PR #4 not merged'])
  expect(verdictOf({ ...base, session: session({ prNumber: 4, prState: 'MERGED' }), talk: talk() }).state).toBe('clear')
  const todo: Item = { id: 'i', text: 'x', project: 'p', kind: 'todo', status: 'open', createdAt: '', session: { id: 't1' } }
  expect(verdictOf({ ...base, items: [todo], session: session(), talk: talk() }).reasons).toEqual(['1 open to-do'])
  expect(verdictOf({ ...base, items: [todo], isOpenItem: () => false, session: session(), talk: talk() }).state).toBe('clear')
})

test('a worktree with work on it is not ready; one that can not be read is unknown', () => {
  const s = session({ cwd: '/r/.claude/worktrees/w' })
  const t = talk({ cwd: '/r/.claude/worktrees/w' })
  expect(verdictOf({ ...base, session: s, talk: t, worktree: { state: 'read', changed: 2, unpushed: 1 } }).reasons).toEqual([
    '2 uncommitted changes',
    '1 commit not pushed',
  ])
  expect(verdictOf({ ...base, session: s, talk: t, worktree: { state: 'unknown' } }).state).toBe('unknown')
  expect(verdictOf({ ...base, session: s, talk: t, worktree: { state: 'read', changed: 0, unpushed: 0 } }).state).toBe('clear')
  expect(isWorktree('/r/.claude/worktrees/w')).toBe(true)
  expect(isWorktree('/r')).toBe(false)
  expect(parseWorktree({ exitCode: 0, stdout: ' M a.ts\n?? b.ts\n' }, { exitCode: 0, stdout: '3\n' })).toEqual({
    state: 'read',
    changed: 2,
    unpushed: 3,
  })
  expect(parseWorktree({ exitCode: 128, stdout: '' }, { exitCode: 0, stdout: '0' })).toEqual({ state: 'unknown' })
})

test('no last turn found is unknown, never clear; this conversation is never clear', () => {
  expect(verdictOf({ ...base, session: session(), talk: null }).state).toBe('unknown')
  expect(verdictOf({ ...base, session: session(), talk: talk(), isHere: true })).toEqual({ state: 'open', reasons: ['this conversation'] })
})

test('clear ones first, stalest first', () => {
  const c = (id: string, state: 'clear' | 'open' | 'unknown', at: number) => ({
    session: session({ id, lastActivityMs: at }),
    verdict: { state, reasons: [] },
  })
  expect(sortConvos([c('a', 'open', 1), c('b', 'clear', 9), c('c', 'clear', 2), c('d', 'unknown', 0)]).map(x => x.session.id)).toEqual([
    'c',
    'b',
    'a',
    'd',
  ])
})

test('when the time says nothing, the newest unclaimed transcript that had the title', () => {
  const dir = `${P}/-Users-a-dev-Projects-tools/`
  const s = session({ lastActivityMs: 10_000_000 })
  const c = (name: string, mtimeMs: number, titles: string[]) => ({ path: `${dir}${name}.jsonl`, mtimeMs, titles })
  // reopened later (newer than the last activity) and renamed: still found
  expect(pickByTitle(s, [c('old', 9_000_000, ['notes']), c('resumed', 20_000_000, ['first name', 'notes'])], new Set())).toBe(
    `${dir}resumed.jsonl`,
  )
  // a fork that another conversation matched by time is left out
  expect(pickByTitle(s, [c('mine', 9_000_000, ['notes']), c('fork', 9_500_000, ['notes'])], new Set([`${dir}fork.jsonl`]))).toBe(
    `${dir}mine.jsonl`,
  )
  expect(pickByTitle(s, [c('x', 9_000_000, ['other'])], new Set())).toBe(null)
  expect(folderFiles(s, [{ path: `${dir}a.jsonl` }, { path: `${P}/-elsewhere/a.jsonl` }, { path: `${dir}sub/a.jsonl` }], P)).toEqual([
    { path: `${dir}a.jsonl` },
  ])
})

test('Codex #1: an old transcript named after the app id does not win over the title match', () => {
  const dir = `${P}/-Users-a-dev-Projects-tools/`
  const files = [
    { path: `${dir}aaaa.jsonl`, mtimeMs: 1_000 },
    { path: `${dir}resumed.jsonl`, mtimeMs: 900_000 },
  ]
  // the last activity matches no file to the second: leave it to the title match
  expect(pickTranscript(session({ id: 'local_aaaa', lastActivityMs: 2_000_000 }), files, P)).toBe(null)
})

test('Codex #2: two conversations never share one transcript by time', () => {
  const dir = `${P}/-Users-a-dev-Projects-tools/`
  const files = [{ path: `${dir}one.jsonl`, mtimeMs: 1_000_000 }]
  const got = matchByTime(
    [session({ id: 'local_a', title: 'a', lastActivityMs: 1_000_000 }), session({ id: 'local_b', title: 'b', lastActivityMs: 1_000_100 })],
    files,
    P,
  )
  expect([...got.values()].filter(p => p === `${dir}one.jsonl`)).toHaveLength(1)
  expect(got.get('local_a')).toBe(`${dir}one.jsonl`)
})

test('Codex #3: a to-do written under the old title still counts after a rename', () => {
  const old: Item = { id: 'i', text: 'x', project: 'p', kind: 'todo', status: 'open', createdAt: '', session: { id: 'old-id', title: 'first name', cwd: '/Users/a/dev/Projects/tools' } }
  const renamed = talk({ id: 'new-id', title: 'notes', titles: ['first name', 'notes'] })
  expect(verdictOf({ ...base, items: [old], session: session(), talk: renamed }).reasons).toEqual(['1 open to-do'])
})
