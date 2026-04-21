import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadEntitiesFromDir } from '../../src/entity-crud/entity-loader';

function mktmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'entity-loader-'));
}

describe('entity-loader', () => {
  it('returns empty result when dir does not exist', () => {
    const r = loadEntitiesFromDir('/tmp/does-not-exist-' + Date.now());
    expect(r.declarations).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it('loads valid declarations', () => {
    const dir = mktmp();
    fs.writeFileSync(
      path.join(dir, 'user.entity.json'),
      JSON.stringify({
        entity: 'user',
        namespace: 'O',
        hashIdPrefix: 'U',
        table: 'users',
        fields: [{ key: 'hashId', type: 'id' }],
        audit: { eventPrefix: 'identity.user' },
      }),
    );
    const r = loadEntitiesFromDir(dir);
    expect(r.declarations.length).toBe(1);
    expect(r.declarations[0]!.entity).toBe('user');
    expect(r.errors).toEqual([]);
  });

  it('collects errors per bad file without crashing', () => {
    const dir = mktmp();
    fs.writeFileSync(path.join(dir, 'bad.entity.json'), '{not json');
    fs.writeFileSync(
      path.join(dir, 'invalid.entity.json'),
      JSON.stringify({ entity: 'x' }),
    );
    fs.writeFileSync(
      path.join(dir, 'good.entity.json'),
      JSON.stringify({
        entity: 'good',
        namespace: 'G',
        hashIdPrefix: 'G',
        table: 'goods',
        fields: [{ key: 'hashId', type: 'id' }],
        audit: { eventPrefix: 'svc.good' },
      }),
    );
    const r = loadEntitiesFromDir(dir);
    expect(r.declarations.length).toBe(1);
    expect(r.declarations[0]!.entity).toBe('good');
    expect(r.errors.length).toBe(2);
  });

  it('ignores non-entity JSON files', () => {
    const dir = mktmp();
    fs.writeFileSync(path.join(dir, 'config.json'), '{"bogus":true}');
    const r = loadEntitiesFromDir(dir);
    expect(r.declarations).toEqual([]);
    expect(r.errors).toEqual([]);
  });
});
