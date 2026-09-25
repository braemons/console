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
const hiddenTray = document.getElementById("hidden-tray");
const dock = document.getElementById("dock");
const resetLayoutButton = document.getElementById("reset-layout");
const minimizeControls = document.getElementById("minimize-controls");
const snapToGridCheckbox = document.getElementById("snap-to-grid");

/*
 * Snap-to-grid is a workflow preference, not a rig's arrangement -- it says
 * how *this person* likes to resize things, on any rig -- so it lives outside
 * the per-rig layout object and under its own key.
 */
const GRID_SIZE_PX = 20;
panels.style.setProperty("--grid-size", `${GRID_SIZE_PX}px`);

function snapToGridEnabled() {
  try {
    return globalThis.localStorage.getItem("console.snapToGrid") === "yes";
  } catch {
    return false;
  }
}

function setSnapToGrid(enabled) {
  try {
    globalThis.localStorage.setItem("console.snapToGrid", enabled ? "yes" : "no");
  } catch {
    /* the checkbox still reflects it for this visit */
  }
  panels.classList.toggle("snap-grid", enabled);
}

function snapPx(value) {
  return Math.round(value / GRID_SIZE_PX) * GRID_SIZE_PX;
}

snapToGridCheckbox.checked = snapToGridEnabled();
setSnapToGrid(snapToGridCheckbox.checked);
snapToGridCheckbox.addEventListener("change", (event) => setSnapToGrid(event.target.checked));

/*
 * Layout: drag a panel's header to reorder it, drag its bottom-right corner
 * to resize it. Both are the platform doing the work -- HTML5 drag-and-drop
 * and CSS `resize: both` -- so this stays inside "no framework" the same way
 * a panel's own fold-state remembers itself with plain localStorage.
 *
 * Per rig, not global: a bench rig's arrangement has nothing to say about a
 * different rig's panels, which may not even be the same daemons.
 */
let currentRigKey = null;
let currentRig = null;
let draggingSlot = null;

function layoutStorageKey(rigKey) {
  return `console.layout.${rigKey}`;
}

function loadLayout(rigKey) {
  try {
    const raw = globalThis.localStorage.getItem(layoutStorageKey(rigKey));
    if (raw) return { order: [], sizes: {}, docked: [], hidden: [], ...JSON.parse(raw) };
  } catch {
    /* a private window, or the value is not what we wrote */
  }
  return { order: [], sizes: {}, docked: [], hidden: [] };
}

/// The daemon a tag belongs to, for colouring a chip that has no `.slot` to
/// read `data-daemon` from -- every tag is `${daemon}-...` by convention.
function daemonOf(tag) {
  return tag.split("-")[0];
}

function saveLayout(rigKey, layout) {
  try {
    globalThis.localStorage.setItem(layoutStorageKey(rigKey), JSON.stringify(layout));
  } catch {
    /* nothing to remember it with; the arrangement still holds for this visit */
  }
}

/** Reorder the mounted slots to match what was saved for this rig, if anything was. */
function applySavedOrder(rigKey, note) {
  const { order } = loadLayout(rigKey);
  if (order.length === 0) return;
  const remaining = new Map([...panels.querySelectorAll(".slot")].map((slot) => [slot.dataset.tag, slot]));
  const ordered = [];
  for (const tag of order) {
    const slot = remaining.get(tag);
    if (slot) {
      ordered.push(slot);
      remaining.delete(tag);
    }
  }
  // A panel this rig has that the saved layout does not -- new since it was
  // arranged -- keeps its mounted position among the leftovers.
  ordered.push(...remaining.values());
  panels.replaceChildren(...ordered, note);
}

function applySavedSize(slot, tag) {
  const { sizes } = loadLayout(currentRigKey);
  const size = sizes[tag];
  if (!size) return;
  slot.style.width = `${size.width}px`;
  slot.style.height = `${size.height}px`;
}

/**
 * Persist a resize once it settles, via the one platform API that reports it.
 *
 * Snapping happens here rather than during the drag: `resize: both` is the
 * browser's own handle, with no hook to intercept mid-drag, so instead the
 * box is nudged to the nearest grid cell right after the person lets go --
 * still a snap, just after the fact rather than during. Setting the style
 * here fires this same observer again with the now-snapped size, which is
 * harmless: it is already a multiple of the grid and rounds to itself.
 */
function observeResize(slot, tag) {
  if (typeof ResizeObserver === "undefined") return; // every browser this UI targets has it
  let debounce = null;
  new ResizeObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (!slot.isConnected || currentRigKey === null) return; // rig switched mid-debounce
      const rect = slot.getBoundingClientRect();
      let width = Math.round(rect.width);
      let height = Math.round(rect.height);
      if (snapToGridEnabled()) {
        width = Math.max(GRID_SIZE_PX * 2, snapPx(width));
        height = Math.max(GRID_SIZE_PX * 2, snapPx(height));
        slot.style.width = `${width}px`;
        slot.style.height = `${height}px`;
      }
      const layout = loadLayout(currentRigKey);
      layout.sizes[tag] = { width, height };
      saveLayout(currentRigKey, layout);
    }, 400);
  }).observe(slot);
}

function persistOrder() {
  if (currentRigKey === null) return;
  const layout = loadLayout(currentRigKey);
  layout.order = [...panels.querySelectorAll(".slot")].map((slot) => slot.dataset.tag);
  saveLayout(currentRigKey, layout);
}

/*
 * Docking and hiding are the same mechanism -- the panel's custom element is
 * torn down, not merely covered, because `disconnectedCallback` is where a
 * panel gives back a daemon's attention and a shrunk-but-mounted one would
 * keep polling for nobody -- shown in two different chip rows so how
 * deliberately put away something is stays visible. A dock is for "out of
 * the way for a moment, coming right back"; hidden is further out, for the
 * rest of the session.
 */
function moveToList(listName, tag, add) {
  if (currentRigKey === null || currentRig === null) return;
  const layout = loadLayout(currentRigKey);
  layout[listName] = add
    ? [...new Set([...layout[listName], tag])]
    : layout[listName].filter((each) => each !== tag);
  saveLayout(currentRigKey, layout);
  showRig(currentRig);
}

const dockPanel = (tag) => moveToList("docked", tag, true);
const undockPanel = (tag) => moveToList("docked", tag, false);
const hidePanel = (tag) => moveToList("hidden", tag, true);
const unhidePanel = (tag) => moveToList("hidden", tag, false);

/** The escape hatch: everything remembered about this rig's arrangement,
 * gone. For when a panel went missing and it is not obvious why -- rather
 * than somebody hunting through two chip rows for it. */
resetLayoutButton.addEventListener("click", () => {
  if (currentRigKey === null || currentRig === null) return;
  try {
    globalThis.localStorage.removeItem(layoutStorageKey(currentRigKey));
  } catch {
    /* nothing was remembered to begin with */
  }
  showRig(currentRig);
});

/** Dock a set of tags in one go, for "minimize everything" and "minimize
 * just this source" alike -- both are the same act on a different list. */
function dockTags(tags) {
  if (currentRigKey === null || currentRig === null || tags.length === 0) return;
  const layout = loadLayout(currentRigKey);
  layout.docked = [...new Set([...layout.docked, ...tags])];
  saveLayout(currentRigKey, layout);
  showRig(currentRig);
}

function tagsMountedFrom(daemonName) {
  const selector = daemonName === null ? ".slot" : `.slot[data-daemon="${daemonName}"]`;
  return [...panels.querySelectorAll(selector)].map((slot) => slot.dataset.tag);
}

/** One "minimize all" button plus one per source actually on screen right
 * now -- rebuilt on every mount, since which daemons are present is a rig
 * fact, not a fixed list this file should hard-code. */
function renderMinimizeControls() {
  const daemons = [...new Set([...panels.querySelectorAll(".slot")].map((slot) => slot.dataset.daemon))].sort();
  const allButton = document.createElement("button");
  allButton.textContent = "minimize all";
  allButton.title = "dock every panel on screen";
  allButton.addEventListener("click", () => dockTags(tagsMountedFrom(null)));

  const perSource = daemons.map((name) => {
    const button = document.createElement("button");
    button.dataset.daemon = name;
    button.textContent = `minimize ${name}`;
    button.title = `dock every ${name} panel`;
    button.addEventListener("click", () => dockTags(tagsMountedFrom(name)));
    return button;
  });

  minimizeControls.replaceChildren(allButton, ...perSource);
}

function renderChipRow(container, label, tags, onRestore) {
  container.hidden = tags.length === 0;
  if (tags.length === 0) return;
  const labelEl = document.createElement("span");
  labelEl.className = "dock-label";
  labelEl.textContent = label;
  const buttons = tags.map((tag) => {
    const button = document.createElement("button");
    button.dataset.daemon = daemonOf(tag);
    button.textContent = `▸ ${tag}`;
    button.title = "bring back";
    button.addEventListener("click", () => onRestore(tag));
    return button;
  });
  container.replaceChildren(labelEl, ...buttons);
}

function renderDock() {
  renderChipRow(dock, "docked:", currentRigKey === null ? [] : loadLayout(currentRigKey).docked, undockPanel);
}

function renderHiddenTray() {
  renderChipRow(hiddenTray, "hidden:", currentRigKey === null ? [] : loadLayout(currentRigKey).hidden, unhidePanel);
}

/** The mounted slot whose centre is nearest a point, for a drag in a wrapped grid. */
function slotNearest(x, y) {
  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const slot of panels.querySelectorAll(".slot")) {
    if (slot === draggingSlot) continue;
    const rect = slot.getBoundingClientRect();
    const dx = x - (rect.left + rect.width / 2);
    const dy = y - (rect.top + rect.height / 2);
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = slot;
    }
  }
  return nearest;
}

// Wired once: `panels` itself is never replaced, only its children, so this
// survives every rig switch.
panels.addEventListener("dragover", (event) => {
  if (draggingSlot === null) return;
  event.preventDefault(); // required for `drop` to fire at all
  const target = slotNearest(event.clientX, event.clientY);
  if (target === null || target === draggingSlot) return;
  const rect = target.getBoundingClientRect();
  const insertAfter = event.clientX > rect.left + rect.width / 2;
  panels.insertBefore(draggingSlot, insertAfter ? target.nextSibling : target);
});
panels.addEventListener("drop", (event) => event.preventDefault());

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
 * (`STATEMACHINED_ELEMENT_NAMES`, `VSTIMD_ELEMENT_NAMES`, …) precisely so a console
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
  "_mousewheeld._tcp": {
    name: "mousewheeld",
    elements: "/elements/mousewheeld.js",
    namesExport: "MOUSEWHEELD_ELEMENT_NAMES",
    preferred: ["mousewheeld-device", "mousewheeld-trace", "mousewheeld-zones"],
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

  let module;
  try {
    module = await import(/* @vite-ignore */ elementsUrlFor(daemon, spec));
  } catch (error) {
    // Almost always one of two things, and they are worth telling apart in the
    // message because the fixes are unrelated: the daemon is down (connection
    // refused), or it is up and serving `/elements/` without CORS, which a
    // cross-origin module script requires and which a same-origin UI never
    // needed. There is no `offered` list to show slots for -- the module never
    // loaded -- so `preferred` names what a person would otherwise have seen.
    for (const tag of spec.preferred) markSlot(makeSlot(spec.name, tag, base, daemon), "bad", "no elements");
    showBanner(`${spec.name} at ${base}: could not load its elements — ${error.message}`);
    return;
  }

  // Every tag the daemon's own module offers, not a curated subset -- adding
  // a panel upstream needs no change here. `preferred` is only the fallback
  // for a module that predates the export.
  const offered = module[spec.namesExport] ?? spec.preferred;
  const { hidden, docked } = loadLayout(currentRigKey ?? "");
  for (const tag of offered) {
    if (hidden.includes(tag) || docked.includes(tag)) continue; // put away: not mounted, not polling
    const slot = makeSlot(spec.name, tag, base, daemon);
    const element = document.createElement(tag);
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
  slot.dataset.daemon = daemonName; // read by console.css for the source colour
  slot.innerHTML = `
    <div class="slot-head">
      <span class="daemon"></span>
      <span class="tag"></span>
      <span class="state muted">loading…</span>
      <button type="button" class="head-btn minimize-btn" title="dock (bring back from the strip below)">–</button>
      <button type="button" class="head-btn hide-btn" title="hide (bring back from the tray below)">✕</button>
    </div>
    <div class="slot-body"><p class="muted">waiting for ${base}</p></div>`;
  slot.querySelector(".daemon").textContent = daemonName;
  slot.querySelector(".tag").textContent = tag;
  slot.title = `${daemonName} at ${base} (${daemon.origin})`;

  // The header, not the whole panel, is the drag handle -- a panel's own
  // buttons and text must stay clickable and selectable.
  const head = slot.querySelector(".slot-head");
  head.draggable = true;
  head.addEventListener("dragstart", (event) => {
    draggingSlot = slot;
    slot.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tag); // Firefox refuses a drag with no data
  });
  head.addEventListener("dragend", () => {
    slot.classList.remove("dragging");
    draggingSlot = null;
    persistOrder();
  });

  const minimizeBtn = slot.querySelector(".minimize-btn");
  minimizeBtn.draggable = false;
  minimizeBtn.addEventListener("click", () => dockPanel(tag));

  const hideBtn = slot.querySelector(".hide-btn");
  hideBtn.draggable = false;
  hideBtn.addEventListener("click", () => hidePanel(tag));

  applySavedSize(slot, tag);
  observeResize(slot, tag);

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
  currentRigKey = rig.key; // read by makeSlot (saved sizes) and the drag handlers (saved order)
  currentRig = rig; // read by hidePanel/unhidePanel to redraw this rig after a change
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
    "The console holds no domain logic: it discovered these, laid them out, and said whether they loaded. " +
    "Drag a panel's header to reorder it, or its bottom-right corner to resize it. – docks it " +
    "in the strip below (out of the way, coming right back); ✕ hides it further, in the tray " +
    "under that. All of it is remembered.";
  panels.append(note);
  applySavedOrder(rig.key, note);
  renderDock();
  renderHiddenTray();
  renderMinimizeControls();
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
