export type AudioMime =
  | 'audio/mpeg'
  | 'audio/wav'
  | 'audio/x-wav'
  | 'audio/m4a'
  | 'audio/aac'
  | 'audio/ogg'
  | 'audio/webm'
  | 'audio/flac';

export type AudioInput = {
  bytes: Uint8Array;
  mime: AudioMime;
};

export type ConvertAudio = (input: AudioInput) => Promise<string>;
