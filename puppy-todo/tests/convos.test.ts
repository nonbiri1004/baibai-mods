import { expect, test } from 'claude-code/testing'

import type { Item, Session, Talk } from '../types'
import { isWorktree, parseSessions, parseWorktree, pickTranscript, projectDir, sortConvos, verdictOf } from '../hooks/convos'

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
const talk = (over: Partial<Talk> = {}): Talk => ({ id: 't1', title: 'notes', project: 'tools', cwd: '/Users/a/dev/Projects/tools', prs: [], mtimeMs: 0, ...over })
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

test('ready only when nothing is left and the folder is clean', () => {
  expect(verdictOf({ ...base, session: session(), talk: talk() })).toEqual({ state: 'ready', reasons: [] })
  expect(verdictOf({ ...base, session: session(), talk: talk({ ask: 'merge it?' }) }).reasons).toEqual(['asked you: merge it?'])
  expect(verdictOf({ ...base, session: session({ prNumber: 4, prState: 'OPEN' }), talk: talk() }).reasons).toEqual(['PR #4 not merged'])
  expect(verdictOf({ ...base, session: session({ prNumber: 4, prState: 'MERGED' }), talk: talk() }).state).toBe('ready')
  const todo: Item = { id: 'i', text: 'x', project: 'p', kind: 'todo', status: 'open', createdAt: '', session: { id: 't1' } }
  expect(verdictOf({ ...base, items: [todo], session: session(), talk: talk() }).reasons).toEqual(['1 open to-do'])
  expect(verdictOf({ ...base, items: [todo], isOpenItem: () => false, session: session(), talk: talk() }).state).toBe('ready')
})

test('a worktree with work on it is not ready; one that can not be read is unknown', () => {
  const s = session({ cwd: '/r/.claude/worktrees/w' })
  const t = talk({ cwd: '/r/.claude/worktrees/w' })
  expect(verdictOf({ ...base, session: s, talk: t, worktree: { state: 'read', changed: 2, unpushed: 1 } }).reasons).toEqual([
    '2 uncommitted changes',
    '1 commit not pushed',
  ])
  expect(verdictOf({ ...base, session: s, talk: t, worktree: { state: 'unknown' } }).state).toBe('unknown')
  expect(verdictOf({ ...base, session: s, talk: t, worktree: { state: 'read', changed: 0, unpushed: 0 } }).state).toBe('ready')
  expect(isWorktree('/r/.claude/worktrees/w')).toBe(true)
  expect(isWorktree('/r')).toBe(false)
  expect(parseWorktree({ exitCode: 0, stdout: ' M a.ts\n?? b.ts\n' }, { exitCode: 0, stdout: '3\n' })).toEqual({
    state: 'read',
    changed: 2,
    unpushed: 3,
  })
  expect(parseWorktree({ exitCode: 128, stdout: '' }, { exitCode: 0, stdout: '0' })).toEqual({ state: 'unknown' })
})

test('no last turn found is unknown, never ready; this conversation is never ready', () => {
  expect(verdictOf({ ...base, session: session(), talk: null }).state).toBe('unknown')
  expect(verdictOf({ ...base, session: session(), talk: talk(), isHere: true })).toEqual({ state: 'open', reasons: ['this conversation'] })
})

test('ready ones first, stalest first', () => {
  const c = (id: string, state: 'ready' | 'open' | 'unknown', at: number) => ({
    session: session({ id, lastActivityMs: at }),
    verdict: { state, reasons: [] },
  })
  expect(sortConvos([c('a', 'open', 1), c('b', 'ready', 9), c('c', 'ready', 2), c('d', 'unknown', 0)]).map(x => x.session.id)).toEqual([
    'c',
    'b',
    'a',
    'd',
  ])
})
