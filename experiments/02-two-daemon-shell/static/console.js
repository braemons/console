// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * The console shell, in one file and no framework.
 *
 * It does four things and refuses the fifth:
 *
 *   1. asks the host helper which daemons are on the network (/api/rigs),
 *   2. groups them into rigs and puts a tab per rig in the nav,
 *   3. imports each daemon's `/elements/` module and places its panels,
 *   4. says, per daemon, whether that import worked.
 *
 * The fifth is domain logic, and there is none here on purpose. This file never
 * calls a daemon's API, never parses a snapshot, and knows no field name from
 * any of the three protocols -- vstimd's protobuf, statemachined's JSON, or
 * triald's. It knows tag names and a URL. Everything a person reads on this
 * page was rendered by an element the owning daemon served, at that daemon's own
 * version, which is what keeps the console from drifting the first time a field
 * changes.
 */

const nav = document.getElementById("rig-nav");
const panels = document.getElementById("panels");
const discoveryState = document.getElementById("discovery-state");
const banner = document.getElementById("banner");

function showBanner(message, kind = "error") {
  banner.textContent = message;
  banner.className = kind === "info" ? "banner info" : "banner";
  banner.hidden = false;
}

/*
 * What the shell knows about a daemon, keyed by its service type.
 *
 * This table is the console's *entire* daemon-specific surface, and keeping it
 * this small is the design working. A new daemon is a row: the tags it offers,
 * and where its module lives when the TXT record does not say.
 *
 * The tag lists are a fallback. A daemon's module exports its own names
 * (`STATEMACHINED_ELEMENT_NAMES`, `VSTIMD_ELEMENT_NAMES`) precisely so a console
 * does not hard-code a list that goes stale when a panel is added, and the
 * loader below prefers that export. These are what to show when it is absent --
 * an older daemon, say -- and they are deliberately the *few* panels a rig-wide
 * view wants rather than every panel the daemon has.
 */
const DAEMONS = {
  "_statemachined._tcp": {
    name: "statemachined",
    elements: "/elements/statemachined.js",
    namesExport: "STATEMACHINED_ELEMENT_NAMES",
    preferred: ["statemachined-device", "statemachined-session", "statemachined-lines"],
  },
  "_vstimd._tcp": {
    name: "vstimd",
    elements: "/elements/vstimd.js",
    namesExport: "VSTIMD_ELEMENT_NAMES",
    preferred: ["vstimd-map", "vstimd-stimuli", "vstimd-lines"],
  },
  "_triald._tcp": {
    name: "triald",
    elements: "/elements/triald.js",
    namesExport: "TRIALD_ELEMENT_NAMES",
    preferred: ["triald-session"],
  },
};

/** The daemon's origin, as a browser has to address it. */
function baseUrlFor(daemon) {
  const host = daemon.host || daemon.address;
  return `http://${host}:${daemon.port}`;
}

/**
 * Where the module is.
 *
 * From the TXT record when there is one, and from the table above when there is
 * not -- because a daemon behind a proxy is not at the conventional path, which
 * is the whole reason statemachined puts `elements=` in the record rather than
 * letting a console assume. An absolute value in the record wins outright.
 */
function elementsUrlFor(daemon, spec) {
  const declared = daemon.txt?.elements ?? spec.elements;
  return /^https?:/.test(declared) ? declared : baseUrlFor(daemon) + declared;
}

/**
 * Load one daemon's elements and place its panels.
 *
 * Every failure here is per-daemon and none of them is fatal. A rig with a dead
 * vstimd must still show a live statemachined, because the person looking at
 * this page is usually looking at it *because* something is wrong, and a
 * console that blanks itself when one daemon goes quiet is at its least useful
 * exactly when it is needed. So: the slot is created first, then filled or
 * marked.
 */
async function mountDaemon(daemon) {
  const spec = DAEMONS[daemon.service];
  if (!spec) return; // A braemons service this console does not know. Not an error.

  const base = baseUrlFor(daemon);
  const slots = spec.preferred.map((tag) => makeSlot(spec.name, tag, base, daemon));

  let module;
  try {
    module = await import(/* @vite-ignore */ elementsUrlFor(daemon, spec));
  } catch (error) {
    // Almost always one of two things, and they are worth telling apart in the
    // message because the fixes are unrelated: the daemon is down (connection
    // refused), or it is up and serving `/elements/` without CORS, which a
    // cross-origin module script requires and which a same-origin UI never
    // needed. vstimd is in the second state today; see docs/PLAN.md §5.
    for (const slot of slots) markSlot(slot, "bad", "no elements");
    showBanner(`${spec.name} at ${base}: could not load its elements — ${error.message}`);
    return;
  }

  // The daemon's own list wins over ours, so adding a panel upstream needs no
  // change here.
  const offered = module[spec.namesExport] ?? spec.preferred;
  for (const slot of slots) {
    if (!offered.includes(slot.dataset.tag)) {
      markSlot(slot, "bad", "not offered");
      continue;
    }
    const element = document.createElement(slot.dataset.tag);
    // `base` and not same-origin, because the console is not served from the
    // rig. This attribute is the whole integration contract.
    element.setAttribute("base", base);
    slot.querySelector(".slot-body").replaceChildren(element);
    markSlot(slot, "ok", "loaded");
  }
}

function makeSlot(daemonName, tag, base, daemon) {
  const slot = document.createElement("section");
  slot.className = "slot";
  slot.dataset.tag = tag;
  slot.innerHTML = `
    <div class="slot-head">
      <span class="daemon"></span>
      <span class="tag"></span>
      <span class="state muted">loading…</span>
    </div>
    <div class="slot-body"><p class="muted">waiting for ${base}</p></div>`;
  slot.querySelector(".daemon").textContent = daemonName;
  slot.querySelector(".tag").textContent = tag;
  slot.title = `${daemonName} at ${base} (${daemon.origin})`;
  panels.append(slot);
  return slot;
}

function markSlot(slot, kind, text) {
  const state = slot.querySelector(".state");
  state.textContent = text;
  state.className = `state ${kind}`;
}

/** Draw one rig: clear the panels, then mount every daemon on it at once. */
function showRig(rig) {
  panels.replaceChildren();
  for (const button of nav.children) button.setAttribute("aria-current", String(button.dataset.key === rig.key));

  if (rig.grouping === "resolved-host") {
    // Say so. Grouping by host is a guess that two daemons answering on one
    // name are one rig, and it is the only evidence available until the daemons
    // publish a shared `rig=` record (docs/PLAN.md §4). It is usually right and
    // it is not always right.
    showBanner(
      `Grouped ${rig.daemons.length} daemons as one rig by host name (${rig.host}) — ` +
        `no shared rig= record. See docs/PLAN.md §4.`,
      "info",
    );
  }

  for (const daemon of rig.daemons) mountDaemon(daemon);

  const note = document.createElement("p");
  note.className = "note";
  note.textContent =
    "Every panel above was served by the daemon it belongs to and talks to that daemon directly. " +
    "The console holds no domain logic: it discovered these, laid them out, and said whether they loaded.";
  panels.append(note);
}

async function main() {
  let payload;
  try {
    payload = await fetch("/api/rigs").then((r) => r.json());
  } catch (error) {
    discoveryState.textContent = "discovery failed";
    return showBanner(`Could not reach the console helper: ${error.message}`);
  }

  const { rigs, problems } = payload;
  discoveryState.textContent = `${rigs.length} rig${rigs.length === 1 ? "" : "s"}`;
  if (problems.length) {
    showBanner(`mDNS browse failed (${problems.map((p) => p.type).join(", ")}); showing configured rigs only.`, "info");
  }
  if (!rigs.length) {
    return showBanner("No rigs found. Start a daemon, or add one to rigs.json.", "info");
  }

  for (const rig of rigs) {
    const button = document.createElement("button");
    button.textContent = rig.host ?? rig.key;
    button.dataset.key = rig.key;
    button.addEventListener("click", () => showRig(rig));
    nav.append(button);
  }
  showRig(rigs[0]);
}

main();
