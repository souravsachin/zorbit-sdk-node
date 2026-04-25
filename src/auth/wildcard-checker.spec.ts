import { matchWildcard, hasPrivilege, hasAllPrivileges } from './wildcard-checker';

describe('matchWildcard', () => {
  it('matches exact codes', () => {
    expect(matchWildcard('datatable.page.create', 'datatable.page.create')).toBe(true);
    expect(matchWildcard('datatable.page.create', 'datatable.page.delete')).toBe(false);
  });

  it('honours *.all wildcards as global super-admin claim (per MSG-037 spec)', () => {
    // Owner contract: 'platform.admin.all' matches anything. Documents the
    // intentional super-admin semantic — *not* a hierarchical match.
    expect(matchWildcard('platform.admin.all', 'platform.admin.users.create')).toBe(true);
    expect(matchWildcard('platform.admin.all', 'platform.admin')).toBe(true);
    expect(matchWildcard('platform.admin.all', 'business.broker.read')).toBe(true);
    expect(matchWildcard('audit.all', 'datatable.page.create')).toBe(true);
  });

  it('matches single-segment * wildcards', () => {
    expect(matchWildcard('business.*.read', 'business.broker.read')).toBe(true);
    expect(matchWildcard('business.*.read', 'business.deeply.nested.read')).toBe(false);
    expect(matchWildcard('business.*.read', 'business.broker.write')).toBe(false);
  });

  it('matches multi-segment ** wildcards', () => {
    expect(matchWildcard('platform.**', 'platform.audit.view.deep')).toBe(true);
    expect(matchWildcard('platform.**', 'business.audit.view')).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(matchWildcard('', 'foo.bar')).toBe(false);
    expect(matchWildcard('foo.bar', '')).toBe(false);
  });
});

describe('hasPrivilege', () => {
  it('honours explicit privileges (legacy fat JWT)', () => {
    expect(
      hasPrivilege({ privileges: ['datatable.page.create'] }, 'datatable.page.create'),
    ).toBe(true);
    expect(
      hasPrivilege({ privileges: ['datatable.page.create'] }, 'datatable.page.delete'),
    ).toBe(false);
  });

  it('honours wildcards array (slim JWT)', () => {
    expect(
      hasPrivilege({ wildcards: ['platform.admin.all'] }, 'datatable.page.create'),
    ).toBe(true);
    expect(
      hasPrivilege({ wildcards: ['business.*.read'] }, 'business.broker.read'),
    ).toBe(true);
    expect(
      hasPrivilege({ wildcards: ['business.*.read'] }, 'business.broker.write'),
    ).toBe(false);
  });

  it('detects wildcards even when stuffed into the privileges array', () => {
    expect(
      hasPrivilege({ privileges: ['platform.admin.all'] }, 'foo.bar.baz'),
    ).toBe(true);
  });

  it('returns false when neither privileges nor wildcards match', () => {
    expect(hasPrivilege({}, 'datatable.page.create')).toBe(false);
    expect(hasPrivilege({ wildcards: [] }, 'datatable.page.create')).toBe(false);
  });
});

describe('hasAllPrivileges', () => {
  it('requires every privilege to match', () => {
    expect(
      hasAllPrivileges({ wildcards: ['platform.admin.all'] }, ['a.b.c', 'd.e.f']),
    ).toBe(true);
    expect(
      hasAllPrivileges({ privileges: ['a.b.c'] }, ['a.b.c', 'd.e.f']),
    ).toBe(false);
  });

  it('passes for empty required list', () => {
    expect(hasAllPrivileges({}, [])).toBe(true);
  });
});
