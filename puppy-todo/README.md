# puppy-todo

your own to-do list, in a quiet pane beside the chat. you add things, tick them, delete them. that's all.

```
3 to-do                               refresh
╭─────────────────────────────────────────────╮
│ [add a to-do…]                        [add] │
│  ○  call the vet about the shots            │
│  ○  decide where the coffee stand goes   ✕  │
│  ○  set up the mods on the backup mac       │
╰─────────────────────────────────────────────╯
▸ done 2
```

on the desktop, the puppy moves beside the header: sitting and blinking while to-dos are open, sleeping when none are open. in the terminal, it is a still puppy in block characters, 34 columns × 13 rows, above the header. it is left out when the pane is shorter than 26 rows.

it looks like the other puppy mods: warm greys, one card ([style](../STYLE.md)).

## what you do

- **open it**: `/todo`. it doesn't open by itself.
- **add**: the field at the top, or `/todo <text>`.
- **tick** ○ when it's done. under `▸ done`, tick ☑ to open it again. done items stay there for three days.
- **✕** to delete something you won't do. on the desktop it shows when the pointer is on the row.
- **refresh** reads the list again, if you changed it in another window.

## what it doesn't do

this list is only yours. Claude doesn't add to it, tick it or read it: the mod gives Claude no tools. it doesn't read your conversations or ask GitHub anything. when the pane is closed, nothing runs.

## why so little

earlier versions also showed what each conversation was doing, which conversations were waiting for you, which could be archived, and a list Claude kept for you. after using it, the extra facts made the day more tiring, not less: the sidebar already shows which conversation needs you, and a list written by someone else is a list you have to check. so it went back to the one thing a to-do list is for.

## where it lives

one small json file per item in `~/.claude/todo/items/`. the file name is the id.

```json
{
  "schemaVersion": 2,
  "id": "20261027-1210-m8p2",
  "text": "call the vet about the shots",
  "project": "home",
  "kind": "todo",
  "status": "open",
  "by": "person",
  "createdAt": "2026-10-27T04:10:00.000Z"
}
```

- ticking sets `status: "done"`, `doneAt`, and `declaration: { by: "person" }`. opening it again clears those and sets `reopenedAt`.
- delete sets `deletedAt` and `deletedBy`. the file stays; the item is never shown again.
- files from older versions still work: their extra fields (the conversation that wrote it, who said it was done) are kept and not used.
- items an older version left for GitHub to tick when a PR merged (`source`, or `completion.mode: "source"`) aren't shown: their file says open even after the merge, and this list doesn't ask GitHub. the files stay.
- the list lives on this computer; a second computer has its own `~/.claude/todo/`.

## install

```
/plugin install puppy-todo --marketplace nonbiri1004/puppy-mods
```

## license

MIT
