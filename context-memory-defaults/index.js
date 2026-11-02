/**
 * Quiet startup defaults for `dsh-context-memory`.
 *
 * The memory plugin keeps its panel preferences in process memory and starts
 * every process with auto capture and turn-end harvest enabled, so a panel
 * toggle lasts only until the next restart. This Host half asks for the quiet
 * posture once, as soon as the plugin's `contextMemory` service is available,
 * and records what it applied. The record is a plain JSON file under the
 * harness home: the panel route that would report the same values is behind the
 * Web connection's authentication, so this is the check a terminal can read.
 *
 * It deliberately touches nothing else: no memory is written, no candidate is
 * decided, and the record file lives outside the profile.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const PLUGIN = 'context-memory-defaults';

/** The harness home, following the same rule the host itself uses. */
function harnessHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return join(homedir(), '.dsh');
}

/** Record the outcome so it can be verified without the authenticated panel. */
async function record(outcome) {
  const file = join(harnessHome(), `${PLUGIN}.json`);
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify({ ...outcome, at: new Date().toISOString() }, void 0, 2)}\n`,
      'utf8',
    );
  } catch {
    /* An unwritable status file must never break activation. */
  }
}

export function apply(ctx, config) {
  const source = config !== null && typeof config === 'object' ? config : {};
  const patch = {
    autoCapture: source.autoCapture === true,
    harvest: source.harvest === true,
  };

  // `ctx.inject`, not a static dependency: a profile without the memory plugin
  // simply never runs this callback, instead of leaving the row pending.
  ctx.inject(['contextMemory'], (memoryCtx) => {
    const service = memoryCtx.get('contextMemory');
    if (service === void 0 || typeof service.setPrefs !== 'function') {
      void record({ applied: false, reason: 'service-unavailable', requested: patch });
      return;
    }
    try {
      const prefs = service.setPrefs(patch);
      void record({ applied: true, requested: patch, prefs });
    } catch (error) {
      void record({
        applied: false,
        reason: String(error?.message ?? error),
        requested: patch,
      });
    }
  });
}
