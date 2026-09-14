# braemons console

One page for a rig: the display, the state machine, and the trial logic
together, from a laptop rather than from the one keyboard in the booth.

The console integrates the UIs of [vstimd](https://github.com/braemons/vstimd),
[statemachined](https://github.com/braemons/statemachined) and
[triald](https://github.com/braemons/triald) — and holds **no domain logic of
its own**. Every panel it shows is a custom element served by the daemon that
owns the hardware it is about, at that daemon's own version, talking to that
daemon directly. The console discovers the daemons, lays their panels out, and
says which of them answered.

![The console: statemachined and vstimd panels on one page](two-daemon-console.png)

## Read this first

- **[`docs/PLAN.md`](docs/PLAN.md)** — the technical basis. What the console is,
  why it holds no domain logic, why it needs a host-side process, and the rig
  identity problem that still has to be fixed in the daemons before a console
  can be fully correct (§4, §8).
- **[`docs/FINDINGS.md`](docs/FINDINGS.md)** — what building the first working
  version of this actually showed, against a real Uno R4 Minima and a live
  `vstimd`: what worked, what it faked, and four things that were wrong and
  have since been fixed.
- **[`docs/BUILD_TOOLING.md`](docs/BUILD_TOOLING.md)** — does a braemons UI need
  Vite? (The console: the question does not arise. vstimd: no, and keep it
  anyway.)

The architecture is mostly not this repo's invention: statemachined's
`dev/DAEMON.md` §5 specifies the `/elements/` contract and the mDNS record, and
names this repo as their consumer.

## Running it

```sh
node serve.mjs          # http://127.0.0.1:9000
```

with a `statemachined serve`, a `triald serve` and a `vstimd` running.
`rigs.json` is where a rig goes if mDNS cannot find it — a supported path
(`docs/PLAN.md` §3), not only a fallback for this bench setup.

## What is on the page

Every panel is independently **reorderable** (drag its header), **resizable**
(drag its corner, optionally snapped to a grid), and can be **docked** (out of
the way, coming right back — the strip below the banner) or **hidden**
(further out, for the rest of the session — the tray under that). All of it
is remembered per rig. A panel's frame is coloured by which daemon it came
from, so three UIs on one page stay tellable apart at a glance without any of
them agreeing on a palette.

## Security

Every daemon is exposed on the rig network, and **the rig network is the security
boundary** — there is no authentication in any of them, and CORS is `*`. That is
a deliberate choice with one precondition: the rig network must be *isolated*,
not merely behind the institute firewall. `docs/PLAN.md` §7 says what it buys,
what it costs, and when it expires.

The console does not proxy any daemon's API and its helper binds loopback, so it
never becomes a route from a laptop's other networks into the rig's. Under this
decision that is a security property rather than a tidiness one.

## What is next

`docs/PLAN.md` §8, shortest first: a shared `rig=` mDNS record so two daemons on
one box can be recognised as one rig; a `--braemons-*` custom-property contract
for theming, agreed while there are three UIs; a usable mDNS record for vstimd
(port, `api`, `elements`); and rig switching exercised against real mDNS
advertisements rather than `rigs.json` alone.

## License

GNU AGPLv3-or-later, matching vstimd and triald. Copyright © 2026 Joscha Schmiedt,
University of Bremen.
