import { describe, expect, it } from 'vitest';
import { SendQueue } from './queue';

describe('the send queue', () => {
  it('gives characters from the front, and a mark once its text is taken', () => {
    const q = new SendQueue<string>();
    q.append('CQ ');
    q.append('TU 9V1NE', 'log');
    expect(q.take(3)).toEqual({ text: 'CQ ', marks: [] });
    expect(q.take(7)).toEqual({ text: 'TU 9V1N', marks: [] });
    expect(q.take(5)).toEqual({ text: 'E', marks: ['log'] });
    expect(q.text).toBe('');
  });

  it('moves a mark with an edit before it and drops it when its text is deleted', () => {
    const q = new SendQueue<string>();
    q.append('HELLO ');
    q.append('TU', 'log');
    q.edit('HI TU');
    expect(q.pending).toEqual(['log']);
    expect(q.take(4)).toEqual({ text: 'HI T', marks: [] });
    expect(q.take(1)).toEqual({ text: 'U', marks: ['log'] });

    q.append('TU', 'log');
    q.backspace();
    expect(q.pending).toEqual(['log']);
    q.backspace();
    expect(q.pending).toEqual([]);
  });

  it('keeps a mark when text is added after it, and clears everything', () => {
    const q = new SendQueue<string>();
    q.append('TU', 'log');
    q.edit('TU K');
    expect(q.take(2).marks).toEqual(['log']);
    q.append('X', 'm');
    q.clear();
    expect(q.text).toBe('');
    expect(q.pending).toEqual([]);
  });
});
