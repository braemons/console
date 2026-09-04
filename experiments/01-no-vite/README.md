# 01 — vstimd's UI without Vite

**Question.** Is Vite load-bearing for a braemons UI, or incidental? It matters
because the console's whole architecture rests on the claim that no daemon has to
adopt another's build (statemachined `dev/DAEMON.md` §5).

**Answer: incidental.** vstimd's UI builds and passes its entire Playwright
browser suite on plain esbuild plus a 40-line dev server.

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

| | Vite 5.4 | esbuild 0.21 alone |
|---|---|---|
| production build | 776 ms | 24 ms |
| bundle | 273.4 kB (83.0 kB gzip) | 266.1 kB minified |

**The code lives in vstimd**, on the branch `explore/web-build-tooling`, because
it only runs there:

- `client/web/dev-server.mjs` — esbuild watch + a raw-socket WebSocket proxy for
  `/ws` and `/events`, replacing `vite.config.ts`'s dev proxy;
- `client/web/playwright.novite.config.ts` — the same suite, that server;
- `dev/design/WEB_BUILD_TOOLING.md` — the full write-up.

## Two things worth knowing before anyone acts on this

**Removing Vite from the build does not remove it from `node_modules`.** `vitest`
depends on `vite`, and vstimd's node WebSocket e2e runs under vitest. So the
saving is one config file, not a dependency — which is why
`../../docs/BUILD_TOOLING.md` recommends keeping it.

**Node's native TS stripping does not rewrite `.js` → `.ts` specifiers**
(verified, Node 24.20 — `ERR_MODULE_NOT_FOUND`). vstimd's client uses NodeNext
style throughout, so "just use `node --test`" is not a small port.

## Two bugs found on the way

- esbuild with `write: false` and `sourcemap: true` returns **two** output files
  and the map is not last. Taking `outputFiles[0]` serves the sourcemap as the
  bundle, and the browser says `Unexpected token ':'`.
- vstimd's `playwright/smoke.spec.ts` hard-coded the backend port, so the suite
  could not run against a second backend. Now `SMOKE_BACKEND`, defaulted.
