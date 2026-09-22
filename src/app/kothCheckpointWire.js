// Checkpoint chunking for P2P transfer (JSON over GetFire data channel).

import { chunkJson } from '../sim/worldCheckpoint.js';

export const CHECKPOINT_CHUNK_CHARS = 48_000;
/** Server-relayed broadcast has a smaller per-message budget than RTC. */
export const BROADCAST_CHUNK_CHARS = 24_000;
export const LEDGER_CHUNK_FRAMES = 80;
export const BROADCAST_LEDGER_CHUNK_FRAMES = 40;

/** @returns {{ transferId: string, total: number, chunks: string[] }} */
export function packCheckpointChunks(checkpoint, transferId, chunkChars = CHECKPOINT_CHUNK_CHARS) {
  const json = JSON.stringify(checkpoint);
  const chunks = chunkJson(json, chunkChars);
  return { transferId, total: chunks.length, chunks };
}

export function createChunkAssembler() {
  /** @type {Map<string, { total: number, parts: Map<number, string>, meta: object }>} */
  const pending = new Map();

  return {
    /**
     * @returns {object | null} assembled checkpoint when complete
     */
    push(transferId, index, total, text, meta = {}) {
      if (!transferId) return null;
      let entry = pending.get(transferId);
      if (!entry) {
        entry = { total: total | 0, parts: new Map(), meta };
        pending.set(transferId, entry);
      }
      entry.total = total | 0;
      entry.meta = { ...entry.meta, ...meta };
      entry.parts.set(index | 0, text);
      if (entry.parts.size < entry.total) return null;
      let json = '';
      for (let i = 0; i < entry.total; i++) {
        const part = entry.parts.get(i);
        if (part == null) return null;
        json += part;
      }
      pending.delete(transferId);
      return { checkpoint: JSON.parse(json), meta: entry.meta };
    },
    clear(transferId) {
      if (transferId) pending.delete(transferId);
      else pending.clear();
    },
  };
}

/** Split ledger frames into wire chunks. */
export function packLedgerChunks(frames, transferId, framesPerChunk = LEDGER_CHUNK_FRAMES) {
  const chunks = [];
  const size = Math.max(1, framesPerChunk | 0);
  for (let i = 0; i < frames.length; i += size) {
    chunks.push(frames.slice(i, i + size));
  }
  if (!chunks.length) chunks.push([]);
  return { transferId, total: chunks.length, chunks };
}

export function createLedgerAssembler() {
  /** @type {Map<string, { total: number, parts: Map<number, object[]>, meta: object }>} */
  const pending = new Map();

  return {
    push(transferId, index, total, frames, meta = {}) {
      if (!transferId) return null;
      let entry = pending.get(transferId);
      if (!entry) {
        entry = { total: total | 0, parts: new Map(), meta };
        pending.set(transferId, entry);
      }
      entry.total = total | 0;
      entry.meta = { ...entry.meta, ...meta };
      entry.parts.set(index | 0, frames ?? []);
      if (entry.parts.size < entry.total) return null;
      const out = [];
      for (let i = 0; i < entry.total; i++) {
        const part = entry.parts.get(i);
        if (part == null) return null;
        out.push(...part);
      }
      pending.delete(transferId);
      return { ledger: out, meta: entry.meta };
    },
    clear(transferId) {
      if (transferId) pending.delete(transferId);
      else pending.clear();
    },
  };
}
