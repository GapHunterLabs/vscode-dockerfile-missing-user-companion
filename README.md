# Dockerfile Missing USER Companion (VS Code)

Warns when a Dockerfile's **final build stage** never sets a non-root
`USER` — Docker runs a container as root by default when `USER` is
absent, a documented container-escape / privilege-escalation risk if a
volume mount is misconfigured. No data leaves your editor.

**v0.1, new niche.** A manual port of the detection rules from the Gap
Hunter Labs IntelliJ plugin `dockerfile-missing-user-companion`, kept in
sync by hand (the two build on different toolchains).

## What it does

Live, on any `Dockerfile`, `Dockerfile.*`, `*.Dockerfile` or
`Containerfile`: scans the file and flags the final `FROM` stage (the
stage a plain `docker build` with no `--target` actually runs) when it
ends up running as root.

It reasons over real multi-stage structure:
- A `USER` in an earlier stage never counts on its own — only the last
  stage in the file is what runs.
- **Except** when that last stage's own `FROM` names a previous stage
  from the same file (`FROM base AS final`): Docker inherits the base
  stage's state, `USER` included, so the chain is followed.
- The **last** `USER` in the (possibly inherited) final stage decides —
  a stage that switches back to `USER root` / `USER 0` after an earlier
  non-root `USER` is still flagged.

**v0.1 scope, honestly noted:** a plain-text line scanner, not a full
parser. It does not verify that the referenced user actually exists
(`USER appuser` with no prior `RUN useradd` is a different problem), and
a `USER` split across lines with a trailing `\` is not recognized
(single-line match only) — rare in practice.

## Privacy

See [PRIVACY.md](PRIVACY.md) — zero network calls, everything runs
against files already open in your editor.

## Development

```bash
npm install
npm run compile   # or: npm run watch
npm test
```

To build an installable package without publishing:

```bash
npx @vscode/vsce package
```

## License

Apache License 2.0 — see [LICENSE](LICENSE).
