# puppy mods

- **What this is:** small claude code mods kept by the lofi puppy: puppy-bowl, puppy-todo, puppy-console.
- **What this isn't:** the puppy's apps, games or music; those live in other (private) repos.
- **Related:** `puppy-console/hooks/puppy.ts` is generated from baibai-brand; baibai-music and ai-video-pipeline write the status files puppy-console shows.

small, quiet mods for [claude code](https://claude.com/claude-code), kept by the lofi puppy.

each one does one useful thing and stays out of the way. they're free and open; nothing is locked.

## the mods

| mod | what it does |
| --- | --- |
| [puppy-bowl](puppy-bowl) | the puppy's food bowl above the prompt: how much context is left, and a `compact` button when it's almost empty |
| [puppy-todo](puppy-todo) | a to-do pane beside the chat: what this conversation was doing, what other conversations asked you, and one shared list every conversation writes to |
| [puppy-console](puppy-console) | a pane with one card per production pipeline (music, videos, …): what it's doing and what waits for you. each pipeline writes a small status file ([format](puppy-console/FORMAT.md)) |

they all look the same way: quiet cards, warm greys, lowercase words. the rules are in [STYLE.md](STYLE.md).

## install

in a claude code session in your terminal:

```
/plugin install puppy-bowl --marketplace nonbiri1004/puppy-mods
/plugin install puppy-todo --marketplace nonbiri1004/puppy-mods
```

(the same for `puppy-console`.)

answer `y` to add the marketplace, then pick a scope (user = every session). it works in the terminal and in the desktop app's code tab once installed.

## donate a can

if a mod keeps you company, you can give the puppy a can: [ko-fi.com/lofipuppy](https://ko-fi.com/lofipuppy). it unlocks nothing; the puppy just wags its tail. ♡

## license

MIT
