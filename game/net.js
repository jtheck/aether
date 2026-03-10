// Multiplayer Networking Layer for Aether RTS
// Handles P2P sync via GetFire, lockstep commands, prediction, and reconciliation
// Supports: 1v1, Adventure, Teams, King of the Hill

(function(net) {
  // Configuration
  net.TICK_RATE = 20; // 20Hz = 50ms ticks (base rate)
  net.MIN_TICK_RATE = 15; // Slow down to 15Hz if peers lagging (adaptive lockstep)
  net.COMMAND_BUFFER_SIZE = 100; // Max buffered commands
  net.STATE_SYNC_INTERVAL = 200; // Full state every 200ms (5 times per second) - base rate
  net.STATE_SYNC_INTERVAL_IDLE = 500; // Slower sync when no active commands (LOD)
  net.RECONNECT_TIMEOUT = 3000; // Reconnect attempts every 3s
  net.SNAP_THRESHOLD = 10; // Units >10 units away snap instead of lerp (reduced snapping)
  net.LERP_SPEED = 0.3; // 30% correction per sync (slower, smoother lerp)
  net.PEER_LAG_THRESHOLD = 3; // Slow down if peer is >3 ticks behind
  net.COMMAND_ACK_TIMEOUT = 1000; // Wait 1s for command acknowledgment before resending
  
  // Debug flags (default off to avoid noisy yellow console warnings in normal play)
  // You can toggle at runtime from DevTools:
  //   window.net.DEBUG_LOCKSTEP_WAIT_LOG = true
  net.DEBUG_LOCKSTEP_WAIT_LOG = false;
  
  // Lockstep resilience (co-op friendly)
  // True lockstep means the slowest device can freeze everyone. For adventure co-op,
  // it's usually better UX to "soft drop" a chronically late peer (stop waiting for them)
  // so the remaining peers stay smooth.
  //
  // NOTE: This preserves determinism for the remaining peers, but the soft-dropped peer
  // may not be able to rejoin deterministically.
  net.LOCKSTEP_SOFT_DROP_ENABLED = true;
  net.LOCKSTEP_SOFT_DROP_TIMEOUT_MS = 2500; // ms to wait before host soft-drops a peer (adventure only)
  net.LOCKSTEP_REJOIN_MIN_STABLE_MS = 1500; // must be near-caught-up for this long before auto rejoin request (adventure only)
  net.CATCHUP_MAX_TICKS_PER_SLICE = 12; // safety cap to avoid long UI stalls while fast-forwarding
  
  // Prefer keeping slow peers in lockstep by increasing slack before soft-dropping.
  // This increases input latency but avoids freezing everyone.
  net.AUTO_INPUT_DELAY_ENABLED = true;
  net.AUTO_INPUT_DELAY_AFTER_MS = 900; // if we're waiting this long, bump input delay (host, adventure only)
  net.AUTO_INPUT_DELAY_COOLDOWN_MS = 4000;
  net.MAX_INPUT_DELAY_TICKS = 8;
  net.MIN_INPUT_DELAY_TICKS = 3;
  // If lockstep stays healthy, ease input delay back down to reduce sluggishness.
  // Host-coordinated so all peers stay deterministic.
  net.AUTO_INPUT_DELAY_DECREASE_ENABLED = true;
  net.AUTO_INPUT_DELAY_DECREASE_AFTER_MS = 6000;
  net.AUTO_INPUT_DELAY_DECREASE_COOLDOWN_MS = 6000;
  
  // Internal state
  let p2p = null;
  let gameId = null;
  let localPlayerId = null;
  let localPlayerShortId = null;
  let isHost = false;
  let tick = 0;
  let commandBuffer = []; // Local pending commands
  let remoteCommands = new Map(); // Per-player command queues
  let lastStateSync = 0;
  let reconnectAttempts = 0;
  let isConnected = false;
  let tickIntervalId = null; // Store interval ID
  let currentTickRate = net.TICK_RATE; // Adaptive tick rate (starts at base)
  let peerLag = new Map(); // Track peer lag: peerId -> { lastTick: number, lastSeen: timestamp }
  let pendingCommandAcks = new Map(); // Track pending command acknowledgments: commandId -> { command, sentAt, retries }
  let lastPlayerCommandTime = 0; // Track when we last sent a player command (for LOD)
  
  // TRUE LOCKSTEP: Tick confirmation system
  // Each peer confirms they're ready for tick N by sending commands or a heartbeat
  // We only advance to tick N when ALL peers have confirmed tick N
  let peerTickConfirmations = new Map(); // peerId -> highest confirmed tick
  let localConfirmedTick = 0; // Highest tick we've confirmed to peers
  let lockstepEnabled = true; // Enable/disable lockstep (for debugging)
  let lastHeartbeatTick = 0; // Last tick we sent a heartbeat for
  let lastHeartbeatSentAt = 0; // Timestamp of last tick_confirm send (for resend while waiting)
  let waitingForPeers = false; // Are we currently waiting for peers?
  let lastWaitLog = 0; // Rate limit "waiting for peers" log
  let softDisconnectedPeers = new Set(); // Peers we stop waiting for (soft drop)
  let peerWaitStartedAt = new Map(); // peerId -> timestamp when they started blocking lockstep
  let selfSoftDropped = false; // whether WE were soft-dropped by host (we should go idle + catch up)
  let lastNearCaughtUpAt = 0; // timestamp for rejoin gating
  let lastInputDelayAdjustAt = 0;
  let lastInputDelayDecreaseAt = 0;
  let lastStableLockstepAt = 0; // last time we advanced a tick without waiting
  let waitingStartedAt = 0; // timestamp when we began waiting for peers (for adaptive tick rate)
  let lastWaitedAt = 0; // last time we observed waiting (for recovery)
  let lastPeerMessageAt = new Map(); // normalizedPeerId -> timestamp of last received message (any type)
  let lastLockstepNudgeAt = new Map(); // normalizedPeerId -> timestamp of last "please confirm" nudge
  let lastPeerProgressAt = new Map(); // normalizedPeerId -> timestamp of last observed tick progress (confirm/implicit confirm)
  
  // If we are still receiving messages from a peer, we should NOT treat them as disconnected.
  // Only consider soft-drop if they've been fully silent for this long.
  net.LOCKSTEP_PEER_SILENT_MS = 3000;
  // If a peer is "alive" (we're receiving messages) but is not advancing confirmations,
  // they can still deadlock co-op lockstep (everyone freezes mid-move). Consider them stuck
  // after this long without tick progress.
  net.LOCKSTEP_PEER_NO_PROGRESS_MS = 3500;
  net.LOCKSTEP_NUDGE_INTERVAL_MS = 500; // how often host nudges a blocking peer for confirm/state
  
  // Internal state tracking
  net._state = {
    localPlayerId: null,
    isConnected: false,
    peers: [],
    currentLobby: null,
    reconnectAttempts: 0,
    initialized: false
  };

  const normalizePeerId = (id) => {
    if (!id) return '';
    const suffix = id.includes('-') ? id.split('-').pop() : id;
    return suffix.length > 6 ? suffix.slice(-6) : suffix;
  };
  
  function isAdventureCoopMatch() {
    const match = window.currentMatch;
    return !!match && match.gameType === 'adventure';
  }
  
  function getLocalPeerIdForComparison() {
    return localPlayerShortId || normalizePeerId(localPlayerId) || localPlayerId;
  }
  
  function idsMatch(a, b) {
    if (!a || !b) return false;
    const na = normalizePeerId(a);
    const nb = normalizePeerId(b);
    return na && nb && na === nb;
  }
  
  function getCatchupTargetTick() {
    // Catch up to where the slowest non-soft-dropped peer has confirmed, minus input delay.
    // This keeps us close enough to rejoin without immediately blocking others again.
    const inputDelay = window.currentMatch?.inputDelayTicks || 3;
    const peers = (p2p ? p2p.getConnectedPeers() : []).filter(pid => !softDisconnectedPeers.has(pid));
    if (peers.length === 0) return tick;
    
    let minConfirmed = Infinity;
    for (const pid of peers) {
      const confirmed = peerTickConfirmations.get(normalizePeerId(pid));
      if (typeof confirmed === 'number') {
        minConfirmed = Math.min(minConfirmed, confirmed);
      }
    }
    if (!isFinite(minConfirmed)) return tick;
    return Math.max(0, Math.floor(minConfirmed - inputDelay));
  }
  
  function runDeterministicPhysicsStepsForOneNetTick() {
    // In this codebase: 60Hz physics, 20Hz net → ~3 physics steps per net tick.
    const dt = 1 / 60;
    const steps = 3;
    
    // During fast-forward we pause the regular rAF physics loop to avoid double-sim.
    // We only advance simulation-relevant systems here; visuals are updated by the normal render loop later.
    for (let i = 0; i < steps; i++) {
      if (window.updateUnits) window.updateUnits(dt);
      if (window.updateBuildings) window.updateBuildings(dt);
      if (window.updateIdleUnits) window.updateIdleUnits();
      if (window.player && window.player.pbody && window.player.pbody.integrate) {
        window.player.pbody.integrate(dt, true, true);
      }
    }
  }
  
  function softDropPeer(peerId, reason = 'lockstep_timeout') {
    if (!peerId) return;
    if (softDisconnectedPeers.has(peerId)) return;
    
    softDisconnectedPeers.add(peerId);
    peerTickConfirmations.delete(peerId);
    peerTickConfirmations.delete(normalizePeerId(peerId));
    peerWaitStartedAt.delete(peerId);
    remoteCommands.delete(peerId);
    
    // Update lobby state if present (best-effort)
    if (window.Lobby && window.Lobby.playerConnectionStates) {
      window.Lobby.playerConnectionStates[peerId] = 'timed_out';
    }
    
    console.warn(`⏳➡️ Soft-dropped peer from lockstep: ${peerId.slice(-8)} (reason=${reason})`);
  }

  // NEW: Get current network status
  net.getStatus = function() {
    return {
      localPlayerId: localPlayerId,
      localPlayerShortId: localPlayerShortId || normalizePeerId(localPlayerId),
      isConnected: isConnected,
      peers: p2p ? p2p.getConnectedPeers() : [],
      currentLobby: net.currentLobby || null,
      reconnectAttempts: reconnectAttempts,
      initialized: !!net.initialized, // Convert to boolean
      isHost: isHost,
      tick: tick,
      commandBufferSize: commandBuffer.length
    };
  };

  // Update internal state helper
  net._updateState = function(updates) {
    Object.assign(net._state, updates);
    // Optional: Trigger status change event
    if (net.onStatusChange) {
      net.onStatusChange(net.getStatus());
    }
  };
  
  // Game type to lobby mapping
  const GAME_TYPES = {
    'adventure': 'aether-adventure-coop',
    'onevsone': 'aether-1v1-quick',
    'koth': 'aether-koth',
    'teams': 'aether-teams-2v2'
  };
  
  // Initialize networking - updated to set initialized and localPlayerId
  net.init = function(options = {}) {
    const roomType = GAME_TYPES[options.gameType] || GAME_TYPES.onevsone;
    
    // Check if we should skip network initialization (offline mode)
    if (options.offlineMode) {
      console.log('🔌 Offline mode - skipping network initialization');
      net.initialized = true; // Mark as initialized but don't connect
      net.offlineMode = true;
      return;
    }
    
    // Initialize GetFire P2P
    try {
      p2p = GETFIREP2P({
        roomType: 'aether-rts',
        onGameLobbyMessage: handleGameLobbyMessage,  // CRITICAL: Needed for auto-negotiation!
        onDataChannelMessage: handleDataMessage,
        onPeerConnected: onPeerConnected,             // ✅ Correct callback name!
        onPeerDisconnected: onPeerDisconnected,       // ✅ Correct callback name!
        onBroadcastMessage: onBroadcastMessage,
        devMode: options.devMode || false
      });
    } catch (error) {
      console.warn('⚠️ Network initialization failed (offline?):', error.message);
      net.initialized = true;
      net.offlineMode = true;
      return;
    }
    
    // Use GetFire's user ID (DON'T generate our own!)
    // This is critical for P2P auto-negotiation to work
    // Wait for P2P to be ready before getting the ID
    const waitForUserId = setInterval(() => {
      if (p2p && p2p.getUserId && p2p.getUserId()) {
        localPlayerId = p2p.getUserId();
        localPlayerShortId = normalizePeerId(localPlayerId);
        // console.log(`🆔 Using P2P user ID: ${localPlayerId}`);
        clearInterval(waitForUserId);
      }
    }, 100);
    
    // Store lobby browser mode flag
    net.lobbyBrowserMode = options.lobbyBrowserMode || false;
    
    // Mark as initialized immediately (but P2P may still be connecting)
    net.initialized = true;
    
    // Wait for P2P to be ready, then join appropriate channels
    setTimeout(() => {
      // console.log(`🔍 Lobby browser mode: ${net.lobbyBrowserMode}`);
      
      // Only join match lobby if not in lobby browser mode
      if (!net.lobbyBrowserMode) {
        if (p2p && p2p.joinMatchLobby) {
          p2p.joinMatchLobby(roomType);
          net.currentLobby = roomType;
          // console.log(`🌐 Joined match lobby: ${roomType}`);
        }
      } else {
        // Join broadcast channel for lobby discovery
        if (options.broadcastChannel && p2p && p2p.joinBroadcast) {
          p2p.joinBroadcast(options.broadcastChannel);
          // console.log(`📡 Joined broadcast for lobby discovery: ${options.broadcastChannel}`);
        }
        // console.log(`🌐 Network initialized for lobby browser mode`);
      }
    }, 500); // Give P2P more time to initialize
    
    // Start tick loop
    net.startTickLoop();
    
    // console.log(`🌐 Network initialized for ${options.gameType || '1v1'}`);
  };
  
  // TRUE LOCKSTEP TICK LOOP
  // Tick N only advances when ALL peers have confirmed tick N
  // This guarantees identical simulation on all clients

  // Send heartbeat/confirmation for a tick.
  // NOTE: This must be module-scoped (NOT nested inside startTickLoop), because it is used
  // by both the lockstep loop and the data-message handler (e.g. request_tick_confirm).
  function sendTickConfirmation(forTick) {
    // IMPORTANT: Don't gate tick_confirm on `isConnected`.
    // GetFire can briefly report 0 connected peers during transitions even though
    // the data channel is still up; if we stop sending confirmations, the other side
    // will think we're dead and may soft-drop us.
    if (!p2p || !p2p.sendData) return;
    
    // Allow resending the same tick_confirm periodically while waiting (prevents deadlocks
    // if the initial match-start confirm was lost or a peer missed it).
    const now = Date.now();
    const isResend = (forTick === lastHeartbeatTick);
    if (forTick < lastHeartbeatTick) {
      return;
    }
    if (isResend && (now - lastHeartbeatSentAt) < 500) {
      return;
    }
    
    lastHeartbeatTick = forTick;
    localConfirmedTick = forTick;
    lastHeartbeatSentAt = now;
    
    // Log first few confirmations
    if (forTick < 10 || forTick % 100 === 0) {
    }
    
    const msg = {
      type: 'tick_confirm',
      tick: forTick,
      playerId: localPlayerShortId || localPlayerId
    };
    
    // Always broadcast (most reliable), and also try direct sends when possible.
    p2p.sendData(msg);
    const peers = p2p.getConnectedPeers ? p2p.getConnectedPeers() : [];
    if (peers && peers.length > 0) {
      peers.forEach(pid => p2p.sendData(msg, pid));
    }
  }

  net.startTickLoop = function() {
    // Clear any existing interval/timeout
    if (tickIntervalId !== null) {
      clearTimeout(tickIntervalId);
      tickIntervalId = null;
    }
    
    // Check if we can advance to the next tick
    function canAdvanceToTick(targetTick) {
      if (!lockstepEnabled || !window.currentMatch) {
        return true; // No lockstep before match object exists
      }
      
      // If this match expects peers (co-op), never allow "free running" when the peer list
      // temporarily appears empty. That can cause clocks/ticks to diverge permanently.
      const humanPlayers = (window.currentMatch.players || []).filter(p => !p?.isAI);
      const expectsPeers = window.isMultiplayer && humanPlayers.length > 1;
      
      const connectedPeers = (p2p ? p2p.getConnectedPeers() : []).filter(peerId => !softDisconnectedPeers.has(peerId));
      // Keep isConnected in sync with reality.
      isConnected = connectedPeers.length > 0;
      
      if (connectedPeers.length === 0) {
        return !expectsPeers; // Solo/testing can run; co-op must wait
      }
      
      // Check if all peers have confirmed the target tick
      for (const peerId of connectedPeers) {
        const confirmedTick = peerTickConfirmations.get(normalizePeerId(peerId)) || 0;
        if (confirmedTick < targetTick) {
          return false; // This peer hasn't confirmed yet
        }
      }
      
      return true; // All peers confirmed
    }
    
    // The lockstep tick loop
    function lockstepTick() {
      const targetTick = tick + 1;
      const inputDelay = window.currentMatch?.inputDelayTicks || 3;
      
      // IMPORTANT: Do not run lockstep gating (or soft-drop) before the match actually starts.
      // During LOADING/READY/countdown, peers often aren't sending tick confirmations yet, which
      // can cause false timeouts and accidental soft-drops on fast clients.
      if (lockstepEnabled && window.currentMatch && window.currentMatch.state !== 'playing') {
        waitingForPeers = false;
        window.lockstepWaitingForPeers = false;
        // Keep a consistent cadence even during READY/LOADING transitions.
        tickIntervalId = setTimeout(lockstepTick, 1000 / (currentTickRate || net.TICK_RATE));
        return;
      }
      
      // If WE were soft-dropped (slow device), go idle and fast-forward to catch up.
      // We must not gate on peer confirmations while catching up, otherwise we'll never
      // reduce the gap. This does NOT affect other peers because they already stopped
      // waiting for us.
      if (selfSoftDropped && isAdventureCoopMatch() && window.currentMatch) {
        const catchupTarget = getCatchupTargetTick();
        
        // Pause the regular rAF physics loop during fast-forward to avoid double-sim.
        window.fastForwardingTicks = true;
        
        let advanced = 0;
        while (tick < catchupTarget && advanced < net.CATCHUP_MAX_TICKS_PER_SLICE) {
          tick++;
          processTick();
          runDeterministicPhysicsStepsForOneNetTick();
          advanced++;
        }
        
        // Confirm we're ready for future ticks (helps eventual rejoin)
        sendTickConfirmation(tick + inputDelay);
        
        // If we're caught up (or very close), stop fast-forwarding and go back to normal cadence.
        if (tick >= catchupTarget) {
          window.fastForwardingTicks = false;
          
          // If we remain near-caught-up for a short window, request lockstep rejoin.
          const now = Date.now();
          const near = Math.abs(catchupTarget - tick) <= 1;
          if (near) {
            if (!lastNearCaughtUpAt) lastNearCaughtUpAt = now;
            const stableMs = now - lastNearCaughtUpAt;
            if (stableMs >= net.LOCKSTEP_REJOIN_MIN_STABLE_MS && p2p && isConnected) {
              p2p.sendData({
                type: 'lockstep_rejoin_request',
                playerId: localPlayerId,
                shortId: getLocalPeerIdForComparison(),
                tick
              });
              // Rate-limit rejoin attempts
              lastNearCaughtUpAt = now + 10_000;
            }
          } else {
            lastNearCaughtUpAt = 0;
          }
          
          tickIntervalId = setTimeout(lockstepTick, 1000 / (currentTickRate || net.TICK_RATE));
        } else {
          // Continue catching up as fast as the device can manage (yield back immediately)
          tickIntervalId = setTimeout(lockstepTick, 0);
        }
        return;
      }
      
      
      if (canAdvanceToTick(targetTick)) {
        // We can advance!
        tick = targetTick;
        waitingForPeers = false;
        window.lockstepWaitingForPeers = false; // Expose to game loop
        lastStableLockstepAt = Date.now();
        waitingStartedAt = 0;
        
        // Adaptive cadence recovery: if we haven't been waiting recently, return to normal tick rate.
        if (currentTickRate < net.TICK_RATE && lastWaitedAt && (lastStableLockstepAt - lastWaitedAt) > 2000) {
          currentTickRate = net.TICK_RATE;
        }
        
        // Process the tick (commands + match logic)
        processTick();
        // Run exactly 3 physics steps for this tick (deterministic across all clients)
        runDeterministicPhysicsStepsForOneNetTick();
        
        // Confirm we're ready for future ticks (current + input delay)
        sendTickConfirmation(tick + inputDelay);
        
        // If lockstep has been stable for a while, ease inputDelayTicks back down (host only).
        // This prevents inputDelay getting stuck at MAX after a transient lag spike / chapter load.
        if (net.AUTO_INPUT_DELAY_DECREASE_ENABLED &&
            isAdventureCoopMatch() &&
            window.currentMatch?.isHost?.() &&
            window.currentMatch?.state === 'playing' &&
            window.currentMatch &&
            typeof window.currentMatch.inputDelayTicks === 'number') {
          
          const now = Date.now();
          const cur = window.currentMatch.inputDelayTicks;
          if (cur > net.MIN_INPUT_DELAY_TICKS &&
              (now - lastInputDelayDecreaseAt) >= net.AUTO_INPUT_DELAY_DECREASE_COOLDOWN_MS &&
              lastStableLockstepAt &&
              (now - lastStableLockstepAt) >= net.AUTO_INPUT_DELAY_DECREASE_AFTER_MS) {
            
            const nextDelay = Math.max(net.MIN_INPUT_DELAY_TICKS, cur - 1);
            lastInputDelayDecreaseAt = now;
            
            if (p2p && isConnected) {
              p2p.sendData({ type: 'set_input_delay', inputDelayTicks: nextDelay });
            }
            window.currentMatch.inputDelayTicks = nextDelay;
            // Keep as warn so it's visible when tuning networking.
            console.warn(`🕒 Host eased inputDelayTicks down to ${nextDelay} (lockstep stable)`);
          }
        }
        
        // Schedule next check at normal tick rate
        tickIntervalId = setTimeout(lockstepTick, 1000 / (currentTickRate || net.TICK_RATE));
      } else {
        // Waiting for peers - check again soon
        if (!waitingForPeers) {
          waitingForPeers = true;
        }
        window.lockstepWaitingForPeers = true; // Expose to game loop - pause physics!
        const now = Date.now();
        if (!waitingStartedAt) waitingStartedAt = now;
        lastWaitedAt = now;
        
        // Adaptive cadence: if we keep waiting, slow the lockstep driver a bit.
        // This gives slower devices more wall-clock time per tick and reduces "inputDelay stuck at 8" scenarios.
        if ((now - waitingStartedAt) > 600) {
          currentTickRate = Math.max(net.MIN_TICK_RATE, Math.min(currentTickRate || net.TICK_RATE, net.MIN_TICK_RATE));
        }
        
        // While waiting, periodically resend our latest confirmation as a heartbeat.
        // This helps peers recover if they missed our last tick_confirm.
        sendTickConfirmation(tick + inputDelay);
        
        // Log waiting status (rate limited)
        if (now - lastWaitLog > 2000) {
          const connectedPeers = (p2p ? p2p.getConnectedPeers() : []).filter(peerId => !softDisconnectedPeers.has(peerId));
          const waiting = connectedPeers.filter(peerId => {
            const confirmed = peerTickConfirmations.get(normalizePeerId(peerId)) || 0;
            return confirmed < targetTick;
          });
          if (waiting.length > 0) {
            try {
              const waitingSummary = waiting.map(pid => {
                const k = normalizePeerId(pid);
                const c = peerTickConfirmations.get(k) || 0;
                const lastMsg = lastPeerMessageAt.get(k) || 0;
                const lastProg = lastPeerProgressAt.get(k) || 0;
                const silentFor = lastMsg ? (now - lastMsg) : -1;
                const noProgFor = lastProg ? (now - lastProg) : -1;
                return `${k}:confirmed=${c},silentMs=${silentFor},noProgMs=${noProgFor}`;
              }).join(' | ');
              if (net.DEBUG_LOCKSTEP_WAIT_LOG) {
                // Use debug level to avoid alarming "yellow spam" during normal play.
                console.debug(`⏳ Lockstep waiting: targetTick=${targetTick}, waitingOn=[${waitingSummary}]`);
              }
            } catch (e) {
              // Don't let logging break the lockstep loop
            }
          }
          lastWaitLog = now;
        }
        
        // Adventure co-op: host can soft-drop peers that block lockstep too long.
        // This prevents one slow device from freezing everyone indefinitely.
        if (net.LOCKSTEP_SOFT_DROP_ENABLED && isAdventureCoopMatch() && window.currentMatch?.isHost?.() && window.currentMatch?.state === 'playing') {
          const connectedPeers = (p2p ? p2p.getConnectedPeers() : []).filter(peerId => !softDisconnectedPeers.has(peerId));
          const blockingPeers = connectedPeers.filter(peerId => {
            const confirmed = peerTickConfirmations.get(normalizePeerId(peerId)) || 0;
            return confirmed < targetTick;
          });
          
          // Track per-peer waiting start time
          blockingPeers.forEach(peerId => {
            if (!peerWaitStartedAt.has(peerId)) {
              peerWaitStartedAt.set(peerId, now);
            }
          });
          connectedPeers.forEach(peerId => {
            if (!blockingPeers.includes(peerId)) {
              peerWaitStartedAt.delete(peerId);
            }
          });
          
          blockingPeers.forEach(peerId => {
            const startedAt = peerWaitStartedAt.get(peerId) || now;
            const waitedMs = now - startedAt;
            const nKey = normalizePeerId(peerId);
            const lastSeen = lastPeerMessageAt.get(nKey) || 0;
            const silentForMs = now - lastSeen;
            const lastProgress = lastPeerProgressAt.get(nKey) || 0;
            const noProgressForMs = lastProgress ? (now - lastProgress) : Infinity;
            
            // Step 0: nudge the peer for an immediate confirmation + state (cheap, avoids false timeouts).
            const lastNudge = lastLockstepNudgeAt.get(nKey) || 0;
            if (now - lastNudge >= net.LOCKSTEP_NUDGE_INTERVAL_MS) {
              lastLockstepNudgeAt.set(nKey, now);
              // Ask that specific peer to re-emit tick_confirm + state_sync right now.
              if (p2p && p2p.sendData) {
                p2p.sendData({ type: 'request_tick_confirm' }, peerId);
                p2p.sendData({ type: 'force_state_sync' }, peerId);
              }
            }
            
            // Step 1 (prefer): increase slack by bumping input delay (host-coordinated).
            if (net.AUTO_INPUT_DELAY_ENABLED &&
                waitedMs >= net.AUTO_INPUT_DELAY_AFTER_MS &&
                now - lastInputDelayAdjustAt >= net.AUTO_INPUT_DELAY_COOLDOWN_MS &&
                window.currentMatch &&
                typeof window.currentMatch.inputDelayTicks === 'number' &&
                window.currentMatch.inputDelayTicks < net.MAX_INPUT_DELAY_TICKS) {
              
              const nextDelay = Math.min(net.MAX_INPUT_DELAY_TICKS, window.currentMatch.inputDelayTicks + 1);
              lastInputDelayAdjustAt = now;
              
              // Broadcast so everyone applies the same deterministic scheduling.
              if (p2p && isConnected) {
                p2p.sendData({
                  type: 'set_input_delay',
                  inputDelayTicks: nextDelay
                });
              }
              
              // Apply locally as well.
              window.currentMatch.inputDelayTicks = nextDelay;
              console.warn(`🕒 Host bumped inputDelayTicks to ${nextDelay} (trying to keep slow peer in lockstep)`);
              
              // Give the peer more time before considering soft-drop.
              peerWaitStartedAt.set(peerId, now);
              return;
            }
            
            // Step 2 (last resort): soft-drop if they're still blocking for too long.
            // Prefer not to soft-drop a peer who is making progress.
            // However, a peer can be "alive" (receiving set_input_delay or other chatter) but not
            // advancing confirmations, which deadlocks co-op and freezes units mid-move.
            const stuckNoProgress = noProgressForMs >= net.LOCKSTEP_PEER_NO_PROGRESS_MS;
            const stuckSilent = silentForMs >= net.LOCKSTEP_PEER_SILENT_MS;
            if (waitedMs >= net.LOCKSTEP_SOFT_DROP_TIMEOUT_MS && (stuckSilent || stuckNoProgress)) {
              // Broadcast decision so all remaining peers stop waiting consistently
              if (p2p && isConnected) {
                p2p.sendData({
                  type: 'lockstep_soft_drop',
                  peerId,
                  atTick: tick,
                  targetTick,
                  reason: stuckSilent ? 'lockstep_timeout_silent' : 'lockstep_timeout_no_progress'
                });
              }
              softDropPeer(peerId, stuckSilent ? 'lockstep_timeout_silent' : 'lockstep_timeout_no_progress');
            }
          });
        }
        
        // Poll at a small fraction of our tick cadence (avoids 5ms busy-loop CPU burn).
        const pollMs = Math.max(10, Math.floor(1000 / ((currentTickRate || net.TICK_RATE) * 4)));
        tickIntervalId = setTimeout(lockstepTick, pollMs);
      }
    }
    
    // Start the loop
    lockstepTick();
  };
  
  // Get maximum peer lag (how many ticks behind the slowest peer is)
  // Returns positive value if peers are ahead of us (we're behind)
  // Returns 0 if peers are in sync or behind us
  function getMaxPeerLag() {
    if (!window.currentMatch || !isConnected) return 0;
    
    let maxLag = 0;
    // CRITICAL: Use match tick only - network tick is just for internal loop
    const currentTick = window.currentMatch.tick;
    const now = Date.now();
    const STALE_THRESHOLD = 1000; // 1 second - ignore stale data aggressively
    const ticksPerSecond = net.TICK_RATE || 20;
    
    // Clean up stale entries
    peerLag.forEach((lagInfo, peerId) => {
      const timeSinceLastSeen = now - (lagInfo.lastSeen || 0);
      if (timeSinceLastSeen > STALE_THRESHOLD) {
        peerLag.delete(peerId);
      }
    });
    
    // Skip lag checking in first 5 seconds of match (synchronization period)
    const matchAge = window.currentMatch.gameTime || 0;
    if (matchAge < 5) {
      return 0; // Don't report lag during initial sync
    }
    
    peerLag.forEach((lagInfo, peerId) => {
      if (lagInfo.lastTick !== undefined) {
        const lag = lagInfo.lastTick - currentTick;
        const age = (now - (lagInfo.lastSeen || 0)) / 1000;
        
        // Ignore stale data (>1 second old)
        if (age > 1.0) return;
        
        // Only count positive lag (peer ahead) within reasonable bounds
        // Ignore impossibly large values (likely from before match reset)
        if (lag > 0 && lag < ticksPerSecond * 30) { // Max 30 seconds
          maxLag = Math.max(maxLag, lag);
        }
      }
    });
    
    return maxLag;
  }
  
  // Update peer lag tracking
  function updatePeerLag(peerId, peerTick) {
    if (!peerLag.has(peerId)) {
      peerLag.set(peerId, { lastTick: peerTick, lastSeen: Date.now() });
    } else {
      const lagInfo = peerLag.get(peerId);
      lagInfo.lastTick = peerTick;
      lagInfo.lastSeen = Date.now();
    }
    
    // Clean up stale entries periodically (older than 3 seconds)
    const now = Date.now();
    const STALE_AGE = 3000; // 3 seconds
    peerLag.forEach((info, pid) => {
      if (now - (info.lastSeen || 0) > STALE_AGE) {
        peerLag.delete(pid);
      }
    });
  }
  
  // Process a single tick (lockstep)
  function processTick() {
    // CRITICAL: Check if we're significantly behind and need to catch up
    // maxPeerLag > 0 means peers are ahead (we're behind)
    // LOCKSTEP MODE: Don't request catch-up. Both players should stay in sync via
    // deterministic simulation. If there's drift, the gentle position corrections handle it.
    // Requesting catch-up was causing more problems than it solved.
    //
    // Monitor peer lag for debugging only (no action taken)
    // Skip lag warning if no peers are connected (e.g., during disconnect)
    const connectedPeers = p2p ? p2p.getConnectedPeers() : [];
    if (connectedPeers.length > 0) {
      const maxPeerLag = getMaxPeerLag();
      if (maxPeerLag > 200 && window.currentMatch && !window.currentMatch._lastLagWarning) {
        // Only warn once for extreme lag (>10 seconds)
        const ticksPerSecond = net.TICK_RATE || 20;
        const secondsBehind = maxPeerLag / ticksPerSecond;
        console.warn(`⚠️ [DEBUG] Peer lag detected: ${maxPeerLag} ticks (~${secondsBehind.toFixed(1)}s). This should resolve with tick reset.`);
        window.currentMatch._lastLagWarning = Date.now();
      }
    }
    
    // Execute buffered commands for this tick
    executeCommandsForTick(tick);
    
    // Update match state (deterministic) - the match handles victory conditions and game state
    if (window.currentMatch && window.currentMatch.processTick) {
      window.currentMatch.processTick();
    }
    
    // Adaptive state sync frequency (LOD):
    // - Fast sync (200ms) when player commands are active (last 2 seconds)
    // - Slow sync (500ms) when idle (no recent player commands)
    const timeSinceLastCommand = Date.now() - lastPlayerCommandTime;
    const isActive = timeSinceLastCommand < 2000; // Active if command within last 2 seconds
    const syncInterval = isActive ? net.STATE_SYNC_INTERVAL : net.STATE_SYNC_INTERVAL_IDLE;
    
    // Send state sync if needed (BOTH players send their own state)
    if (Date.now() - lastStateSync > syncInterval && isConnected) {
      sendStateSync();
      lastStateSync = Date.now();
    }
    
    // Check for unacknowledged commands (resend if needed)
    checkPendingCommandAcks();
  };
  
  // Check and resend unacknowledged commands
  function checkPendingCommandAcks() {
    // Skip if no connected peers (e.g., AI-only game)
    const connectedPeers = p2p ? p2p.getConnectedPeers() : [];
    if (connectedPeers.length === 0) {
      // Clear any pending acks - no one to acknowledge them
      if (pendingCommandAcks.size > 0) {
        pendingCommandAcks.clear();
      }
      return;
    }
    
    const now = Date.now();
    pendingCommandAcks.forEach((ackInfo, commandId) => {
      if (now - ackInfo.sentAt > net.COMMAND_ACK_TIMEOUT) {
        // Command not acknowledged - resend
        ackInfo.retries++;
        if (ackInfo.retries < 3) { // Max 3 retries
          p2p.sendData({
            type: 'game_command',
            command: ackInfo.command,
            isRetry: true
          });
          ackInfo.sentAt = now;
        } else {
          // Give up after 3 retries
          console.warn(`⚠️ Command ${commandId} failed after ${ackInfo.retries} retries`);
          pendingCommandAcks.delete(commandId);
        }
      }
    });
  }
  
  // Queue a command for lockstep execution
  net.sendCommand = function(command) {
    if (!isConnected) {
      console.warn('Cannot send command: not connected');
      return false;
    }
    
    // If we were soft-dropped (slow device), we must go idle (no gameplay-affecting inputs)
    // until we catch up and rejoin lockstep. This prevents "missed window" commands that
    // would desync our local state vs the remaining peers.
    if (selfSoftDropped && isAdventureCoopMatch()) {
      console.warn('🧊 Command blocked: you are in catch-up (idle) mode.');
      return false;
    }
    
    // Add tick prediction (execute immediately for local player)
    command.tick = tick + Math.ceil(50 / (1000 / net.TICK_RATE)); // ~1 tick delay for latency
    const selfPlayerId = localPlayerShortId || normalizePeerId(localPlayerId) || localPlayerId;
    command.playerId = selfPlayerId;
    command.type = command.type || 'unknown';
    
    // Store locally for prediction
    commandBuffer.push(command);
    
    // Prune old commands
    if (commandBuffer.length > net.COMMAND_BUFFER_SIZE) {
      commandBuffer.shift();
    }
    
    // Send to remote peers
    const message = {
      type: 'command',
      tick: command.tick,
      content: command
    };
    
    // Broadcast to all connected peers
    p2p.sendData(message);
    
    // Predict execution for local player (optimistic)
    if (command.playerId === selfPlayerId) {
      executeCommand(command, tick);
    }
    
    return true;
  };
  
  // Execute all commands scheduled for current tick
  function executeCommandsForTick(currentTick) {
    // Get all commands for this tick from buffer and remote queues
    const commandsThisTick = [...commandBuffer.filter(c => c.tick === currentTick)];
    
    // Add remote commands
    remoteCommands.forEach((queue, playerId) => {
      const remoteCmds = queue.filter(c => c.tick === currentTick);
      commandsThisTick.push(...remoteCmds);
      // Remove executed remote commands
      remoteCommands.set(playerId, queue.filter(c => c.tick > currentTick));
    });
    
    // Sort by playerId for deterministic order
    commandsThisTick.sort((a, b) => window.deterministicStringCompare(a.playerId || 'local', b.playerId || 'local'));
    
    // Execute in deterministic order
    commandsThisTick.forEach(cmd => executeCommand(cmd, currentTick));
  };
  
  // Execute a single command (called by game systems)
  function executeCommand(command, currentTick) {
    // Validate tick (prevent future/past execution)
    if (Math.abs(command.tick - currentTick) > 2) {
      console.warn(`Skipping out-of-order command: tick ${command.tick} vs current ${currentTick}`);
      return;
    }
    
    // Dispatch to game systems based on type
    switch (command.type) {
      case 'move':
        handleMoveCommand(command);
        break;
      case 'attack':
        handleAttackCommand(command);
        break;
      case 'build':
        handleBuildCommand(command);
        break;
      case 'gather':
        handleGatherCommand(command);
        break;
      case 'ability':
        handleAbilityCommand(command);
        break;
      default:
        console.warn(`Unknown command type: ${command.type}`);
    }
  };
  
  // Command handlers (integrate with existing game systems)
  function handleMoveCommand(cmd) {
    const unit = findUnitById(cmd.unitId);
    if (unit && unit.owner === cmd.playerId) {
      // Move unit to target (use existing pathfinding)
      if (window.pathfinding && window.pathfinding.moveUnit) {
        window.pathfinding.moveUnit(unit, cmd.target);
      } else {
        // Fallback direct movement
        unit.pb.state.loc.x = cmd.target.x;
        unit.pb.state.loc.z = cmd.target.z;
      }
    }
  };
  
  function handleAttackCommand(cmd) {
    const attacker = findUnitById(cmd.unitId);
    const target = findUnitById(cmd.targetId);
    if (attacker && target && attacker.owner === cmd.playerId) {
      // Trigger attack (use existing combat system)
      if (window.combat && window.combat.attack) {
        window.combat.attack(attacker, target, cmd.damage);
      }
    }
  };
  
  function handleBuildCommand(cmd) {
    // Place building at target location
    if (window.buildingSystem && window.buildingSystem.placeBuilding) {
      window.buildingSystem.placeBuilding(cmd.buildingType, cmd.target, cmd.playerId);
    }
  };
  
  function handleGatherCommand(cmd) {
    const unit = findUnitById(cmd.unitId);
    const resource = findResourceById(cmd.resourceId);
    if (unit && resource && unit.owner === cmd.playerId) {
      // Start gathering (use existing resource system)
      if (window.resources && window.resources.gather) {
        window.resources.gather(unit, resource);
      }
    }
  };
  
  function handleAbilityCommand(cmd) {
    const unit = findUnitById(cmd.unitId);
    if (unit && unit.owner === cmd.playerId && unit.abilities.includes(cmd.ability)) {
      // Execute ability (use existing ability system)
      if (window.abilities && window.abilities.execute) {
        window.abilities.execute(unit, cmd.ability, cmd.target);
      }
    }
  };
  
  // Helper: Find unit by ID (search across all players)
  function findUnitById(unitId) {
    return [...(window.player?.units || []), ...(window.opponent?.units || []), ...window.gameUnits || []]
      .find(u => u.id === unitId);
  };
  
  function findResourceById(resourceId) {
    // Implement based on your resource system
    return window.resources?.find(r => r.id === resourceId);
  };
  
  // Handle incoming data channel messages
  function handleDataMessage(data, peerId) {
    try {
      const message = typeof data === 'string' ? JSON.parse(data) : data;
      
      // GetFire P2P wraps messages in game_data envelope, extract the actual content
      let actualMessage = message;
      if (message.type === 'game_data' && message.content) {
        actualMessage = message.content;
      }
      
      switch (actualMessage.type) {
        default:
          // Record that this peer is alive (any message counts)
          lastPeerMessageAt.set(normalizePeerId(peerId), Date.now());
          break;
      }
      
      // Re-enter the switch now that we've recorded last-seen.
      switch (actualMessage.type) {
        case 'command':
          // Queue remote command for lockstep
          if (!remoteCommands.has(peerId)) {
            remoteCommands.set(peerId, []);
          }
          remoteCommands.get(peerId).push(actualMessage.content);
          
          // Prune old remote commands
          remoteCommands.set(peerId, remoteCommands.get(peerId).filter(c => c.tick > tick - 10));
          
          // TRUE LOCKSTEP: Any received command implies the peer is alive and has advanced to (at least) that tick.
          // Some older code paths use {type:'command'} instead of {type:'game_command'}; without this, the host can
          // falsely think the peer is "not confirming" and soft-drop them.
          if (actualMessage.content && actualMessage.content.tick !== undefined) {
            const key = normalizePeerId(actualMessage.content.playerId || peerId);
            const currentConfirmed = peerTickConfirmations.get(key) || 0;
            if (actualMessage.content.tick > currentConfirmed) {
              peerTickConfirmations.set(key, actualMessage.content.tick);
              lastPeerProgressAt.set(key, Date.now());
            }
          }
          break;
          
        case 'tick_confirm':
          // TRUE LOCKSTEP: Peer confirms they're ready for tick N
          // This includes any commands they have for that tick
          if (actualMessage.tick !== undefined) {
            const confirmedTick = actualMessage.tick;
            const keyFromPeer = normalizePeerId(peerId);
            const keyFromPlayer = normalizePeerId(actualMessage.playerId);
            const currentConfirmed = peerTickConfirmations.get(keyFromPeer) || 0;
            
            // Only update if this is a newer confirmation
            if (confirmedTick > currentConfirmed) {
              peerTickConfirmations.set(keyFromPeer, confirmedTick);
              if (keyFromPlayer) {
                peerTickConfirmations.set(keyFromPlayer, Math.max(peerTickConfirmations.get(keyFromPlayer) || 0, confirmedTick));
              }
              // Tick confirmation is the strongest "progress" signal.
              lastPeerProgressAt.set(keyFromPeer, Date.now());
              if (keyFromPlayer) lastPeerProgressAt.set(keyFromPlayer, Date.now());
              // Log first few confirmations and then periodically
              if (confirmedTick < 10 || confirmedTick % 100 === 0) {
              }
            }
          }
          break;
        
        case 'request_tick_confirm':
          // Host is nudging us to re-emit confirmations (helps recover from transient packet loss).
          if (window.currentMatch) {
            const inputDelay = window.currentMatch.inputDelayTicks || 3;
            // Use our current local tick variable in net.js, not match tick (lockstep driver).
            sendTickConfirmation(tick + inputDelay);
            // Also send state sync to prove liveness / advance implicit confirmations.
            sendStateSync();
          }
          break;
          
        case 'state_sync':
          // P2P: Each player is authoritative for their own units
          // Only reconcile if there's significant drift (safety net for desync)
          reconcileState(actualMessage.content);
          // Update peer lag tracking
          if (actualMessage.content && actualMessage.content.tick !== undefined) {
            updatePeerLag(peerId, actualMessage.content.tick);
            
            // TRUE LOCKSTEP FALLBACK: Treat state_sync as an implicit tick confirmation.
            // This prevents stalls if tick_confirm packets are delayed/dropped while other
            // traffic (state_sync) is still flowing.
            const key = normalizePeerId(peerId);
            const currentConfirmed = peerTickConfirmations.get(key) || 0;
            const confirmTick = actualMessage.content.tick + (window.currentMatch?.inputDelayTicks || 3);
            if (confirmTick > currentConfirmed) {
              peerTickConfirmations.set(key, confirmTick);
              lastPeerProgressAt.set(key, Date.now());
            }
          }
          break;
          
        case 'resource_state_sync':
          if (window.currentMatch) {
            const match = window.currentMatch;
            if (actualMessage.resourceEntries) {
              actualMessage.resourceEntries.forEach(entry => {
                const key = `${entry.gridX},${entry.gridZ}`;
                match.resourceRemaining.set(key, entry.remaining);
              });
            }
            if (actualMessage.scheduledDepletions) {
              if (!match._scheduledDepletions) match._scheduledDepletions = new Map();
              actualMessage.scheduledDepletions.forEach(info => {
                const key = `${info.gridX},${info.gridZ}`;
                if (!match._scheduledDepletions.has(key)) {
                  match._scheduledDepletions.set(key, info);
                }
              });
            }
          }
          break;
          
        case 'unit_position_sync':
          // P2P: Apply unit positions from other players (they're authoritative for their own units)
          // This prevents floating-point drift while maintaining P2P fairness
          if (window.currentMatch && actualMessage.positions && actualMessage.playerId) {
            window.currentMatch.applyUnitPositions(actualMessage.positions, actualMessage.playerId, actualMessage.tick);
            
            // TRUE LOCKSTEP: Position sync also serves as tick confirmation
            if (actualMessage.tick !== undefined) {
              const keyFromPeer = normalizePeerId(peerId);
              const keyFromPlayer = normalizePeerId(actualMessage.playerId);
              const currentConfirmed = peerTickConfirmations.get(keyFromPeer) || 0;
              // Position syncs confirm up to the synced tick + inputDelay
              const confirmTick = actualMessage.tick + (window.currentMatch?.inputDelayTicks || 3);
              if (confirmTick > currentConfirmed) {
                peerTickConfirmations.set(keyFromPeer, confirmTick);
                if (keyFromPlayer) {
                  peerTickConfirmations.set(keyFromPlayer, Math.max(peerTickConfirmations.get(keyFromPlayer) || 0, confirmTick));
                }
                lastPeerProgressAt.set(keyFromPeer, Date.now());
                if (keyFromPlayer) lastPeerProgressAt.set(keyFromPlayer, Date.now());
              }
              updatePeerLag(peerId, actualMessage.tick);
            }
          }
          break;
        
        case 'lockstep_soft_drop':
          // Host has decided this peer is blocking lockstep too long; stop waiting for them.
          if (actualMessage.peerId) {
            softDropPeer(actualMessage.peerId, actualMessage.reason || 'lockstep_soft_drop');
            
            // If the host soft-dropped US, we should go idle and start catch-up mode.
            const localId = getLocalPeerIdForComparison();
            if (idsMatch(actualMessage.peerId, localId) || idsMatch(actualMessage.peerId, localPlayerId)) {
              selfSoftDropped = true;
              window.fastForwardingTicks = false;
              lastNearCaughtUpAt = 0;
              console.warn(`🧊 You were soft-dropped (slow device). Entering catch-up mode (idle).`);
            }
          }
          break;
        
        case 'lockstep_rejoin_accept':
          // Host allowed a previously soft-dropped peer to rejoin lockstep quorum.
          if (actualMessage.peerId) {
            softDisconnectedPeers.delete(actualMessage.peerId);
            peerWaitStartedAt.delete(actualMessage.peerId);
            
            // Prime confirmations so we don't immediately block on first tick after rejoin.
            if (typeof actualMessage.baselineTick === 'number') {
              const inputDelay = window.currentMatch?.inputDelayTicks || 3;
              peerTickConfirmations.set(normalizePeerId(actualMessage.peerId), actualMessage.baselineTick + inputDelay);
            }
            
            // If it was us, exit soft-drop mode and allow inputs again.
            const localId = getLocalPeerIdForComparison();
            if (idsMatch(actualMessage.peerId, localId) || idsMatch(actualMessage.peerId, localPlayerId)) {
              selfSoftDropped = false;
              window.fastForwardingTicks = false;
              lastNearCaughtUpAt = 0;
              console.warn(`✅ Rejoined lockstep.`);
            }
          }
          break;
        
        case 'force_state_sync':
          // Best-effort: peers can ask everyone to send an immediate state_sync to help a rejoin/catch-up.
          // This is safe because each player only includes their OWN units/buildings/resources.
          if (!actualMessage.targetPeerId || (peerId && actualMessage.targetPeerId === peerId) || actualMessage.targetPeerId === (localPlayerShortId || localPlayerId)) {
            sendStateSync();
          } else {
            // If target is specified and isn't us, ignore.
            // (force_state_sync is usually broadcast; target filtering prevents extra traffic)
          }
          break;
        
        case 'set_input_delay':
          // Host-coordinated input delay change (must be applied uniformly for determinism).
          if (window.currentMatch && typeof actualMessage.inputDelayTicks === 'number') {
            const newDelay = Math.max(1, Math.min(net.MAX_INPUT_DELAY_TICKS, Math.floor(actualMessage.inputDelayTicks)));
            const oldDelay = window.currentMatch.inputDelayTicks;
            window.currentMatch.inputDelayTicks = newDelay;
            console.warn(`🕒 Input delay adjusted: ${oldDelay} → ${newDelay} ticks`);
          }
          break;
        
        case 'lockstep_rejoin_request':
          // Only the host decides; when accepted we broadcast so everyone re-enables waiting for that peer.
          if (net.LOCKSTEP_SOFT_DROP_ENABLED && isAdventureCoopMatch() && window.currentMatch?.isHost?.() && actualMessage.playerId) {
            // Accept if they're connected; prime confirmations near our current tick.
            const baselineTick = tick;
            p2p.sendData({
              type: 'lockstep_rejoin_accept',
              peerId: actualMessage.playerId,
              baselineTick
            });
            
            // Ask all peers to send a fresh state sync to smooth out any visual/state divergence.
            p2p.sendData({
              type: 'force_state_sync'
            });
          }
          break;
          
        case 'request_catchup_sync':
          // Peer is falling behind and requesting a catch-up sync
          // Send them our current full state so they can fast-forward
          if (window.currentMatch && actualMessage.myTick !== undefined) {
            const theirTick = actualMessage.myMatchTick || actualMessage.myTick;
            const ourTick = window.currentMatch.tick || tick;
            const lag = ourTick - theirTick; // Positive = we're ahead, negative = they're ahead
            
            // Only help them catch up if we're actually ahead
            if (lag > 0) {
              
              // Send full state sync immediately
              sendStateSync();
              
              // Also send a catchup sync with our tick so they can fast-forward
              p2p.sendData({
                type: 'catchup_sync',
                targetTick: ourTick,
                matchTick: ourTick,
                timestamp: Date.now()
              }, peerId);
            } else {
              // They're actually ahead of us, ignore their catch-up request
              // (Silently ignore - this is normal when peers have slight timing differences)
            }
          }
          break;
          
        case 'request_catchup':
          // Peer is behind and requesting current tick to catch up
          if (window.currentMatch && actualMessage.fromTick !== undefined) {
            const currentTick = window.currentMatch.tick || tick;
            const ticksBehind = currentTick - actualMessage.fromTick;
            
            if (ticksBehind > 0) {
              console.log(`📡 Peer is ${ticksBehind} ticks behind, sending catch-up target: ${currentTick}`);
              
              // Send our current tick so they can fast-forward
              if (window.net && window.net.p2p) {
                window.net.p2p.sendData({
                  type: 'catchup_sync',
                  targetTick: currentTick
                });
              }
            }
          }
          break;
          
        case 'catchup_sync':
          // Received catch-up sync - fast-forward our tick to match theirs
          if (window.currentMatch && actualMessage.targetTick !== undefined) {
            const targetTick = actualMessage.targetTick;
            const currentTick = window.currentMatch.tick || tick;
            const ticksToCatchUp = targetTick - currentTick;
            
            if (ticksToCatchUp > 0 && ticksToCatchUp < 1000) { // Sanity check: don't fast-forward more than 20 seconds
              console.log(`⏩ Fast-forwarding ${ticksToCatchUp} ticks (${(ticksToCatchUp / 20).toFixed(1)}s) to catch up...`);
              
              // Pause the regular rAF physics loop during fast-forward to avoid double-sim
              window.fastForwardingTicks = true;
              
              // Fast-forward by processing ticks AND running physics (like selfSoftDropped path)
              // Without physics, behaviors get set but units never actually move during catch-up
              for (let i = 0; i < ticksToCatchUp; i++) {
                tick++;
                if (window.currentMatch) {
                  window.currentMatch.tick++;
                  window.currentMatch.gameTime = window.currentMatch.tick / (net.TICK_RATE || 20);
                  
                  window.currentMatch.executeCommandsForTick(window.currentMatch.tick);
                  
                  if (window.currentMatch.tick % 20 === 0) {
                    window.currentMatch.updateAIPlayers();
                    if (window.currentMatch.isHost()) {
                      window.currentMatch.generateAICommands();
                    }
                    window.currentMatch.checkAgoraOccupation();
                    window.currentMatch.checkWonderVictory();
                    window.currentMatch.checkEliminationVictory();
                  }
                }
                runDeterministicPhysicsStepsForOneNetTick();
              }
              
              window.fastForwardingTicks = false;
              
              // Mark that we're done catching up
              if (window.currentMatch) {
                window.currentMatch.isCatchingUp = false;
                window.currentMatch.lastCatchupRequest = 0; // Reset catch-up request timer
              }
              
              console.log(`✅ Caught up! Now at tick ${window.currentMatch?.tick || tick}`);
            } else if (ticksToCatchUp <= 0) {
              // Already caught up or ahead
              if (window.currentMatch) {
                window.currentMatch.isCatchingUp = false;
              }
            } else {
              console.warn(`⚠️ Catch-up sync requested impossible fast-forward: ${ticksToCatchUp} ticks (current: ${currentTick}, target: ${targetTick})`);
            }
          }
          break;
          
        case 'ping':
          // Respond to ping
          p2p.sendData({type: 'pong', from: localPlayerId}, peerId);
          break;
          
        case 'player_ready':
          // Other player ready - determine host deterministically
          if (actualMessage.playerId !== localPlayerId) {
            // Deterministic host selection: lower peer ID becomes host
            const peerIds = p2p.getConnectedPeers().sort();
            const allPeerIds = [localPlayerId, ...peerIds].sort();
            isHost = (allPeerIds[0] === localPlayerId);
            // console.log(`👑 Host determination: ${isHost ? 'I am host' : 'Peer is host'} (IDs: ${allPeerIds.join(', ')})`);
            
            // NO AUTO-START! Lobby system handles game start now via START button
          }
          break;
          
        case 'pong':
          // Handle pong response if tracking latency
          break;
          
        case 'player_ready_state':
          // Update ready state in lobby
          if (window.Lobby && actualMessage.playerId) {
            const wasReady = window.Lobby.playerReadyStates[actualMessage.playerId];
            window.Lobby.playerReadyStates[actualMessage.playerId] = actualMessage.isReady;
            
            // console.log(`${actualMessage.isReady ? '✅' : '⏸️'} Peer ${actualMessage.playerId.slice(-4)} ready state: ${actualMessage.isReady}`);
            
            // Update lobby UI if we're in a lobby
            if (window.Lobby.currentGameType && window.Lobby.currentLobbyId) {
              const lobby = window.Lobby.availableLobbies[window.Lobby.currentGameType]?.find(l => l.id === window.Lobby.currentLobbyId);
              if (lobby) {
                window.Lobby.updateLobbyRoomUI(window.Lobby.currentGameType, lobby);
                
                // If we're the host, announce lobby update (ready state changed)
                if (window.Lobby.isHost) {
                  // console.log(`📣 Host broadcasting lobby update (ready state changed)`);
                  window.Lobby.announceLobby(lobby);
                }
              }
            }
          }
          break;
          
        case 'lobby_closed':
          // Host closed the lobby - return to browser
          if (window.Lobby && actualMessage.lobbyId === window.Lobby.currentLobbyId) {
            console.log('🚪 Host closed lobby - returning to browser');
            window.Lobby.leaveLobby();
            if (window.ui && window.ui.showMenu) {
              window.ui.showMenu('main_menu');
            }
          }
          break;

        case 'lobby_name_update':
          // Host updated lobby name
          if (window.Lobby && actualMessage.name) {
            // Update local lobby copy
            if (window.Lobby.currentLobby) {
              window.Lobby.currentLobby.name = actualMessage.name;
              window.Lobby.currentLobby.timestamp = Date.now();

              // Update UI
              window.Lobby.updateLobbyRoomUI(window.Lobby.currentGameType, window.Lobby.currentLobby);
            }
          }
          break;

        case 'lobby_settings_update':
          // Host updated lobby settings
          if (window.Lobby && actualMessage.settings) {
            // Update local lobby copy
            if (window.Lobby.currentLobby) {
              window.Lobby.currentLobby.settings = actualMessage.settings;
              window.Lobby.currentLobby.timestamp = Date.now();

              // Update UI
              window.Lobby.updateLobbyRoomUI(window.Lobby.currentGameType, window.Lobby.currentLobby);
            }
          }
          break;
          
        case 'player_joined':
          // Add player to lobby
          if (window.Lobby && actualMessage.playerId && actualMessage.playerId !== localPlayerId) {
            const joinedPlayerId = actualMessage.playerId;
            const normalize = window.Lobby.normalizePeerId ? window.Lobby.normalizePeerId.bind(window.Lobby) : (id => id);
            const targetNormalizedId = normalize(joinedPlayerId);
            const playerExists = window.Lobby.connectedPlayers.some(p => normalize(p.id || p) === targetNormalizedId);
            const isAckMessage = !!actualMessage.handshakeAck;
            
            if (window.Lobby.upsertConnectedPlayerMeta) {
              window.Lobby.upsertConnectedPlayerMeta({
                id: joinedPlayerId,
                name: actualMessage.playerName,
                color: actualMessage.playerColor
              });
            } else if (!playerExists) {
              window.Lobby.connectedPlayers.push({
                id: joinedPlayerId,
                name: actualMessage.playerName,
                color: actualMessage.playerColor
              });
            }
            
            // Track connection state for UI regardless of whether the player is new
            if (window.Lobby.playerConnectionStates) {
              window.Lobby.playerConnectionStates[joinedPlayerId] = 'connected';
            }
            
            const connectedEntry = window.Lobby.connectedPlayers.find(p => normalize(p.id || p) === targetNormalizedId);
            const isMetadataComplete = !!connectedEntry?.name;
            
             // Ensure peer list stays aligned with actual connections
            if (window.Lobby.syncConnectedPlayersFromPeerIds && p2p) {
              window.Lobby.syncConnectedPlayersFromPeerIds(p2p.getConnectedPeers());
            }
            
            // Always refresh the lobby UI so updated metadata is visible
            if (window.Lobby.currentGameType && window.Lobby.currentLobbyId) {
              const lobby = window.Lobby.availableLobbies[window.Lobby.currentGameType]?.find(l => l.id === window.Lobby.currentLobbyId);
              if (lobby) {
                window.Lobby.updateLobbyRoomUI(window.Lobby.currentGameType, lobby);
                
                if (window.Lobby.isHost && (!playerExists || !isMetadataComplete)) {
                  window.Lobby.announceLobby(lobby);
                }
              }
              
              // Also update adventure-specific UI if in adventure mode
              if (window.Lobby.currentGameType === 'adventure' && window.Lobby.updateAdventurePlayerList) {
                window.Lobby.updateAdventurePlayerList();
              }
            }
            
            // Send our info back (if we're already in the lobby) only when this wasn't an acknowledgement
            if (window.Lobby.currentLobbyId && !isAckMessage) {
              p2p.sendData({
                type: 'player_joined',
                playerId: localPlayerId,
                playerName: window.currentPlayerName || window.player?.name || `Player ${localPlayerId.slice(-4)}`,
                playerColor: window.currentPlayerColor || window.player?.color || '#ffffff',
                handshakeAck: true
              }, peerId);
            }
          }
          break;
          
        case 'player_left':
          // Remove player from lobby
          if (window.Lobby && actualMessage.playerId) {
            if (window.Lobby.playerConnectionStates) {
              window.Lobby.playerConnectionStates[actualMessage.playerId] = 'disconnected';
            }
            if (window.Lobby.playerReadyStates) {
              delete window.Lobby.playerReadyStates[actualMessage.playerId];
            }
            if (window.Lobby.removeConnectedPlayerById) {
              window.Lobby.removeConnectedPlayerById(actualMessage.playerId);
            } else {
              window.Lobby.connectedPlayers = window.Lobby.connectedPlayers.filter(p => (p.id || p) !== actualMessage.playerId);
            }
            // console.log(`👤 Player left lobby: ${actualMessage.playerId}`);
            
            // Update lobby UI
            if (window.Lobby.currentGameType && window.Lobby.currentLobbyId) {
              const lobby = window.Lobby.availableLobbies[window.Lobby.currentGameType]?.find(l => l.id === window.Lobby.currentLobbyId);
              if (lobby) {
                window.Lobby.updateLobbyRoomUI(window.Lobby.currentGameType, lobby);
                
                if (window.Lobby.isHost) {
                  window.Lobby.announceLobby(lobby);
                }
              }
            }
          }
          break;
          
        case 'start_game':
          // Host has initiated match start!
          if (window.Lobby && actualMessage.gameType && actualMessage.settings) {
            // Store host's player ID and full player list for player ordering
            if (actualMessage.hostPlayerId) {
              window.Lobby._hostPlayerId = actualMessage.hostPlayerId;
            }
            if (actualMessage.playerIds) {
              window.Lobby._playerIds = actualMessage.playerIds;
              console.log(`📡 Received start_game with playerIds:`, actualMessage.playerIds.map(id => id.slice(-6)));
            }
            window.Lobby.startMultiplayerMatchWithSettings(actualMessage.gameType, actualMessage.settings);
          } else {
            console.error('❌ Received invalid start_game message:', actualMessage);
          }
          break;
          
        case 'adventure_countdown':
          // Host is counting down to start
          console.log('⏱️ Adventure countdown:', actualMessage.count);
          if (window.Lobby) {
            const hostInfo = document.getElementById('adventure_host_info');
            if (hostInfo) {
              hostInfo.innerHTML = `
                <div style="text-align: center; font-size: 24px; font-weight: bold;">Starting in ${actualMessage.count}...</div>
              `;
            }
            // Hide leave button during countdown
            const cancelBtn = document.querySelector('#adventure_hosting_view .lobby_b');
            if (cancelBtn) cancelBtn.style.display = 'none';
          }
          break;
          
        case 'adventure_start':
          // Host has started adventure mode!
          console.log('🚀 Received adventure_start from host!');
          if (window.Lobby && actualMessage.mapData) {
            // Show GO! message
            const hostInfo = document.getElementById('adventure_host_info');
            if (hostInfo) {
              hostInfo.innerHTML = `
                <div style="text-align: center; font-size: 24px; font-weight: bold; color: #4f4;">GO!</div>
              `;
            }
            
            // Stop join interval
            if (window.Lobby._adventureJoinInterval) {
              clearInterval(window.Lobby._adventureJoinInterval);
              window.Lobby._adventureJoinInterval = null;
            }
            window.Lobby._isJoiningAdventure = false;
            
            // Build correct player order: host is P1, we are P2
            // Ensure local player exists
            if (!window.player) {
              window.player = new Player();
            }
            if (!window.player.id || window.player.id === 'demo' || window.player.id === 'undefined') {
              const randomSuffix = Math.random().toString(36).substring(2, 8);
              window.player.id = `adventurer-${randomSuffix}`;
            }
            window.player.units = [];
            window.player.buildings = [];
            window.player.selectedUnits = [];
            
            const players = [];
            // P1 = Host
            if (actualMessage.hostId) {
              players.push({
                id: actualMessage.hostId,
                name: 'Host',
                color: '#ff0000',
                units: [],
                buildings: [],
                selectedUnits: []
              });
            }
            // P2 = Us (the peer)
            players.push(window.player);
            
            console.log('🎮 Peer player order:', players.map((p, i) => `P${i+1}=${(p.id || 'unknown').slice(-6)}`).join(', '));
            
            // Brief delay to show GO! then start
            setTimeout(() => {
              window.Lobby.startAdventureWithMap(actualMessage.mapData, players);
            }, 300);
          } else {
            console.error('❌ Received invalid adventure_start message:', actualMessage);
          }
          break;
          
        case 'game_command':
          // Receive command from another player for the match
          if (window.currentMatch && actualMessage.command) {
            const cmd = actualMessage.command;
            
            // CRITICAL: Normalize playerId to ensure consistent matching
            // Commands use normalized playerId (last 6 chars), but we need to match it correctly
            const normalizedPlayerId = cmd.playerId?.length > 6 ? cmd.playerId.slice(-6) : cmd.playerId;
            cmd.playerId = normalizedPlayerId; // Ensure command has normalized ID
            
            // TRUE LOCKSTEP: Command for tick N confirms peer is ready for tick N
            // Update tick confirmation (commands serve as implicit heartbeats)
            if (cmd.tick !== undefined) {
              const currentConfirmed = peerTickConfirmations.get(normalizePeerId(peerId)) || 0;
              if (cmd.tick > currentConfirmed) {
                peerTickConfirmations.set(normalizePeerId(peerId), cmd.tick);
              }
            }
            
            // Update peer lag tracking (they sent us a command at tick cmd.tick)
            // Use normalized playerId for lag tracking, not peerId
            updatePeerLag(normalizedPlayerId, cmd.tick);
            
            // Send acknowledgment if requested
            if (actualMessage.requestAck && cmd.commandId) {
              // Find the peerId that corresponds to this playerId
              const connectedPeers = p2p.getConnectedPeers();
              const targetPeerId = connectedPeers.find(p => {
                const normalizedPeer = normalizePeerId(p);
                return normalizedPeer === normalizedPlayerId;
              }) || peerId; // Fallback to original peerId if not found
              
              p2p.sendData({
                type: 'command_ack',
                commandId: cmd.commandId,
                tick: window.currentMatch.tick || tick
              }, targetPeerId);
            }
            
            // Check if command is for a past tick (arrived too late)
            if (cmd.tick < window.currentMatch.tick) {
              // Execute the command immediately since we're already past its scheduled tick.
              // Don't fast-forward physics: running extra steps for individual units
              // desynchronizes them from the simulation, and running updateUnits for ALL
              // units causes unrelated behaviors to complete early (triggering wandering).
              // Position sync corrections will handle any remaining drift.
              try {
                window.currentMatch.executeCommand(cmd);
              } catch (error) {
                console.error(`❌ Error executing late command:`, error);
              }
            } else {
              // CRITICAL: Deduplicate move commands - remove older commands for same units
              // This prevents jerky movement from processing intermediate commands
              if (cmd.type === 'move' && cmd.unitIds && cmd.unitIds.length > 0) {
                const unitIdSet = new Set(cmd.unitIds);
                
                // Check all command buffers for older move commands for these units
                window.currentMatch.commandBuffer.forEach((commands, tickKey) => {
                  const filteredCommands = commands.filter(existingCmd => {
                    // Keep non-move commands
                    if (existingCmd.type !== 'move') return true;
                    // Keep move commands for different units
                    if (!existingCmd.unitIds || existingCmd.unitIds.length === 0) return true;
                    // Remove if any unit IDs overlap (same units, newer command wins)
                    const hasOverlap = existingCmd.unitIds.some(id => unitIdSet.has(id));
                    return !hasOverlap;
                  });
                  
                  // Update the buffer with filtered commands
                  if (filteredCommands.length !== commands.length) {
                    if (filteredCommands.length > 0) {
                      window.currentMatch.commandBuffer.set(tickKey, filteredCommands);
                    } else {
                      window.currentMatch.commandBuffer.delete(tickKey);
                    }
                  }
                });
              }
              
              // CRITICAL: Add to match command buffer for future execution
              // Ensure command has normalized playerId for consistent processing
              const tickKey = cmd.tick;
              if (!window.currentMatch.commandBuffer.has(tickKey)) {
                window.currentMatch.commandBuffer.set(tickKey, []);
              }
              
              // console.log(`📥 [T${window.currentMatch.tick}] Received command from peer: ${cmd.type} for tick ${tickKey}, commandId=${cmd.commandId?.slice(-6)}, from player ${normalizedPlayerId}`);
              
              window.currentMatch.commandBuffer.get(tickKey).push(cmd);
            }
            
            // Add to command history
            window.currentMatch.commandHistory.push(cmd);
            window.currentMatch.replay.commands.push(cmd);
          }
          break;
          
        case 'command_ack':
          // Command acknowledgment received
          if (actualMessage.commandId && pendingCommandAcks.has(actualMessage.commandId)) {
            // Remove from pending list
            pendingCommandAcks.delete(actualMessage.commandId);
            // Update peer lag tracking
            if (actualMessage.tick !== undefined) {
              updatePeerLag(peerId, actualMessage.tick);
            }
          }
          break;
          
        case 'sync_checkpoint':
          // Verify synchronization checkpoint
          if (window.currentMatch && actualMessage.tick && actualMessage.checksum) {
            window.currentMatch.verifySyncCheckpoint(actualMessage.tick, actualMessage.checksum, actualMessage.components);
          }
          
          // Also use checkpoints as implicit confirmation (they only arrive if peer is alive).
          if (actualMessage.tick !== undefined) {
            const key = normalizePeerId(peerId);
            const currentConfirmed = peerTickConfirmations.get(key) || 0;
            const confirmTick = actualMessage.tick + (window.currentMatch?.inputDelayTicks || 3);
            if (confirmTick > currentConfirmed) {
              peerTickConfirmations.set(key, confirmTick);
            }
          }
          break;
          
        case 'request_state_sync':
          // Another player detected desync and needs full state
          if (window.currentMatch && isHost) {
            // console.log('📤 Sending full state sync to peer...');
            // TODO: Implement full state sync
          }
          break;
          
        case 'player_loaded':
          // Another player finished loading and is ready to start
          if (window.currentMatch && actualMessage.playerId) {
            const shortId = normalizePeerId(actualMessage.playerId);
            window.currentMatch.onPlayerLoaded(actualMessage.playerId);
          }
          break;
          
        case 'player_conceded':
          // Player conceded the match
          if (window.currentMatch && actualMessage.playerId) {
            const player = window.currentMatch.getPlayerById(actualMessage.playerId);
            const playerName = player?.name || `Player ${normalizePeerId(actualMessage.playerId)}`;
            console.log(`🏳️ ${playerName} conceded the match`);
            
            // Eliminate the conceding player
            if (window.currentMatch.eliminatePlayer) {
              window.currentMatch.eliminatePlayer(actualMessage.playerId);
            }
          }
          break;
          
        case 'match_countdown':
          // Host broadcasting countdown to clients
          if (window.currentMatch && actualMessage.countdown) {
            console.log(`⏳ Countdown update from host: ${actualMessage.countdown}`);
            window.currentMatch.updateLoadingOverlay(`${actualMessage.countdown}`);
          }
          break;
          
        case 'match_start':
          // Host signaling all clients to start playing
          if (window.currentMatch && window.currentMatch.beginPlaying) {
            console.log('🚀 Received match_start from host – entering PLAYING state');
            window.currentMatch.beginPlaying();
          }
          break;
        
        case 'adventure_objective_complete':
          // Host authoritative objective completion for co-op adventure.
          if (window.currentMatch && Array.isArray(window.adventureObjectives) && actualMessage.objectiveId !== undefined) {
            const obj = window.adventureObjectives.find(o => o && o.id === actualMessage.objectiveId);
            if (obj && !obj.completed) {
              obj.completed = true;
            }
            
            // Show speech/notification on clients to match host.
            if (actualMessage.message && window.UnitSpeech && window.UnitSpeech.showSpeech && window.gameUnits && actualMessage.unitId) {
              const unit = window.gameUnits.find(u => u && u.id === actualMessage.unitId);
              if (unit) {
                window.UnitSpeech.showSpeech(unit, actualMessage.message, 4000);
              }
            }
          }
          break;
        
        case 'adventure_victory':
          // Host authoritative victory trigger for co-op adventure.
          if (window.currentMatch && !window.currentMatch._adventureVictoryHandled) {
            window.currentMatch._adventureVictoryHandled = true;
            window.currentMatch._adventureVictoryPromptShown = false; // allow prompt once via handler
            window.currentMatch.isPaused = true;
            window.currentMatch.state = 'victory';
            if (typeof window.currentMatch.handleAdventureVictory === 'function') {
              window.currentMatch.handleAdventureVictory();
            }
          }
          break;
        
        case 'adventure_chapter_ready':
          // Host tracks which players have confirmed they want to continue.
          if (window.currentMatch && window.currentMatch.isHost && window.currentMatch.isHost() && actualMessage.playerId && actualMessage.nextChapterId) {
            if (!window.currentMatch._chapterTransition) {
              window.currentMatch._chapterTransition = { nextChapterId: null, ready: new Set(), started: false };
            }
            // Ignore if this is for a different chapter transition
            if (!window.currentMatch._chapterTransition.nextChapterId) {
              window.currentMatch._chapterTransition.nextChapterId = actualMessage.nextChapterId;
            }
            if (window.currentMatch._chapterTransition.nextChapterId !== actualMessage.nextChapterId) {
              break;
            }
            window.currentMatch._chapterTransition.ready.add(actualMessage.playerId);
            if (typeof window.currentMatch._checkChapterTransitionReady === 'function') {
              window.currentMatch._checkChapterTransitionReady();
            }
          }
          break;
        
        case 'adventure_chapter_start':
          // Host provides next chapter map + players so everyone loads together.
          if (window.Lobby && actualMessage.mapData && actualMessage.chapterId) {
            window.currentChapterId = actualMessage.chapterId;
            
            // Rebuild the player list so `window.player` is included for the local slot.
            const playerIds = Array.isArray(actualMessage.playerIds) ? actualMessage.playerIds : null;
            if (playerIds && playerIds.length > 0) {
              if (!window.player) {
                window.player = new Player();
              }
              const normalize = (id) => {
                if (!id) return '';
                const suffix = id.includes('-') ? id.split('-').pop() : id;
                return suffix.length > 6 ? suffix.slice(-6) : suffix;
              };
              const localNorm = normalize(window.player.id);
              const meta = Array.isArray(actualMessage.playersMeta) ? actualMessage.playersMeta : [];
              const players = playerIds.map((id, idx) => {
                const idNorm = normalize(id);
                if (localNorm && idNorm === localNorm) {
                  // Preserve local player object for input/selection, but adopt host-assigned name/color for consistency.
                  if (meta[idx] && meta[idx].color) window.player.color = meta[idx].color;
                  if (meta[idx] && meta[idx].name) window.player.name = meta[idx].name;
                  return window.player;
                }
                return {
                  id,
                  name: meta[idx]?.name || (idx === 0 ? 'Host' : `Player ${idx + 1}`),
                  color: meta[idx]?.color || (idx === 0 ? '#ff0000' : '#00ff00'),
                  units: [],
                  buildings: [],
                  selectedUnits: []
                };
              });
              window.Lobby.startAdventureWithMap(actualMessage.mapData, players);
            } else {
              // Fallback: preserve existing players if available
              const coopPlayers = window.currentMatch?.players;
              window.Lobby.startAdventureWithMap(actualMessage.mapData, Array.isArray(coopPlayers) ? coopPlayers : undefined);
            }
          }
          break;
          
        case 'match_pause':
          // Player broadcasting pause to all others
          if (window.currentMatch) {
            console.log('⏸️ Received match_pause from peer');
            window.currentMatch.isPaused = true;
            window.currentMatch.updateLoadingOverlay('⏸️ PAUSED');
            // console.log('⏸️ Match paused by remote player');
          }
          break;
          
        case 'match_resume':
          // Player broadcasting resume to all others
          if (window.currentMatch) {
            console.log('▶️ Received match_resume from peer');
            window.currentMatch.isPaused = false;
            const overlay = document.getElementById('match_loading_overlay');
            if (overlay) {
              overlay.style.display = 'none';
            }
            // console.log('▶️ Match resumed by remote player');
          }
          break;
          
        default:
          // console.warn(`Unknown message type: ${actualMessage.type}`, 'Full message:', actualMessage);
      }
    } catch (error) {
      console.error('Failed to parse network message:', error);
    }
  };
  
  // Handle game lobby messages (match requests, etc)
  function handleGameLobbyMessage(data) {
    // console.log('📩 Game lobby message:', data.type, data);
    
    // Manual match initiation if auto-negotiation fails
    if ((data.type === 'player_join' || data.type === 'player_rejoin') && 
        data.from !== localPlayerId &&
        window.Lobby && window.Lobby.currentLobbyId) {
      
      const myId = localPlayerId;
      const theirId = data.from;
      
      // console.log(`🤝 Detected peer ${theirId}, checking if we should initiate...`);
      
      // Check immediately
      const checkConnection = () => {
        const connectedPeers = p2p.getConnectedPeers();
        if (connectedPeers.includes(theirId)) {
          // console.log(`✅ [${myId}] Already connected to ${theirId}`);
          return;
        }
        
        // Deterministic: higher ID initiates
        if (myId > theirId) {
          // console.log(`📞 [${myId}] I should initiate (${myId} > ${theirId})`);
          p2p.requestMatch(theirId);
        } else {
          // console.log(`⏳ [${myId}] Waiting for ${theirId} to initiate (${theirId} > ${myId})`);
          
          // Safety: If they don't initiate after 3 seconds, we do it anyway
          setTimeout(() => {
            const stillNotConnected = !p2p.getConnectedPeers().includes(theirId);
            if (stillNotConnected) {
              // console.warn(`⚠️ [${myId}] Peer didn't initiate, forcing match request!`);
              p2p.requestMatch(theirId);
            }
          }, 3000);
        }
      };
      
      // Check after short delay (let GetFire try first)
      setTimeout(checkConnection, 300);
    }
    
    // GetFire also handles auto-negotiation internally after calling this
  }
  
  // Handle peer connection - updated to sync isConnected
  function onPeerConnected(peerId) {
    // console.log(`✅ Connected to peer: ${peerId.slice(-8)}`);
    isConnected = p2p.getConnectedPeers().length > 0;
    reconnectAttempts = 0;
    
    // Check if this is a reconnection during a match
    if (window.currentMatch && 
        window.currentMatch.state === 'disconnected' && 
        window.currentMatch._disconnectedPlayerId === peerId) {
      handlePlayerReconnected(peerId);
      return;
    }
    
    // Update lobby connection status
    if (window.Lobby) {
      window.Lobby.playerConnectionStates[peerId] = 'connected';
      
      const currentPeers = [...new Set(p2p.getConnectedPeers())];
      if (window.Lobby.syncConnectedPlayersFromPeerIds) {
        window.Lobby.syncConnectedPlayersFromPeerIds(currentPeers);
      } else {
        window.Lobby.connectedPlayers = currentPeers;
      }
    }
    
    // Send ready signal with local player ID
    p2p.sendData({type: 'player_ready', playerId: localPlayerId, gameType: gameId});
    
    // Announce player presence to lobby
    if (window.Lobby && window.Lobby.currentLobbyId) {
      // console.log(`👤 Sending player_joined to peer ${peerId}`);
      if (window.Lobby.sendPlayerPresence) {
        window.Lobby.sendPlayerPresence(peerId);
      } else {
        p2p.sendData({
          type: 'player_joined',
          playerId: localPlayerId,
          playerName: window.currentPlayerName || window.player?.name || `Player ${localPlayerId.slice(-4)}`,
          playerColor: window.currentPlayerColor || window.player?.color || '#ffffff'
        });
      }
      
      // Update lobby UI to show connection status
      if (window.Lobby.currentGameType && window.Lobby.currentLobby) {
        window.Lobby.updateLobbyRoomUI(window.Lobby.currentGameType, window.Lobby.currentLobby);
      }
    } else {
      // console.log('⚠️ Not in lobby, skipping player_joined');
    }
    
    // Host will be determined when both sides exchange player_ready messages
    // (see handleDataMessage for deterministic host selection)
  };
  
  // Handle player reconnection during match
  function handlePlayerReconnected(peerId) {
    const match = window.currentMatch;
    const player = match.getPlayerById(peerId);
    const playerName = player?.name || `Player ${peerId.slice(-4)}`;
    
    // console.log(`✅ ${playerName} reconnected!`);
    
    // Cancel forfeit timeout
    if (match._reconnectTimeout) {
      clearTimeout(match._reconnectTimeout);
      match._reconnectTimeout = null;
    }
    
    // Resume match
    match.isPaused = false;
    match.state = 'playing';
    match._disconnectedPlayerId = null;
    
    // Show notification
    match.showNotification(`✅ ${playerName} reconnected - resuming match`, 'success');
    
    // Hide overlay
    hideDisconnectOverlay();
    
    // Send state sync to reconnected player if we're host
    if (window.Lobby && window.Lobby.isHost) {
      setTimeout(() => {
        p2p.sendData({
          type: 'state_sync',
          tick: match.tick,
          checksum: match.calculateGameStateChecksum()
        }, peerId);
      }, 500);
    }
  }
  
  // Handle peer disconnection - updated to sync isConnected
  function onPeerDisconnected(peerId) {
    console.log(`👋 Peer disconnected: ${peerId.slice(-8)}`);
    isConnected = p2p.getConnectedPeers().length > 0;
    remoteCommands.delete(peerId);
    
    // CRITICAL: Clear tick confirmation for disconnected peer
    // This allows lockstep to continue without waiting for them
    peerTickConfirmations.delete(peerId);
    peerTickConfirmations.delete(normalizePeerId(peerId));
    
    // Update lobby connection status
    if (window.Lobby) {
      window.Lobby.playerConnectionStates[peerId] = 'disconnected';
      if (window.Lobby.removeConnectedPlayerById) {
        window.Lobby.removeConnectedPlayerById(peerId);
      }
      
      const currentPeers = [...new Set(p2p.getConnectedPeers())];
      if (window.Lobby.syncConnectedPlayersFromPeerIds) {
        window.Lobby.syncConnectedPlayersFromPeerIds(currentPeers);
      } else {
        window.Lobby.connectedPlayers = currentPeers;
      }
      
      // Update lobby UI
      if (window.Lobby.currentGameType && window.Lobby.currentLobby) {
        window.Lobby.updateLobbyRoomUI(window.Lobby.currentGameType, window.Lobby.currentLobby);
        
        // If we're the host, announce updated lobby (player count changed)
        if (window.Lobby.isHost && window.Lobby.currentLobby) {
          window.Lobby.announceLobby(window.Lobby.currentLobby);
        }
      }
    }
    
    // Try to reconnect after timeout (only if not in active match)
    if (!window.currentMatch || window.currentMatch.state !== 'playing') {
      setTimeout(() => {
        if (!p2p.getConnectedPeers().includes(peerId)) {
          reconnectAttempts++;
          // console.log(`🔄 Reconnect attempt ${reconnectAttempts} for ${peerId}`);
          p2p.requestMatch(peerId);
        }
      }, net.RECONNECT_TIMEOUT);
    }
  };
  
  // Handle disconnection during active match
  function handleMatchDisconnect(peerId) {
    const match = window.currentMatch;
    const player = match.getPlayerById(peerId);
    const playerName = player?.name || `Player ${peerId.slice(-4)}`;
    
    // console.log(`⚠️ ${playerName} disconnected during match`);
    
    // Pause the match  
    match.isPaused = true;
    const previousState = match.state;
    match.state = 'disconnected';
    
    // Show disconnect overlay
    showDisconnectOverlay(playerName);
    
    // Wait for reconnection (30 second timeout)
    const reconnectTimeout = setTimeout(() => {
      if (match.state === 'disconnected') {
        // Player didn't reconnect - they forfeit
        // console.log(`💀 ${playerName} failed to reconnect - automatic forfeit`);
        match.eliminatePlayer(peerId);
        
        hideDisconnectOverlay();
        
        // Check if match should end
        const remainingPlayers = match.players.filter(p => 
          !match.eliminatedPlayers.has(p.id || p)
        );
        
        if (remainingPlayers.length === 1) {
          match.endMatch(remainingPlayers[0].id || remainingPlayers[0], 'disconnect_forfeit');
        } else if (remainingPlayers.length > 1) {
          // Resume match with remaining players
          match.state = previousState;
          match.isPaused = false;
        }
      }
    }, 30000); // 30 seconds to reconnect
    
    // Store timeout ID so we can cancel if they reconnect
    match._reconnectTimeout = reconnectTimeout;
    match._disconnectedPlayerId = peerId;
  }
  
  // Show disconnect overlay
  function showDisconnectOverlay(playerName) {
    let overlay = document.getElementById('disconnect_overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'disconnect_overlay';
      document.body.appendChild(overlay);
    }
    
    overlay.innerHTML = `
      <div class="disconnect_panel">
        <div class="disconnect_icon">⚠️</div>
        <h2>Player Disconnected</h2>
        <p><strong>${playerName}</strong> has lost connection</p>
        <div class="disconnect_timer">
          <p>Waiting for reconnection...</p>
          <div class="timer_bar"><div class="timer_fill"></div></div>
          <p class="timer_text">30 seconds remaining</p>
        </div>
        <p class="disconnect_hint">Match is paused</p>
      </div>
    `;
    
    overlay.style.display = 'flex';
    
    // Animate timer bar
    const timerFill = overlay.querySelector('.timer_fill');
    const timerText = overlay.querySelector('.timer_text');
    let secondsLeft = 30;
    
    const timerInterval = setInterval(() => {
      secondsLeft--;
      const percent = (secondsLeft / 30) * 100;
      timerFill.style.width = percent + '%';
      timerText.textContent = `${secondsLeft} seconds remaining`;
      
      if (secondsLeft <= 0) {
        clearInterval(timerInterval);
      }
    }, 1000);
    
    overlay._timerInterval = timerInterval;
  }
  
  // Hide disconnect overlay
  function hideDisconnectOverlay() {
    const overlay = document.getElementById('disconnect_overlay');
    if (overlay) {
      if (overlay._timerInterval) {
        clearInterval(overlay._timerInterval);
      }
      overlay.style.display = 'none';
    }
  }
  
  // Track command acknowledgment (only when there are real peers)
  net.trackCommandAck = function(commandId, command) {
    // Skip tracking if no connected peers (e.g., AI-only game)
    const connectedPeers = p2p ? p2p.getConnectedPeers() : [];
    if (connectedPeers.length === 0) {
      return; // No peers to wait for acknowledgment
    }
    
    pendingCommandAcks.set(commandId, {
      command: command,
      sentAt: Date.now(),
      retries: 0
    });
  };
  
  // Update last player command time (for LOD sync frequency)
  net.updateLastPlayerCommandTime = function() {
    lastPlayerCommandTime = Date.now();
  };
  
  // Get current adaptive tick rate
  net.getCurrentTickRate = function() {
    return currentTickRate;
  };
  
  // Get peer lag info
  net.getPeerLag = function() {
    const lagInfo = {};
    peerLag.forEach((info, peerId) => {
      lagInfo[peerId] = {
        lastTick: info.lastTick,
        lastSeen: info.lastSeen,
        lag: (window.currentMatch?.tick || tick) - info.lastTick
      };
    });
    return lagInfo;
  };
  
  // Expose p2p for direct access
  Object.defineProperty(net, 'p2p', {
    get: function() { return p2p; }
  });
  
  // Join a broadcast channel
  net.joinBroadcast = function(channelName) {
    if (p2p && p2p.joinBroadcast) {
      p2p.joinBroadcast(channelName);
      // console.log(`📡 Joined broadcast channel: ${channelName}`);
    } else {
      console.warn(`Cannot join broadcast ${channelName}: P2P not ready`);
    }
  };
  
  // Send broadcast message
  net.broadcast = function(data, channelName) {
    if (p2p && p2p.broadcast) {
      p2p.broadcast(data, channelName);
    }
  };
  
  // Handle broadcast messages (lobby/global)
  function onBroadcastMessage(data) {
    // Pass to external handler if set
    if (net.onBroadcast) {
      net.onBroadcast(data);
    }
    
    // Handle lobby messages, game invites, etc.
    switch (data.type) {
      case 'lobby_chat':
        // Update lobby UI
        if (window.ui && window.ui.updateLobbyChat) {
          window.ui.updateLobbyChat(data.message, data.from);
        }
        break;
      case 'game_invite':
        // Show invite UI
        if (window.ui && window.ui.showGameInvite) {
          window.ui.showGameInvite(data.from, data.gameType);
        }
        break;
      case 'lobby_closed':
        // Host closed the lobby - return to browser
        if (window.Lobby && data.lobbyId === window.Lobby.currentLobbyId) {
          console.log('🚪 Host closed lobby (broadcast) - returning to browser');
          window.Lobby.leaveLobby();
          if (window.ui && window.ui.showMenu) {
            window.ui.showMenu('main_menu');
          }
        }
        break;
      default:
        // Ignore unknown broadcast types
    }
  };
  
  // Send full state sync (BOTH players send their own unit positions)
  function sendStateSync() {
    // IMPORTANT: Don't gate state sync on `isConnected`.
    // GetFire can briefly report 0 peers during transitions; if we stop emitting state_sync,
    // lockstep may falsely think a peer is stalled and soft-drop them.
    if (!p2p || !p2p.sendData) return;
    
    // PEER-TO-PEER: Each player only sends their OWN unit positions
    const localOwnerId = localPlayerShortId || normalizePeerId(localPlayerId) || localPlayerId;
    
    // Find only OUR units (don't try to sync opponent's units)
    const allUnits = window.gameUnits || [];
    const myUnits = allUnits.filter(u => u.owner === localOwnerId);
    
    // CRITICAL: Include resource tile states for camps at sync checkpoints
    // This ensures resource states stay synchronized even if workers complete at different ticks
    const resourceStates = {};
    if (window.gameBuildings && tick % (window.currentMatch?.syncInterval || 100) === 0) {
      window.gameBuildings.forEach(building => {
        if (building.owner === localOwnerId && building.availableResources && building.availableResources.length > 0) {
          resourceStates[building.id] = building.availableResources.map(r => ({
            gridX: r.gridX,
            gridZ: r.gridZ,
            remaining: r.remaining || 0,
            depleted: r.depleted || false,
            depletionTick: r.depletionTick
          }));
        }
      });
    }
    
    const state = {
      tick: tick,
      playerId: localOwnerId, // Identify which player this state is from
      resources: window.player?.resources || {},
      units: myUnits.map(u => ({
        id: u.id,
        pos: {x: u.pb.state.loc.x, z: u.pb.state.loc.z},
        health: u.currentHealth,
        state: u.state
      })),
      buildings: window.gameBuildings?.filter(b => b.owner === localOwnerId).map(b => ({
        id: b.id, 
        type: b.type, 
        pos: b.position
      })) || [],
      resourceStates: Object.keys(resourceStates).length > 0 ? resourceStates : undefined, // Only include if we have resources
      timestamp: Date.now()
    };
    
    const message = {
      type: 'state_sync',
      isHost: true,
      content: state,
      tick: tick
    };
    
    // Always broadcast (most reliable), and also try direct sends when possible.
    p2p.sendData(message);
    const peers = p2p.getConnectedPeers ? p2p.getConnectedPeers() : [];
    if (peers && peers.length > 0) {
      peers.forEach(pid => p2p.sendData(message, pid));
    }
    // Log occasionally (disabled - working!)
    // if (tick % (net.TICK_RATE * 5) === 0) {
    //   console.log(`📤 Sent state sync: ${myUnits.length} units from player ${localOwnerId} at tick ${tick}`);
    // }
  };
  
  // Reconcile with authoritative state (PEER-TO-PEER version)
  function reconcileState(remoteState) {
    const remoteTick = remoteState.tick;
    const remotePlayerId = remoteState.playerId;
    const tickDiff = remoteTick - tick;
    
    // Don't sync ticks - let them run independently and rely on command scheduling
    // Commands are scheduled for specific ticks and will execute when both clients reach that tick
    // Position sync every 200ms handles any drift in simulation results
    
    // Only reconcile positions if reasonably close (prevent massive rewinds)
    if (Math.abs(tickDiff) > 10) {
      // console.log(`⚠️ Tick desync: local=${tick}, remote=${remoteTick} (diff: ${tickDiff})`);
      // Still reconcile positions even if ticks are desynced
    }
    
    // CRITICAL: Never rewind simulation - we're using lockstep with checkpoint sync
    // If remote tick is behind, it means they sent stale data - skip position updates
    // The rewindSimulation function is a placeholder and should not be used in P2P lockstep
    // if (remoteTick < tick) {
    //   rewindSimulation(remoteTick); // DISABLED: Never rewind in lockstep mode
    // }
    
    // Apply state corrections
    const localOwnerId = localPlayerShortId || normalizePeerId(localPlayerId) || localPlayerId;
    
    // Skip if this is our own state echoed back
    if (remotePlayerId === localOwnerId) {
      return;
    }
    
    // Debug: Log state sync info occasionally (disabled - working!)
    // if (tick % (net.TICK_RATE * 5) === 0) {
    //   console.log(`📥 Received state from player ${remotePlayerId}: ${remoteState.units.length} units at tick ${remoteTick}`);
    // }
    
    // Update remote player resources
    if (window.opponent && remotePlayerId === window.opponent.id) {
      window.opponent.resources = {...remoteState.resources};
    }
    
    // CRITICAL: Sync resource tile states at sync checkpoints
    // This ensures resource states stay synchronized even if workers complete at different ticks
    if (remoteState.resourceStates && window.gameBuildings && tick % (window.currentMatch?.syncInterval || 100) === 0) {
      Object.keys(remoteState.resourceStates).forEach(buildingId => {
        const building = window.gameBuildings.find(b => b.id === buildingId);
        if (building && building.availableResources) {
          const remoteResources = remoteState.resourceStates[buildingId];
          
          // Update each resource tile state
          remoteResources.forEach(remoteResource => {
            const localResource = building.availableResources.find(r => 
              r.gridX === remoteResource.gridX && r.gridZ === remoteResource.gridZ
            );
            
            if (localResource) {
              // Sync remaining amount and depletion state
              localResource.remaining = remoteResource.remaining;
              localResource.depleted = remoteResource.depleted;
              localResource.depletionTick = remoteResource.depletionTick;
            }
          });
          
          console.log(`🔄 Synced resource states for building ${buildingId} at tick ${tick}`);
        }
      });
    }
    
    // Update remote units with smart correction
    let unitsFound = 0;
    let unitsUpdated = 0;
    let ownerMismatches = 0;
    
    // CRITICAL: Skip position reconciliation for stale state_sync messages
    // Checkpoint sync (unit_position_sync) handles position sync, so state_sync should
    // only be used for health/state updates. Old state_sync messages with stale positions
    // cause false "catastrophic desync" warnings.
    const isStaleMessage = Math.abs(tickDiff) > 50; // More than 50 ticks old = stale
    
    remoteState.units.forEach(remoteUnit => {
      const localUnit = findUnitById(remoteUnit.id);
      if (localUnit) {
        unitsFound++;
        
        // Only accept position updates from the unit's owner
        // Normalize IDs for comparison (last 6 chars)
        const localUnitOwnerId = localUnit.owner?.slice ? localUnit.owner.slice(-6) : localUnit.owner;
        const remoteOwnerId = remotePlayerId?.slice ? remotePlayerId.slice(-6) : remotePlayerId;
        
        // Skip if this unit doesn't belong to the remote player
        if (localUnitOwnerId !== remoteOwnerId) {
          ownerMismatches++;
          return; // Not their unit to update
        }
        
        unitsUpdated++;
        
        // P2P with checkpoint sync: We now sync positions at checkpoints (every 100 ticks)
        // This old reconcile system is just a safety net for catastrophic desyncs
        // Only snap on MASSIVE drift (>50 units = missed command or major logic error)
        // CRITICAL: Never apply positions from past ticks - only forward or current tick
        // Skip position reconciliation entirely for stale messages to prevent false desync warnings
        if (!isStaleMessage && remoteTick >= tick) {
          // Only reconcile if remote tick is current or future (never past)
          const dx = remoteUnit.pos.x - localUnit.pb.state.loc.x;
          const dz = remoteUnit.pos.z - localUnit.pb.state.loc.z;
          const distanceSq = dx * dx + dz * dz;
          
          // Only snap if drift is CATASTROPHIC (> 50 units - probably missed a command)
          // Normal ~10 unit drift is handled by checkpoint sync every 100 ticks
          if (distanceSq > 2500) { // 50^2 = 2500
            localUnit.pb.state.loc.x = remoteUnit.pos.x;
            localUnit.pb.state.loc.z = remoteUnit.pos.z;
            console.warn(`⚠️ CATASTROPHIC DESYNC: Snapped unit ${localUnit.id.slice(-4)} - drift: ${Math.sqrt(distanceSq).toFixed(2)} units`);
          }
          // Small drift (<50 units) is normal and will be corrected at next checkpoint sync
        }
        // If message is stale or from past tick, skip position updates entirely - checkpoint sync handles positions
        
        // Always sync health and state immediately (even for stale messages)
        localUnit.currentHealth = remoteUnit.health;
        localUnit.state = remoteUnit.state;
      }
    });
    
    // Log summary occasionally (disabled - working!)
    // if (tick % (net.TICK_RATE * 5) === 0) {
    //   console.log(`     ├─ Found: ${unitsFound}/${remoteState.units.length}, Updated: ${unitsUpdated}, Owner mismatches: ${ownerMismatches}`);
    // }
    
    // Update buildings (if provided)
    if (remoteState.buildings && remoteState.buildings.length > 0) {
      // Initialize buildings array if it doesn't exist
      if (!window.buildings) {
        window.buildings = [];
      }
      
      remoteState.buildings.forEach(remoteBuilding => {
        // Find or create local building representation
        let localBuilding = window.buildings.find(b => b.id === remoteBuilding.id);
        if (!localBuilding) {
          // Create ghost building for opponent
          localBuilding = createGhostBuilding(remoteBuilding);
          window.buildings.push(localBuilding);
        } else {
          // Update position if moved (rare)
          localBuilding.position.x = remoteBuilding.pos.x;
          localBuilding.position.z = remoteBuilding.pos.z;
        }
      });
    }
  };
  
  // Rewind simulation to previous tick (for corrections)
  function rewindSimulation(targetTick) {
    // Store current state
    const backupState = captureGameState();
    
    // Reset to target tick (simplified - in full impl, replay commands up to targetTick)
    tick = targetTick;
    
    // Restore from backup or replay commands (placeholder)
    // In production: replay all commands up to targetTick deterministically
    // console.log(`⏪ Rewound simulation to tick ${targetTick}`);
  };
  
  // Capture current game state for backup/rewind
  function captureGameState() {
    return {
      tick: tick,
      units: window.gameUnits?.map(u => ({
        id: u.id,
        pos: {...u.pb.state.loc},
        rot: {...u.pb.state.rot},
        health: u.currentHealth,
        state: u.state
      })) || [],
      resources: window.player?.resources || {},
      buildings: window.buildings?.map(b => ({id: b.id, type: b.type, health: b.health})) || []
    };
  };
  
  // Create ghost building for opponent (visual only)
  function createGhostBuilding(buildingData) {
    // Create simplified mesh for opponent building
    const mesh = BABYLON.MeshBuilder.CreateBox(`ghost_${buildingData.id}`, {size: 2}, window.gfx.scene);
    mesh.position.x = buildingData.pos.x;
    mesh.position.z = buildingData.pos.z;
    mesh.material = new BABYLON.StandardMaterial('ghostMat', window.gfx.scene);
    mesh.material.diffuseColor = new BABYLON.Color3(0.5, 0.5, 1); // Blue tint for opponent
    mesh.isPickable = false; // Can't interact with ghost buildings
    
    return {
      id: buildingData.id,
      type: buildingData.type,
      position: {x: buildingData.pos.x, z: buildingData.pos.z},
      mesh: mesh,
      owner: 'opponent',
      health: 100 // Default
    };
  };
  
  // OLD auto-start code removed - lobby system handles game start now via START button
  
  // CRITICAL: Reset network state for new match start
  // This ensures both players start with synchronized tick counters
  net.resetForMatchStart = function() {
    const connectedPeers = p2p ? p2p.getConnectedPeers() : [];
    // IMPORTANT: During chapter transitions, `isConnected` can be briefly stale even though
    // the data channels are up. Recompute from the real peer list.
    isConnected = connectedPeers.length > 0;
    tick = 0;
    commandBuffer = [];
    remoteCommands.clear();
    peerLag.clear();
    lastStateSync = 0;
    
    // Reset lockstep state
    peerTickConfirmations.clear();
    localConfirmedTick = 0;
    lastHeartbeatTick = 0;
    lastHeartbeatSentAt = 0;
    waitingForPeers = false;
    lastWaitLog = 0;
    window.lockstepWaitingForPeers = false; // Clear global flag for game loop
    softDisconnectedPeers.clear();
    peerWaitStartedAt.clear();
    lastPeerMessageAt.clear();
    lastLockstepNudgeAt.clear();
    lastPeerProgressAt.clear();
    selfSoftDropped = false;
    lastNearCaughtUpAt = 0;
    window.fastForwardingTicks = false;
    
    // IMPORTANT: Do NOT "pre-confirm" remote peers.
    // Doing so can let one side run ahead by inputDelay ticks during start transitions,
    // which then leads to both peers perpetually waiting a tick behind each other
    // (units freeze mid-move because physics pauses while lockstep waits).
    //
    // Instead: only set our *local* confirmed baseline and send an initial tick_confirm.
    // Remote peers will be marked confirmed only after we actually receive their tick_confirm
    // (or other implicit progress signals).
    const inputDelay = window.currentMatch?.inputDelayTicks || 3;
    localConfirmedTick = inputDelay;
    lastHeartbeatTick = inputDelay;
    
    // Send initial confirmation to peers (best-effort; safe even if peer list is briefly empty)
    if (p2p && p2p.sendData) {
      p2p.sendData({
        type: 'tick_confirm',
        tick: inputDelay,
        playerId: localPlayerShortId || localPlayerId
      });
    } else {
      // If there are truly no peers, this is fine (solo/testing). In co-op, the main loop will
      // wait for peers and retry heartbeats once peers appear.
      // console.warn(`   ⚠️ Cannot send initial tick_confirm: p2p=${!!p2p}, peers=${connectedPeers.length}`);
    }
    
    // Clear catch-up state
    if (window.currentMatch) {
      window.currentMatch.isCatchingUp = false;
      window.currentMatch.lastCatchupRequest = 0;
      window.currentMatch.lastCatchupWarningTime = 0;
    }
  };
  
  // Cleanup on disconnect
  net.disconnect = function() {
    if (p2p) {
      p2p.disconnect();
    }
    isConnected = false;
    commandBuffer = [];
    remoteCommands.clear();
    tick = 0;
    // console.log('🌐 Network disconnected');
  };
  
  // Switch to a different lobby
  net.switchLobby = function(newLobbyKey) {
    const myUserId = p2p ? p2p.getUserId() : 'unknown';
    // console.log(`🔄 [${myUserId}] Switching to lobby: ${newLobbyKey}`);
    
    if (net.currentLobby === newLobbyKey) {
      // console.log(`[${myUserId}] Already in this lobby`);
      return;
    }
    
    // Leave current lobby if in one
    if (p2p && net.currentLobby) {
      // Note: GetFire P2P doesn't have a leave function, so we just rejoin
      // console.log(`[${myUserId}] Leaving lobby: ${net.currentLobby}`);
    }
    
    // Join new lobby
    if (p2p && p2p.joinMatchLobby) {
      p2p.joinMatchLobby(newLobbyKey);
      net.currentLobby = newLobbyKey;
      
      // Reset state for new lobby
      commandBuffer = [];
      remoteCommands.clear();
      isConnected = false;
      
      // console.log(`✅ [${myUserId}] Switched to ${newLobbyKey}`);
      
      // Announce presence after a delay to catch existing players
      // GetFire's connected() callback sends player_join, but we send player_rejoin
      // to catch anyone who's already in the lobby
      // CRITICAL: Use p2p.getUserId() not localPlayerId!
      setTimeout(() => {
        const userId = p2p.getUserId();
        // console.log(`🔍 [${userId}] Checking for subscription to ${newLobbyKey}...`);
        
        if (p2p.consumer && p2p.consumer.subscriptions && p2p.consumer.subscriptions.subscriptions) {
          const allSubs = Array.from(p2p.consumer.subscriptions.subscriptions);
          // console.log(`📋 [${userId}] Found ${allSubs.length} subscriptions:`, 
          //   allSubs.map(s => JSON.parse(s.identifier).game_lobby));
          
          const subscription = allSubs.find(
            s => s.identifier && JSON.parse(s.identifier).game_lobby === newLobbyKey
          );
          
          if (subscription) {
            subscription.perform('speak', {
              game_lobby: newLobbyKey,
              type: 'player_rejoin',
              from: userId,  // MUST use GetFire's userId, not our localPlayerId!
              content: 'announcing presence'
            });
            // console.log(`📢 [${userId}] Announced presence in ${newLobbyKey}`);
          } else {
            console.error(`❌ [${userId}] Could not find subscription for ${newLobbyKey}!`);
          }
        } else {
          console.error(`❌ [${userId}] No consumer/subscriptions available!`);
        }
      }, 1000); // Longer delay to ensure ActionCable is fully connected
    } else {
      console.error(`❌ [${myUserId}] P2P not initialized, cannot switch lobby`);
    }
  };
  
  // Debug: Log network stats
  net.logStats = function() {
    const status = net.getStatus();
    // console.log('🌐 Network Stats:', {
    //   ...status,
    //   remoteQueues: Array.from(remoteCommands.values()).map(q => q.length)
    // });
  };
  
  // Export public API
  window.net = net;
  
})(window.net = window.net || {});

// DEPRECATED: Old Math.sin()-based RNG - replaced by Determinism module
// The new deterministicRandom is set up in game/determinism.js using mulberry32
// which is truly deterministic across all platforms.
// window.deterministicRandom is now defined in determinism.js

// DON'T auto-initialize networking here!
// The lobby system will initialize it when user picks a game type
// This ensures proper devMode detection and lobby selection
