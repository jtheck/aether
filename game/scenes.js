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

    // Play a scene by trigger type (e.g. 'victory'). Returns a promise.
    // Returns null if no matching scene exists.
    playByTrigger(triggerType) {
      const scene = this.scenes.find(s => !s.played && s.trigger && s.trigger.type === triggerType);
      if (!scene) return null;
      return this.playScene(scene);
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
          return this.match.tick <= 30;

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

        case 'victory':
          return false; // manually triggered by handleAdventureVictory

        default:
          return false;
      }
    }

    async playScene(scene) {
      scene.played = true;
      this.playing = true;
      this.currentScene = scene;

      if (window.ui) window.ui._scenePlaying = true;
      this._startAmbientDrift();

      console.log(`🎬 Playing scene: ${scene.name}`);

      try {
        for (const step of scene.steps) {
          if (step.blocking === false) {
            this.executeStep(step);
          } else {
            await this.executeStep(step);
          }
        }
      } catch (err) {
        console.error('🎬 Scene error:', err);
      }

      this._stopAmbientDrift();
      if (window.ui) window.ui._scenePlaying = false;

      this.playing = false;
      this.currentScene = null;
      console.log(`🎬 Scene complete: ${scene.name}`);
    }

    // Slow ambient camera rotation so it never looks dead
    _startAmbientDrift() {
      this._drifting = true;
      const camera = window.gfx?.camera;
      if (!camera) return;
      const driftSpeed = 0.0003; // radians per frame — very subtle
      const tick = () => {
        if (!this._drifting) return;
        if (!this._cameraStepActive && camera) {
          camera.alpha += driftSpeed;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    _stopAmbientDrift() {
      this._drifting = false;
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
    // style 'narrator' or no speaker → cinematic subtitle bar (with optional speaker name)
    // otherwise                      → floating speech bubble above the named unit
    stepDialogue(step) {
      if (step.style === 'narrator' || !step.speaker) {
        return this._stepNarration(step);
      }
      return this._stepUnitDialogue(step);
    }

    static DIALOGUE_STYLES = {
      normal:  { fontSize: 1.2, color: [1, 1, 0.85],   yOffset: 3.5 },
      shout:   { fontSize: 1.8, color: [1, 0.45, 0.3],  yOffset: 4.0 },
      whisper: { fontSize: 0.8, color: [0.7, 0.7, 0.8], yOffset: 3.0 },
      think:   { fontSize: 1.0, color: [0.6, 0.85, 1],  yOffset: 4.0 },
      command: { fontSize: 1.5, color: [1, 0.85, 0.2],  yOffset: 3.8 },
      scared:  { fontSize: 1.1, color: [0.9, 0.55, 1],  yOffset: 3.5 },
    };

    _dialogueDuration(text) {
      const len = (text || '').length;
      return Math.max(2500, Math.min(len * 55, 8000));
    }

    // Floating speech bubble above the unit whose displayName matches the speaker
    _stepUnitDialogue(step) {
      const speakerName = (step.speaker || '').trim().toLowerCase();
      const units = window.gameUnits || [];
      const unit = units.find(u => {
        if (!u || u.dead) return false;
        const dn = (typeof u.getDisplayName === 'function' ? u.getDisplayName() : (u.displayName || '')).toLowerCase();
        return dn === speakerName;
      });

      const msg = step.message || '...';
      const duration = step.duration ? step.duration * 1000 : this._dialogueDuration(msg);
      const preset = ScenePlayer.DIALOGUE_STYLES[step.style] || ScenePlayer.DIALOGUE_STYLES.normal;

      if (unit && window.UnitSpeech) {
        window.UnitSpeech.showSpeech(unit, msg, duration, {
          fontSize: preset.fontSize,
          color: new BABYLON.Color3(preset.color[0], preset.color[1], preset.color[2]),
          yOffset: preset.yOffset
        });
      }

      return this.stepWait({ duration: duration / 1000 });
    }

    // Bottom-screen subtitle bar — non-blocking, auto-fades. Supports optional speaker name.
    _stepNarration(step) {
      const existing = document.getElementById('scene-narration-bar');
      if (existing) existing.remove();

      const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const msg = esc(step.message || '...').replace(/\n/g,'<br>');
      const speaker = step.speaker ? esc(step.speaker) : '';
      const duration = step.duration ? step.duration * 1000 : this._dialogueDuration(step.message || '');

      const speakerHtml = speaker
        ? '<div style="font-size:14px;font-weight:bold;color:#ffcc44;margin-bottom:6px;">' + speaker + '</div>'
        : '';

      const bar = document.createElement('div');
      bar.id = 'scene-narration-bar';
      bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:10000;' +
        'pointer-events:none;opacity:0;transition:opacity 0.4s;';
      bar.innerHTML =
        '<div style="background:linear-gradient(transparent, rgba(0,0,0,0.85));padding:60px 20px 24px;">' +
        speakerHtml +
        '<div style="font-size:17px;color:#eee;max-width:700px;margin:0 auto;line-height:1.6;font-family:Georgia,serif;">' + msg + '</div>' +
        '</div>';
      document.body.appendChild(bar);
      requestAnimationFrame(() => { bar.style.opacity = '1'; });

      return new Promise(resolve => {
        const start = performance.now();
        const fadeStart = duration - 400;
        const tick = () => {
          const elapsed = performance.now() - start;
          if (elapsed >= fadeStart && bar.style.opacity !== '0') {
            bar.style.opacity = '0';
          }
          if (elapsed >= duration) {
            bar.remove();
            resolve();
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
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
      this._cameraStepActive = true;
      const tileSize = (typeof TILE_SIZE !== 'undefined') ? TILE_SIZE : 4;
      const targetX = (step.x + 0.5) * tileSize;
      const targetZ = (step.y + 0.5) * tileSize;
      const targetY = 9;
      const duration = (step.duration || 2) * 1000;

      const camTarget = window.gfx?.cameraTarget;
      const camera = window.gfx?.camera;
      if (!camTarget) { this._cameraStepActive = false; return Promise.resolve(); }

      const startX = camTarget.position.x;
      const startY = camTarget.position.y;
      const startZ = camTarget.position.z;
      const startRadius = camera ? camera.radius : 80;
      const endRadius = step.zoom || startRadius;
      const startAlpha = camera ? camera.alpha : -2.5;
      const endAlpha = step.alpha !== undefined ? step.alpha : startAlpha;

      const self = this;
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

          if (camera) {
            if (endRadius !== startRadius) {
              camera.radius = startRadius + (endRadius - startRadius) * t;
            }
            if (endAlpha !== startAlpha) {
              camera.alpha = startAlpha + (endAlpha - startAlpha) * t;
            }
          }

          if (raw >= 1) {
            self._cameraStepActive = false;
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
