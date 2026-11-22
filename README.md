# Sokoban solver

[![sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/lively-raven-87/sokoban-solver-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/lively-raven-87/sokoban-solver-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A Sokoban solver for the make.fun bounty **"Build the best Sokoban solver"**
(`sokoban-solver-01-run-20261121`).

Entered on [make.fun](https://make.fun/?ref=200tdmdd&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards

## How it works

Every level is a one-cell-wide hallway (the row the player starts on) with
one to four rooms hanging off it, each room holding 3–4 boxes and as many
goals, entered through a single door. A box pushed out of its room can never
come back, so rooms are independent: the solver splits the level into
hallway + rooms, solves each room on its own with push-optimal A* (a state
is the player's square plus the sorted box squares, cost = number of
pushes, estimate = sum of BFS distances from each box to its nearest goal,
corner-deadlock pruning), walks the hallway between doors, and
concatenates the move strings into one `u`/`d`/`l`/`r` solution.

The search is bounded by expansions, never by the clock, and every
tie-break is fixed, so two runs write byte-identical outputs.

## Usage

```sh
node main.ts
```

Reads levels from `MAKEFUN_INPUT_DIR` (default `/input`, one `level.txt`
per instance directory) and writes `solution.txt` per instance to
`MAKEFUN_OUTPUT_DIR` (default `/output`).

## Practice-set results

| Instance | Points | Pushes (P*) |
| -------- | ------ | ----------- |
| i001 | 1000 | 13 / 13 |
| i002 | 1000 | 16 / 16 |
| i003 | 1000 | 29 / 29 |
| i004 | 1000 | 47 / 47 |
| i005 | 1000 | 60 / 60 |
| **Total** | **5000 / 5000** | push-optimal on all 5 |

Whole practice set runs in ~6 seconds (limit: 60 seconds), deterministic
(two runs produce identical bytes).

## License

MIT — see [LICENSE](LICENSE).
