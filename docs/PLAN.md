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

Everything below marked **verified** was run; see docs/FINDINGS.md.

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

**Verified**: the console puts three statemachined panels
and three vstimd panels on one page against a real Uno R4 board and a live
`vstimd --null`, and drives vstimd from inside the console (clicking `+ Rect` in
the embedded panel creates a stimulus on the daemon).

## 2. Custom elements, and what shadow roots buy and cost

The interop layer is custom elements with shadow roots, one `base` attribute,
every attribute a string. That is §5's decision and it holds up.

**What it buys, verified.** Six panels from two codebases on one page, no class
collisions, no shared framework, no build coupling. vstimd is React; the other
two are vanilla; nobody had to change. Wrapping React panels as elements cost
~40 lines (`(moved upstream into vstimd's client/web/src/elements/)`) and changed
nothing inside the panels.

**What it costs, and this is not in §5: there is no theming.** Shadow roots stop
the console's CSS reaching in — which is the point — but they stop it reaching in
when it is *wanted* too. On one page, statemachined's panels are light and
vstimd's are dark, and it looks like what it is: two applications sharing a
scrollbar. See the screenshot in `docs/FINDINGS.md`.

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
(`discovery.mjs`, ~90 lines, no dependencies).
It speaks to no daemon and holds no state, so it is never in the path of
anything a person is watching and a bug in it cannot make a rig look wrong.

Consequences worth writing down:

- **It runs on the experimenter's machine, not the rig** — that is what makes
  multi-rig work at all, and it is why `base` is an attribute.
- **It does not give the daemons a stable origin to trust.** An earlier draft
  claimed this as a benefit; it is not one. The helper serves the shell, but the
  *browser* is what talks to each daemon, so a daemon still sees "whatever
  laptop" as the origin. That is settled by §7 (CORS `*`, network-level
  security), not by the helper.
- **`avahi-browse` rather than a zeroconf npm package**, so the console keeps
  zero dependencies (§6). A rig network already runs avahi; `braemons-rig`
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
2. Group by resolved host name. What the console does today, and it is a
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

## 7. Security: the network is the boundary

**Decided: every daemon is exposed on the rig network, and security is enforced
at the network level rather than in the daemons.** No per-daemon authentication,
no token, no per-origin CORS allowlist. For now.

This is a real choice and not an omission, so it is worth writing down what it
buys, what it costs, and the condition it depends on.

**What it buys.** The console works. A console runs on whatever laptop the
experimenter carried into the room, which means a daemon cannot know its origin
in advance — so `*` on `/elements/` and `/api/` is not a shortcut here, it is the
only thing that works without a registration step nobody wants to operate. It
also means no credential has to be distributed to, stored on, or rotated across
a set of rig boxes, which is the part of "just add auth" that actually costs
something in a lab.

**What it costs, stated plainly.** Anyone with a route to the rig network can:

- run arbitrary Python in triald's process — a policy is remote code execution
  *by design*, and that is the daemon's whole point;
- drive the valve and every other output line through statemachined;
- change what is on the screen in front of an animal, mid-session.

There is no defence against any of that inside the daemons, by this decision.

**The condition this rests on: the rig network is isolated.** Not "behind the
institute firewall" — isolated: its own segment or VLAN, no route from the
general network, no port forwarding. If that stops being true, this section
expires and the daemons need something real. It is the *only* control, so it
should be the deliberate kind rather than the assumed kind.

**Two consequences for the console specifically**, both of which make it *more*
important that the console holds no domain logic and proxies nothing (§1, §3):

- **The console must never become a bridge.** It runs on the experimenter's
  machine, which is frequently a laptop with a route to the wider network as
  well. A console that proxied a daemon's API would be exactly the hole this
  decision assumes does not exist — one hop from anywhere the laptop can reach
  into the rig network. It does not proxy: the browser talks to each daemon
  directly, and the helper (§3) serves static files and a DNS-SD browse and
  nothing else. **This is now a security property, not just a tidiness one.**
- **The helper binds loopback.** `127.0.0.1`, not `0.0.0.0`, because it has no
  reason to be reachable and the machine it runs on is the least trusted thing
  in the picture.
  **The exception is a console on the rig itself.** The Raspberry Pi image
  installs `braemons-console` and sets `CONSOLE_HOST=0.0.0.0`, so a laptop
  opens the console from the rig. That box is on the rig network already and
  serves four daemons on it; the console adds a static page and a DNS-SD
  browse, and still proxies nothing, so it does not widen what is reachable.

**What changes if a daemon is ever reached from outside the rig network** — a
recording from home, a second site — is a VPN or an authenticating reverse proxy
in front of the whole segment, not authentication added to three daemons in three
languages. Keeping the boundary in one place is the thing this decision is
actually choosing.

### 7.1 If a rig ever leaves an isolated network

**Not planned: rigs run on isolated lab networks, and §7 stands.** This is the
concept for the day that stops being true, written down now so that nothing
built in the meantime makes it expensive. Tracked in
braemons/console#2.

The tempting answer is to expose only the console, since one thing is easier to
secure than five. It does not survive contact with how rigs are used: people
drive the daemons from Python, over gRPC, without a browser anywhere. So the
daemons' APIs have to be reachable from off the box regardless, and the question
is what stands in front of them.

**One authenticating gateway on the rig, and daemons that stay as they are.**

```
laptop browser ─┐                          ┌─ vstimd        127.0.0.1
Python client ──┼─ TLS + token ─▶ gateway ─┼─ statemachined 127.0.0.1
                │     :443       (Envoy /  ├─ triald        127.0.0.1
                │                 Caddy)   └─ mousewheeld   127.0.0.1
```

- **The daemons bind loopback and do no authentication.** Authentication done
  once, in a proxy that exists to do it, rather than four times in Rust and
  Python by people whose job is stimulus timing. This is §7's last paragraph,
  made concrete.
- **gRPC goes through one port.** Every call's path is
  `/package.Service/Method`, so the gateway routes by service name. A Python
  client changes its channel and nothing else:
  ```python
  creds = grpc.composite_channel_credentials(
      grpc.ssl_channel_credentials(ca_pem),
      grpc.access_token_call_credentials(token))
  channel = grpc.secure_channel("rig-b16b46.lab.example:443", creds)
  ```
- **HTTP goes through it by path prefix** — `/vstimd/…`, `/triald/…` — and so
  does the console. Everything the browser loads then has one origin, so
  `CORS: *` goes away rather than being narrowed, and a login page on the
  gateway can set a cookie. That is also what covers WebSockets
  (`/api/trace/stream`), which cannot carry an `authorization` header from a
  browser.
- **This does not make the console a bridge** (§7). The gateway is the
  boundary, on the rig, deliberately; the console still proxies nothing.

**Authentication: a token, with client certificates as the stronger option.**

- *Bearer tokens* first. A few random tokens per rig in a root-only file under
  `/etc/braemons/`, sent as `authorization: Bearer …` in gRPC metadata or an
  HTTP header. Easy to hand to a student, easy to revoke, and useless without
  TLS — anyone on the segment reads them otherwise.
- *mTLS* for scripts and long-lived clients, which gRPC supports natively.
  Client certificates in browsers are miserable to install, so not for people.
- *Server certificates* from a small lab CA (`step-ca`, or a script in
  `braemons-rig` issuing one per rig), whose root is installed on lab laptops
  once. `.local` names cannot have public certificates, and a rig on a bigger
  network needs a real DNS name anyway.

**Authorization: two levels, and no more.** Roles and rights management are a
non-goal.

- *observer*: reads — state, trace streams, counters.
- *operator*: everything else.

Enforced in the gateway by method name, from a short list. **triald's policy
upload is a separate switch, off from the network by default**: it is remote
code execution by design (§7), and "operator" should not quietly include "can
run Python as the rig".

**What the gateway does not cover.**

- **ZeroMQ.** vstimd (5555, 5556) and mousewheeld (5557) publish over ZMQ,
  which an HTTP/gRPC proxy cannot carry. Keep those on loopback if outside
  clients only need gRPC, which is the simpler answer; ZMQ's CURVE is the
  answer if they do not.
- **mDNS.** It does not cross subnets, and on a shared network it tells
  everyone what runs where. Such a rig is started with `--no-mdns` and listed in
  `console-rigs.json` (§3).

**Cheaper steps before any of it.** A VPN (WireGuard, Tailscale) into the rig
network changes no code and is usually the right answer to "reach the rig from
my office". The gateway is for a rig that has to *sit on* a shared network.

**What to keep true now, so this stays cheap:**

1. Every daemon can bind loopback (`--host`), and nothing hard-codes `0.0.0.0`.
2. Every panel honours `base` exactly as given, **including a path** —
   `https://rig/vstimd`, not only `http://rig:8080`. The `/elements/` contract
   already says `base`; it has to mean it.
3. Clients accept a TLS channel and a token, even while nothing checks them.

## 8. What is next, in order

**Done since this document's last update:**

- **vstimd serves its own `/elements/vstimd.js`, with CORS**, from
  `client/web/src/elements/vstimd_elements.tsx` — a second Vite entry
  (`vite.elements.config.ts`, library mode, one self-contained ES module) built
  alongside the main app and embedded the same way. The console-side stand-in
  this used to be (`vstimd-elements/`, `build.mjs`) is gone; `rigs.json` now
  points at vstimd's own daemon like it does for the other two. What is still
  open: a usable mDNS record for it (§4 — the port and path records vstimd's
  `.service` template does not carry).
- **triald `/elements/triald.js`** — six panels (session, sets, counters,
  trial log, config, the simulated-subject bench), the third daemon no longer
  the odd one out. triald's own page (`/`) is built from the same six
  elements now too, so there is one implementation of each panel, not two that
  can drift.
- **The layout respects panel sizes, and then some.** Every panel is
  independently reorderable (drag its header) and resizable (native `resize:
  both`, optionally snapped to a grid), and can be docked or hidden and
  brought back — all remembered per rig. Still a guess made by the console's
  own frame, not a size the panel declares (§2's `--braemons-panel-width`
  idea remains undone), but no longer "the console flex-wraps and guesses"
  with no way to fix it by hand.

**Still open, in order:**

1. **`rig=` in every daemon's TXT record** (§4). Nothing else is correct without
   it, and it is the smallest change here.
2. **The `--braemons-*` theming contract** (§2), agreed while there are three
   UIs and it is still cheap: statemachined is light, vstimd is dark, triald's
   own colours are whatever this repo just picked for the console's frame
   around it. Panel *content* still cannot be made to match across a shadow
   root without it.
3. **vstimd's mDNS record** (§4): still the ZMQ port, no `api`/`elements`/web
   port, and from a `.service` template that cannot know the port the server
   was actually given — same problem `rig=` has, same fix shape.
4. **Rig switching against real mDNS advertisements**, exercised against more
   than one rig, rather than `rigs.json` alone. `rigs.json` stays regardless —
   configured rigs are a first-class path (§3), not only a fallback.

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
