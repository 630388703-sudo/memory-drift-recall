# MEMORY DRIFT: RECALL.exe

A vanilla HTML/CSS/JS browser prototype — the standalone web version of the
*Memory Drift* interactive installation. No build step, no backend, no login.

## Run locally

Just open `index.html` in a browser, or serve the folder so relative asset
paths resolve cleanly:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy to GitHub Pages

1. Push this folder's contents to a repo (root, or a `/docs` folder).
2. Repo → Settings → Pages → set the source branch/folder.
3. Done — no build step required.

## What's implemented (v1 prototype)

- Boot screen → Archive Desktop → file viewers (photo / chat / location /
  voice / unknown / trash)
- Re-opening a file increments a hidden **DRIFT** value and has a chance to
  mutate its displayed content (object: window/door, weather: rain/sunny,
  date: 2018/2019)
- Reconstruction Board with click-to-select **and** drag-and-drop evidence
  cards across four slots (date / object / weather / person)
- Confirming a memory raises visible **CONFIDENCE** and adjusts **Adaptive
  Loot** weighting (max 75% per option — never fully certain), then unlocks
  reinforcing desktop files
- Conflict evidence event (`DO_NOT_DELETE.pdf`) with KEEP / DELETE branching;
  deleting can cause the file to resurface later from Trash
- Final reveal: Version A / Version B, "which do you remember?", the
  "you did not recover the memory — you completed it" turn, and a Memory
  Recovery Receipt
- `localStorage` session save/continue
- Hidden debug panel — press **Shift+D** to toggle (confidence, drift, all
  counters, all adaptive weights)

## Tuning

All pacing numbers (confidence gain ranges, drift gain ranges, weight step,
max weight cap, mutation chance, confirms-to-complete, conflict deltas) live
in `config.js` so the mechanic can be rebalanced without touching game logic.

## Next pass (not in this prototype, per spec §35)

No AI-generated art, no audio playback, no accounts/backend, no analytics.
All imagery in `assets/images/` is intentionally placeholder SVG — swap in
final art by keeping the same filenames (`photo-{window|door}-{rain|sunny}.svg`)
or updating the `photoImg()` path builder in `script.js`.
