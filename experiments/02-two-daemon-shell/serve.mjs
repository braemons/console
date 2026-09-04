// SPDX-License-Identifier: AGPL-3.0-or-later
// The console, as a host-side process: static files, plus the one thing a
// browser cannot do for itself.
//
// Two routes and no framework:
//
//   GET /api/rigs   the DNS-SD browse, as JSON (discovery.mjs)
//   GET /*          the shell, from static/
//
// It speaks to no daemon. Every panel on the page is an element served by the
// daemon that owns the hardware it is about, and it fetches its own data from
// that daemon directly -- so this process is never in the path of anything a
// person is watching, and a bug in it cannot make a rig look wrong.
//
// In this experiment it also serves the prototype vstimd elements bundle out of
// static/vstimd-elements/, standing in for the `/elements/vstimd.js` that
// vstimd does not serve yet (see vstimd-elements/vstimd_elements.tsx). That is
// the *only* place this shell holds anything daemon-specific, and it is the
// thing the experiment is asking vstimd to take over.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverRigs } from "./discovery.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = join(HERE, "static");
const PORT = Number(process.env.CONSOLE_PORT ?? 9000);

/** Rigs mDNS cannot find. See discovery.mjs; the file is optional. */
const configured = await readFile(join(HERE, "rigs.json"), "utf8")
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
    // Nothing is cached, for the reason statemachined gives for its own
    // assets: one process serving both the shell and the elements contract it
    // depends on is what keeps them the same version during development.
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
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
server.listen(PORT, "127.0.0.1", () =>
  console.log(`braemons console (experiment) on http://127.0.0.1:${PORT}`),
);
