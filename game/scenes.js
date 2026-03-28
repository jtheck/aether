// Scene Player - Plays authored cinematic sequences during gameplay
// Scenes are defined in the forge editor and serialized into .garden files.
// Playback pauses the match tick while keeping the render loop alive,
// allowing camera movement and cosmetic unit animation.

(function() {
  'use strict';

  class ScenePlayer {
    constructor(scenes, match) {
      this.scenes = (scenes || []).map(s => Object.assign({}, s, { played: false }));
      this.match = match;
      this.playing = false;
      this.currentScene = null;
      this._animationFrameId = null;
    }

    // Called from processTick — checks if any scene should fire
    checkTriggers() {
      if (this.playing || !this.match) return;

      for (const scene of this.scenes) {
        if (scene.played) continue;
        if (this.shouldTrigger(scene)) {
          this.playScene(scene);
          return;
        }
      }
    }

    shouldTrigger(scene) {
      const t = scene.trigger;
      if (!t) return false;

      switch (t.type) {
        case 'match_start':
          return this.match.tick <= 1;

        case 'objective_reached': {
          const objectives = window.adventureObjectives;
          if (!objectives) return false;
          const obj = objectives[t.objectiveId];
          return obj && obj.completed;
        }

        case 'location_entered': {
          const tileSize = (typeof TILE_SIZE !== 'undefined') ? TILE_SIZE : 4;
          const cx = (t.x + 0.5) * tileSize;
          const cz = (t.y + 0.5) * tileSize;
          const r = (t.r || 4) * tileSize;
          const units = (window.gameUnits || []).filter(u => u && !u.dead);
          for (const unit of units) {
            const loc = unit.pb?.state?.loc;
            if (!loc) continue;
            const dx = loc.x - cx;
            const dz = loc.z - cz;
            if (Math.sqrt(dx * dx + dz * dz) <= r) return true;
          }
          return false;
        }

        case 'timer':
          return this.match.gameTime >= (t.delay || 0);

        default:
          return false;
      }
    }

    async playScene(scene) {
      scene.played = true;
      this.playing = true;
      this.currentScene = scene;

      const wasPaused = this.match.isPaused;
      if (this.match.state === 'playing' && this.match.pauseMatch) {
        this.match.pauseMatch();
      }

      // Disable player camera controls during scene
      this._savedCameraInput = true;
      if (window.ui) window.ui._scenePlaying = true;

      console.log(`🎬 Playing scene: ${scene.name}`);

      try {
        for (const step of scene.steps) {
          await this.executeStep(step);
        }
      } catch (err) {
        console.error('🎬 Scene error:', err);
      }

      // Restore camera controls
      if (window.ui) window.ui._scenePlaying = false;

      // Resume match if it wasn't paused before the scene
      if (!wasPaused && this.match.resumeMatch && this.match.state === 'playing') {
        this.match.resumeMatch();
      }

      this.playing = false;
      this.currentScene = null;
      console.log(`🎬 Scene complete: ${scene.name}`);
    }

    executeStep(step) {
      switch (step.type) {
        case 'dialogue':  return this.stepDialogue(step);
        case 'wait':      return this.stepWait(step);
        case 'camera':    return this.stepCamera(step);
        case 'unit_move': return this.stepUnitMove(step);
        default:
          console.warn(`🎬 Unknown step type: ${step.type}`);
          return Promise.resolve();
      }
    }

    // -- Step: Dialogue --
    // Wraps showStoryDialogue in a Promise. The existing function already
    // handles pause/resume, but we've already paused, so we prevent double-resume
    // by temporarily marking the match as "was paused".
    stepDialogue(step) {
      return new Promise(resolve => {
        const msg = step.speaker
          ? `<b>${step.speaker}</b>\n${step.message || ''}`
          : (step.message || '...');

        // showStoryDialogue checks wasPaused internally; since we already paused,
        // ensure it doesn't try to resume on its own
        const savedPaused = this.match.isPaused;
        this.match.isPaused = true;

        window.showStoryDialogue(msg, 'scene', () => {
          this.match.isPaused = savedPaused;
          resolve();
        });
      });
    }

    // -- Step: Wait --
    // Render-loop based timer (match tick is paused)
    stepWait(step) {
      const duration = (step.duration || 1) * 1000;
      return new Promise(resolve => {
        const start = performance.now();
        const tick = () => {
          if (performance.now() - start >= duration) {
            resolve();
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      });
    }

    // -- Step: Camera --
    // Smoothly lerp camera target to world position over duration
    stepCamera(step) {
      const tileSize = (typeof TILE_SIZE !== 'undefined') ? TILE_SIZE : 4;
      const targetX = (step.x + 0.5) * tileSize;
      const targetZ = (step.y + 0.5) * tileSize;
      const targetY = 9;
      const duration = (step.duration || 2) * 1000;

      const camTarget = window.gfx?.cameraTarget;
      const camera = window.gfx?.camera;
      if (!camTarget) return Promise.resolve();

      const startX = camTarget.position.x;
      const startY = camTarget.position.y;
      const startZ = camTarget.position.z;
      const startRadius = camera ? camera.radius : 80;
      const endRadius = step.zoom || startRadius;

      return new Promise(resolve => {
        const startTime = performance.now();
        const animate = () => {
          const elapsed = performance.now() - startTime;
          const raw = Math.min(elapsed / duration, 1);
          // Smooth ease-in-out
          const t = raw < 0.5
            ? 2 * raw * raw
            : 1 - Math.pow(-2 * raw + 2, 2) / 2;

          camTarget.position.x = startX + (targetX - startX) * t;
          camTarget.position.y = startY + (targetY - startY) * t;
          camTarget.position.z = startZ + (targetZ - startZ) * t;

          if (window.cameraAnchor) {
            window.cameraAnchor.x = camTarget.position.x;
            window.cameraAnchor.z = camTarget.position.z;
          }

          if (camera && endRadius !== startRadius) {
            camera.radius = startRadius + (endRadius - startRadius) * t;
          }

          if (raw >= 1) {
            resolve();
          } else {
            requestAnimationFrame(animate);
          }
        };
        requestAnimationFrame(animate);
      });
    }

    // -- Step: Unit Move --
    // Cosmetic movement of a starting unit toward a target while match is paused.
    // Drives the unit's physics body position directly in the render loop.
    stepUnitMove(step) {
      const tileSize = (typeof TILE_SIZE !== 'undefined') ? TILE_SIZE : 4;
      const targetX = (step.tx + 0.5) * tileSize;
      const targetZ = (step.ty + 0.5) * tileSize;
      const speed = (step.speed || 1) * tileSize * 2; // tiles per second

      const units = window.gameUnits || [];
      let unit;
      if (step.unitName && typeof step.unitName === 'string') {
        const name = step.unitName.trim();
        unit = units.find(u => u.getDisplayName && u.getDisplayName() === name);
      }
      if (!unit && Number.isFinite(step.unitIndex)) {
        const orderedUnits = units
          .filter(u => !!u)
          .slice()
          .sort((a, b) => {
            const aIdx = Number.isFinite(a.adventureSpawnIndex) ? a.adventureSpawnIndex : Number.MAX_SAFE_INTEGER;
            const bIdx = Number.isFinite(b.adventureSpawnIndex) ? b.adventureSpawnIndex : Number.MAX_SAFE_INTEGER;
            if (aIdx !== bIdx) return aIdx - bIdx;
            return window.deterministicStringCompare(a.id || '', b.id || '');
          });
        unit = orderedUnits[step.unitIndex];
      }
      if (!unit || !unit.pb?.state?.loc) return Promise.resolve();

      return new Promise(resolve => {
        let lastTime = performance.now();

        const animate = () => {
          const now = performance.now();
          const dt = (now - lastTime) / 1000;
          lastTime = now;

          const loc = unit.pb.state.loc;
          const dx = targetX - loc.x;
          const dz = targetZ - loc.z;
          const dist = Math.sqrt(dx * dx + dz * dz);

          if (dist < 0.5) {
            loc.x = targetX;
            loc.z = targetZ;
            resolve();
            return;
          }

          const move = Math.min(speed * dt, dist);
          loc.x += (dx / dist) * move;
          loc.z += (dz / dist) * move;

          // Update mesh position for visual feedback
          if (unit.mesh) {
            unit.mesh.position.x = loc.x;
            unit.mesh.position.z = loc.z;
          }

          // Face movement direction
          if (unit.mesh) {
            unit.mesh.rotation.y = Math.atan2(dx, dz);
          }

          requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      });
    }

    // Cleanup
    dispose() {
      if (this._animationFrameId) {
        cancelAnimationFrame(this._animationFrameId);
      }
      this.scenes = [];
      this.playing = false;
      this.currentScene = null;
    }
  }

  window.ScenePlayer = ScenePlayer;
})();
