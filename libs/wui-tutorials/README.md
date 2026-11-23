# wui-tutorials — the tutorials' guide

Plays the modules' own tutorials (`tutorial/<id>.json`, collected by wui-toolkit 0.30.0 or
later into `data/dashboard-wc/wui-tutorials.json`) over the site: Sigma, a mascot, says each
step, lights up its target and waits for the operator to do it. The page `#/tutorials` lists
them, with the roles they are for and the badges earned; the guide is on every page through the
module's shell boot script.

A site selects it with `npx wui use tutorials`. Writing a module's tutorials: the toolkit's
`wui-tutorial` skill and its `docs/REFERENCE.md`, "A module's tutorials".

Details: [docs/wui-tutorials/README.md](../../docs/wui-tutorials/README.md).
