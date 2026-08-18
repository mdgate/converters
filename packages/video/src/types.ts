export type VideoMime =
  | 'video/mp4'
  | 'video/quicktime'
  | 'video/webm'
  | 'video/x-matroska'
  | 'video/x-msvideo';

export type VideoInput = {
  bytes: Uint8Array;
  mime: VideoMime;
};

export type ConvertVideo = (input: VideoInput) => Promise<string>;
