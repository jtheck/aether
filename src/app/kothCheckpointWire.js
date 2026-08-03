// Checkpoint chunking for P2P transfer (JSON over GetFire data channel).

import { chunkJson } from '../sim/worldCheckpoint.js';

export const CHECKPOINT_CHUNK_CHARS = 48_000;
export const LEDGER_CHUNK_FRAMES = 80;

/** @returns {{ transferId: string, total: number, chunks: string[] }} */
export function packCheckpointChunks(checkpoint, transferId) {
  const json = JSON.stringify(checkpoint);
  const chunks = chunkJson(json, CHECKPOINT_CHUNK_CHARS);
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
export function packLedgerChunks(frames, transferId) {
  const chunks = [];
  for (let i = 0; i < frames.length; i += LEDGER_CHUNK_FRAMES) {
    chunks.push(frames.slice(i, i + LEDGER_CHUNK_FRAMES));
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
