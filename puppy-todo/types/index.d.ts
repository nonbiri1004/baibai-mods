// one to-do in the shared list: ~/.claude/todo/items/<id>.json
export type Item = {
  // 2 for items with source/completion/declaration; missing means the first format
  schemaVersion?: number
  id: string
  text: string
  // the repo or project it belongs to, e.g. lofi-puppy
  project: string
  // todo: the person does it; ask: a question waiting for the person; later: a conversation said it would do it later
  kind: Kind
  // for declared items: what someone said. for source items: ignored, the source decides
  status: 'open' | 'done'
  // the conversation that wrote it, when known
  session?: { id?: string; title?: string; cwd?: string }
  // a PR, issue or doc it points at (a link alone decides nothing)
  link?: string
  // who wrote the item: claude, codex or person
  by?: string
  createdAt: string
  doneAt?: string
  // where the answer to "is it done?" lives; only github PRs so far
  source?: PrSource
  // declared: someone says it is done. source: the source says it is done
  completion?: { mode: 'declared' | 'source'; condition?: 'merged' }
  // who said it is done, for declared items; cleared when it opens again
  declaration?: Declaration
  // when it was last opened again after being done
  reopenedAt?: string
}

export type Kind = 'todo' | 'ask' | 'later'

export type PrSource = { type: 'github-pr'; host: string; repo: string; number: number }

export type Declaration = {
  // who says it is done: person, claude or codex
  by: string
  // who wrote it down, when someone else said it
  recordedBy?: string
  at: string
  note?: string
}

// what a PR is right now, by `gh pr view`; endedAt is when it was merged or closed
export type PrState = { state: 'OPEN' | 'MERGED' | 'CLOSED'; endedAt?: string }

// an item as the pane shows it: worked out from the file and its source, never stored
export type Outcome = {
  state: 'open' | 'done' | 'canceled' | 'unknown'
  // source: checked at the source. declared: someone said so. legacy: an old file, nobody recorded who
  basis: 'source' | 'declared' | 'legacy'
  // a few words on why, shown dim
  why?: string
  // when it was done or canceled, for how long it stays shown
  endedAt?: string
}

// a person's "skip" for one row: ~/.claude/todo/attention/<hash>.json
// it never says anything about done; it only hides a reminder
export type Attention = {
  version: 1
  // item:<id>, ask:<conversation>, pr:<url>
  target: string
  state: 'dismissed' | 'active'
  // which time this was skipped; a new question, a changed item or new PR activity has another
  occurrence: string
  at: string
  by: string
}

// what one conversation's transcript says right now
export type Talk = {
  // the transcript's file name without .jsonl (the engine's session id; a reopened conversation gets a new one)
  id: string
  title: string
  project: string
  cwd: string
  // the last wrap-up recap
  recap?: string
  // the last wrap-up question, while nothing was typed after it
  ask?: string
  // the tool use that asked it, so one skip covers this question only
  askId?: string
  prs: string[]
  mtimeMs: number
}

export type Pr = { repo: string; number: number; title: string; url: string; isDraft: boolean; updatedAt: string }

// one of the app's conversations, from its session list
export type Session = {
  // local_<uuid>, the app's id
  id: string
  title: string
  cwd: string
  isArchived: boolean
  isPinned: boolean
  lastActivityMs: number
  prNumber?: number
  prState?: string
}

// a worktree's git state: changed files and commits on no remote
export type WorktreeState = { state: 'read'; changed: number; unpushed: number } | { state: 'unknown' }

// ready: nothing left, it can be archived. open: something is left (reasons say what). unknown: couldn't tell
export type Verdict = { state: 'ready' | 'open' | 'unknown'; reasons: string[] }

export type Convo = { session: Session; recap?: string; verdict: Verdict }

export type View = {
  // this conversation
  here: { id: string; title: string; project: string; cwd: string; goal?: string; recap?: string }
  talks: Talk[]
  prs: Pr[]
  items: Item[]
  // PR states for items whose source is a PR, by prKey
  prStates: Record<string, PrState>
  // skips, by target
  attention: Record<string, Attention>
  // whether the skipped rows are listed
  isShowingSkipped: boolean
  // every conversation the app has open, with its verdict; null when the app's list can't be read
  convos: Convo[] | null
  // what happened on the last archive press, by session id
  archiving: Record<string, string>
  // ms since the epoch of the last refresh; null before the first
  at: number | null
  // why a source could not be read (gh missing, ...)
  notes: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'puppy-todo': { view: View }
  }
}
