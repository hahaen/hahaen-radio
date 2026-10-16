import { readdir, readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? walk(join(path, entry.name))
        : entry.name.endsWith('.md')
          ? [join(path, entry.name)]
          : [],
    ),
  );
  return files.flat();
}
const files = ['README.md', 'AGENTS.md', ...(await walk('docs'))];
let links = 0;
for (const file of files) {
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]?.split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    await access(resolve(dirname(file), decodeURIComponent(target)));
    links++;
  }
}
console.log(`Verified ${files.length} Markdown files and ${links} local links.`);
