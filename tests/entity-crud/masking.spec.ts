import {
  shouldMask,
  applyPattern,
  maskRow,
  maskRows,
} from '../../src/entity-crud/masking';

const emailRule = {
  field: 'emailToken',
  pattern: '(.{2}).*(@.*)',
  replacement: '$1***$2',
  unlessPrivilege: 'identity.user.pii.view',
  unlessRole: ['superadmin', 'platform_admin'],
};

describe('masking — shouldMask', () => {
  it('masks when user has neither unless-privilege nor unless-role', () => {
    expect(shouldMask(emailRule, { role: 'user', privileges: [] })).toBe(true);
  });

  it('skips mask when user has unless-privilege', () => {
    expect(
      shouldMask(emailRule, {
        role: 'user',
        privileges: ['identity.user.pii.view'],
      }),
    ).toBe(false);
  });

  it('skips mask when user has unless-role', () => {
    expect(
      shouldMask(emailRule, { role: 'superadmin', privileges: [] }),
    ).toBe(false);
    expect(
      shouldMask(emailRule, { role: 'platform_admin', privileges: [] }),
    ).toBe(false);
  });

  it('masks for unrelated role with no privilege', () => {
    expect(
      shouldMask(emailRule, { role: 'auditor', privileges: [] }),
    ).toBe(true);
  });

  it('masks when ctx has no role/privileges', () => {
    expect(shouldMask(emailRule, {})).toBe(true);
  });

  it('rule with only unlessPrivilege ignores role', () => {
    const r = { ...emailRule };
    delete (r as any).unlessRole;
    expect(shouldMask(r, { role: 'superadmin' })).toBe(true);
    expect(shouldMask(r, { privileges: ['identity.user.pii.view'] })).toBe(
      false,
    );
  });

  it('rule with only unlessRole ignores privilege', () => {
    const r = { ...emailRule };
    delete (r as any).unlessPrivilege;
    expect(
      shouldMask(r, { privileges: ['identity.user.pii.view'] }),
    ).toBe(true);
    expect(shouldMask(r, { role: 'superadmin' })).toBe(false);
  });
});

describe('masking — applyPattern', () => {
  it('applies the regex replace', () => {
    expect(applyPattern('alice@example.com', '(.{2}).*(@.*)', '$1***$2')).toBe(
      'al***@example.com',
    );
  });

  it('passes through non-string values', () => {
    expect(applyPattern(42, '(.+)', '$1')).toBe(42);
    expect(applyPattern(null, '(.+)', '$1')).toBeNull();
  });

  it('returns original value on bad regex', () => {
    expect(applyPattern('hi', '(', '$1')).toBe('hi');
  });
});

describe('masking — maskRow / maskRows', () => {
  it('masks applicable fields on a single row', () => {
    const row = { emailToken: 'alice@example.com', displayName: 'Alice' };
    const masked = maskRow({ ...row }, [emailRule], {
      role: 'user',
      privileges: [],
    });
    expect(masked.emailToken).toBe('al***@example.com');
    expect(masked.displayName).toBe('Alice');
  });

  it('leaves row untouched when role allows bypass', () => {
    const row = { emailToken: 'alice@example.com' };
    const masked = maskRow({ ...row }, [emailRule], {
      role: 'superadmin',
      privileges: [],
    });
    expect(masked.emailToken).toBe('alice@example.com');
  });

  it('skips fields not present on the row', () => {
    const row = { displayName: 'Alice' };
    const masked = maskRow({ ...row }, [emailRule], { role: 'user' });
    expect(masked.displayName).toBe('Alice');
    expect('emailToken' in masked).toBe(false);
  });

  it('maskRows returns a new array with masked copies', () => {
    const rows = [
      { emailToken: 'alice@b.com' },
      { emailToken: 'charlie@d.com' },
    ];
    const masked = maskRows(rows, [emailRule], { role: 'user' });
    expect(masked).toHaveLength(2);
    expect(masked[0]!.emailToken).toBe('al***@b.com');
    expect(masked[1]!.emailToken).toBe('ch***@d.com');
    // original rows untouched
    expect(rows[0]!.emailToken).toBe('alice@b.com');
  });

  it('maskRows with no rules returns input unchanged', () => {
    const rows = [{ a: 1 }];
    expect(maskRows(rows as any, [], {})).toBe(rows);
  });
});
