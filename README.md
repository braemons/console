# braemons console

One page for a rig: the display, the state machine, the trial logic and the
wheel together, from a laptop rather than from the one keyboard in the booth.

The console integrates the UIs of [vstimd](https://github.com/braemons/vstimd),
[statemachined](https://github.com/braemons/statemachined),
[triald](https://github.com/braemons/triald) and
[mousewheeld](https://github.com/braemons/mousewheeld) — and holds **no domain logic of
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
`docs/developer/daemon.md` §5 specifies the `/elements/` contract and the mDNS record, and
names this repo as their consumer.

## Running it

```sh
node serve.mjs          # http://127.0.0.1:9000
```

with any of `statemachined serve`, `triald serve`, `vstimd` and
`mousewheeld serve` running (`mousewheeld serve --simulate` needs no board).
A daemon that is not running shows up as a panel that says so.
`rigs.json` is where a rig goes if mDNS cannot find it — a supported path
(`docs/PLAN.md` §3), not only a fallback for this bench setup.

### As a package

`braemons-console` is in the braemons apt archive, and the braemons Raspberry
Pi image installs it. It runs as `braemons-console.service`, reads
`/etc/braemons/console-rigs.json` instead of `rigs.json`, and takes its
settings from `/etc/braemons/console.env`:

| setting | default | |
|---|---|---|
| `CONSOLE_HOST` | `127.0.0.1` | the Raspberry Pi image sets `0.0.0.0`, so `http://braemons-XXXXXX.local:9000` opens it from a laptop |
| `CONSOLE_PORT` | `9000` | |

```sh
make deb       # dist/braemons-console_<version>_all.deb
make check     # node --check every module
```

The version is the latest `v*` tag, or `CONSOLE_VERSION=...`. A tag builds the
release: `git tag v0.3.0-alpha1 && git push origin v0.3.0-alpha1`.

## What is on the page

Every panel is independently **reorderable** (drag its header), **resizable**
(drag its corner, optionally snapped to a grid), and can be **docked** (out of
the way, coming right back — the strip below the banner) or **hidden**
(further out, for the rest of the session — the tray under that). All of it
is remembered per rig. A panel's frame is coloured by which daemon it came
from, so four UIs on one page stay tellable apart at a glance without any of
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

All four daemons now advertise themselves over mDNS with a shared `rig=` record,
so the console groups one box's daemons as one rig without guessing from the
hostname. Each daemon advertises from inside itself while it runs; the box's
own name, `braemons-XXXXXX`, comes from the `braemons-rig` package.

`docs/PLAN.md` §8, what is left: a `--braemons-*` custom-property contract for
theming, agreed while there are four UIs; and rig switching exercised against
real mDNS advertisements rather than `rigs.json` alone.

## License

GNU AGPLv3-or-later, matching vstimd and triald. Copyright © 2026 Joscha Schmiedt,
University of Bremen.
