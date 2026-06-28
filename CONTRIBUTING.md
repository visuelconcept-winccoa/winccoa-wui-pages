<!--
SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
SPDX-License-Identifier: AGPL-3.0-only
-->

# Contributing to WinCC OA WebUI Pages

Thanks for your interest in contributing! This document explains how to propose
changes and the licensing terms that apply to contributions.

## How to contribute

1. **Open an issue** first for anything non-trivial (bug, feature, question) so we
   can agree on the approach before you invest time.
2. **Fork** the repository and create a topic branch from `main`
   (e.g. `fix/para-archive-range`, `feat/mosaic-embed`).
3. **Follow the project conventions** — see
   [`AGENTS.md`](./AGENTS.md) and `docs/knowledge/project/coding-conventions.md`.
   Use Siemens iX components and theme tokens; do not hardcode colors/spacing.
4. **Keep changes scoped.** One logical change per PR. Update the relevant
   `docs/wui-<page>/` docs when you change a module's behavior.
5. **Run quality checks** on what you touched before pushing:

   ```bash
   npm run lint
   npm run test
   npx tsc --noEmit -p tsconfig.base.json
   ```

6. **Add the SPDX header** to every new source file you create:

   ```ts
   // SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
   // SPDX-License-Identifier: AGPL-3.0-only
   ```

7. **Open a pull request** against `main` with a clear description of what and why.

## Licensing of contributions — Developer Certificate of Origin + relicensing grant

This project is dual-licensed: open source under **AGPL-3.0-only**, and under a
**separate commercial license** offered by VISUEL CONCEPT. To keep that possible,
every contribution must be made under the terms below.

By submitting a contribution (commit, patch, or pull request), **you certify the
Developer Certificate of Origin 1.1** (full text below) **and you agree that:**

1. Your contribution is licensed to the project and the public under
   **AGPL-3.0-only**; **and**
2. You grant **VISUEL CONCEPT** a perpetual, worldwide, non-exclusive,
   royalty-free, irrevocable right to use, reproduce, modify, sublicense and
   **relicense your contribution under any terms, including a commercial /
   proprietary license**, so that VISUEL CONCEPT can continue to offer the project
   under both AGPL-3.0 and a commercial license.
3. You have the legal right to grant the above (the work is yours, or your
   employer has authorized it).

You retain copyright on your contribution; this is a license grant, not a transfer
of ownership.

### How to certify — `Signed-off-by`

Add a sign-off line to **every commit** by committing with `-s`:

```bash
git commit -s -m "fix: correct PARA archive range"
```

This appends a line to your commit message:

```
Signed-off-by: Your Name <you@example.com>
```

The `Signed-off-by` line is your statement that you agree to the DCO and the
relicensing grant above. PRs whose commits are not signed off cannot be merged.

### Developer Certificate of Origin 1.1

```
By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I have the right to
    submit it under the open source license indicated in the file; or

(b) The contribution is based upon previous work that, to the best of my knowledge,
    is covered under an appropriate open source license and I have the right under
    that license to submit that work with modifications, whether created in whole or
    in part by me, under the same open source license (unless I am permitted to
    submit under a different license), as indicated in the file; or

(c) The contribution was provided directly to me by some other person who certified
    (a), (b) or (c) and I have not modified it.

(d) I understand and agree that this project and the contribution are public and that
    a record of the contribution (including all personal information I submit with it,
    including my sign-off) is maintained indefinitely and may be redistributed
    consistent with this project or the open source license(s) involved.
```

The DCO text above is from <https://developercertificate.org/> and is reproduced
verbatim.

## Questions

For licensing or commercial questions: **contact@visuelconcept.com**.
