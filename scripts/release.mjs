#!/usr/bin/env node
/**
 * One source for the version, and a CHANGELOG built from the commits.
 *
 * Seven files carry the version and nothing has ever compared them:
 *
 *   package.json                 the workspace root, and the source of truth
 *   apps/mobile/package.json     the app's own manifest
 *   apps/mobile/app.json         expo.version, which is what the APK workflow
 *                                names the release asset after
 *   apps/api/package.json
 *   apps/landing/package.json
 *   apps/web/package.json
 *   packages/shared/package.json
 *
 * Drift is silent in both directions. `lift-0.14.1-29-abc1234.apk` is named
 * from app.json alone, so a bump that misses app.json ships a file claiming the
 * old version, and a bump that only touches app.json leaves five manifests
 * behind. `check` is the step CI runs; it reads and writes nothing.
 *
 * The CHANGELOG half exists because `gh release create --generate-notes`
 * derives its body from merged pull requests, and this project commits
 * straight to main. Every release note so far has been a bare compare link.
 * The commit subjects are already conventional, so the notes were there all
 * along, just never collected.
 *
 *   node scripts/release.mjs                    same as check
 *   node scripts/release.mjs check              verify the seven agree
 *   node scripts/release.mjs check --expect 0.15.0
 *   node scripts/release.mjs set 0.15.0         rewrite the seven, then CHANGELOG
 *   node scripts/release.mjs set minor          bump from the root manifest
 *   node scripts/release.mjs changelog          regenerate CHANGELOG.md alone
 *   node scripts/release.mjs notes v0.15.0      print one section, for gh release
 *   node scripts/release.mjs --help
 *
 * `set` and `changelog` take --dry-run, which prints the same output and writes
 * nothing. Nothing here commits, tags or pushes: cutting a release is still
 * `set`, read the diff, commit, tag. This only removes the seven-file edit and
 * the changelog from that list.
 *
 * Writes are surgical string replacements, not JSON.stringify. Round-tripping
 * these files through a parser would reformat every one of them and bury the
 * one line that changed in a whole-file diff.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The seven, root first: it is the source `set` reads a bare bump from.
const MANIFESTS = [
  { file: 'package.json', path: ['version'] },
  { file: 'apps/mobile/package.json', path: ['version'] },
  { file: 'apps/mobile/app.json', path: ['expo', 'version'] },
  { file: 'apps/api/package.json', path: ['version'] },
  { file: 'apps/landing/package.json', path: ['version'] },
  { file: 'apps/web/package.json', path: ['version'] },
  { file: 'packages/shared/package.json', path: ['version'] },
];

const CHANGELOG = join(ROOT, 'CHANGELOG.md');

// Conventional-commit types, in the order a reader wants them. Everything from
// `refactor` down is real work that changed no behaviour anyone can see, so it
// goes under one heading rather than six.
const SECTIONS = [
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['revert', 'Reverts'],
];
const INTERNAL = new Set(['refactor', 'build', 'ci', 'docs', 'chore', 'test', 'style']);

// The commit that records a release is not part of it.
const RELEASE_COMMIT = /^Cut version /i;

// ---------------------------------------------------------------- args -----

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');

if (argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') {
  console.log(
    [
      'Usage: node scripts/release.mjs [command]',
      '',
      '  check [--expect <version>]  Verify the seven version fields agree.',
      '                              Reads only. This is what CI runs.',
      '  set <version|major|minor|patch>',
      '                              Rewrite all seven, then regenerate CHANGELOG.md.',
      '  changelog                   Regenerate CHANGELOG.md alone.',
      '  notes <version>             Print that release\'s CHANGELOG section to',
      '                              stdout. Reads only. android.yml feeds it to',
      '                              gh release create --notes-file.',
      '  --dry-run                   With set or changelog: print, write nothing.',
      '  --help                      This text.',
      '',
      'The default command is check, so running this with no arguments never',
      'modifies anything.',
      '',
      'The seven files:',
      ...MANIFESTS.map((m) => `  ${m.file}  (${m.path.join('.')})`),
    ].join('\n'),
  );
  process.exit(0);
}

const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'check';

// --------------------------------------------------------------- read ------

function read(manifest) {
  const full = join(ROOT, manifest.file);
  if (!existsSync(full)) return { ...manifest, missing: true };
  const text = readFileSync(full, 'utf8');
  let node;
  try {
    node = JSON.parse(text);
  } catch (error) {
    die(`${manifest.file} is not valid JSON: ${error.message}`);
  }
  for (const key of manifest.path) node = node?.[key];
  return { ...manifest, full, text, version: typeof node === 'string' ? node : undefined };
}

function die(message) {
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=Release::${message}`);
  console.error(`error: ${message}`);
  process.exit(1);
}

function versions() {
  const found = MANIFESTS.map(read);
  for (const m of found) {
    if (m.missing) die(`${m.file} does not exist. Update MANIFESTS in this script if it moved.`);
    if (!m.version) die(`${m.file} has no string at ${m.path.join('.')}.`);
  }
  return found;
}

// -------------------------------------------------------------- check ------

function check() {
  const found = versions();
  const root = found[0].version;
  const width = Math.max(...found.map((m) => m.file.length));

  for (const m of found) {
    const agrees = m.version === root;
    console.log(`${agrees ? '  ok  ' : ' >>>  '}${m.file.padEnd(width)}  ${m.version}`);
  }

  const drifted = found.filter((m) => m.version !== root);
  if (drifted.length > 0) {
    die(
      `Version drift. ${found[0].file} says ${root} but ${drifted
        .map((m) => `${m.file} says ${m.version}`)
        .join(', ')}. Run 'node scripts/release.mjs set ${root}' to bring them back together.`,
    );
  }

  const expectIndex = argv.indexOf('--expect');
  if (expectIndex !== -1) {
    // The tag name with its leading v stripped, when CI calls this on a tag
    // push. A tag that does not match what the manifests say produces an APK
    // named after one version published under another.
    const expected = (argv[expectIndex + 1] || '').replace(/^v/, '');
    if (!expected) die('--expect needs a version.');
    if (expected !== root) {
      die(
        `The seven manifests agree on ${root}, but this build is for ${expected}. The tag and the tree have to name the same release: run 'node scripts/release.mjs set ${expected}', commit, and re-tag.`,
      );
    }
    console.log(`\nAll seven agree on ${root}, which is the version being built.`);

    // A warning rather than a failure: an absent entry makes for an empty
    // release note, which is the gap this script exists to close, but it is
    // not a reason to stop a release that is otherwise correct.
    if (existsSync(CHANGELOG) && !readFileSync(CHANGELOG, 'utf8').includes(`[${root}]`)) {
      const message = `CHANGELOG.md has no section for ${root}, so this release's notes will be empty. Run 'node scripts/release.mjs changelog'.`;
      if (process.env.GITHUB_ACTIONS) console.log(`::warning title=No changelog entry::${message}`);
      console.log(`\nwarning: ${message}`);
    }
    return;
  }

  console.log(`\nAll seven agree on ${root}.`);
}

// ---------------------------------------------------------------- set ------

function bump(current, how) {
  if (/^\d+\.\d+\.\d+/.test(how)) return how;
  const parts = current.split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    die(`Cannot bump from '${current}', which is not major.minor.patch. Pass a version instead.`);
  }
  const [major, minor, patch] = parts;
  if (how === 'major') return `${major + 1}.0.0`;
  if (how === 'minor') return `${major}.${minor + 1}.0`;
  if (how === 'patch') return `${major}.${minor}.${patch + 1}`;
  return die(`'${how}' is not a version or one of major, minor, patch.`);
}

function set() {
  const target = argv[1];
  if (!target || target.startsWith('-')) die("set needs a version, or one of major, minor, patch. See --help.");

  const found = versions();
  const next = bump(found[0].version, target);

  for (const m of found) {
    if (m.version === next) {
      console.log(`  ok  ${m.file} already ${next}`);
      continue;
    }

    // Anchored on the current value as well as the key, and required to match
    // exactly once. A file where this is ambiguous is one this script should
    // refuse rather than guess at.
    const key = m.path[m.path.length - 1];
    const pattern = new RegExp(`("${key}"\\s*:\\s*")${escapeRegExp(m.version)}(")`, 'g');
    const hits = m.text.match(pattern) ?? [];
    if (hits.length !== 1) {
      die(
        `Expected exactly one "${key}": "${m.version}" in ${m.file}, found ${hits.length}. Change it by hand and re-run check.`,
      );
    }

    console.log(`  ->  ${m.file}  ${m.version} -> ${next}`);
    if (!dryRun) writeFileSync(m.full, m.text.replace(pattern, `$1${next}$2`));
  }

  console.log('');
  changelog(next);

  console.log(
    dryRun
      ? '\nDry run, nothing written.'
      : `\nSet to ${next}. Read the diff, then commit and tag:\n  git commit -am 'Cut version ${next}'\n  git tag v${next} && git push && git push --tags`,
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ------------------------------------------------------------ changelog ----
//
// Everything below reads git and nothing else, so a regeneration is
// reproducible from any checkout: the file is an artefact of the history, not
// a document maintained beside it.
//
// Which is also why no workflow runs it. actions/checkout fetches depth 1 by
// default, and a shallow clone with no tags would regenerate the file as one
// empty Unreleased section and commit that over twenty-five releases. It is a
// local command. CI runs `check` and `notes`, both of which read files.

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

// `git@github-personal:pawan67/lift.git` is an ssh host alias, which is the
// form this repository's remote actually takes, so a naive URL parse gets
// nothing. Both shapes reduce to owner/repo or the links are simply omitted.
function repoSlug() {
  let url;
  try {
    url = git('remote', 'get-url', 'origin');
  } catch {
    return null;
  }
  const match = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

function parseCommits(range) {
  // Unit and record separators, because a subject may contain anything a
  // person can type and a body is multi-line by definition.
  const raw = git('log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', ...range);
  if (!raw) return [];

  return raw
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, body = ''] = record.split('\x1f');
      const match = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
      return {
        hash,
        subject,
        type: match ? match[1].toLowerCase() : null,
        scope: match ? match[2] : null,
        text: match ? match[4] : subject,
        breaking: Boolean(match?.[3]) || /^BREAKING[ -]CHANGE:/m.test(body),
      };
    })
    .filter((commit) => !RELEASE_COMMIT.test(commit.subject));
}

function renderCommit(commit, slug, showType = false) {
  // The type is only printed under Internal, where seven of them share one
  // heading and "docs" against "build" is the whole of the difference.
  const label = showType && commit.type ? `${commit.type}${commit.scope ? `(${commit.scope})` : ''}: ` : '';
  const scope = !showType && commit.scope ? `**${commit.scope}:** ` : '';
  const link = slug ? ` ([${commit.hash.slice(0, 7)}](https://github.com/${slug}/commit/${commit.hash}))` : '';
  return `- ${label}${scope}${commit.text}${link}`;
}

function renderRelease({ version, date, previous, commits, slug, unreleased }) {
  const heading =
    slug && previous
      ? `## [${version}](https://github.com/${slug}/compare/${previous}...${unreleased ? 'HEAD' : `v${version}`})`
      : `## [${version}]`;

  const lines = [`${heading}${date ? ` - ${date}` : ''}`, ''];

  if (commits.length === 0) {
    lines.push('No commits outside the release itself.', '');
    return lines;
  }

  const breaking = commits.filter((c) => c.breaking);
  if (breaking.length > 0) {
    lines.push('### Breaking changes', '');
    for (const c of breaking) lines.push(renderCommit(c, slug));
    lines.push('');
  }

  for (const [type, title] of SECTIONS) {
    const group = commits.filter((c) => c.type === type && !c.breaking);
    if (group.length === 0) continue;
    lines.push(`### ${title}`, '');
    for (const c of group) lines.push(renderCommit(c, slug));
    lines.push('');
  }

  const internal = commits.filter((c) => c.type && INTERNAL.has(c.type) && !c.breaking);
  if (internal.length > 0) {
    lines.push('### Internal', '');
    for (const c of internal) lines.push(renderCommit(c, slug, true));
    lines.push('');
  }

  // Everything before v0.8.0 predates the convention and has a plain subject.
  // Dropping those would make the early history look empty, which is worse
  // than a heading that says what the bucket is.
  const other = commits.filter(
    (c) => !c.breaking && !SECTIONS.some(([t]) => t === c.type) && !(c.type && INTERNAL.has(c.type)),
  );
  if (other.length > 0) {
    lines.push('### Other changes', '');
    for (const c of other) lines.push(renderCommit(c, slug));
    lines.push('');
  }

  return lines;
}

function changelog(pending) {
  const slug = repoSlug();

  // Ascending, then walked backwards, so each release's range is bounded by
  // the tag before it. --sort=v:refname is git's own version ordering, which
  // puts v0.9.0 before v0.10.0 where a lexical sort would not.
  const tags = git('tag', '--list', 'v*', '--sort=v:refname').split('\n').filter(Boolean);

  const releases = [];

  // Commits since the newest tag. Under `set` they are the release being cut,
  // so they get its number and today's date; on their own they are Unreleased.
  const head = tags.length > 0 ? parseCommits([`${tags[tags.length - 1]}..HEAD`]) : parseCommits(['HEAD']);
  if (head.length > 0) {
    releases.push({
      version: pending ?? 'Unreleased',
      date: pending ? new Date().toISOString().slice(0, 10) : null,
      previous: tags[tags.length - 1] ?? null,
      unreleased: !pending,
      commits: head,
      slug,
    });
  }

  for (let i = tags.length - 1; i >= 0; i--) {
    const tag = tags[i];
    const previous = tags[i - 1] ?? null;
    releases.push({
      version: tag.replace(/^v/, ''),
      date: git('log', '-1', '--format=%as', tag),
      previous,
      commits: parseCommits(previous ? [`${previous}..${tag}`] : [tag]),
      slug,
    });
  }

  const lines = [
    '# Changelog',
    '',
    'Every release of Lift, collected from the conventional commit subjects in',
    'this repository.',
    '',
    'Generated by `scripts/release.mjs`, so edits here are overwritten on the next',
    'run. To change an entry, reword the commit; to change the shape of the file,',
    'change the script. Releases before v0.8.0 predate the commit convention and',
    'appear under "Other changes".',
    '',
  ];

  for (const release of releases) lines.push(...renderRelease(release));

  const text = `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;

  if (dryRun) {
    console.log(`Would write ${text.split('\n').length} lines to CHANGELOG.md covering ${releases.length} releases.`);
    return;
  }

  writeFileSync(CHANGELOG, text);
  console.log(`Wrote CHANGELOG.md: ${releases.length} releases, ${text.split('\n').length} lines.`);
}

// -------------------------------------------------------------- notes -----
//
// One section of the file, lifted out for `gh release create --notes-file`.
// Kept here rather than as a shell one-liner in the workflow so the heading
// shape is defined in the same place it is written.

function notes() {
  const version = (argv[1] || '').replace(/^v/, '');
  if (!version) die('notes needs a version.');
  if (!existsSync(CHANGELOG)) die("CHANGELOG.md does not exist. Run 'node scripts/release.mjs changelog'.");

  const lines = readFileSync(CHANGELOG, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) {
    // stderr and a non-zero exit, because the caller in android.yml treats a
    // failure here as "fall back to --generate-notes" rather than as a reason
    // to stop the release.
    console.error(`error: CHANGELOG.md has no section for ${version}.`);
    process.exit(1);
  }

  let end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  if (end === -1) end = lines.length;

  // The heading itself is dropped: GitHub already titles the release with the
  // tag, and repeating it inside the body reads as a mistake.
  console.log(lines.slice(start + 1, end).join('\n').trim());
}

// -------------------------------------------------------------- main -------

if (command === 'check') check();
else if (command === 'set') set();
else if (command === 'changelog') changelog();
else if (command === 'notes') notes();
else die(`Unknown command '${command}'. See --help.`);
