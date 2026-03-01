import type { Flavor } from '@domain/types/flavor.js';
import { formatFlavorDetail, formatFlavorTable } from './flavor-formatter.js';

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const minimalFlavor: Flavor = {
  name: 'tdd-build',
  stageCategory: 'build',
  steps: [{ stepName: 'write-tests', stepType: 'build' }],
  synthesisArtifact: 'build-output',
};

describe('formatFlavorDetail', () => {
  it('renders flavor name, stage, and synthesis artifact', () => {
    const out = formatFlavorDetail(minimalFlavor, true);
    expect(out).toContain('tdd-build');
    expect(out).toContain('build');
    expect(out).toContain('build-output');
  });

  it('renders step names', () => {
    const out = formatFlavorDetail(minimalFlavor, true);
    expect(out).toContain('write-tests');
  });

  it('renders description when present', () => {
    const out = formatFlavorDetail({ ...minimalFlavor, description: 'Test-first build' }, true);
    expect(out).toContain('Test-first build');
  });

  it('renders agent line when kataka uuid is set', () => {
    const flavor: Flavor = { ...minimalFlavor, kataka: VALID_UUID };
    const out = formatFlavorDetail(flavor, true);
    expect(out).toContain('Agent');
    expect(out).toContain(VALID_UUID);
  });

  it('omits agent line when kataka is not set', () => {
    const out = formatFlavorDetail(minimalFlavor, true);
    expect(out).not.toContain('Agent:');
  });

  it('renders overrides when present', () => {
    const flavor: Flavor = {
      ...minimalFlavor,
      overrides: { 'write-tests': { humanApproval: true, timeout: 30000 } },
    };
    const out = formatFlavorDetail(flavor, true);
    expect(out).toContain('write-tests');
    expect(out).toContain('humanApproval: true');
  });
});

describe('formatFlavorTable', () => {
  it('returns empty message for empty list', () => {
    expect(formatFlavorTable([], true)).toContain('No flavors');
  });

  it('renders flavor name in table', () => {
    const out = formatFlavorTable([minimalFlavor], true);
    expect(out).toContain('tdd-build');
  });

  it('renders multiple flavors', () => {
    const second: Flavor = {
      name: 'security-review',
      stageCategory: 'review',
      steps: [{ stepName: 'audit', stepType: 'review' }],
      synthesisArtifact: 'security-report',
    };
    const out = formatFlavorTable([minimalFlavor, second], true);
    expect(out).toContain('tdd-build');
    expect(out).toContain('security-review');
  });
});
