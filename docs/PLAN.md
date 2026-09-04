# The braemons console — technical basis

The console is the one page an experimenter looks at: the display, the state
machine, and the trial logic of a rig, together, from a laptop rather than from
the one keyboard in the booth.

This document is the technical basis for it. Most of the architecture was
already decided in statemachined's [`dev/DAEMON.md`](https://github.com/braemons/statemachined)
§5, which specifies the `/elements/` contract and the mDNS record and names this
repo as their consumer. **This document does not relitigate that.** It records
what building a working two-daemon console against it showed — including four
things that do not work yet — and fills in the parts §5 left to this repo.

Everything below marked **verified** was run; see `experiments/`.

---

## 1. The shape

```
                    ┌──────────────────────────────────────────┐
   browser          │  console shell   nav · layout · status   │
                    │  (static, zero dependencies)             │
                    └───┬─────────────────┬────────────────┬───┘
      GET /api/rigs     │                 │ <script type=module>
   ┌────────────────────┘                 │                │
   │                          ┌───────────▼──────┐  ┌──────▼───────────┐
┌──▼─────────────┐            │ /elements/       │  │ /elements/       │
│ console helper │            │ statemachined.js │  │ vstimd.js        │
│ DNS-SD browse  │            ├──────────────────┤  ├──────────────────┤
│ + static files │            │  statemachined   │  │  vstimd          │
└──┬─────────────┘            │  FastAPI · JSON  │  │  axum · protobuf │
   │ avahi-browse             └──────────────────┘  └──────────────────┘
   ▼                                    ▲                    ▲
  mDNS                                  └── the panels talk ─┘
                                            straight to their own daemon
```

**The console holds no domain logic.** It knows tag names and URLs. It never
calls a daemon's API, never parses a snapshot and knows no field name from any
of the three protocols. Every pixel a person reads was rendered by an element the
owning daemon served, at that daemon's own version.

That is the property everything else is in service of, and it is worth being
explicit about *why*, because the tempting alternative — one app with a client
library per daemon — fails in a specific way. vstimd speaks protobuf over two
WebSockets; statemachined and triald speak JSON over HTTP. A console that
modelled all three would hold a copy of three schemas that change on three
release cadences, and would be wrong about a field the first time any of them
shipped. Here, a daemon that adds a field ships the panel that shows it, in the
same artefact, and the console does not know it happened.

**Verified**: `experiments/02-two-daemon-shell` puts three statemachined panels
and three vstimd panels on one page against a real Uno R4 board and a live
`vstimd --null`, and drives vstimd from inside the console (clicking `+ Rect` in
the embedded panel creates a stimulus on the daemon).

## 2. Custom elements, and what shadow roots buy and cost

The interop layer is custom elements with shadow roots, one `base` attribute,
every attribute a string. That is §5's decision and it holds up.

**What it buys, verified.** Six panels from two codebases on one page, no class
collisions, no shared framework, no build coupling. vstimd is React; the other
two are vanilla; nobody had to change. Wrapping React panels as elements cost
~40 lines (`experiments/02-two-daemon-shell/vstimd-elements/`) and changed
nothing inside the panels.

**What it costs, and this is not in §5: there is no theming.** Shadow roots stop
the console's CSS reaching in — which is the point — but they stop it reaching in
when it is *wanted* too. On one page, statemachined's panels are light and
vstimd's are dark, and it looks like what it is: two applications sharing a
scrollbar. See the screenshot in `experiments/02-two-daemon-shell/README.md`.

The fix is cheap and standard, and it has to be agreed **now**, while there are
two UIs and not five: **CSS custom properties inherit through shadow
boundaries.** So:

> Every braemons panel takes its palette from `--braemons-*` custom properties,
> with its own values as the fallback: `background: var(--braemons-panel-bg,
> #fff)`. A daemon serving its own UI standalone looks exactly as it does today.
> A console sets the properties once on `:root` and every panel on the page
> follows, through the shadow boundary, natively.

The console should publish that list of properties, and it is the one piece of
shared vocabulary the three UIs need. It is not a component library and must not
become one.

**A second, smaller gap: panels do not declare a size.** vstimd's map wants ~700
px; statemachined's line map wants the full width; the console currently
flex-wraps and guesses. An attribute or a custom property (`--braemons-panel-
width`, or a `size="wide|narrow"` attribute the panel reads) would settle it.
Lower priority than theming — the layout is wrong-looking, not wrong.

## 3. Why the console needs a host-side process

**A browser cannot browse DNS-SD.** It can resolve `rig.local`, because the OS
does that; there is no API to enumerate `_vstimd._tcp`. So §5's "a console
discovers a rig instead of being hand-configured with URLs" cannot be a page
served off a rig, and cannot be a page served off anything without a helper.

That helper is the console, and it is small: a static file server plus one route
that shells out to `avahi-browse -rpt` and returns JSON
(`experiments/02-two-daemon-shell/discovery.mjs`, ~90 lines, no dependencies).
It speaks to no daemon and holds no state, so it is never in the path of
anything a person is watching and a bug in it cannot make a rig look wrong.

Consequences worth writing down:

- **It runs on the experimenter's machine, not the rig** — that is what makes
  multi-rig work at all, and it is why `base` is an attribute.
- **It gives the console one stable origin**, which matters because every daemon
  then has one origin to allow through CORS rather than "whatever laptop".
- **`avahi-browse` rather than a zeroconf npm package**, so the console keeps
  zero dependencies (§6). A rig network already runs avahi; vstimd's `.deb`
  Recommends it. On a machine without it, discovery degrades to the configured
  list, which is the path a network with mDNS switched off takes anyway.
- **Configured rigs must exist as a first-class path**, not a debug flag. mDNS is
  off on plenty of networks, `.local` is hijacked by a corporate search domain on
  plenty more, and `--no-mdns` is a supported thing to do to a bench box.

## 4. The rig identity problem — the console cannot group daemons today

**This is the one thing that must be fixed in the daemons before a console can be
correct**, and it is not visible from either repo alone.

Both daemons publish a stable `id=`. They are constructed differently:

| daemon | `id=` | from |
|---|---|---|
| vstimd | `vstimd-a1b2c3` | the generated hostname, literal, in an Avahi `.service` file |
| statemachined | `4f2a…` (16 hex) | `sha256("statemachined:" + /etc/machine-id)[:16]`, from the daemon |

Both are correct for their own clients and **neither can be matched to the
other.** The hash is salted with the daemon's own name, so two daemons on one
physical box produce two unrelated strings *by construction*. A console grouping
on `id=` shows every rig twice, once per daemon, forever.

Three fixes, in order of preference:

1. **Add a `rig=` TXT record, published by every braemons daemon, salted
   `braemons:` rather than per-daemon** — `sha256("braemons:" + machine-id)[:16]`.
   Keep `id=` exactly as it is: it is a wire contract with existing clients and
   it answers a different question ("which vstimd"), which is worth keeping
   distinct from "which rig". This is a few lines in each daemon and it is the
   right answer.
2. Group by resolved host name. What `experiments/02` does today, and it is a
   guess: it says two daemons answering on one name are one rig, which is usually
   true and is not true behind a reverse proxy or on a box running two rigs'
   daemons. The experiment therefore **says on screen** when it fell back to
   this, because it is a claim on weaker evidence than it looks.
3. Configure it by hand. The escape hatch that has to exist regardless.

**Two smaller mDNS gaps, both vstimd's:**

- **The record points at the wrong port.** `_vstimd._tcp` advertises **5555, the
  ZMQ port**, and no path records at all. statemachined publishes `id`,
  `version`, `api`, `elements`, `device`, `port`. A console cannot find vstimd's
  web port, API or elements URL from mDNS today.
- **It is published by an Avahi `.service` template, not by the daemon**, so it
  cannot carry the port the server was actually told to listen on — which is
  exactly the reason statemachined publishes its own. vstimd should do the same,
  or at minimum render the web port into the template.

## 5. Degradation is the normal case

A person opens the console *because* something is wrong. So:

- **Every failure is per-daemon and none is fatal.** A rig with a dead vstimd
  still shows a live statemachined. **Verified**: with vstimd stopped, its three
  panels report `unreachable — retrying` and statemachined's three stay live.
- **"connecting" and "unreachable" are different words.** Found the hard way in
  experiment 02: a panel that knows only connected/not sits on `connecting…`
  indefinitely, which reads as *slow* when it means *absent*. A person deciding
  whether to walk to the booth is being told the wrong thing.
- **Panels reconnect on their own, with backoff.** A console is left open across
  the thing it is watching — a rig restarted between blocks, a daemon upgraded, a
  cable. **Verified**: an open page picks a restarted vstimd back up within ten
  seconds, no reload.
- **The console says which daemon went quiet**, by name and address. A rig-wide
  "connected" light would be lying about one of them.

## 6. Dependencies, and the build that is not here

**The console has no npm dependencies and no build step.** `index.html`,
`console.js`, `console.css`, and two node files using only built-ins. It should
stay that way, for triald's and statemachined's reason: a rig box may have no
route to the internet, and a browser in a booth must not wait on unpkg.

This is also the answer to "does the console need Vite": the question does not
arise, because the console bundles nothing. The build question belongs to each
daemon, and **only vstimd has one** — see `docs/BUILD_TOOLING.md` and vstimd's
`dev/design/WEB_BUILD_TOOLING.md` on the branch `explore/web-build-tooling`.

## 7. Security, which is a decision and not a discovery

triald binds localhost by default because a policy is Python running in the
daemon's process — remote code execution by design, deliberately. statemachined's
CORS is `*` today. A console is an argument for exposing all three daemons on the
rig network, and that argument should be made explicitly rather than arrived at
because the console needed it.

Not solved here, and the console must not pretend otherwise. What it can do
meanwhile: run on the experimenter's machine (so the daemons need only allow that
host), and never proxy a daemon's API, so it adds no new reachable surface of its
own. What has to be decided before this is deployed on a shared network: whether
`*` is acceptable for `/elements/` (probably; it is static JS) and for `/api/`
(probably not).

## 8. What is next, in order

1. **`rig=` in every daemon's TXT record** (§4). Nothing else is correct without
   it, and it is the smallest change here.
2. **vstimd: `/elements/vstimd.js` + CORS + a usable mDNS record** (§4, and
   vstimd's `WEB_BUILD_TOOLING.md` §5). The wrapper is written and working in
   `experiments/02`; it needs to move upstream, where it stops being a
   cross-repo hack and becomes a second build entry point.
3. **The `--braemons-*` theming contract** (§2), agreed while there are two UIs.
4. **triald `/elements/triald.js`** — the third daemon, still vanilla, still no
   build step.
5. **Promote `experiments/02` to the console proper**: rig switching, a layout
   that respects panel sizes, and the mDNS path exercised against real
   advertisements rather than `rigs.json`.

## Non-goals

- **Cross-daemon time correlation.** statemachined timestamps in its own clock,
  vstimd in vblanks, triald in trials. Aligning them is the record's job — the
  `.tdr` file and the trace — not a UI's. A console that drew one timeline would
  be inventing precision it does not have.
- **A component library, or a shared framework.** §2's custom-property list is
  the entire shared vocabulary. Anything more re-creates the coupling the
  elements contract exists to avoid.
- **Being in the data path.** The console proxies nothing and caches nothing.
- **Owning configuration.** A rig's settings live in the daemon that owns the
  hardware; the console shows that daemon's own editor for them.
