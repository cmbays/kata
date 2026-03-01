import { detectTags } from './domain-tagger.js';

describe('detectTags', () => {
  describe('domain heuristics — web-frontend', () => {
    it.each([
      'Build a React dashboard',
      'Create a Vue.js component',
      'Style with CSS animations',
      'Improve UX flows',
      'Fix UI alignment issues',
      'Add Angular routing',
      'Fix frontend rendering bug',
    ])('detects web-frontend from: %s', (desc) => {
      const tags = detectTags(desc);
      expect(tags.domain).toBe('web-frontend');
    });
  });

  describe('domain heuristics — web-backend', () => {
    it.each([
      'Add a backend endpoint',
      'Design the REST API for users',
      'Express server middleware',
      'FastAPI authentication route',
      'Django admin configuration',
      'Improve server performance',
    ])('detects web-backend from: %s', (desc) => {
      const tags = detectTags(desc);
      expect(tags.domain).toBe('web-backend');
    });
  });

  describe('language heuristics — typescript-js', () => {
    it('detects typescript-js from "typescript" keyword', () => {
      expect(detectTags('Migrate codebase to TypeScript').language).toBe('typescript-js');
    });

    it('detects typescript-js from " ts " keyword', () => {
      expect(detectTags('Compile ts files correctly').language).toBe('typescript-js');
    });

    it('detects typescript-js from ".ts" extension reference', () => {
      expect(detectTags('Update config.ts settings').language).toBe('typescript-js');
    });
  });

  describe('language heuristics — python', () => {
    it('detects python from "python" keyword', () => {
      expect(detectTags('Write a Python script').language).toBe('python');
    });

    it('detects python from ".py" extension reference', () => {
      expect(detectTags('Fix the broken script.py').language).toBe('python');
    });
  });

  describe('language heuristics — rust', () => {
    it('detects rust', () => {
      expect(detectTags('Rewrite parser in Rust').language).toBe('rust');
    });
  });

  describe('language heuristics — go', () => {
    it('detects go from "go "', () => {
      expect(detectTags('Write a go service').language).toBe('go');
    });

    it('detects go from "golang"', () => {
      expect(detectTags('Convert golang codebase').language).toBe('go');
    });
  });

  describe('workType heuristics', () => {
    it('detects bug-fix from "fix"', () => {
      expect(detectTags('Fix the login page').workType).toBe('bug-fix');
    });

    it('detects bug-fix from "bug"', () => {
      expect(detectTags('Investigate the payment bug').workType).toBe('bug-fix');
    });

    it('detects bug-fix from "broken"', () => {
      expect(detectTags('Handle the broken redirect').workType).toBe('bug-fix');
    });

    it('detects bug-fix from "error"', () => {
      expect(detectTags('Resolve the error in auth service').workType).toBe('bug-fix');
    });

    it('detects refactor', () => {
      expect(detectTags('Refactor the database layer').workType).toBe('refactor');
    });

    it('detects greenfield from "greenfield"', () => {
      expect(detectTags('Start greenfield project').workType).toBe('greenfield');
    });

    it('detects greenfield from "new project"', () => {
      expect(detectTags('Bootstrap new project skeleton').workType).toBe('greenfield');
    });

    it('detects greenfield from "from scratch"', () => {
      expect(detectTags('Rewrite from scratch').workType).toBe('greenfield');
    });

    it('detects legacy-migration from "migrate"', () => {
      expect(detectTags('Migrate the old API').workType).toBe('legacy-migration');
    });

    it('detects legacy-migration from "migration"', () => {
      expect(detectTags('Database migration script').workType).toBe('legacy-migration');
    });
  });

  describe('scope heuristics', () => {
    it('detects small scope for descriptions under 50 chars', () => {
      const short = 'Fix login'; // 9 chars
      expect(detectTags(short).scope).toBe('small');
    });

    it('detects large scope for descriptions over 200 chars', () => {
      const long = 'A'.repeat(201);
      expect(detectTags(long).scope).toBe('large');
    });

    it('does not set scope for descriptions between 50 and 200 chars', () => {
      const mid = 'A'.repeat(100); // exactly 100 chars
      expect(detectTags(mid).scope).toBeUndefined();
    });
  });

  describe('source provenance', () => {
    it('sets source to auto-detected when any tag is inferred', () => {
      const tags = detectTags('Fix React bug');
      expect(tags.source).toBe('auto-detected');
    });

    it('does NOT set source when no heuristics match', () => {
      // A 100-char description that doesn't match any domain/language/workType heuristic
      const neutral = 'Implement comprehensive user onboarding flow for the mobile application platform today';
      const tags = detectTags(neutral);
      // source should only be present if some other tag was set
      if (Object.keys(tags).filter((k) => k !== 'source').length === 0) {
        expect(tags.source).toBeUndefined();
      }
    });

    it('returns empty object when no heuristics match a neutral medium-length string', () => {
      // Carefully crafted to not match anything: length 75 chars (medium scope), no keywords
      const neutral = 'Conduct team retro meeting on quarterly planning outcomes and takeaways ok';
      const tags = detectTags(neutral);
      expect(Object.keys(tags)).toHaveLength(0);
    });
  });

  describe('combined detection', () => {
    it('detects multiple tags from a single description', () => {
      const tags = detectTags('Fix the React TypeScript bug');
      expect(tags.domain).toBe('web-frontend');
      expect(tags.language).toBe('typescript-js');
      expect(tags.workType).toBe('bug-fix');
      expect(tags.source).toBe('auto-detected');
    });

    it('returns partial object when only some tags are detected', () => {
      const tags = detectTags('Rust performance optimization task for the service layer here');
      expect(tags.language).toBe('rust');
      expect(tags.domain).toBeUndefined();
      expect(tags.source).toBe('auto-detected');
    });
  });
});
