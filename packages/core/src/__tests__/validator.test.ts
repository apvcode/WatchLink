import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_BYTES } from '../constants.js';
import { MessageValidator } from '../validator.js';

describe('MessageValidator', () => {
  it('validates hello messages correctly', () => {
    const validator = new MessageValidator();
    const res = validator.parseAndValidate(
      JSON.stringify({ v: 2, type: 'hello', peerId: 'peer1', name: 'Alice' }),
      'peer1',
    );
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.msg.type).toBe('hello');
    }
  });

  it('rejects payloads exceeding MAX_MESSAGE_BYTES (8 KB)', () => {
    const validator = new MessageValidator();
    const bigText = 'a'.repeat(MAX_MESSAGE_BYTES + 100);
    const res = validator.parseAndValidate(bigText, 'peer1');
    expect(res.valid).toBe(false);
    expect((res as any).reason).toBe('PAYLOAD_TOO_LARGE');
  });

  it('enforces rate limiting at 20 msg/sec per peer', () => {
    const validator = new MessageValidator(20, 20);
    const now = 1000000;
    // 20 messages should pass
    for (let i = 0; i < 20; i++) {
      const allowed = validator.checkRateLimit('peer1', now);
      expect(allowed).toBe(true);
    }
    // 21st message in the same millisecond must be rejected
    const blocked = validator.checkRateLimit('peer1', now);
    expect(blocked).toBe(false);

    // After 100ms, 2 tokens replenish
    const replenished = validator.checkRateLimit('peer1', now + 100);
    expect(replenished).toBe(true);
  });

  it('fuzz testing: rejects malformed JSON and random garbage without throwing', () => {
    const validator = new MessageValidator(1000, 1000); // high rate limit for fuzz
    const garbageInputs = [
      '',
      '{',
      '}{',
      'null',
      '123',
      '[1, 2, 3]',
      JSON.stringify({ v: 2, type: 'hello' }), // unsupported version
      JSON.stringify({ v: 2, type: 'unknown_type' }),
      JSON.stringify({ v: 2, type: 'cmd', lamport: 'invalid' }),
      JSON.stringify({ v: 2, type: 'cmd', lamport: 1, from: 'p1', action: 'drop_database' }),
      JSON.stringify({ v: 2, type: 'state', position: -5 }),
      JSON.stringify({ v: 2, type: 'chat', text: 123 }),
    ];

    for (const input of garbageInputs) {
      expect(() => {
        const res = validator.parseAndValidate(input, 'fuzz_peer');
        expect(res.valid).toBe(false);
      }).not.toThrow();
    }
  });

  it('validates all protocol message types', () => {
    const validator = new MessageValidator();

    expect(
      validator.parseAndValidate(JSON.stringify({ v: 2, type: 'clock.ping', t0: 12345 }), 'peer1')
        .valid,
    ).toBe(true);

    expect(
      validator.parseAndValidate(
        JSON.stringify({ v: 2, type: 'clock.pong', t0: 100, t1: 150, t2: 155 }),
        'peer1',
      ).valid,
    ).toBe(true);

    expect(
      validator.parseAndValidate(
        JSON.stringify({
          v: 2,
          type: 'cmd',
          lamport: 1,
          from: 'peer1',
          action: 'play',
          position: 10,
          rate: 1,
          startAt: 200,
        }),
        'peer1',
      ).valid,
    ).toBe(true);

    expect(
      validator.parseAndValidate(
        JSON.stringify({
          v: 2,
          type: 'state',
          url: 'https://example.com',
          playing: true,
          position: 5,
          rate: 1,
          at: 1000,
          hold: false,
        }),
        'peer1',
      ).valid,
    ).toBe(true);

    expect(
      validator.parseAndValidate(
        JSON.stringify({ v: 2, type: 'buffering', peerId: 'peer1', on: true }),
        'peer1',
      ).valid,
    ).toBe(true);

    expect(
      validator.parseAndValidate(
        JSON.stringify({ v: 2, type: 'chat', id: 'c1', text: 'hello world', ts: 1000 }),
        'peer1',
      ).valid,
    ).toBe(true);

    expect(
      validator.parseAndValidate(JSON.stringify({ v: 2, type: 'bye', peerId: 'peer1' }), 'peer1')
        .valid,
    ).toBe(true);

    expect(
      validator.parseAndValidate(
        JSON.stringify({ v: 2, type: 'error', code: 'ROOM_FULL', message: 'full' }),
        'peer1',
      ).valid,
    ).toBe(true);
  });
  describe('chat replies', () => {
    const chat = (extra: Record<string, unknown>) =>
      JSON.stringify({ v: 2, type: 'chat', id: 'c2', text: 'yes', ts: 1000, ...extra });

    it('keeps a well-formed quote', () => {
      const res = new MessageValidator().parseAndValidate(
        chat({ re: { id: 'c1', name: 'Bob', text: 'hello?' } }),
        'p',
      );
      expect(res.valid).toBe(true);
      if (res.valid && res.msg.type === 'chat') {
        expect(res.msg.re).toEqual({ id: 'c1', name: 'Bob', text: 'hello?' });
      }
    });

    it('keeps the photo flag and strips unknown quote fields', () => {
      const res = new MessageValidator().parseAndValidate(
        chat({ re: { id: 'c1', name: 'Bob', text: '', img: true, evil: 1 } }),
        'p',
      );
      expect(res.valid).toBe(true);
      if (res.valid && res.msg.type === 'chat') {
        expect(res.msg.re).toEqual({ id: 'c1', name: 'Bob', text: '', img: true });
      }
    });

    it('accepts a plain message without a quote', () => {
      const res = new MessageValidator().parseAndValidate(chat({}), 'p');
      expect(res.valid).toBe(true);
      if (res.valid && res.msg.type === 'chat') expect(res.msg.re).toBeUndefined();
    });

    it.each([
      ['null', null],
      ['a string', 'x'],
      ['no id', { name: 'Bob', text: 'hi' }],
      ['empty id', { id: '', name: 'Bob', text: 'hi' }],
      ['long name', { id: 'c1', name: 'n'.repeat(49), text: 'hi' }],
      ['long text', { id: 'c1', name: 'Bob', text: 't'.repeat(141) }],
      ['numeric text', { id: 'c1', name: 'Bob', text: 5 }],
      ['non-boolean img', { id: 'c1', name: 'Bob', text: '', img: 'yes' }],
    ])('rejects a malformed quote (%s)', (_label, re) => {
      const res = new MessageValidator().parseAndValidate(chat({ re }), 'p');
      expect(res.valid).toBe(false);
      if (!res.valid) expect(res.reason).toBe('INVALID_CHAT_REPLY');
    });
  });
});
