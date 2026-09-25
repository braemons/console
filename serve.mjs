// SPDX-License-Identifier: AGPL-3.0-or-later
// The console, as a host-side process: static files, plus the one thing a
// browser cannot do for itself.
//
// Two routes and no framework:
//
//   GET /api/rigs   the DNS-SD browse, as JSON (discovery.mjs)
//   GET /*          the shell, from static/
//
// It speaks to no daemon and holds nothing daemon-specific at all. Every
// panel on the page is an element served by the daemon that owns the
// hardware it is about, fetched by the browser directly from that daemon's
// own `/elements/<name>.js` -- this process never touches one. That is what
// keeps a bug here from being able to make a rig look wrong, and it is why
// `rigs.json`'s `elements` field for every daemon is either a bare path
// (resolved against that daemon's own `base`) or that daemon's own absolute
// URL, never a URL back into this server.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverRigs } from "./discovery.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = join(HERE, "static");
const PORT = Number(process.env.CONSOLE_PORT ?? 9000);
// Loopback unless told otherwise; see the listen() call at the bottom.
const HOST = process.env.CONSOLE_HOST ?? "127.0.0.1";
// The package keeps it in /etc/braemons, where a person edits it.
const RIGS = process.env.CONSOLE_RIGS ?? join(HERE, "rigs.json");

/** Rigs mDNS cannot find. See discovery.mjs; the file is optional. */
const configured = await readFile(RIGS, "utf8")
  .then(JSON.parse)
  .catch(() => []);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/rigs") {
    const body = JSON.stringify(await discoverRigs(configured));
    res.writeHead(200, { "content-type": TYPES[".json"] });
    return res.end(body);
  }

  // No directory traversal: normalise, then refuse anything that climbed out.
  const rel = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = join(STATIC, rel);
  if (!file.startsWith(STATIC)) {
    res.writeHead(403);
    return res.end("no");
  }

  try {
    const body = await readFile(file);
    // Not cached: the shell is small, changes during development, and this
    // process's whole reason for existing is being trivial to keep in sync
    // with what it serves.
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

// Loopback, not 0.0.0.0. The daemons are exposed on the rig network and the
// network is the security boundary (docs/PLAN.md §7) -- which makes the machine
// this runs on, usually a laptop with a route to the wider network too, the
// least trusted thing in the picture. It has no reason to be reachable, so it
// is not.
//
// The one exception is a console installed on the rig itself, which sits on
// the rig network and is reached from a laptop: the SD image sets
// CONSOLE_HOST=0.0.0.0 there (docs/PLAN.md §7). It still proxies nothing.
server.listen(PORT, HOST, () =>
  console.log(`braemons console on http://${HOST}:${PORT}`),
);
