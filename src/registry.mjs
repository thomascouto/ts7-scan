// @ts-check
// Optional npm-registry lookup: does the latest published version of a lib
// already admit TS 7? Network-failure tolerant — never throws.

import { admitsTs7 } from './analyze.mjs';

/**
 * Fetch `<name>/latest` from the npm registry and report its version and
 * whether that version's declared `typescript` range admits 7.
 * @param {string} name package name
 * @param {typeof fetch} [fetchImpl] injectable for tests
 * @returns {Promise<{ latest: string | null, admits: boolean | null }>}
 */
export async function latestAdmitsTs7(name, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`);
    if (!res.ok) return { latest: null, admits: null };
    const j = await res.json();
    const range = j.peerDependencies?.typescript ?? j.dependencies?.typescript ?? null;
    return { latest: j.version ?? null, admits: admitsTs7(range) };
  } catch {
    return { latest: null, admits: null };
  }
}
