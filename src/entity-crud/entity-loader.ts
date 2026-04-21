/**
 * Boot-time loader — walks `<entitiesDir>/*.entity.json` and returns an
 * array of validated `EntityDeclaration` objects.
 *
 * Used by `ZorbitEntityCrudModule.register()` before it mounts the
 * dynamic controllers.
 */
import * as fs from 'fs';
import * as path from 'path';
import { EntityDeclaration, parseEntityDeclaration } from './entity-schema';

export interface EntityLoadResult {
  declarations: EntityDeclaration[];
  /** Per-file validation errors (empty on clean load) */
  errors: Array<{ file: string; message: string }>;
}

/**
 * Load every `*.entity.json` in `dir`. Invalid files are collected in
 * `errors` — boot continues, consumers decide whether to fail fast.
 */
export function loadEntitiesFromDir(dir: string): EntityLoadResult {
  const out: EntityLoadResult = { declarations: [], errors: [] };

  if (!fs.existsSync(dir)) {
    return out;
  }

  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    out.errors.push({ file: dir, message: 'entitiesDir is not a directory' });
    return out;
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.entity.json'))
    .sort();

  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
      const decl = parseEntityDeclaration(raw);
      out.declarations.push(decl);
    } catch (err) {
      out.errors.push({
        file: full,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return out;
}
