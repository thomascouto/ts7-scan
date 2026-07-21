// @ts-check
import { describe, it, expect } from 'vitest';
import { latestAdmitsTs7 } from '../src/registry.mjs';

/** @param {object} body @param {boolean} [ok] */
function fakeFetch(body, ok = true) {
  return async () => ({ ok, json: async () => body });
}

describe('latestAdmitsTs7 (fetch mocked — never hits network)', () => {
  it('reports latest version and whether it admits TS 7', async () => {
    const r = await latestAdmitsTs7('foo', fakeFetch({ version: '3.0.0', peerDependencies: { typescript: '>=5' } }));
    expect(r).toEqual({ latest: '3.0.0', admits: true });
  });

  it('reads range from dependencies when no peer', async () => {
    const r = await latestAdmitsTs7('foo', fakeFetch({ version: '2.0.0', dependencies: { typescript: '^5' } }));
    expect(r).toEqual({ latest: '2.0.0', admits: false });
  });

  it('returns nulls on a non-ok response', async () => {
    const r = await latestAdmitsTs7('foo', fakeFetch({}, false));
    expect(r).toEqual({ latest: null, admits: null });
  });

  it('returns nulls (no throw) on network failure', async () => {
    const r = await latestAdmitsTs7('foo', async () => { throw new Error('offline'); });
    expect(r).toEqual({ latest: null, admits: null });
  });
});
