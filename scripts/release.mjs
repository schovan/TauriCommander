// Bumps the app version in the three places that must stay in sync,
// then updates Cargo.lock. Usage: bun run release <version>  (e.g. 1.0.1)
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: bun run release <version>   e.g. bun run release 1.0.1");
  process.exit(1);
}

function replaceInFile(relPath, pattern, replacement) {
  const path = join(root, relPath);
  const before = readFileSync(path, "utf8");
  const after = before.replace(pattern, replacement);
  if (after === before) {
    console.error(`Could not find a version field to update in ${relPath}`);
    process.exit(1);
  }
  writeFileSync(path, after);
  console.log(`  updated ${relPath}`);
}

console.log(`Bumping version to ${version}`);

// package.json + tauri.conf.json: first "version": "..." entry
replaceInFile("package.json", /("version":\s*")[^"]*(")/, `$1${version}$2`);
replaceInFile("src-tauri/tauri.conf.json", /("version":\s*")[^"]*(")/, `$1${version}$2`);

// Cargo.toml: the [package] version, anchored to the crate name
replaceInFile(
  "src-tauri/Cargo.toml",
  /(name = "tauri-app"\s*\nversion = ")[^"]*(")/,
  `$1${version}$2`,
);

console.log("Syncing Cargo.lock");
execFileSync("cargo", ["update", "-p", "tauri-app", "--precise", version], {
  cwd: join(root, "src-tauri"),
  stdio: "inherit",
});

const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "inherit" });

console.log(`Committing and tagging v${version}`);
git("commit", "-am", `Release v${version}`);
git("tag", `v${version}`);
git("push", "origin", "HEAD", "--tags");

console.log(`\nDone. Commit and tag v${version} pushed — CI will build and publish the release.`);

