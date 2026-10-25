# puppy-todo

one quiet pane beside the chat that answers two things when you come back to a conversation:

- **this conversation**: its title, what you first asked here, its last recap, and what is still open from it.
- **everywhere**: questions other conversations are waiting on you for, your open PRs, and the shared to-do list for every project.

a small puppy sits at the top: `•ᴥ•` most of the time, `°ᴥ°` while a conversation is waiting on you, `^ᴥ^` when nothing is left (skipped rows count as left). no headphones here; those are for the music.

it opens by itself when a session starts. `/todo` opens it again; `/todo <text>` adds a to-do for this conversation.

## where each part comes from

| part | source | written by |
| --- | --- | --- |
| this conversation | the session's own messages, and its transcript's title and last wrap-up | the app (read only) |
| waiting on you | each recent transcript in `~/.claude/projects/` (last 14 days, newest 40): its title, its last wrap-up question, and whether you typed anything after it | the app (read only) |
| prs to merge | `gh search prs --author=@me --state=open` (every 5 minutes, or on refresh) | github (read only) |
| to-do | `~/.claude/todo/items/*.json`, one file per item | any conversation, any AI, or you |

archived conversations are left out when the desktop app's session list can be read.

## done and skip

the pane has no tick. a tick is easy to press before the thing is really done, and then you have to check again. so:

| row | how it ends | what you can press |
| --- | --- | --- |
| an item tied to a PR | github says merged (✓) or closed without merge (✕) | skip |
| any other item | someone says it is done in a conversation (“the call is done”), and claude records who said it | skip |
| a question waiting on you | you answer it in its conversation | skip |
| an open PR | it merges or closes on github | skip |

- **skip** only hides a reminder. it never counts as done, and the puppy says how many rows are skipped.
- a skip covers one occurrence: a new question in that conversation, an item whose text changes, or new activity on the PR brings the row back.
- `skipped (n)` at the bottom lists them, each with `bring back`.

## the shared list

one small json file per item, so two conversations writing at the same time never overwrite each other:

an item someone says is done:

```json
{
  "schemaVersion": 2,
  "id": "20261025-1210-m8p2",
  "text": "call the vet about the shots",
  "project": "home",
  "kind": "todo",
  "status": "done",
  "session": { "id": "…", "title": "Add a dark mode", "cwd": "…" },
  "by": "claude",
  "createdAt": "2026-10-25T04:10:00.000Z",
  "doneAt": "2026-10-25T04:30:00.000Z",
  "completion": { "mode": "declared" },
  "declaration": { "by": "person", "recordedBy": "claude", "at": "2026-10-25T04:30:00.000Z", "note": "said the call is done" }
}
```

an item github decides:

```json
{
  "schemaVersion": 2,
  "id": "20261025-1200-k3f9",
  "text": "merge the notes PR",
  "project": "my-app",
  "kind": "todo",
  "status": "open",
  "link": "https://github.com/you/my-app/pull/78",
  "by": "codex",
  "createdAt": "2026-10-25T04:00:00.000Z",
  "source": { "type": "github-pr", "host": "github.com", "repo": "you/my-app", "number": 78 },
  "completion": { "mode": "source", "condition": "merged" }
}
```

- `kind`: `todo` (you do it), `ask` (a question waiting for you), `later` (a conversation said it would do it later).
- `completion.mode`: `declared` (someone says it is done; `status` and `declaration` record it) or `source` (github decides; `status` in the file is ignored).
- a `link` alone decides nothing: “merge the PR” and “check the deploy after the merge” are different things. only `source` + `completion` tie an item to a PR.
- files without `schemaVersion` still work: a `done` in them shows as “marked done, nobody recorded who”.
- ended items stay in the pane for 3 days; the file is never deleted. the file name is the id: `<id>.json`. unknown fields are kept.

skips live apart, one file per row in `~/.claude/todo/attention/`, so pressing skip never rewrites an item another conversation may be writing.

with the mod installed, claude gets three tools:

- `todo_add`: session and project are filled in. pass `pr` when the item is done exactly when that PR merges.
- `todo_done`: needs `by` (`person` when you said it, with your words in `note`; `claude` when claude did it and checked). a PR item is not changed; github is asked and its answer comes back.
- `todo_list`: open items, PR items checked on github.

without it (codex, a script, you), write a file in the shape above.

a line to put in each project's `CLAUDE.md` so conversations keep the list:

> before ending a conversation, add what is left to the shared to-do list (`todo_add`, or a file in `~/.claude/todo/items/`); mark items done when they are finished.

## limits

- a mod sees only its own session through the api. other conversations are read from their transcript files, whose format is the app's and may change; if it does, "waiting on you" goes quiet and the rest keeps working.
- the pane can't open another conversation for you: the app's session links aren't web links. it names the conversation so you can find it in the sidebar.
- "waiting on you" only knows questions asked with the app's wrap-up box. a question asked in plain text is missed unless the conversation adds it as an `ask` item.
- the list lives on this computer. a second computer has its own `~/.claude/todo/`.
- the app gives a conversation a new transcript each time it opens it again, and transcripts don't carry the app's own session id. so a conversation is known by its title and folder: two conversations with the same title in the same folder look like one, and archived ones are matched by title.
- “done” for a declared item is what someone said, not proof. the record says who said it and when, so it can be checked later.
- reading the transcripts takes a couple of seconds the first time; after that only changed files are read again.
- open PRs need the `gh` cli, signed in.

## install

```
/plugin install puppy-todo --marketplace nonbiri1004/puppy-mods
```

## license

MIT
