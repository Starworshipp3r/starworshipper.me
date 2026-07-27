import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const errors = [];

async function readJson(relativePath) {
  try {
    return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
  } catch (error) {
    errors.push(`${relativePath}: ${error.message}`);
    return null;
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${label} must be a non-empty string`);
  }
}

function requireStringArray(value, label) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    errors.push(`${label} must be an array of non-empty strings`);
  }
}

function requireHttpUrl(value, label) {
  requireText(value, label);
  if (typeof value !== 'string' || !value.trim()) return;

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      errors.push(`${label} must use http or https`);
    }
  } catch {
    errors.push(`${label} must be a valid URL`);
  }
}

async function requireLocalAsset(value, label) {
  if (value === undefined) return;
  requireText(value, label);
  if (typeof value !== 'string' || !value.startsWith('/')) return;

  const relativePath = decodeURIComponent(value.split(/[?#]/, 1)[0]).replace(/^\/+/, '');
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    errors.push(`${label} escapes the site root`);
    return;
  }

  try {
    await access(resolved);
  } catch {
    errors.push(`${label} references missing file: ${value}`);
  }
}

const journal = await readJson('site/data/journal.json');
if (journal && !Array.isArray(journal)) {
  errors.push('site/data/journal.json must contain an array');
}

const seenEntries = new Set();
if (Array.isArray(journal)) {
  for (const [index, entry] of journal.entries()) {
    const label = `journal entry ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${label} must be an object`);
      continue;
    }

    requireText(entry.date, `${label}.date`);
    requireText(entry.title, `${label}.title`);
    requireText(entry.type, `${label}.type`);
    requireText(entry.body, `${label}.body`);
    requireStringArray(entry.tags, `${label}.tags`);
    requireStringArray(entry.photos, `${label}.photos`);

    if (typeof entry.date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      errors.push(`${label}.date must use YYYY-MM-DD`);
    }

    const identity = `${entry.date}\u0000${entry.title}`;
    if (seenEntries.has(identity)) {
      errors.push(`${label} duplicates ${entry.date} / ${entry.title}`);
    }
    seenEntries.add(identity);

    await requireLocalAsset(entry.coverImage, `${label}.coverImage`);
    if (Array.isArray(entry.photos)) {
      await Promise.all(
        entry.photos.map((photo, photoIndex) =>
          requireLocalAsset(photo, `${label}.photos[${photoIndex}]`),
        ),
      );
    }

    if (entry.videos !== undefined) {
      if (!Array.isArray(entry.videos)) {
        errors.push(`${label}.videos must be an array`);
      } else {
        for (const [videoIndex, video] of entry.videos.entries()) {
          const videoLabel = `${label}.videos[${videoIndex}]`;
          if (!video || typeof video !== 'object' || Array.isArray(video)) {
            errors.push(`${videoLabel} must be an object`);
            continue;
          }
          requireHttpUrl(video.src, `${videoLabel}.src`);
          await requireLocalAsset(video.poster, `${videoLabel}.poster`);
        }
      }
    }
  }
}

const highlights = await readJson('site/data/highlights.json');
if (highlights) {
  if (typeof highlights !== 'object' || Array.isArray(highlights)) {
    errors.push('site/data/highlights.json must contain an object');
  } else {
    requireText(highlights.doing, 'highlights.doing');
    requireHttpUrl(highlights.artwork, 'highlights.artwork');
    requireHttpUrl(highlights.link, 'highlights.link');
    requireText(highlights.credit, 'highlights.credit');
  }
}

if (errors.length) {
  console.error(`Site check failed with ${errors.length} issue${errors.length === 1 ? '' : 's'}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Site check passed: ${journal?.length ?? 0} journal entries and highlights data are valid.`);
}
