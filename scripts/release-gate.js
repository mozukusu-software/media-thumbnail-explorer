'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const fail = (message) => { throw new Error(message); };
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    ...options
  });
  if (result.error) throw result.error;
  return result;
}

function checkMetadata() {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const version = pkg.version;

  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`Invalid package version: ${version}`);
  if (lock.version !== version) fail(`package-lock.json version ${lock.version} != package.json ${version}`);
  if (lock.packages?.['']?.version !== version) {
    fail(`package-lock root package version ${lock.packages?.['']?.version} != package.json ${version}`);
  }

  const changelog = read('CHANGELOG.md');
  const releaseHeading = new RegExp(`^## v${version.replace(/\./g, '\\.')}\\b`, 'm');
  if (!releaseHeading.test(changelog)) fail(`CHANGELOG.md has no v${version} release heading`);

  if (pkg.license !== 'Apache-2.0') fail(`package.json license is ${pkg.license}, expected Apache-2.0`);
  if (!exists('LICENSE')) fail('LICENSE is missing');

  return { version, changelog };
}

function checkVersionDocs(changelog) {
  const versions = [...changelog.matchAll(/^## v(\d+\.\d+\.\d+)\b/gm)].map((match) => match[1]);
  if (versions.length === 0) fail('No release versions found in CHANGELOG.md');

  for (const version of versions) {
    const [major, minor] = version.split('.');
    const docDir = path.join('doc', `${major}.${minor}`, version);
    const readme = path.join(docDir, 'README.md');
    if (!exists(readme)) fail(`Missing version documentation: ${readme}`);

    const markdown = read(readme);
    const imageRefs = [...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
    for (const ref of imageRefs) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('#')) continue;
      const decodedRef = decodeURIComponent(ref.split('#')[0]);
      const target = path.normalize(path.join(docDir, decodedRef));
      if (!exists(target)) fail(`Broken image reference in ${readme}: ${ref}`);
    }
  }

  return versions;
}

function checkGit() {
  const inside = run('git', ['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') fail('Release gate must run inside a Git worktree');

  const diffCheck = run('git', ['diff', '--check', 'HEAD']);
  if (diffCheck.status !== 0) fail(`git diff --check failed:\n${diffCheck.stdout}${diffCheck.stderr}`);

  const status = run('git', ['status', '--porcelain']);
  if (status.status !== 0) fail(`git status failed:\n${status.stderr}`);
  if (status.stdout.trim()) fail(`Git worktree is not clean:\n${status.stdout}`);
}

function runTests() {
  const testDir = path.join(root, 'test');
  const tests = fs.readdirSync(testDir)
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => path.join('test', name));
  if (tests.length === 0) fail('No test/*.test.js files found');

  const result = run(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
  if (result.status !== 0) fail(`Test suite failed with exit code ${result.status}`);
}

function main() {
  const { version, changelog } = checkMetadata();
  const versions = checkVersionDocs(changelog);
  checkGit();
  runTests();
  console.log(`Release gate PASS: v${version}; documented releases=${versions.length}`);
}

try {
  main();
} catch (error) {
  console.error(`Release gate FAIL: ${error.message}`);
  process.exitCode = 1;
}
