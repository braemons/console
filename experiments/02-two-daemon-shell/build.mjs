// SPDX-License-Identifier: AGPL-3.0-or-later
// Build the prototype vstimd elements bundle, and serve the shell.
//
// esbuild and nothing else: no Vite, no config file, no plugins. See
// docs/BUILD_TOOLING.md for why, and experiments/01-no-vite for the evidence
// that the same thing carries vstimd's whole existing UI.
//
// The one awkward flag is `nodePaths`. This entry point lives in the console
// repo and imports React *and* vstimd's panels, which live in vstimd's repo and
// resolve React from vstimd's `node_modules`. Two copies of React in one bundle
// is broken hooks, so both are pointed at the same tree. That awkwardness is an
// artefact of prototyping across two repos and disappears the moment this file
// moves upstream into vstimd, where it is just a second entry point.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const VSTIMD_WEB = resolve(process.env.VSTIMD_WEB_SRC ?? join(HERE, "../../../vstimd/client/web"));
const NODE_MODULES = join(VSTIMD_WEB, "node_modules");

const esbuild = await import(createRequire(join(NODE_MODULES, "x.js")).resolve("esbuild"));

export const options = {
  entryPoints: [join(HERE, "vstimd-elements/vstimd_elements.tsx")],
  outfile: join(HERE, "static/vstimd-elements/vstimd.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  nodePaths: [NODE_MODULES],
  //  rather than a relative path out of this repo and into the
  // next one: the import then reads the same here as it will upstream.
  alias: { "@vstimd/web": VSTIMD_WEB },
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "info",
};

if (import.meta.url === `file://${process.argv[1]}`) await esbuild.build(options);
