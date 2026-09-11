# Findings: the first working console

What building and running the first working two-daemon console actually
showed, against a **real Uno R4 Minima** and a live `vstimd`. Kept as a
historical record — the console itself has since grown a third daemon
(triald), lost the prototype vstimd stood in for it, and gained a real
layout. Each finding below says what has and has not since been addressed.

![The console: statemachined and vstimd panels on one page](../two-daemon-console.png)

Two codebases, two languages, two protocols — statemachined is FastAPI and JSON,
vstimd is axum and protobuf over two WebSockets — and one page that knew neither
of them. The shell (`static/console.js`) never calls a daemon's API and knows no
field name from either protocol; that much has not changed.

## What it verified

- **Six panels from two daemons load and render live data.** statemachined's
  device panel shows the board's real scan rate and pin map; vstimd's show the
  VTL bit grid and the stimulus table.
- **Actuation works through the console.** Clicking `+ Rect` in the embedded
  vstimd panel creates a stimulus on the daemon.
- **Shadow roots hold.** Six panels, no class collisions, no shared framework —
  and the console's stylesheet cannot reach into any of them.
- **A React UI wraps as custom elements in ~40 lines**, with nothing inside the
  panels changed. They were already functions of `(conn, snapshot)`, and their
  inline styles are element-local and so already shadow-DOM-safe.
- **One daemon dying does not take the page down.** With vstimd stopped, its
  panels say `unreachable — retrying` and statemachined's three stay live.
- **An open page recovers on its own.** Restarting vstimd, the panels reconnect
  within ten seconds with no reload.

## What it showed that was wrong

Four findings, tracked in `PLAN.md`:

1. **The daemons cannot be grouped into a rig** (§4). vstimd's `id=` is its
   hostname; statemachined's is `sha256("statemachined:" + machine-id)`. The salt
   is the daemon's own name, so on one box they are two unrelated strings *by
   construction*, and a console grouping on `id=` shows every rig twice. Needs a
   shared `rig=` record. **This is the one thing that must be fixed in the
   daemons — still open.**
2. **vstimd's mDNS record is unusable by a console** (§4): it advertises port
   5555, the ZMQ port, with no `api`, `elements` or web port — and from a
   `.service` template that cannot know the port the server was given.
   **Still open.**
3. **There is no theming** (§2). statemachined's panels were light and
   vstimd's were dark, and it read as two applications sharing a scrollbar.
   Shadow roots stop the console's CSS reaching in when it is wanted too. The
   fix agreed then (a `--braemons-*` custom-property contract) is **still
   open** — what shipped instead, so far, is the console's own frame around
   each panel taking a colour by source, which helps tell three UIs apart but
   does nothing for what is inside a shadow root.
4. **"connecting" and "unreachable" have to be different words** (§5). The first
   version of the wrapper knew only connected/not, and with vstimd stopped it sat
   on `connecting…` forever — which reads as *slow* when it means *absent*.
   **Fixed**: three states and a backoff retry, in vstimd's own
   `client/web/src/elements/vstimd_elements.tsx` now.

A fifth, smaller: panels did not declare a size, so the layout guessed.
**Addressed a different way**: every panel is independently resizable by hand
now (drag its corner, optionally snapped to a grid) and the size is
remembered — not a panel declaring its own preferred size, which remains
undone, but no longer a guess with no way to correct it.

## What it faked, at the time

- **vstimd did not serve `/elements/vstimd.js`.** A prototype of that file
  lived in this repo (`vstimd-elements/`), bundled across both repos by a
  console-side `build.mjs` and served by `serve.mjs`, standing in for the
  daemon. That was the *only* daemon-specific thing this repo held.
  **Fixed**: the file moved upstream into vstimd's own
  `client/web/src/elements/`, built by a second Vite entry
  (`vite.elements.config.ts`) alongside the main app, embedded in the binary,
  and served at `/elements/vstimd.js` with CORS — the same way statemachined
  and triald serve theirs. `vstimd-elements/` and `build.mjs` are gone from
  this repo.
- **Because of that, killing vstimd did not test the import-failure path** —
  the module was served by the console, so the elements loaded and then failed
  to connect. Now that vstimd serves its own module, stopping vstimd exercises
  the real `no elements` branch in `console.js`.
- **`rigs.json` stood in for mDNS**, and still does: `discovery.mjs` really
  does browse DNS-SD and really did find nothing, because neither daemon was
  advertising on the box this ran on. The configured path is a first-class
  path (§3), not only a test fixture, and remains the primary path until a
  console is exercised against real mDNS advertisements (§8).
- **statemachined's session panel polled `/api/trial/result` and got a 404**
  when no trial had run. Cosmetic, and statemachined's, not the console's.

## What has been added since

Not part of the original run, but grew directly out of the findings above:
triald's own `/elements/triald.js` (six panels, and triald's own web UI now
built from the same elements rather than a second implementation); per-panel
drag-reorder, resize, dock, and hide, all remembered per rig; and colour by
source on each panel's frame. See `PLAN.md` §8 for what of the original list
is still open.
