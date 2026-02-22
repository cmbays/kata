import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, setLoggerOptions } from './logger.js';

describe('logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // Reset to default (info level, text mode)
    setLoggerOptions({ level: 'info' });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    setLoggerOptions({});
  });

  it('logs info messages by default', () => {
    logger.info('hello');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('hello'));
  });

  it('logs warn messages', () => {
    logger.warn('watch out');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('watch out'));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[warn]'));
  });

  it('logs error messages in red', () => {
    logger.error('failure');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('failure'));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[error]'));
  });

  it('suppresses debug messages at info level', () => {
    logger.debug('hidden');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('shows debug messages when level is debug', () => {
    setLoggerOptions({ level: 'debug' });
    logger.debug('visible');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('visible'));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[debug]'));
  });

  it('includes data in output', () => {
    logger.info('with data', { key: 'value' });
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('"key":"value"'));
  });

  describe('JSON mode', () => {
    beforeEach(() => {
      setLoggerOptions({ json: true });
    });

    it('outputs structured JSON', () => {
      logger.info('json msg');
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output.trim());
      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('json msg');
      expect(parsed.timestamp).toBeDefined();
    });

    it('includes data fields in JSON', () => {
      logger.warn('json warn', { count: 5 });
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output.trim());
      expect(parsed.count).toBe(5);
    });
  });

  describe('child logger', () => {
    it('creates a child that merges default data', () => {
      const child = logger.child({ component: 'test' });
      child.info('child msg');
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('child msg'));
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('"component":"test"'));
    });

    it('child data can be overridden per-call', () => {
      const child = logger.child({ component: 'default' });
      child.info('override', { component: 'custom' });
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('"component":"custom"'));
    });
  });

  describe('setLoggerOptions', () => {
    it('can set warn level to suppress info', () => {
      setLoggerOptions({ level: 'warn' });
      logger.info('suppressed');
      expect(stderrSpy).not.toHaveBeenCalled();
      logger.warn('visible');
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('visible'));
    });

    it('can set error level to suppress warn', () => {
      setLoggerOptions({ level: 'error' });
      logger.warn('suppressed');
      expect(stderrSpy).not.toHaveBeenCalled();
      logger.error('visible');
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('visible'));
    });
  });
});
