/**
 * iOS audio session (Safari 16.4 and later). "play-and-record" lets the microphone run while
 * output plays, and the silent switch does not mute it.
 */

type AudioSessionType = 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record';

interface NavigatorWithSession {
  audioSession?: { type: AudioSessionType };
}

/** Sets the session type; returns the type now in force, or null where the API is missing. */
export function setAudioSession(type: AudioSessionType, nav: Navigator = navigator): AudioSessionType | null {
  const s = (nav as Navigator & NavigatorWithSession).audioSession;
  if (!s) return null;
  try {
    s.type = type;
    return s.type;
  } catch {
    return null;
  }
}
