// SPDX-License-Identifier: AGPL-3.0-or-later
// Finding the daemons on a rig, on behalf of a browser that cannot.
//
// **This is why the console needs a host-side process at all.** A browser can
// resolve `rig.local` (the OS does it), but it cannot *browse* DNS-SD: there is
// no API to enumerate `_vstimd._tcp`. So "a console discovers a rig instead of
// being hand-configured with URLs" -- statemachined's dev/DAEMON.md §5 -- cannot
// be a page served off a rig. Something local has to browse and tell it.
//
// That something is small: this file plus a static file server. It holds no
// domain logic and speaks to no daemon; it converts a DNS-SD browse into JSON
// and stops. See docs/PLAN.md §3.
//
// avahi-browse rather than a zeroconf library, because the console needs no
// npm dependencies at all this way, and because a rig box already runs
// avahi-daemon -- vstimd's packaging Recommends it.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The braemons service types. Adding a daemon is adding a line. */
export const SERVICE_TYPES = [
  "_vstimd._tcp",
  "_statemachined._tcp",
  "_triald._tcp",
  "_mousewheeld._tcp",
];

/**
 * One `avahi-browse -rpt` line, which is `;`-separated and shell-unfriendly:
 *
 *   =;enp4s0;IPv4;rig-a1b2;_statemachined._tcp;local;rig.local;10.0.1.42;8081;"id=..." "port=..."
 *
 * Only `=` lines are resolved; `+` lines are a name with no address yet.
 */
function parseBrowseLine(line) {
  const f = line.split(";");
  if (f[0] !== "=" || f.length < 10) return null;
  const txt = {};
  for (const m of f.slice(9).join(";").matchAll(/"([^"=]+)=([^"]*)"/g)) txt[m[1]] = m[2];
  return {
    service: f[4],
    displayName: f[3],
    host: f[6],
    address: f[7],
    port: Number(f[8]),
    txt,
  };
}

/**
 * Which rig a service belongs to.
 *
 * **The `id=` TXT record cannot answer this**, and that is the finding this
 * experiment exists to record. vstimd publishes `id=vstimd-a1b2c3` (its
 * generated hostname); statemachined publishes
 * `sha256("statemachined:" + machine-id)[:16]`. Both are stable and both are
 * correct for their own clients -- and on one physical rig they are two
 * unrelated strings, by construction, because the salt is the daemon's own
 * name. Grouping on `id=` shows every rig twice, once per daemon.
 *
 * So: group on `rig=` if the daemons ever publish one (docs/PLAN.md §4
 * proposes it, with a salt that is `braemons:` rather than the daemon's name),
 * and otherwise on the resolved host, which is what is actually available
 * today. The fallback is reported rather than hidden, because "these two panels
 * are the same box" is a claim the console is making on weaker evidence than it
 * looks, and a person moving a board between rigs deserves to know that.
 */
function rigKeyFor(service) {
  if (service.txt.rig) return { key: `rig:${service.txt.rig}`, grouping: "rig-txt-record" };
  return { key: `host:${service.host || service.address}`, grouping: "resolved-host" };
}

/** Browse one service type. A type nobody advertises is not an error. */
async function browse(type) {
  try {
    const { stdout } = await run("avahi-browse", ["-rpt", type], { timeout: 5000 });
    return stdout.split("\n").map(parseBrowseLine).filter(Boolean);
  } catch (error) {
    // avahi-browse missing, or avahi-daemon down. Neither is fatal: the
    // configured rigs below still work, which is the path a network with mDNS
    // switched off has to take anyway.
    return { error: String(error.message ?? error), type };
  }
}

/**
 * Every rig this console can see, discovered and configured together.
 *
 * `configured` entries are the escape hatch that has to exist: mDNS is off on
 * plenty of networks, `.local` is hijacked by a corporate search domain on
 * plenty more, and a daemon started with `--no-mdns` is a supported thing to
 * do. They are merged into the same shape so the shell has one code path.
 */
export async function discoverRigs(configured = []) {
  const results = await Promise.all(SERVICE_TYPES.map(browse));
  const problems = results.filter((r) => !Array.isArray(r));
  const services = results.filter(Array.isArray).flat();

  const rigs = new Map();
  const add = (service, origin) => {
    const { key, grouping } = rigKeyFor(service);
    if (!rigs.has(key)) rigs.set(key, { key, grouping, host: service.host, daemons: [] });
    rigs.get(key).daemons.push({ ...service, origin });
  };

  for (const s of services) add(s, "mdns");
  for (const c of configured) {
    const url = new URL(c.base);
    add(
      {
        service: `_${c.daemon}._tcp`,
        displayName: c.name ?? url.hostname,
        host: url.hostname,
        address: url.hostname,
        port: Number(url.port),
        // `elements` is where the module lives. It is a TXT record on a
        // discovered daemon for a reason -- a proxy can move it -- so a
        // configured one has to be able to say it too.
        txt: { elements: c.elements, api: c.api ?? "/api", rig: c.rig },
      },
      "configured",
    );
  }

  return { rigs: [...rigs.values()], problems };
}
