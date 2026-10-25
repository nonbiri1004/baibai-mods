import { expect, test } from 'claude-code/testing'

import type { Attention, Item, PrState, Talk } from '../types'
import {
  FACES,
  attentionFile,
  byProject,
  isHere,
  isSkipped,
  mood,
  newId,
  newestTalks,
  occurrence,
  outcomeOf,
  parseAttention,
  parseItem,
  parsePrState,
  parsePrUrl,
  parsePrs,
  parseScan,
  prKey,
  declareDone,
  prAnswer,
  reopen,
  projectOf,
  saying,
  shown,
  target,
} from '../hooks/todo'

const NOW = Date.parse('2026-10-24T14:30:00Z')
const wrap = (recap: string, ask?: string, id = 'toolu_1') =>
  JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name: 'mcp__ccd_turn__wrap_up', input: ask ? { recap, ask } : { recap } }] },
  })
const item = (over: Partial<Item>): Item => ({ id: 'a', text: 'a', project: 'p', kind: 'todo', status: 'open', createdAt: '', ...over })
const PR = { type: 'github-pr', host: 'github.com', repo: 'you/app', number: 8 } as const
const prItem = (over: Partial<Item> = {}) =>
  item({ schemaVersion: 2, source: PR, completion: { mode: 'source', condition: 'merged' }, ...over })
const skipOf = (what: string, occ: string, state: Attention['state'] = 'dismissed'): Record<string, Attention> => ({
  [what]: { version: 1, target: what, state, occurrence: occ, at: '', by: 'person' },
})
const states = (s: PrState): Record<string, PrState> => ({ [prKey(PR)]: s })

test('ids sort by time and stay short', () => {
  expect(newId(NOW, () => 0.5)).toMatch(/^\d{8}-\d{4}-[0-9a-z]{4}$/)
})

test('a worktree belongs to its repo', () => {
  expect(projectOf('/Users/a/dev/Projects/lofi-puppy/.claude/worktrees/nervous-hertz-0421c7')).toBe('lofi-puppy')
  expect(projectOf('/Users/a/dev/Projects/baibai-tools')).toBe('baibai-tools')
})

test('hand-written items are read loosely, broken ones dropped, unknown fields kept', () => {
  expect(parseItem('{"id":"x","text":" merge #78 ","kind":"weird","extra":1}')).toMatchObject({
    text: 'merge #78',
    kind: 'todo',
    project: 'misc',
    status: 'open',
    extra: 1,
  })
  expect(parseItem('{"id":"x"}')).toBe(null)
  expect(parseItem('not json')).toBe(null)
})

test('a PR item listens to github, not to the file', () => {
  // someone wrote done in the file, but the PR is still open
  expect(outcomeOf(prItem({ status: 'done', doneAt: '2026-10-24T10:00:00Z' }), states({ state: 'OPEN' })).state).toBe('open')
  expect(outcomeOf(prItem(), states({ state: 'MERGED', endedAt: '2026-10-24T12:00:00Z' }))).toMatchObject({
    state: 'done',
    basis: 'source',
    why: 'merged',
  })
  expect(outcomeOf(prItem(), states({ state: 'CLOSED' })).state).toBe('canceled')
  // not asked yet, or github could not be reached: never counts as done
  expect(outcomeOf(prItem(), {}).state).toBe('unknown')
  expect(outcomeOf(prItem({ completion: { mode: 'source', condition: 'deployed' as 'merged' } }), states({ state: 'MERGED' })).state).toBe(
    'unknown',
  )
})

test('a PR link alone decides nothing', () => {
  const linked = item({ link: 'https://github.com/you/app/pull/8' })
  expect(outcomeOf(linked, states({ state: 'MERGED' })).state).toBe('open')
})

test('done says who said it; old files say nobody recorded who', () => {
  const said = item({
    schemaVersion: 2,
    completion: { mode: 'declared' },
    status: 'done',
    declaration: { by: 'person', recordedBy: 'claude', at: '2026-10-24T13:00:00Z' },
  })
  expect(outcomeOf(said, {})).toMatchObject({ state: 'done', basis: 'declared', why: 'person said done (noted by claude)' })
  expect(outcomeOf(item({ status: 'done', doneAt: '2026-10-24T13:00:00Z', by: 'claude' }), {})).toMatchObject({
    state: 'done',
    basis: 'legacy',
  })
})

test('open items first, ended ones fade after a few days', () => {
  const list = shown(
    [
      item({ id: 'b' }),
      item({ id: 'a' }),
      item({ id: 'c', status: 'done', doneAt: '2026-10-24T10:00:00Z' }),
      item({ id: 'd', status: 'done', doneAt: '2026-10-01T10:00:00Z' }),
      prItem({ id: 'e' }),
    ],
    states({ state: 'MERGED', endedAt: '2026-10-24T11:00:00Z' }),
    NOW,
  )
  expect(list.map(i => i.id)).toEqual(['a', 'b', 'e', 'c'])
  expect(byProject([{ project: 'z' }, { project: 'a' }]).map(([p]) => p)).toEqual(['a', 'z'])
})

test('a skip covers one occurrence: a new question or a changed item comes back', () => {
  const talk: Talk = { id: 's1', title: 'notes', titles: ['notes'], project: 'p', cwd: '/x', ask: 'merge?', askId: 'toolu_1', prs: [], mtimeMs: 0 }
  const att = skipOf(target.ask(talk), 'toolu_1')
  expect(isSkipped(att, target.ask(talk), occurrence.ask(talk))).toBe(true)
  expect(isSkipped(att, target.ask(talk), occurrence.ask({ ...talk, askId: 'toolu_2' }))).toBe(false)

  const one = item({ id: 'x', text: 'call the vet' })
  const skipOne = skipOf(target.item(one), occurrence.item(one))
  expect(isSkipped(skipOne, target.item(one), occurrence.item(one))).toBe(true)
  expect(isSkipped(skipOne, target.item(one), occurrence.item({ ...one, text: 'call the vet again' }))).toBe(false)
  // brought back
  expect(isSkipped(skipOf(target.item(one), occurrence.item(one), 'active'), target.item(one), occurrence.item(one))).toBe(false)
})

test('skip files: a hash name, and only a well-formed file counts', () => {
  const name = attentionFile('pr:https://github.com/you/app/pull/8')
  expect(name).toMatch(/^[0-9a-f]{16}\.json$/)
  expect(attentionFile('pr:https://github.com/you/app/pull/8')).toBe(name)
  expect(attentionFile('pr:https://github.com/you/app/pull/9')).not.toBe(name)
  expect(parseAttention('{"version":1,"target":"item:a","state":"dismissed","occurrence":"x"}')?.target).toBe('item:a')
  expect(parseAttention('{"version":2,"target":"item:a","state":"dismissed","occurrence":"x"}')).toBe(null)
  expect(parseAttention('{"version":1,"target":"item:a","state":"done","occurrence":"x"}')).toBe(null)
})

test('the puppy is happy only when nothing is left, skipped rows included', () => {
  expect(mood(2, 5)).toBe('hello')
  expect(mood(0, 3)).toBe('calm')
  expect(mood(0, 0)).toBe('happy')
  expect(mood(0, 0, 3)).toBe('calm')
  expect(saying('calm', 0, 0, 3)).toBe('nothing to show · 3 skipped')
  expect(saying('calm', 0, 2, 1)).toBe('2 open · 1 skipped')
  // no headphones: the face has no ◖◗ ear cups
  expect(Object.values(FACES).join('')).not.toMatch(/[◖◗]/)
})

test('a question waits until something is typed after it, and keeps its tool use id', () => {
  const out = [
    '\x1e/p/one.jsonl',
    '{"type":"custom-title","customTitle":"Puppy notes"}',
    'U',
    wrap('Built it.', 'Merge the PR?', 'toolu_9'),
    '{"type":"pr-link","prUrl":"https://github.com/o/r/pull/3"}',
    'C:"cwd":"/x/lofi-puppy/.claude/worktrees/w"',
    '\x1e/p/two.jsonl',
    '{"type":"custom-title","customTitle":"Old talk"}',
    wrap('Asked.', 'Which one?'),
    'U',
    'C:',
  ].join('\n')
  const [one, two] = parseScan(out, new Map([['/p/one.jsonl', 5]]))
  expect(one).toMatchObject({
    id: 'one',
    title: 'Puppy notes',
    project: 'lofi-puppy',
    cwd: '/x/lofi-puppy/.claude/worktrees/w',
    recap: 'Built it.',
    ask: 'Merge the PR?',
    askId: 'toolu_9',
    mtimeMs: 5,
  })
  expect(one?.prs).toEqual(['https://github.com/o/r/pull/3'])
  expect(two?.ask).toBe(undefined)
  expect(two?.askId).toBe(undefined)
})

test('a reopened conversation is one conversation: newest transcript wins, its items stay here', () => {
  const t = (id: string, mtimeMs: number, title = 'notes'): Talk => ({ id, title, titles: [title], project: 'p', cwd: '/x', prs: [], mtimeMs })
  expect(newestTalks([t('old', 1), t('new', 2), t('other', 1, 'games')]).map(x => x.id)).toEqual(['new', 'other'])
  const here = { id: 'new', title: 'notes', cwd: '/x' }
  expect(isHere(item({ session: { id: 'old', title: 'notes', cwd: '/x' } }), here)).toBe(true)
  expect(isHere(item({ session: { id: 'old', title: 'notes', cwd: '/y' } }), here)).toBe(false)
  expect(isHere(item({}), here)).toBe(false)
})

test('github answers become rows and states', () => {
  const prs = parsePrs(
    '[{"number":78,"title":"Log","url":"https://x/78","isDraft":false,"updatedAt":"2026-10-24T01:00:00Z","repository":{"name":"tools"}}]',
  )
  expect(prs).toEqual([{ repo: 'tools', number: 78, title: 'Log', url: 'https://x/78', isDraft: false, updatedAt: '2026-10-24T01:00:00Z' }])
  expect(parsePrs('oops')).toEqual([])
  expect(parsePrState('{"state":"MERGED","mergedAt":"2026-10-24T02:00:00Z","closedAt":"2026-10-24T02:00:00Z"}')).toEqual({
    state: 'MERGED',
    endedAt: '2026-10-24T02:00:00Z',
  })
  expect(parsePrState('{"state":"OPEN","mergedAt":null}')).toEqual({ state: 'OPEN' })
  expect(parsePrState('nope')).toBe(null)
  expect(parsePrUrl('https://github.com/you/app/pull/8')).toEqual(PR)
  expect(parsePrUrl('https://github.com/you/app/issues/8')).toBe(null)
  expect(parsePrUrl('https://evil.example/you/app/pull/8')).toBe(null)
})

test('Codex #1: an item with completion null does not break the list', () => {
  const broken = parseItem('{"id":"x","text":"x","completion":null,"source":null,"declaration":null}')
  expect(broken).not.toBe(null)
  expect(() => shown([broken as Item, item({ id: 'ok' })], {}, NOW)).not.toThrow()
  expect(outcomeOf(broken as Item, {}).state).toBe('open')
})

test('Codex #2: skipped, done, then opened again comes back', () => {
  const one = item({ id: 'x', text: 'call the vet', schemaVersion: 2, completion: { mode: 'declared' } })
  const skip = skipOf(target.item(one), occurrence.item(one))
  const reopened = reopen(declareDone(one))
  expect(reopened.status).toBe('open')
  expect(isSkipped(skip, target.item(reopened), occurrence.item(reopened))).toBe(false)
})

test('Codex #4: when github cannot be asked, the answer and the line agree', () => {
  const known = states({ state: 'MERGED', endedAt: '2026-10-24T12:00:00Z' })
  const answer = prAnswer(prItem(), {}, known)
  // the line is drawn from answer.states, so the words must say the same thing
  expect(outcomeOf(prItem(), answer.states).state).toBe('done')
  expect(answer.said).toContain('could not ask github')
  expect(answer.said).toContain('done')
})
