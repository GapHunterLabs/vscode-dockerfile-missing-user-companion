/**
 * Pure logic -- no `vscode` dependency. A deliberate, manual port of the
 * Gap Hunter Labs IntelliJ plugin `dockerfile-missing-user-companion`
 * (`DockerfileUserScanner.kt`) to TypeScript -- same detection rules,
 * kept in sync by hand, not a shared module (the two build on different
 * toolchains). If you change the rules in one place, mirror the change.
 *
 * Flags when a Dockerfile's FINAL build stage never ends up with a
 * non-root `USER`. Docker runs a container as root by default when
 * `USER` is absent -- documented by Docker's own guide for the
 * instruction as a real security risk (container escape / privilege
 * escalation if a volume mount is misconfigured).
 *
 * Reasons over real multi-stage structure: a `USER` in an EARLIER stage
 * never counts on its own; only the last `FROM` in the file (the stage
 * a plain `docker build` with no `--target` actually runs) is checked.
 * Except when that last stage's own `FROM` names a PREVIOUS stage from
 * this same file (`FROM base AS final`, not an external image): Docker
 * inherits the base stage's state, `USER` included, so the chain is
 * followed.
 *
 * Scope stated honestly: the LAST `USER` in the (possibly inherited)
 * final stage decides -- a stage that switches back to `USER root`/
 * `USER 0` after an earlier non-root `USER` is still flagged. Never
 * validates that the referenced user actually exists. A `USER` split
 * across lines with a trailing `\` is not recognized (single-line match
 * only) -- rare, but a known gap.
 */

export interface DockerfileViolation {
  kind: 'FINAL_STAGE_RUNS_AS_ROOT';
  line: number; // 1-based: the final FROM line
  message: string;
}

const FROM_LINE = /^FROM\s+(.+)$/i;
const USER_LINE = /^USER\s+(\S+)\s*$/i;
const ROOT_USERS = new Set(['root', '0']);

/** Strips an optional `:group` suffix (`USER appuser:appgroup`) and
 * lowercases -- only the user part decides root-ness. */
function rootUserName(userValue: string): string {
  const colon = userValue.indexOf(':');
  const userPart = colon >= 0 ? userValue.slice(0, colon) : userValue;
  return userPart.toLowerCase();
}

/**
 * `FROM [--flag ...] <baseRef> [AS <stageName>]`. Leading
 * `--platform=...`-style flags are skipped to find the real base
 * image/stage reference.
 */
function parseFromLine(trimmed: string): { baseRef: string; stageName: string | null } | null {
  const match = FROM_LINE.exec(trimmed);
  if (!match) return null;
  const tokens = match[1].trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length && tokens[i].startsWith('--')) i++;
  if (i >= tokens.length) return null;
  const baseRef = tokens[i];
  const stageName =
    i + 2 < tokens.length && tokens[i + 1].toLowerCase() === 'as' ? tokens[i + 2] : null;
  return { baseRef, stageName };
}

export function scanDockerfile(text: string): DockerfileViolation[] {
  const lines = text.split('\n');
  // Keyed by lowercased stage name -> the USER value in effect when that
  // stage ended (null = still root/never set). Lets a later
  // `FROM <name> AS ...` that reuses an earlier stage inherit its state
  // instead of resetting to "no USER seen" like an external base image.
  const stageUserAtEnd = new Map<string, string | null>();
  let lastFromLineIndex = -1;
  let currentUser: string | null = null;
  let currentStageName: string | null = null;

  const closeCurrentStage = (): void => {
    if (currentStageName !== null) {
      stageUserAtEnd.set(currentStageName.toLowerCase(), currentUser);
    }
  };

  lines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;

    const fromParts = parseFromLine(trimmed);
    if (fromParts) {
      closeCurrentStage();
      lastFromLineIndex = index;
      // present only when baseRef is an earlier stage in this file;
      // undefined (external image) and null (stage ended as root) both
      // mean "start this stage as root".
      currentUser = stageUserAtEnd.get(fromParts.baseRef.toLowerCase()) ?? null;
      currentStageName = fromParts.stageName;
      return;
    }

    const userMatch = USER_LINE.exec(trimmed);
    if (userMatch) {
      currentUser = userMatch[1];
    }
  });
  closeCurrentStage();

  if (lastFromLineIndex < 0) return []; // not a real Dockerfile shape

  const effectiveUser = currentUser;
  const isRootOrMissing = effectiveUser === null || ROOT_USERS.has(rootUserName(effectiveUser));
  if (!isRootOrMissing) return [];

  return [
    {
      kind: 'FINAL_STAGE_RUNS_AS_ROOT',
      line: lastFromLineIndex + 1,
      message:
        "This Dockerfile's final build stage never sets a non-root USER, so the container runs as root by default -- a documented container-escape / privilege-escalation risk if a volume mount is misconfigured. Add a `USER <non-root>` instruction to the final stage.",
    },
  ];
}
