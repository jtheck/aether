// Forge Scenes Module - Cinematic sequence authoring
(function(forge) {
  'use strict';

  // ========== SCENE CRUD ==========

  forge.addScene = function() {
    const scene = {
      id: this.state.scenes.length,
      name: 'Scene ' + (this.state.scenes.length + 1),
      trigger: { type: 'match_start' },
      steps: []
    };
    this.state.scenes.push(scene);
    this.selectScene(this.state.scenes.length - 1);
    console.log(`🎬 Added scene: ${scene.name}`);
  };

  forge.removeScene = function(index) {
    if (index < 0 || index >= this.state.scenes.length) return;
    this.state.scenes.splice(index, 1);
    this.state.scenes.forEach((s, i) => s.id = i);

    if (this.state.selectedSceneIndex >= this.state.scenes.length) {
      this.state.selectedSceneIndex = this.state.scenes.length - 1;
    }
    this.state.selectedStepIndex = -1;
    this.state.scenePickMode = null;
    this.updateSceneList();
    this.updateSceneEditor();
    console.log(`🎬 Removed scene ${index}`);
  };

  forge.clearScenes = function() {
    if (!confirm('Clear ALL scenes? This cannot be undone.')) return;
    this.state.scenes = [];
    this.state.selectedSceneIndex = -1;
    this.state.selectedStepIndex = -1;
    this.state.scenePickMode = null;
    this.updateSceneList();
    this.updateSceneEditor();
    console.log('🎬 All scenes cleared');
  };

  forge.selectScene = function(index) {
    this.state.selectedSceneIndex = index;
    this.state.selectedStepIndex = -1;
    this.state.scenePickMode = null;
    this.updateSceneList();
    this.updateSceneEditor();
  };

  // ========== SCENE PROPERTY UPDATES ==========

  forge.updateSceneName = function(name) {
    const scene = this.state.scenes[this.state.selectedSceneIndex];
    if (!scene) return;
    scene.name = name;
    this.updateSceneList();
  };

  forge.setSceneTriggerType = function(type) {
    const scene = this.state.scenes[this.state.selectedSceneIndex];
    if (!scene) return;
    scene.trigger = { type };
    if (type === 'objective_reached') scene.trigger.objectiveId = 0;
    if (type === 'location_entered') Object.assign(scene.trigger, { x: 32, y: 32, r: 4 });
    if (type === 'timer') scene.trigger.delay = 30;
    this.updateSceneEditor();
  };

  forge.setSceneTriggerParam = function(key, value) {
    const scene = this.state.scenes[this.state.selectedSceneIndex];
    if (!scene) return;
    scene.trigger[key] = (key === 'type') ? value : Number(value);
    this.updateSceneEditor();
  };

  // ========== STEP CRUD ==========

  forge.addSceneStep = function(type) {
    const scene = this.state.scenes[this.state.selectedSceneIndex];
    if (!scene) return;

    const step = { type };
    switch (type) {
      case 'dialogue':
        step.speaker = '';
        step.message = '';
        step.style = 'normal';
        break;
      case 'wait':
        step.duration = 2.0;
        break;
      case 'camera':
        step.x = 32; step.y = 32; step.zoom = 60; step.duration = 2.0;
        break;
      case 'unit_move':
        step.unitIndex = 0; step.tx = 32; step.ty = 32; step.speed = 1.0;
        break;
    }

    scene.steps.push(step);
    this.state.selectedStepIndex = scene.steps.length - 1;
    this.updateSceneEditor();
    console.log(`🎬 Added ${type} step to ${scene.name}`);
  };

  forge.removeSceneStep = function(stepIndex) {
    const scene = this.state.scenes[this.state.selectedSceneIndex];
    if (!scene || stepIndex < 0 || stepIndex >= scene.steps.length) return;
    scene.steps.splice(stepIndex, 1);
    if (this.state.selectedStepIndex >= scene.steps.length) {
      this.state.selectedStepIndex = scene.steps.length - 1;
    }
    this.updateSceneEditor();
  };

  forge.moveSceneStep = function(stepIndex, direction) {
    const scene = this.state.scenes[this.state.selectedSceneIndex];
    if (!scene) return;
    const target = stepIndex + direction;
    if (target < 0 || target >= scene.steps.length) return;
    const temp = scene.steps[stepIndex];
    scene.steps[stepIndex] = scene.steps[target];
    scene.steps[target] = temp;
    if (this.state.selectedStepIndex === stepIndex) {
      this.state.selectedStepIndex = target;
    }
    this.updateSceneEditor();
  };

  forge.updateStepParam = function(stepIndex, key, value) {
    const scene = this.state.scenes[this.state.selectedSceneIndex];
    if (!scene || stepIndex < 0 || stepIndex >= scene.steps.length) return;
    const step = scene.steps[stepIndex];
    if (key === 'speaker' || key === 'message' || key === 'type' || key === 'unitName' || key === 'style') {
      step[key] = value;
    } else {
      step[key] = Number(value);
    }
  };

  // ========== MAP CLICK COORDINATE PICKER ==========

  forge.startScenePick = function(mode, stepIndex) {
    this.state.scenePickMode = mode;
    if (stepIndex !== undefined) this.state.selectedStepIndex = stepIndex;
    const labels = {
      trigger_location: 'Click map to set trigger location',
      camera_target: 'Click map to set camera target',
      unit_target: 'Click map to set unit destination'
    };
    console.log(`🎬 ${labels[mode] || 'Pick mode active'}`);
  };

  forge.handleSceneMapClick = function(pos) {
    const scene = this.state.scenes[this.state.selectedSceneIndex];
    if (!scene) return;

    const mode = this.state.scenePickMode;

    if (mode === 'trigger_location') {
      scene.trigger.x = pos.x;
      scene.trigger.y = pos.y;
    } else if (mode === 'camera_target' || mode === 'unit_target') {
      const step = scene.steps[this.state.selectedStepIndex];
      if (step) {
        if (mode === 'camera_target') {
          step.x = pos.x;
          step.y = pos.y;
        } else {
          step.tx = pos.x;
          step.ty = pos.y;
        }
      }
    }

    this.state.scenePickMode = null;
    this.updateSceneEditor();
    console.log(`🎬 Set coordinates: (${pos.x}, ${pos.y})`);
  };

  // ========== SCENE TRIGGER ZONE MARKERS ==========

  forge._sceneTriggerMarkers = [];

  forge.updateSceneTriggerMarkers = function() {
    if (this._sceneTriggerMarkers) {
      this._sceneTriggerMarkers.forEach(m => m.dispose());
    }
    this._sceneTriggerMarkers = [];

    const scene = gfx?.scene;
    if (!scene || this.state.editingLayer !== 'scenes') return;

    this.state.scenes.forEach((sc, i) => {
      if (sc.trigger.type !== 'location_entered') return;
      const t = sc.trigger;

      const cylinder = BABYLON.MeshBuilder.CreateCylinder(
        `sceneTrigger_${i}`,
        { diameter: (t.r || 4) * 2 * TILE_SIZE, height: 0.3, tessellation: 32 },
        scene
      );
      const worldX = (t.x + 0.5) * TILE_SIZE;
      const worldZ = (t.y + 0.5) * TILE_SIZE;
      cylinder.position = new BABYLON.Vector3(worldX, 0.8, worldZ);

      const mat = new BABYLON.StandardMaterial(`sceneTriggerMat_${i}`, scene);
      const isSelected = this.state.selectedSceneIndex === i;
      mat.diffuseColor = isSelected
        ? new BABYLON.Color3(1, 0.6, 0.1)
        : new BABYLON.Color3(0.8, 0.4, 1);
      mat.emissiveColor = mat.diffuseColor.scale(0.4);
      mat.alpha = isSelected ? 0.6 : 0.35;
      mat.backFaceCulling = false;
      cylinder.material = mat;

      this._sceneTriggerMarkers.push(cylinder);
    });
  };

  // ========== UI RENDERING ==========

  forge.updateSceneList = function() {
    const list = document.getElementById('scene-list');
    if (!list) return;

    if (this.state.scenes.length === 0) {
      list.innerHTML = '<span style="opacity:0.5;">No scenes. Click + Add Scene to create one.</span>';
      return;
    }

    list.innerHTML = this.state.scenes.map((sc, i) => {
      const isSelected = this.state.selectedSceneIndex === i;
      const bg = isSelected ? 'rgba(180,100,255,0.3)' : 'rgba(0,0,0,0.2)';
      const border = isSelected ? 'border:2px solid #b464ff;' : '';
      const triggerIcon = { match_start: '▶️', objective_reached: '🎯', location_entered: '📍', timer: '⏱️', victory: '🏆' }[sc.trigger.type] || '❓';
      const stepCount = sc.steps.length;
      return `<div style="margin-bottom:4px;padding:4px;${border}background:${bg};border-radius:3px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;" onclick="forge.selectScene(${i})">
        <div>
          <div style="font-weight:${isSelected ? 'bold' : 'normal'};">${triggerIcon} ${i + 1}. ${sc.name}</div>
          <div style="font-size:10px;opacity:0.6;">${stepCount} step${stepCount !== 1 ? 's' : ''}</div>
        </div>
        <button class="forge-btn-sm" onclick="event.stopPropagation();forge.removeScene(${i})" title="Remove scene">✕</button>
      </div>`;
    }).join('');
  };

  forge.updateSceneEditor = function() {
    const editor = document.getElementById('scene-editor');
    if (!editor) return;

    const scene = this.state.scenes[this.state.selectedSceneIndex];
    if (!scene) {
      editor.style.display = 'none';
      return;
    }
    editor.style.display = 'block';

    // Name
    const nameInput = document.getElementById('scene-name');
    if (nameInput) nameInput.value = scene.name;

    // Trigger
    this.renderTriggerEditor(scene);

    // Steps
    this.renderStepTimeline(scene);

    // Update trigger markers
    this.updateSceneTriggerMarkers();
  };

  forge.renderTriggerEditor = function(scene) {
    const container = document.getElementById('scene-trigger-params');
    if (!container) return;

    const t = scene.trigger;
    let html = '';

    switch (t.type) {
      case 'match_start':
        html = '<div style="font-size:11px;opacity:0.6;">Fires when match begins.</div>';
        break;
      case 'objective_reached':
        html = '<label style="font-size:11px;">Objective:</label>';
        html += '<select style="width:100%;margin-top:2px;padding:4px;background:#2a2a3e;border:1px solid #444;color:#fff;border-radius:3px;" onchange="forge.setSceneTriggerParam(\'objectiveId\',this.value)">';
        if (this.state.objectives.length === 0) {
          html += '<option value="0">No objectives defined</option>';
        } else {
          this.state.objectives.forEach((o, i) => {
            const sel = t.objectiveId === i ? ' selected' : '';
            html += `<option value="${i}"${sel}>#${i + 1} ${o.type} (${o.x},${o.y})</option>`;
          });
        }
        html += '</select>';
        break;
      case 'location_entered':
        html = `<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
          <label style="font-size:11px;">X:</label><input type="number" value="${t.x || 0}" style="width:50px;padding:2px;background:#2a2a3e;border:1px solid #444;color:#fff;border-radius:3px;" onchange="forge.setSceneTriggerParam('x',this.value)">
          <label style="font-size:11px;">Y:</label><input type="number" value="${t.y || 0}" style="width:50px;padding:2px;background:#2a2a3e;border:1px solid #444;color:#fff;border-radius:3px;" onchange="forge.setSceneTriggerParam('y',this.value)">
          <label style="font-size:11px;">R:</label><input type="number" value="${t.r || 4}" min="1" max="20" style="width:40px;padding:2px;background:#2a2a3e;border:1px solid #444;color:#fff;border-radius:3px;" onchange="forge.setSceneTriggerParam('r',this.value)">
          <button class="forge-btn-sm" onclick="forge.startScenePick('trigger_location')" title="Pick from map">📍</button>
        </div>`;
        break;
      case 'timer':
        html = `<div style="display:flex;gap:4px;align-items:center;">
          <label style="font-size:11px;">Delay (sec):</label>
          <input type="number" value="${t.delay || 30}" min="1" style="width:60px;padding:2px;background:#2a2a3e;border:1px solid #444;color:#fff;border-radius:3px;" onchange="forge.setSceneTriggerParam('delay',this.value)">
        </div>`;
        break;
    }

    container.innerHTML = html;

    // Sync trigger type dropdown
    const sel = document.getElementById('scene-trigger-type');
    if (sel) sel.value = t.type;
  };

  forge.renderStepTimeline = function(scene) {
    const container = document.getElementById('scene-steps-list');
    if (!container) return;

    if (scene.steps.length === 0) {
      container.innerHTML = '<div style="opacity:0.5;font-size:11px;">No steps. Add one below.</div>';
      return;
    }

    container.innerHTML = scene.steps.map((step, i) => {
      const isSelected = this.state.selectedStepIndex === i;
      const bg = isSelected ? 'rgba(100,200,255,0.2)' : 'rgba(0,0,0,0.15)';
      const border = isSelected ? 'border:1px solid #64c8ff;' : 'border:1px solid transparent;';
      const icon = { dialogue: '💬', wait: '⏸️', camera: '📷', unit_move: '🚶' }[step.type] || '❓';
      const summary = this.getStepSummary(step);

      return `<div style="margin-bottom:3px;padding:4px;${border}background:${bg};border-radius:3px;" onclick="forge.selectStep(${i})">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11px;">${icon} <b>${i + 1}.</b> ${summary}</span>
          <div style="display:flex;gap:2px;">
            <button class="forge-btn-sm" onclick="event.stopPropagation();forge.moveSceneStep(${i},-1)" title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button>
            <button class="forge-btn-sm" onclick="event.stopPropagation();forge.moveSceneStep(${i},1)" title="Move down" ${i === scene.steps.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="forge-btn-sm" onclick="event.stopPropagation();forge.removeSceneStep(${i})" title="Remove">✕</button>
          </div>
        </div>
        ${isSelected ? this.renderStepEditor(step, i) : ''}
      </div>`;
    }).join('');
  };

  forge.getStepSummary = function(step) {
    switch (step.type) {
      case 'dialogue':
        const preview = step.message ? step.message.substring(0, 25) : '(empty)';
        return step.speaker ? `${step.speaker}: "${preview}${step.message && step.message.length > 25 ? '...' : ''}"` : `"${preview}"`;
      case 'wait':
        return `Wait ${step.duration}s`;
      case 'camera':
        return `Camera → (${step.x},${step.y}) ${step.duration}s`;
      case 'unit_move':
        return (step.unitName && String(step.unitName).trim()) ? `"${this.escHtml(step.unitName)}" → (${step.tx},${step.ty})` : `Unit#${step.unitIndex} → (${step.tx},${step.ty})`;
      default:
        return step.type;
    }
  };

  forge.selectStep = function(index) {
    this.state.selectedStepIndex = index;
    this.updateSceneEditor();
  };

  forge.renderStepEditor = function(step, index) {
    const inputStyle = 'padding:3px;background:#2a2a3e;border:1px solid #444;color:#fff;border-radius:3px;font-size:11px;';

    switch (step.type) {
      case 'dialogue': {
        const styles = ['normal','shout','whisper','think','command','scared'];
        const styleOpts = styles.map(s => `<option value="${s}"${(step.style||'normal')===s?' selected':''}>${s}</option>`).join('');
        return `<div style="margin-top:4px;">
          <div style="display:flex;gap:4px;align-items:center;margin-bottom:3px;">
            <input type="text" value="${this.escAttr(step.speaker)}" placeholder="Speaker (empty = narrator)" style="flex:1;${inputStyle}" onchange="forge.updateStepParam(${index},'speaker',this.value)">
            <select style="width:80px;${inputStyle}" onchange="forge.updateStepParam(${index},'style',this.value)">${styleOpts}</select>
          </div>
          <textarea rows="2" style="width:100%;${inputStyle}resize:vertical;" onchange="forge.updateStepParam(${index},'message',this.value)" placeholder="Dialogue text...">${this.escHtml(step.message)}</textarea>
        </div>`;
      }

      case 'wait':
        return `<div style="margin-top:4px;display:flex;gap:4px;align-items:center;">
          <label style="font-size:11px;">Duration:</label>
          <input type="number" value="${step.duration}" min="0.1" step="0.1" style="width:60px;${inputStyle}" onchange="forge.updateStepParam(${index},'duration',this.value)">
          <span style="font-size:11px;opacity:0.6;">sec</span>
        </div>`;

      case 'camera':
        return `<div style="margin-top:4px;">
          <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
            <label style="font-size:11px;">X:</label><input type="number" value="${step.x}" style="width:50px;${inputStyle}" onchange="forge.updateStepParam(${index},'x',this.value)">
            <label style="font-size:11px;">Y:</label><input type="number" value="${step.y}" style="width:50px;${inputStyle}" onchange="forge.updateStepParam(${index},'y',this.value)">
            <button class="forge-btn-sm" onclick="event.stopPropagation();forge.startScenePick('camera_target',${index})" title="Pick from map">📍</button>
          </div>
          <div style="display:flex;gap:4px;align-items:center;margin-top:3px;">
            <label style="font-size:11px;">Zoom:</label><input type="number" value="${step.zoom}" min="20" max="150" style="width:50px;${inputStyle}" onchange="forge.updateStepParam(${index},'zoom',this.value)">
            <label style="font-size:11px;">Duration:</label><input type="number" value="${step.duration}" min="0.1" step="0.1" style="width:50px;${inputStyle}" onchange="forge.updateStepParam(${index},'duration',this.value)">
            <span style="font-size:11px;opacity:0.6;">sec</span>
          </div>
        </div>`;

      case 'unit_move':
        return `<div style="margin-top:4px;">
          <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-bottom:3px;">
            <label style="font-size:11px;">Name:</label><input type="text" value="${this.escAttr(step.unitName || '')}" placeholder="or use #" style="width:70px;${inputStyle}" onchange="forge.updateStepParam(${index},'unitName',this.value)" title="Named unit (overrides index)">
            <label style="font-size:11px;">or #:</label><input type="number" value="${step.unitIndex}" min="0" style="width:40px;${inputStyle}" onchange="forge.updateStepParam(${index},'unitIndex',this.value)">
            <label style="font-size:11px;">→ X:</label><input type="number" value="${step.tx}" style="width:50px;${inputStyle}" onchange="forge.updateStepParam(${index},'tx',this.value)">
            <label style="font-size:11px;">Y:</label><input type="number" value="${step.ty}" style="width:50px;${inputStyle}" onchange="forge.updateStepParam(${index},'ty',this.value)">
            <button class="forge-btn-sm" onclick="event.stopPropagation();forge.startScenePick('unit_target',${index})" title="Pick from map">📍</button>
          </div>
          <div style="display:flex;gap:4px;align-items:center;">
            <label style="font-size:11px;">Speed:</label><input type="number" value="${step.speed}" min="0.1" step="0.1" style="width:50px;${inputStyle}" onchange="forge.updateStepParam(${index},'speed',this.value)">
          </div>
        </div>`;

      default:
        return '';
    }
  };

  // HTML escaping helpers
  forge.escHtml = function(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
  forge.escAttr = function(s) { return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };

  // ========== SCENE PREVIEW ==========

  forge._previewPlaying = false;

  forge.previewSelectedScene = async function() {
    const scene = this.state.scenes[this.state.selectedSceneIndex];
    if (!scene) { console.warn('🎬 No scene selected to preview'); return; }
    if (this._previewPlaying) { console.warn('🎬 Preview already running'); return; }

    this._previewPlaying = true;
    console.log(`🎬 Previewing: ${scene.name}`);

    try {
      for (const step of scene.steps) {
        await this._previewStep(step);
      }
    } catch (err) {
      console.error('🎬 Preview error:', err);
    }

    this._previewPlaying = false;
    console.log(`🎬 Preview complete: ${scene.name}`);
  };

  forge._previewStep = function(step) {
    switch (step.type) {
      case 'dialogue':  return this._previewDialogue(step);
      case 'wait':      return this._previewWait(step);
      case 'camera':    return this._previewCamera(step);
      case 'unit_move': return this._previewWait({ duration: 0.5 });
      default:          return Promise.resolve();
    }
  };

  forge._previewDialogue = function(step) {
    return new Promise(resolve => {
      const existing = document.getElementById('forge-preview-dialogue');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'forge-preview-dialogue';
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;' +
        'display:flex;flex-direction:column;justify-content:flex-end;cursor:pointer;';

      const speaker = step.speaker
        ? `<div style="font-size:14px;font-weight:bold;color:#ffcc44;margin-bottom:6px;">${this.escHtml(step.speaker)}</div>`
        : '';
      overlay.innerHTML = `<div style="background:linear-gradient(transparent, rgba(0,0,0,0.85));padding:60px 20px 20px;">` +
        speaker +
        `<div style="font-size:16px;color:#eee;max-width:700px;margin:0 auto;line-height:1.5;">${this.escHtml(step.message || '...')}</div>` +
        `<div style="font-size:11px;opacity:0.5;text-align:center;margin-top:10px;">Click anywhere to continue</div>` +
        `</div>`;

      overlay.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        overlay.remove();
        resolve();
      });
      document.body.appendChild(overlay);
    });
  };

  forge._previewWait = function(step) {
    const ms = (step.duration || 1) * 1000;
    return new Promise(resolve => {
      const start = performance.now();
      const tick = () => {
        if (performance.now() - start >= ms) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  };

  forge._previewCamera = function(step) {
    const cam = gfx?.camera;
    if (!cam) return Promise.resolve();

    const targetX = (step.x + 0.5) * TILE_SIZE;
    const targetZ = (step.y + 0.5) * TILE_SIZE;
    const targetY = step.zoom || cam.position.y;
    const duration = (step.duration || 2) * 1000;

    const startX = cam.position.x;
    const startY = cam.position.y;
    const startZ = cam.position.z;

    // Compute target look-at offset from current camera
    const lookOffset = cam.getTarget().subtract(cam.position);

    return new Promise(resolve => {
      const t0 = performance.now();
      const animate = () => {
        const raw = Math.min((performance.now() - t0) / duration, 1);
        const t = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;

        cam.position.x = startX + (targetX - startX) * t;
        cam.position.y = startY + (targetY - startY) * t;
        cam.position.z = startZ + (targetZ - startZ) * t;
        cam.setTarget(cam.position.add(lookOffset));

        if (raw >= 1) resolve();
        else requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    });
  };

})(window.forge);
