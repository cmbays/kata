import { slugify, generateTeammateName } from './naming.js';

describe('slugify', () => {
  it('converts spaces to hyphens and lowercases', () => {
    expect(slugify('Add OAuth2 Login')).toBe('add-oauth2-login');
  });

  it('removes non-alphanumeric characters', () => {
    expect(slugify('Fix bug #123!')).toBe('fix-bug-123');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('foo---bar')).toBe('foo-bar');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello');
  });

  it('truncates to maxLength (default 20)', () => {
    const long = 'this-is-a-very-long-description-that-exceeds';
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it('does not leave trailing hyphen after truncation', () => {
    // 'abcdefghij-klmnopqrst' truncated to 20 = 'abcdefghij-klmnopqrs' → no trailing hyphen
    const result = slugify('abcdefghij klmnopqrst uvwxyz');
    expect(result).not.toMatch(/-$/);
  });

  it('respects custom maxLength', () => {
    expect(slugify('hello world foo', 5)).toBe('hello');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });
});

describe('generateTeammateName', () => {
  it('produces {slug}/{kataka} format', () => {
    expect(generateTeammateName('Add OAuth2 Login', 'bugfix-ts')).toBe('add-oauth2-login/bugfix-ts');
  });

  it('truncates long bet descriptions', () => {
    const name = generateTeammateName('This is a very long bet description that should be truncated', 'research-deep');
    expect(name).toMatch(/^[a-z0-9-]{1,20}\/research-deep$/);
  });

  it('does not append index when 0', () => {
    expect(generateTeammateName('auth fix', 'bugfix-ts', 0)).toBe('auth-fix/bugfix-ts');
  });

  it('does not append index when undefined', () => {
    expect(generateTeammateName('auth fix', 'bugfix-ts')).toBe('auth-fix/bugfix-ts');
  });

  it('appends index when > 0', () => {
    expect(generateTeammateName('auth fix', 'bugfix-ts', 2)).toBe('auth-fix/bugfix-ts-2');
  });

  it('handles special characters in bet description', () => {
    expect(generateTeammateName('Fix bug #42 (urgent!)', 'review')).toBe('fix-bug-42-urgent/review');
  });

  it('uses "unnamed" when bet description slugifies to empty', () => {
    expect(generateTeammateName('!!!', 'bugfix-ts')).toBe('unnamed/bugfix-ts');
    expect(generateTeammateName('', 'review')).toBe('unnamed/review');
  });
});
