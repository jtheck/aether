// Determinism Module for Aether RTS
// Provides deterministic random number generation, state checksums, and replay support
// All multiplayer-critical random operations MUST use this module

(function(global) {
  'use strict';

  // ============================================================================
  // MULBERRY32 - Deterministic PRNG
  // ============================================================================
  // This PRNG produces identical output on all platforms given the same seed.
  // Unlike Math.sin()-based PRNGs, it doesn't rely on transcendental functions
  // that can vary between CPU/browser implementations.
  
  // ============================================================================
  // DETERMINISTIC STRING COMPARISON
  // ============================================================================
  // localeCompare() is NON-DETERMINISTIC across browsers/locales!
  // This function provides a deterministic alternative for sorting.
  
  /**
   * Deterministic string comparison (locale-independent)
   * @param {string} a - First string
   * @param {string} b - Second string
   * @returns {number} -1, 0, or 1
   */
  function deterministicStringCompare(a, b) {
    if (a === b) return 0;
    if (a < b) return -1;
    return 1;
  }

  /**
   * Create a mulberry32 PRNG instance
   * @param {number} seed - Initial seed value (32-bit integer)
   * @returns {function} Function that returns next random number [0, 1)
   */
  function mulberry32(seed) {
    // Ensure seed is a 32-bit integer
    let state = seed >>> 0;
    
    return function() {
      state |= 0; // Ensure 32-bit integer
      state = (state + 0x6D2B79F5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ============================================================================
  // SEEDED RANDOM CLASS
  // ============================================================================
  // A stateful random number generator that can be shared across game systems.
  // Supports saving/restoring state for replay synchronization.
  
  class SeededRandom {
    constructor(seed = 12345) {
      this.initialSeed = seed >>> 0;
      this.callCount = 0;
      this._rng = mulberry32(this.initialSeed);
    }
    
    /**
     * Get next random number in range [0, 1)
     * @returns {number}
     */
    next() {
      this.callCount++;
      return this._rng();
    }
    
    /**
     * Get random integer in range [min, max] (inclusive)
     * @param {number} min 
     * @param {number} max 
     * @returns {number}
     */
    nextInt(min, max) {
      return Math.floor(this.next() * (max - min + 1)) + min;
    }
    
    /**
     * Get random float in range [min, max)
     * @param {number} min 
     * @param {number} max 
     * @returns {number}
     */
    nextFloat(min, max) {
      return this.next() * (max - min) + min;
    }
    
    /**
     * Get random boolean with given probability of true
     * @param {number} probability - Probability of true [0, 1], default 0.5
     * @returns {boolean}
     */
    nextBool(probability = 0.5) {
      return this.next() < probability;
    }
    
    /**
     * Pick random element from array
     * @param {Array} array 
     * @returns {*}
     */
    pick(array) {
      if (!array || array.length === 0) return undefined;
      return array[Math.floor(this.next() * array.length)];
    }
    
    /**
     * Shuffle array in place (Fisher-Yates)
     * @param {Array} array 
     * @returns {Array} The same array, shuffled
     */
    shuffle(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    }
    
    /**
     * Get current state for serialization
     * @returns {Object}
     */
    getState() {
      return {
        seed: this.initialSeed,
        callCount: this.callCount
      };
    }
    
    /**
     * Restore state from serialization (replays calls to get same position)
     * @param {Object} state 
     */
    restoreState(state) {
      this.initialSeed = state.seed >>> 0;
      this.callCount = 0;
      this._rng = mulberry32(this.initialSeed);
      
      // Fast-forward to the saved position
      for (let i = 0; i < state.callCount; i++) {
        this._rng();
      }
      this.callCount = state.callCount;
    }
    
    /**
     * Reset to initial seed
     */
    reset() {
      this.callCount = 0;
      this._rng = mulberry32(this.initialSeed);
    }
    
    /**
     * Create new instance with different seed
     * @param {number} seed 
     * @returns {SeededRandom}
     */
    fork(seed) {
      return new SeededRandom(seed);
    }
  }

  // ============================================================================
  // GLOBAL MATCH RNG
  // ============================================================================
  // Single source of randomness for the current match.
  // Initialized when match starts, used by all game systems.
  
  let matchRng = null;
  
  /**
   * Initialize the match RNG with a seed
   * @param {number} seed - Map seed or match seed
   */
  function initMatchRng(seed) {
    matchRng = new SeededRandom(seed);
  }
  
  /**
   * Get the current match RNG instance
   * @returns {SeededRandom}
   */
  function getMatchRng() {
    if (!matchRng) {
      console.warn('⚠️ Match RNG not initialized, using default seed');
      matchRng = new SeededRandom(12345);
    }
    return matchRng;
  }
  
  /**
   * Convenience: Get next random number from match RNG
   * @returns {number} Random value in [0, 1)
   */
  function random() {
    return getMatchRng().next();
  }
  
  /**
   * Convenience: Get random int from match RNG
   * @param {number} min 
   * @param {number} max 
   * @returns {number}
   */
  function randomInt(min, max) {
    return getMatchRng().nextInt(min, max);
  }
  
  /**
   * Convenience: Get random float from match RNG
   * @param {number} min 
   * @param {number} max 
   * @returns {number}
   */
  function randomFloat(min, max) {
    return getMatchRng().nextFloat(min, max);
  }

  // ============================================================================
  // FIXED-POINT MATH HELPERS
  // ============================================================================
  // For critical physics calculations, use fixed-point to avoid FP drift
  
  const FIXED_SCALE = 1000; // 3 decimal places of precision
  
  /**
   * Convert float to fixed-point integer
   * @param {number} value 
   * @returns {number}
   */
  function toFixed(value) {
    return Math.round(value * FIXED_SCALE);
  }
  
  /**
   * Convert fixed-point integer to float
   * @param {number} fixed 
   * @returns {number}
   */
  function fromFixed(fixed) {
    return fixed / FIXED_SCALE;
  }
  
  /**
   * Round a float to fixed precision (3 decimal places)
   * Use this for physics values to prevent FP drift
   * @param {number} value 
   * @returns {number}
   */
  function roundToFixed(value) {
    return Math.round(value * FIXED_SCALE) / FIXED_SCALE;
  }

  // ============================================================================
  // GAME STATE CHECKSUM
  // ============================================================================
  // Calculate deterministic checksums of game state for desync detection.
  // Uses FNV-1a hash for speed and simplicity.
  
  /**
   * FNV-1a hash implementation
   * @param {string} str - String to hash
   * @returns {number} 32-bit hash
   */
  function fnv1aHash(str) {
    let hash = 2166136261; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619); // FNV prime
      hash = hash >>> 0; // Keep as unsigned 32-bit
    }
    return hash;
  }
  
  /**
   * Calculate checksum of current game state
   * @param {number} tick - Current tick number
   * @returns {Object} Checksum data
   */
  function calculateGameStateChecksum(tick) {
    const components = [];
    
    // 1. Unit positions and states (sorted by ID for determinism)
    if (global.gameUnits && global.gameUnits.length > 0) {
      const unitStates = global.gameUnits
        .filter(u => u && u.pb && u.pb.state && u.pb.state.loc)
        .map(u => ({
          id: u.id,
          x: roundToFixed(u.pb.state.loc.x),
          z: roundToFixed(u.pb.state.loc.z),
          hp: u.currentHealth || 0,
          owner: u.owner || 'none'
        }))
        .sort((a, b) => deterministicStringCompare(a.id || '', b.id || ''));
      
      components.push(`units:${JSON.stringify(unitStates)}`);
    }
    
    // 2. Building states (sorted by ID)
    if (global.gameBuildings && global.gameBuildings.length > 0) {
      const buildingStates = global.gameBuildings
        .filter(b => b && b.position)
        .map(b => ({
          id: b.id,
          type: b.type,
          x: roundToFixed(b.position.x),
          z: roundToFixed(b.position.z),
          owner: b.owner || 'none',
          progress: b.buildProgress !== undefined ? roundToFixed(b.buildProgress) : 1
        }))
        .sort((a, b) => deterministicStringCompare(a.id || '', b.id || ''));
      
      components.push(`buildings:${JSON.stringify(buildingStates)}`);
    }
    
    // 3. Player resources
    if (global.currentMatch && global.currentMatch.players) {
      const playerResources = global.currentMatch.players
        .map(p => ({
          id: p.id || p,
          resources: p.resources || {}
        }))
        .sort((a, b) => deterministicStringCompare(a.id || '', b.id || ''));
      
      components.push(`resources:${JSON.stringify(playerResources)}`);
    }
    
    // 4. RNG state
    if (matchRng) {
      components.push(`rng:${matchRng.callCount}`);
    }
    
    // Combine all components and hash
    const stateString = components.join('|');
    const checksum = fnv1aHash(stateString);
    
    return {
      tick,
      checksum,
      componentCount: components.length,
      // Include component hashes for debugging desync
      componentHashes: components.map(c => ({
        name: c.split(':')[0],
        hash: fnv1aHash(c)
      }))
    };
  }
  
  /**
   * Compare two checksums and identify differences
   * @param {Object} local - Local checksum
   * @param {Object} remote - Remote checksum
   * @returns {Object} Comparison result
   */
  function compareChecksums(local, remote) {
    if (local.checksum === remote.checksum) {
      return { match: true };
    }
    
    // Find which component differs
    const differences = [];
    const localComponents = new Map(local.componentHashes.map(c => [c.name, c.hash]));
    const remoteComponents = new Map(remote.componentHashes.map(c => [c.name, c.hash]));
    
    for (const [name, hash] of localComponents) {
      const remoteHash = remoteComponents.get(name);
      if (remoteHash !== hash) {
        differences.push({
          component: name,
          localHash: hash,
          remoteHash: remoteHash
        });
      }
    }
    
    return {
      match: false,
      tick: local.tick,
      differences
    };
  }

  // ============================================================================
  // REPLAY SYSTEM
  // ============================================================================
  
  class ReplayPlayer {
    constructor(replayData) {
      this.replay = replayData;
      this.currentTick = 0;
      this.isPlaying = false;
      this.playbackSpeed = 1.0;
      this.commandIndex = 0;
      this.onTick = null; // Callback for each tick
      this.onComplete = null; // Callback when replay ends
    }
    
    /**
     * Initialize game state from replay
     */
    async initialize() {
      console.log(`🎬 Initializing replay: ${this.replay.matchId}`);
      
      // Initialize RNG with replay's seed
      initMatchRng(this.replay.mapSeed);
      
      // Sort commands by tick for efficient playback
      this.sortedCommands = [...this.replay.commands].sort((a, b) => a.tick - b.tick);
      this.commandIndex = 0;
      
      // Calculate total duration
      if (this.sortedCommands.length > 0) {
        this.totalTicks = this.sortedCommands[this.sortedCommands.length - 1].tick + 100;
      } else {
        this.totalTicks = this.replay.endTick || 1000;
      }
      
      console.log(`📊 Replay has ${this.sortedCommands.length} commands over ${this.totalTicks} ticks`);
      
      return true;
    }
    
    /**
     * Get commands for a specific tick
     * @param {number} tick 
     * @returns {Array}
     */
    getCommandsForTick(tick) {
      const commands = [];
      
      // Advance through sorted commands
      while (this.commandIndex < this.sortedCommands.length) {
        const cmd = this.sortedCommands[this.commandIndex];
        if (cmd.tick < tick) {
          // Missed command (shouldn't happen in proper playback)
          console.warn(`⚠️ Missed command at tick ${cmd.tick}, current tick ${tick}`);
          this.commandIndex++;
        } else if (cmd.tick === tick) {
          commands.push(cmd);
          this.commandIndex++;
        } else {
          // Command is for future tick
          break;
        }
      }
      
      return commands;
    }
    
    /**
     * Step forward one tick
     * @returns {boolean} True if more ticks remain
     */
    step() {
      if (this.currentTick >= this.totalTicks) {
        this.isPlaying = false;
        if (this.onComplete) this.onComplete();
        return false;
      }
      
      // Get commands for this tick
      const commands = this.getCommandsForTick(this.currentTick);
      
      // Execute commands (caller should handle this via callback)
      if (this.onTick) {
        this.onTick(this.currentTick, commands);
      }
      
      this.currentTick++;
      return true;
    }
    
    /**
     * Seek to a specific tick
     * @param {number} targetTick 
     */
    seekTo(targetTick) {
      if (targetTick < this.currentTick) {
        // Need to restart from beginning
        this.currentTick = 0;
        this.commandIndex = 0;
        // Caller needs to reset game state
      }
      
      // Fast-forward to target tick
      while (this.currentTick < targetTick) {
        this.step();
      }
    }
    
    /**
     * Get playback progress
     * @returns {Object}
     */
    getProgress() {
      return {
        currentTick: this.currentTick,
        totalTicks: this.totalTicks,
        percent: this.totalTicks > 0 ? (this.currentTick / this.totalTicks) * 100 : 0,
        remainingCommands: this.sortedCommands.length - this.commandIndex
      };
    }
  }
  
  /**
   * Load a replay from localStorage
   * @param {string} replayId 
   * @returns {Object|null}
   */
  function loadReplay(replayId) {
    try {
      const key = replayId.startsWith('replay_') ? replayId : `replay_${replayId}`;
      const data = localStorage.getItem(key);
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load replay:', error);
    }
    return null;
  }
  
  /**
   * List all saved replays
   * @returns {Array}
   */
  function listReplays() {
    const replays = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('replay_')) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          replays.push({
            id: key,
            matchId: data.matchId,
            gameType: data.gameType,
            mapSeed: data.mapSeed,
            players: data.players,
            winner: data.winner,
            duration: data.duration,
            commandCount: data.commands ? data.commands.length : 0,
            savedAt: data.savedAt || null,
            saved: data.saved || false, // Protected from auto-delete
            version: data.version || '0.9' // Track replay format version
          });
        } catch (e) {
          // Skip corrupted replays
          console.warn(`⚠️ Skipping corrupted replay: ${key}`);
        }
      }
    }
    return replays.sort((a, b) => {
      // Sort by savedAt timestamp (newer first), fallback to ID parsing
      const timeA = a.savedAt || parseInt(a.id.split('-')[1]) || 0;
      const timeB = b.savedAt || parseInt(b.id.split('-')[1]) || 0;
      return timeB - timeA;
    });
  }
  
  /**
   * Toggle "saved" (protected) status of a replay
   * @param {string} replayId 
   * @returns {boolean} New saved status
   */
  function toggleReplaySaved(replayId) {
    try {
      const key = replayId.startsWith('replay_') ? replayId : `replay_${replayId}`;
      const data = localStorage.getItem(key);
      if (data) {
        const replay = JSON.parse(data);
        replay.saved = !replay.saved;
        localStorage.setItem(key, JSON.stringify(replay));
        console.log(`${replay.saved ? '⭐' : '☆'} Replay ${replay.saved ? 'saved' : 'unsaved'}: ${key}`);
        return replay.saved;
      }
    } catch (error) {
      console.error('Failed to toggle replay saved status:', error);
    }
    return false;
  }
  
  /**
   * Delete a specific replay
   * @param {string} replayId 
   * @returns {boolean} Success
   */
  function deleteReplay(replayId) {
    try {
      const key = replayId.startsWith('replay_') ? replayId : `replay_${replayId}`;
      localStorage.removeItem(key);
      console.log(`🗑️ Deleted replay: ${key}`);
      return true;
    } catch (error) {
      console.error('Failed to delete replay:', error);
      return false;
    }
  }
  
  /**
   * Clean up old replays, keeping maxToKeep most recent (respects "saved" flag)
   * @param {number} maxToKeep 
   */
  function cleanupOldReplays(maxToKeep = 15) {
    const replays = listReplays();
    const unsavedReplays = replays.filter(r => !r.saved);
    const toRemove = unsavedReplays.slice(maxToKeep);
    
    toRemove.forEach(r => {
      localStorage.removeItem(r.id);
    });
    
    if (toRemove.length > 0) {
      console.log(`🧹 Cleaned up ${toRemove.length} old replays, kept ${replays.length - toRemove.length}`);
    }
  }

  // ============================================================================
  // EXPORTS
  // ============================================================================
  
  const Determinism = {
    // PRNG
    mulberry32,
    SeededRandom,
    initMatchRng,
    getMatchRng,
    random,
    randomInt,
    randomFloat,
    
    // Fixed-point math
    FIXED_SCALE,
    toFixed,
    fromFixed,
    roundToFixed,
    
    // Checksums
    fnv1aHash,
    calculateGameStateChecksum,
    compareChecksums,
    
    // Replay
    ReplayPlayer,
    loadReplay,
    listReplays,
    toggleReplaySaved,
    deleteReplay,
    cleanupOldReplays
  };
  
  // Export to window
  global.Determinism = Determinism;
  
  // Also export convenience functions directly
  global.deterministicRandom = random; // Replace old Math.sin() based version
  global.initMatchRng = initMatchRng;
  global.getMatchRng = getMatchRng;
  global.deterministicStringCompare = deterministicStringCompare; // Replace localeCompare()
  
  
})(typeof window !== 'undefined' ? window : this);
