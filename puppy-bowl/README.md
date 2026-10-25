# puppy-bowl

the puppy's food bowl, sitting above the prompt in claude code. the food is your context window: as the conversation grows, the puppy eats it.

```
◖•ᴥ•◗ ●●●●○○○○○○ 42% left
```

- by default the bowl only comes out once half of it is eaten (the status line already shows the number before that).
- past 80% used, the puppy says the bowl is almost empty and shows a `compact` button, so you can tidy the conversation before it runs out.
- nothing pops up, nothing talks to the network.

## install

in a claude code session in your terminal:

```
/plugin install puppy-bowl --marketplace nonbiri1004/puppy-mods
```

answer `y` to add the marketplace, then pick a scope.

## commands

| command | what it does |
| --- | --- |
| `/bowl` | steps through the modes: `auto` (out when half empty) → `always` → `off` |
| `/bowl auto`, `/bowl always`, `/bowl off` | picks one; it's remembered for every new conversation |
| `/can` | give the puppy a can: a thank-you and a link to [ko-fi](https://ko-fi.com/lofipuppy). unlocks nothing ♡ |

## develop

```
claude plugin validate puppy-bowl
claude plugin test puppy-bowl
```

## license

MIT
