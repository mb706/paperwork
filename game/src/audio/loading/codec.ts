// The codec probe (10 §9.4, "Safari and the AAC fallback"): at start-up the engine decodes a 0.1 s Ogg
// Opus probe with decodeAudioData and asks the media element whether it plays Ogg Opus (the menu loop and
// recordings stream through one). Ogg Opus support in Safari depends on its version and the OS's, so only
// the probe decides. If either fails, the engine loads the AAC pack (.m4a).

export type Codec = 'ogg' | 'm4a';

export interface ProbeResult {
  codec: Codec;
  decodes: boolean;
  mediaPlays: boolean;
}

export async function probeCodec(
  decode: (bytes: ArrayBuffer) => Promise<unknown>,
  probeBytes: () => Promise<ArrayBuffer>,
  canPlayType: (type: string) => string = (t) =>
    typeof document === 'undefined' ? '' : document.createElement('audio').canPlayType(t),
): Promise<ProbeResult> {
  const mediaPlays = canPlayType('audio/ogg; codecs=opus') !== '';
  let decodes = false;
  try {
    await decode(await probeBytes());
    decodes = true;
  } catch {
    decodes = false;
  }
  return { codec: decodes && mediaPlays ? 'ogg' : 'm4a', decodes, mediaPlays };
}

export const MIME: Readonly<Record<Codec, string>> = {
  ogg: 'audio/ogg; codecs=opus',
  m4a: 'audio/mp4; codecs=mp4a.40.2',
};
