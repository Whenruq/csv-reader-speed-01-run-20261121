# csv-reader-speed-01 entry

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Whenruq/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Whenruq/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0, built for the
"Read broken CSV files faster" bounty.

`solve.js` exports `run(input)`, which returns exactly the
`{columns, rows, errors}` that csv-reader 1.0.0's `readCsv` returns for
the same `{text, header}` — same broken-row policy, same error records,
same line and row numbering. Where the reference reads one character at
a time and builds each field a character at a time, this reader scans
by index and takes each field (or each clean run of it) with one slice;
only the broken fields (stray CRs, doubled quotes, CRs inside quotes)
take a slower path that assembles the value from the slices between
the special characters.

On the kit's practice set (6 cases, ~10 MB of CSV) the answers are
byte-identical to the house baseline's, and the parse itself runs
about 6x faster (trimmed mean over 9 rounds, this machine).

`main.ts` is the harness driver: it reads `/input/cases.json`, answers
each case with `run`, and writes `/output/answers.json`.

## What's inside

- `solve.js` — the fast reader (dependency-free ES module).
- `main.ts` — the harness driver.
- `LICENSE` — MIT.
