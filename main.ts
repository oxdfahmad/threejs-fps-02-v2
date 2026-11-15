// Neon Breach II — the hand-in program (main.ts).
//
// Runs on Node 22, standard library only. It stages the entry for the
// grader: the game tree (game/ — static files, three.js 0.187.0 vendored),
// the screenshots/ captures, and a dossier.json built by the kit's vendored
// make.fun library, which is what the judge reads. Everything lands under
// the platform's output directory.
//
// Local dry run, outside the grader:
//   mkdir -p /tmp/fps02v2-out && MAKEFUN_OUTPUT_DIR=/tmp/fps02v2-out node main.ts
//
// To play the game while developing, serve it with `node serve.ts` from the
// dev folder and open http://localhost:8080 — no build step, the browser
// loads game/index.html as ES modules straight from disk.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// Limits taken from the scorer's own gate, so what we stage can never trip
// it: four screenshots at most of 256 KiB each, game/ under 993 files and
// 48 MiB, and the dossier text capped at 160 KiB.
const DOSSIER_TEXT_CAP = 163840;
const SHOT_LIMIT = 4;
const SHOT_BYTES_CAP = 262144;
const GAME_FILE_CAP = 993;
const GAME_BYTES_CAP = 50331648;

function stageEntry(repoRoot, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  // game/ first — the whole static tree, three.js included.
  cpSync(join(repoRoot, 'game'), join(targetDir, 'game'), { recursive: true });
  // screenshots/ next, when the maker has taken them.
  const shotsDir = join(targetDir, 'screenshots');
  mkdirSync(shotsDir, { recursive: true });
  if (existsSync(join(repoRoot, 'screenshots'))) {
    cpSync(join(repoRoot, 'screenshots'), shotsDir, { recursive: true });
  }
  return targetDir;
}

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const targetDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
stageEntry(repoRoot, targetDir);

const dossierText = buildDossier(targetDir, {
  text_max_bytes: DOSSIER_TEXT_CAP,
  screenshots: { max: SHOT_LIMIT, max_bytes: SHOT_BYTES_CAP },
  game_max_files: GAME_FILE_CAP,
  game_max_bytes: GAME_BYTES_CAP,
});
writeFileSync(join(targetDir, 'dossier.json'), dossierText);
