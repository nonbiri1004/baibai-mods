# puppy-todo

a to-do pane beside the chat, shared by every conversation. when you come back to a conversation it tells you what this one was doing, what other conversations asked you, and what is left.

```
•ᴥ• 3 to-do · 1 asked you                 refresh
╭─────────────────────────────────────────────╮
│ notes app                            my-app │
│ last: the list works; offline sync is next. │
╰─────────────────────────────────────────────╯
╭─────────────────────────────────────────────╮
│ asked you                         1 waiting │
│ games chat · 3h                             │
│   make the office prototype first?          │
╰─────────────────────────────────────────────╯
╭─────────────────────────────────────────────╮
│ to-do                                3 open │
│ [add a to-do…]                              │
│                                             │
│ this conversation                           │
│ ☐ test offline sync                         │
│                                             │
│ my-app                                      │
│ ☐ write the retry docs                      │
│ ↗ merge the notes PR · waiting for merge    │
╰─────────────────────────────────────────────╯
▸ done 8
▸ tidy up: 32 of 80 conversations have nothing open
looked at 14:05
```

it looks like the other puppy mods: one card per part ([style](../STYLE.md)).

it opens by itself when a session starts. `/todo` opens it again; `/todo <text>` adds a to-do for this conversation.

## what you do

- **add**: the field at the top of the list, or `/todo <text>`.
- **tick** ☐ when it's done. tick ☑ under `done` to open it again.
- **✕** to delete something you won't do. on the desktop it shows when the pointer is on the row.
- **tidy up**: when the sidebar gets long, unfold the last row. it lists every open conversation with what is still open in it and its last recap, so you can archive from the sidebar without opening each one.

that's all. everything else happens by itself.

## what happens by itself

- **asked you**: the last question another conversation asked in its wrap-up box, while you haven't typed anything after it. questions fade after two days.
- **PR items** (↗) have no tick: they turn done when GitHub says the PR merged, and show ✕ under `done` if it closed without merging.
- **claude keeps the list**: with the mod installed, claude has `todo_add`, `todo_done` and `todo_list`, and a line in your `CLAUDE.md` asks it to add what is left at the end of a conversation and tick what it finished.
- **this conversation first**: the to-dos written here, by this session or an earlier one of the same conversation, come before the rest.

## the shared list

one small json file per item in `~/.claude/todo/items/`, so conversations writing at the same time don't overwrite each other's items. the file name is the id.

```json
{
  "schemaVersion": 2,
  "id": "20261025-1210-m8p2",
  "text": "call the vet about the shots",
  "project": "home",
  "kind": "todo",
  "status": "open",
  "session": { "id": "…", "title": "notes app", "cwd": "…" },
  "by": "claude",
  "createdAt": "2026-10-25T04:10:00.000Z",
  "completion": { "mode": "declared" }
}
```

- ticking sets `status: "done"`, `doneAt`, and `declaration` (who said it: `person` for a tick in the pane; `recordedBy: "claude"` when you said it in a conversation).
- a PR item has `"source": { "type": "github-pr", "host": "github.com", "repo": "you/my-app", "number": 78 }` and `"completion": { "mode": "source", "condition": "merged" }`. github decides; `status` in the file is ignored. a plain `link` decides nothing.
- delete sets `deletedAt` and `deletedBy`. the file stays; the item is never shown again.
- files from older versions still work. unknown fields are kept.

without the mod (codex, a script, you), write a file in this shape.

a line for your `CLAUDE.md`:

> before ending a conversation, add what is still left with `todo_add` (pass `pr` when a PR merging finishes it), or write a file to `~/.claude/todo/items/`. tick with `todo_done` only when the person said it is done (`by: person`) or you did it and checked (`by: claude`).

## limits

- a mod sees only its own session. other conversations are read from their transcript files, whose format is the app's and may change.
- "nothing open found" in tidy-up is a hint, not a promise: a question asked in plain text, or work never written down, isn't seen. archiving stays in the app's sidebar, since it also removes the conversation's worktree.
- a conversation is matched to its transcript by the time of its last activity, else by its title. forks with the same title, when the time doesn't tell them apart, may show each other's last turn.
- "asked you" only knows questions from the app's wrap-up box.
- the app's conversation list is read in pages of 150, 80 or 40; the pane says when it shows only the newest ones.
- the list lives on this computer; a second computer has its own `~/.claude/todo/`.
- PR items need the `gh` cli, signed in.

## install

```
/plugin install puppy-todo --marketplace nonbiri1004/puppy-mods
```

## license

MIT
