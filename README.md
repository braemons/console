# braemons console

One page for a rig: the display, the state machine, and the trial logic
together, from a laptop rather than from the one keyboard in the booth.

The console integrates the UIs of [vstimd](https://github.com/braemons/vstimd),
[statemachined](https://github.com/braemons/statemachined) and
[triald](https://github.com/braemons/triald) — and holds **no domain logic of its
own**. Every panel it shows is a custom element served by the daemon that owns
the hardware it is about, at that daemon's own version, talking to that daemon
directly. The console discovers the daemons, lays their panels out, and says
which of them answered.

> **Status: experiments.** Nothing here is deployed. `docs/PLAN.md` is the
> technical basis and `experiments/` is what was actually run against real
> hardware to check it — including four things that do not work yet. It is meant
> to be argued with.

## Read this first

- **[`docs/PLAN.md`](docs/PLAN.md)** — the technical basis. What the console is,
  why it holds no domain logic, why it needs a host-side process, and the rig
  identity problem that has to be fixed in the daemons before any console can be
  correct.
- **[`docs/BUILD_TOOLING.md`](docs/BUILD_TOOLING.md)** — does a braemons UI need
  Vite? (The console: the question does not arise. vstimd: no, and keep it
  anyway.)

The architecture is mostly not this repo's invention: statemachined's
`dev/DAEMON.md` §5 specifies the `/elements/` contract and the mDNS record, and
names this repo as their consumer. `docs/PLAN.md` records what building against
that showed.

## The experiments

| | |
|---|---|
| [`01-no-vite`](experiments/01-no-vite) | vstimd's whole browser suite passing with Vite removed — esbuild plus a 40-line dev server |
| [`02-two-daemon-shell`](experiments/02-two-daemon-shell) | a working console: statemachined and vstimd panels on one page, against a real board |

## Try experiment 02

```sh
cd experiments/02-two-daemon-shell
node build.mjs          # prototype vstimd elements (needs ../../../vstimd)
node serve.mjs          # http://127.0.0.1:9000
```

with a `statemachined serve` and a `vstimd --null --web-port 8150` running. See
that experiment's README for what it proves and what it fakes.

## What is next

`docs/PLAN.md` §8, shortest first: a shared `rig=` mDNS record so two daemons on
one box can be recognised as one rig; `/elements/vstimd.js` and CORS in vstimd;
and a `--braemons-*` custom-property contract for theming, agreed while there are
two UIs and not five.
