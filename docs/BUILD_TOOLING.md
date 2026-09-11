# Build tooling: does a braemons UI need Vite?

**For the console: the question does not arise.** The console bundles nothing —
it has no npm dependencies and no build step — because every panel it shows is a
module served over HTTP by the daemon that owns it. See `PLAN.md` §6.

**For vstimd, which is the only braemons UI with a build:** no, nothing in it
depends on Vite — and it should keep Vite anyway. The full argument and the
measurements are in vstimd's `dev/design/WEB_BUILD_TOOLING.md`, on the branch
`explore/web-build-tooling`. The short version:

| | Vite 5.4 | esbuild 0.21 alone |
|---|---|---|
| production build | 776 ms | 24 ms |
| bundle | 273.4 kB (83.0 kB gzip) | 266.1 kB minified |
| dev server | built in, HMR | 40 lines, no HMR |
| Playwright suite | 8 passed | **8 passed** |

Vite does exactly three things for vstimd — TS/JSX, bundling bare specifiers, and
a dev proxy — and esbuild plus forty lines does all three, verified against the
whole browser suite:

```console
$ VSTIMD_BIN=target/release/vstimd npx playwright test -c playwright.novite.config.ts
Running 8 tests using 1 worker
  ✓ boots and connects                                        (402ms)
  ✓ creates a stimulus                                        (302ms)
  ✓ toggles a VTL bit in the binary grid                      (317ms)
  ✓ lists an animation and arms it                            (242ms)
  ✓ couple-visibility dialog can target an output line        (345ms)
  ✓ system: Hide all disables every stimulus                  (231ms)
  ✓ scene-config: save then load restores the scene           (426ms)
  ✓ drag on the map moves the stimulus (RF mapping)           (379ms)
  8 passed (3.8s)
```

Two bugs found running that suite without Vite, worth knowing about regardless
of which bundler ends up in front of them:

- esbuild with `write: false` and `sourcemap: true` returns **two** output files
  and the map is not last. Taking `outputFiles[0]` serves the sourcemap as the
  bundle, and the browser says `Unexpected token ':'`.
- vstimd's `playwright/smoke.spec.ts` hard-coded the backend port, so the suite
  could not run against a second backend. Fixed with `SMOKE_BACKEND`, defaulted.

The reason to keep it anyway is a dependency that does not go away: **`vitest`
depends on `vite`**, and vstimd's node WebSocket e2e runs under vitest. Porting
that to `node --test` means rewriting 43 assertions *and* touching every import
in the client, because the suite uses NodeNext-style `.js` specifiers for `.ts`
files and **Node's native type stripping does not rewrite `.js` → `.ts`**
(verified, Node 24.20). So removing Vite from the build saves one config file and
752 ms, and removes nothing from `node_modules`.

## What this was actually for

The question mattered because of a claim the console rests on: **no braemons UI
has to adopt another's build.** statemachined's `dev/DAEMON.md` §5 asserts it —
"nobody has to change build systems for a shared framework nobody would agree
on" — and now there is a passing test suite behind it rather than an assumption:

- vstimd's UI runs with Vite and without it, unchanged;
- its panels wrap as custom elements in ~40 lines, with nothing inside them
  changed;
- and they sit on one page beside statemachined's vanilla ones, which have no
  build step at all.

The build is each daemon's own business. That is the useful result.

## The rule going forward

**A daemon's UI is built however that daemon likes, and ships an
`/elements/<daemon>.js` that registers custom elements.** That is the entire
contract. A daemon with no npm dependencies (statemachined, triald) should keep
having none. vstimd has React and protobuf-es, so it has a bundler, and which
bundler is not a cross-repo concern.

**The console acquires no build step.** If it ever seems to need one, the thing
that changed is that domain logic has leaked into it, and that is the bug.
