// Binary wire format for audio.chunk, per docs/audio-streaming-contract.md §6.2:
//
//   [ metadata_length: uint32 big-endian ][ metadata: UTF-8 JSON ][ PCM payload ]
//
// Only standard ArrayBuffer/DataView/TextEncoder APIs are used so this module
// runs unmodified in both the browser client and the Node mock gateway.

import type { AudioChunkMetadata } from './types';

const LENGTH_PREFIX_BYTES = 4;

export function encodeAudioFrame(metadata: AudioChunkMetadata, payload: Int16Array): ArrayBuffer {
  const json = JSON.stringify(metadata);
  const metadataBytes = new TextEncoder().encode(json);
  const payloadBytes = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);

  const frame = new ArrayBuffer(LENGTH_PREFIX_BYTES + metadataBytes.byteLength + payloadBytes.byteLength);
  const view = new DataView(frame);
  view.setUint32(0, metadataBytes.byteLength, false);

  const bytes = new Uint8Array(frame);
  bytes.set(metadataBytes, LENGTH_PREFIX_BYTES);
  bytes.set(payloadBytes, LENGTH_PREFIX_BYTES + metadataBytes.byteLength);

  return frame;
}

export interface DecodedAudioFrame {
  metadata: AudioChunkMetadata;
  payload: Int16Array;
}

export function decodeAudioFrame(buffer: ArrayBuffer): DecodedAudioFrame {
  const view = new DataView(buffer);
  const metadataLength = view.getUint32(0, false);
  const metadataBytes = new Uint8Array(buffer, LENGTH_PREFIX_BYTES, metadataLength);
  const metadata = JSON.parse(new TextDecoder().decode(metadataBytes)) as AudioChunkMetadata;

  const payloadOffset = LENGTH_PREFIX_BYTES + metadataLength;
  const payloadByteLength = buffer.byteLength - payloadOffset;

  // Copy into a fresh buffer so the resulting Int16Array is always
  // 2-byte aligned, regardless of where the payload happened to start.
  const payloadBytes = new Uint8Array(buffer, payloadOffset, payloadByteLength);
  const aligned = new Uint8Array(payloadBytes.byteLength);
  aligned.set(payloadBytes);
  const payload = new Int16Array(aligned.buffer);

  return { metadata, payload };
}
