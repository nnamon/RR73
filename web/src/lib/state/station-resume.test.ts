// @vitest-environment jsdom
// Resume audio after the radio's USB cable moved to another port: the browser lists the input
// under a new ID, and the tap finds it by its name, as Start audio does.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineState } from '../audio/engine';

const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('../audio/unlock', async (importOriginal) => ({ ...(await importOriginal<typeof import('../audio/unlock')>()), playClip: () => 0 }));

vi.mock('../audio/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../audio/engine')>();
  const failed: EngineState = { status: 'failed', reason: null, stoppedAtUtcMs: null, error: 'no-device' };
  const running: EngineState = { status: 'running', reason: null, stoppedAtUtcMs: null, error: null };
  /** An engine whose input is gone under its old ID and opens under the new one. */
  class FakeEngine {
    readonly mapper = { inputOffsetS: 0 };
    readonly output = { sinkId: null, error: null };
    state: EngineState = { status: 'stopped', reason: 'input-ended', stoppedAtUtcMs: 0, error: null };
    onState() {
      return () => undefined;
    }
    onReport() {
      return () => undefined;
    }
    onChunk() {
      return () => undefined;
    }
    onOutput() {
      return () => undefined;
    }
    useOutput() {
      return Promise.resolve(this.output);
    }
    async resume(): Promise<EngineState> {
      calls.push('resume');
      // The input ended, so resume opens it again by the ID it had.
      this.state = failed;
      return failed;
    }
    async start(id: string | null): Promise<EngineState> {
      calls.push(`start ${id}`);
      this.state = id === 'new-in' ? running : failed;
      return this.state;
    }
  }
  return { ...real, CaptureEngine: FakeEngine };
});

import { resumeAudio } from './station.svelte';
import { settings, updateSettings } from './settings.svelte';

const LABEL = 'Microphone (USB Audio CODEC)';

beforeEach(async () => {
  calls.length = 0;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      addEventListener: () => undefined,
      enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'new-in', label: LABEL, groupId: 'g' } as MediaDeviceInfo],
    },
  });
  await updateSettings({ inputDeviceId: 'old-in', inputDeviceLabel: LABEL });
});

describe('Resume audio', () => {
  it('finds an input that came back under a new ID by its name, saves the ID and starts it in the same tap', async () => {
    const st = await resumeAudio();
    expect(calls).toEqual(['resume', 'start new-in']);
    expect(st.status).toBe('running');
    expect(settings.inputDeviceId).toBe('new-in');
  });
});
