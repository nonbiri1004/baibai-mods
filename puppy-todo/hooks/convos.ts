// the conversation list: which of the app's conversations can be archived. no $ here; tests import it
import type { Convo, Item, Session, Talk, Verdict, WorktreeState } from '../types'

import { isHere } from './todo'

// a transcript's folder under ~/.claude/projects: the working folder with every other character as -
export function projectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

// `list_sessions` as the app returns it; rows missing an id, a title or a folder are left out
export function parseSessions(text: string): Session[] {
  try {
    const rows = JSON.parse(text) as Record<string, unknown>[]

    return rows.flatMap(r => {
      if (typeof r.sessionId !== 'string' || typeof r.title !== 'string' || typeof r.cwd !== 'string') {
        return []
      }
      const at = typeof r.lastActivityAt === 'string' ? Date.parse(r.lastActivityAt) : NaN

      return [
        {
          id: r.sessionId,
          title: r.title,
          cwd: r.cwd,
          isArchived: r.isArchived === true,
          isPinned: r.pinned === true,
          lastActivityMs: Number.isFinite(at) ? at : 0,
          ...(typeof r.prNumber === 'number' ? { prNumber: r.prNumber } : {}),
          ...(typeof r.prState === 'string' ? { prState: r.prState } : {}),
        },
      ]
    })
  } catch {
    return []
  }
}

// which transcript is this conversation's latest: the app writes the transcript as it works, so the
// file in the conversation's folder changed at its last activity. a resumed conversation has several
// transcripts and forks share a title, so the time is what tells them apart
export const SAME_MOMENT_MS = 5_000

export function pickTranscript(s: Session, files: readonly { path: string; mtimeMs: number }[], projects: string): string | null {
  const dir = `${projects}/${projectDir(s.cwd)}/`
  const mine = folderFiles(s, files, projects)
  let best: { path: string; gap: number } | null = null
  for (const f of mine) {
    const gap = Math.abs(f.mtimeMs - s.lastActivityMs)
    if (!best || gap < best.gap) {
      best = { path: f.path, gap }
    }
  }
  if (best && best.gap <= SAME_MOMENT_MS) {
    return best.path
  }
  // the app's id often is the first transcript's name
  const named = `${dir}${s.id.replace(/^local_/, '')}.jsonl`

  return mine.some(f => f.path === named) ? named : null
}

// when no transcript changed at the last activity (the app moves that time when a conversation is
// pinned or renamed, and writes to a transcript when it opens it again), the newest transcript in its
// folder that ever had its title, among those no other conversation already matched by time.
// a resumed conversation has several such files; the newest is its latest
export function pickByTitle(
  s: Session,
  candidates: readonly { path: string; mtimeMs: number; titles: readonly string[] }[],
  claimed: ReadonlySet<string>,
): string | null {
  const same = candidates.filter(c => !claimed.has(c.path) && c.titles.includes(s.title)).sort((a, b) => b.mtimeMs - a.mtimeMs)

  return same[0]?.path ?? null
}

// the transcripts in a conversation's folder
export function folderFiles<T extends { path: string }>(s: Session, files: readonly T[], projects: string): T[] {
  const dir = `${projects}/${projectDir(s.cwd)}/`

  return files.filter(f => f.path.startsWith(dir) && !f.path.slice(dir.length).includes('/'))
}

// `git status --porcelain` lines, and the number of commits on no remote
export function parseWorktree(status: { exitCode: number; stdout: string }, unpushed: { exitCode: number; stdout: string }): WorktreeState {
  if (status.exitCode !== 0 || unpushed.exitCode !== 0) {
    return { state: 'unknown' }
  }
  const n = Number(unpushed.stdout.trim())

  return {
    state: 'read',
    changed: status.stdout.split('\n').filter(l => l.trim() !== '').length,
    unpushed: Number.isFinite(n) ? n : 0,
  }
}

export function isWorktree(cwd: string): boolean {
  return /\/\.claude\/worktrees\/[^/]+\/?$/.test(cwd)
}

// can it be archived? only when nothing points at unfinished work. anything that can't be read
// makes it unknown, never ready: archiving removes the conversation's worktree
export function verdictOf(c: {
  session: Session
  talk: Talk | null
  items: readonly Item[]
  isOpenItem: (i: Item) => boolean
  worktree: WorktreeState | null
  isHere: boolean
}): Verdict {
  const reasons: string[] = []
  if (c.isHere) {
    return { state: 'open', reasons: ['this conversation'] }
  }
  if (c.talk?.ask) {
    reasons.push(`asked you: ${c.talk.ask}`)
  }
  if (c.talk) {
    const open = c.items.filter(i => c.isOpenItem(i) && isHere(i, { id: c.talk!.id, title: c.session.title, cwd: c.session.cwd }))
    if (open.length > 0) {
      reasons.push(`${open.length} open to-do${open.length > 1 ? 's' : ''}`)
    }
  }
  if (c.session.prState === 'OPEN') {
    reasons.push(`PR #${c.session.prNumber ?? '?'} not merged`)
  }
  if (c.worktree?.state === 'read') {
    if (c.worktree.changed > 0) {
      reasons.push(`${c.worktree.changed} uncommitted change${c.worktree.changed > 1 ? 's' : ''}`)
    }
    if (c.worktree.unpushed > 0) {
      reasons.push(`${c.worktree.unpushed} commit${c.worktree.unpushed > 1 ? 's' : ''} not pushed`)
    }
  }
  if (reasons.length > 0) {
    return { state: 'open', reasons }
  }
  if (!c.talk) {
    return { state: 'unknown', reasons: ['could not find its last turn'] }
  }
  if (c.worktree?.state === 'unknown') {
    return { state: 'unknown', reasons: ['could not check its folder'] }
  }

  return { state: 'ready', reasons: [] }
}

// ready ones first, oldest first, so a sweep starts with the stalest; then open; then unknown
export function sortConvos(list: readonly Convo[]): Convo[] {
  const rank = { ready: 0, open: 1, unknown: 2 }

  return [...list].sort((a, b) => rank[a.verdict.state] - rank[b.verdict.state] || a.session.lastActivityMs - b.session.lastActivityMs)
}
