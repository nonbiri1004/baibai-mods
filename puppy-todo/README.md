# puppy-todo

one quiet pane beside the chat that answers two things when you come back to a conversation:

- **this conversation**: its title, what you first asked here, its last recap, and what is still open from it.
- **everywhere**: questions other conversations are waiting on you for, your open PRs, and the shared to-do list for every project.

a small puppy sits at the top: `•ᴥ•` most of the time, `°ᴥ°` while a conversation is waiting on you, `^ᴥ^` when nothing is left. no headphones here; those are for the music.

it opens by itself when a session starts. `/todo` opens it again; `/todo <text>` adds a to-do for this conversation.

## where each part comes from

| part | source | written by |
| --- | --- | --- |
| this conversation | the session's own messages, and its transcript's title and last wrap-up | the app (read only) |
| waiting on you | each recent transcript in `~/.claude/projects/` (last 14 days, newest 40): its title, its last wrap-up question, and whether you typed anything after it | the app (read only) |
| prs to merge | `gh search prs --author=@me --state=open` (every 5 minutes, or on refresh) | github (read only) |
| to-do | `~/.claude/todo/items/*.json`, one file per item | any conversation, any AI, or you |

archived conversations are left out when the desktop app's session list can be read.

## the shared list

one small json file per item, so two conversations writing at the same time never overwrite each other:

```json
{
  "id": "20261024-2230-k3f9",
  "text": "merge PR #78 by hand; my-app deploys on merge",
  "project": "my-app",
  "kind": "todo",
  "status": "open",
  "session": { "id": "…", "title": "Add a dark mode", "cwd": "…" },
  "link": "https://github.com/you/my-app/pull/78",
  "by": "claude",
  "createdAt": "2026-10-24T14:30:00.000Z",
  "doneAt": "…"
}
```

- `kind`: `todo` (you do it), `ask` (a question waiting for you), `later` (a conversation said it would do it later).
- `status`: `open` or `done`. done items stay in the pane for 3 days; the file is never deleted.
- the file name is the id: `<id>.json`.

with the mod installed, claude gets three tools: `todo_add`, `todo_done`, `todo_list` (session and project are filled in). without it (codex, a script, you), write a file in the shape above.

a line to put in each project's `CLAUDE.md` so conversations keep the list:

> before ending a conversation, add what is left to the shared to-do list (`todo_add`, or a file in `~/.claude/todo/items/`); mark items done when they are finished.

## limits

- a mod sees only its own session through the api. other conversations are read from their transcript files, whose format is the app's and may change; if it does, "waiting on you" goes quiet and the rest keeps working.
- the pane can't open another conversation for you: the app's session links aren't web links. it names the conversation so you can find it in the sidebar.
- "waiting on you" only knows questions asked with the app's wrap-up box. a question asked in plain text is missed unless the conversation adds it as an `ask` item.
- the list lives on this computer. a second computer has its own `~/.claude/todo/`.
- reading the transcripts takes a couple of seconds the first time; after that only changed files are read again.
- open PRs need the `gh` cli, signed in.

## install

```
/plugin install puppy-todo --marketplace nonbiri1004/puppy-mods
```

## license

MIT
