
////////////////////////////////
// GetFire.net P2P API v0.0.1
////////////////////////////////
  //
  // Usage:
  //   let p2p = GETFIREP2P({
  //     roomType: "my-app",
  //     onDataChannelMessage: (data, peerId) => { /* handle messages */ },
  //     onPeerConnected: (peerId) => { /* peer joined */ },
  //     onPeerDisconnected: (peerId) => { /* peer left */ },
  //     onBroadcastMessage: (data) => { /* server broadcast messages */ }
  //   });
  //   
  //   // Broadcast-only channels (server-relayed, no P2P)
  //   p2p.joinBroadcast("global-games");     // Join broadcast channel
  //   p2p.broadcast({msg: "hello"});         // Send to server broadcast
  //   
  //   // P2P matching lobbies (auto-connects peers)  
  //   p2p.joinMatchLobby("game-123");        // Join P2P match lobby
  //   p2p.sendData({msg: "hello"});          // Send to P2P peers
  //   p2p.getConnectedPeers();               // Get array of peer IDs
  //   p2p.getUserId();                       // Get your user ID
  //



(function(){

  let GETFIREP2P = window.GETFIREP2P = function(config) {
    GETFIREP2P.ready = false;

    let uri = "https://getfire.net/";
    let ssl = document.location.protocol == "https:";
    let env = "production";

    // P2P Configuration  
    config = config || {};
    let roomType = config.roomType || "default";
    let userId = config.userId || generateUserId();
    let onDataChannelMessage = config.onDataChannelMessage || function(data, peerId) { 
      // console.log('P2P Data from', peerId + ':', data); 
    };
    let onPeerConnected = config.onPeerConnected || function(peerId) { 
      // console.log('Peer connected:', peerId); 
    };
    let onPeerDisconnected = config.onPeerDisconnected || function(peerId) { 
      // console.log('Peer disconnected:', peerId); 
    };
    let onBroadcastMessage = config.onBroadcastMessage || function(data) { 
      // console.log('Broadcast message:', data); 
    };
    let onGameLobbyMessage = config.onGameLobbyMessage || function(data) {
      // console.log('Game lobby message:', data);
    };

    // WebRTC Configuration
    const rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    // Internal state
    let peers = new Map();
    let gameLobbyChannel = null;
    let p2pSignalingChannels = new Map();
    let broadcastChannels = new Map();
    let currentBroadcastChannels = new Set();
    let localUserId = userId;
    let currentGameLobby = null;

    // Development mode detection
    if (config.devMode === true) {
      uri = "http://localhost:3000/";
      ssl = true;
      env = "development";
    }

    function generateUserId() {
      return 'p2p-' + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    }

    function generateSessionId() {
      return Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    }

    // Initialize ActionCable consumer
    function initializeConsumer() {
      let wsUrl;
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        wsUrl = 'ws://localhost:3000/ws/cable';
      } else {
        wsUrl = 'wss://getfire.net/ws/cable';
      }
      GETFIREP2P.consumer = ActionCable.createConsumer(wsUrl);
    }

    // Join a game lobby for matchmaking
    function joinGameLobby(lobbyName) {
      if (gameLobbyChannel) {
        gameLobbyChannel.unsubscribe();
      }
      currentGameLobby = lobbyName;
      gameLobbyChannel = GETFIREP2P.consumer.subscriptions.create(
        { channel: "P2pChannel", game_lobby: lobbyName },
        {
          connected() {
            this.perform('speak', {
              game_lobby: lobbyName,
              type: 'player_join',
              from: localUserId,
              room_type: roomType,
              content: 'joined lobby'
            });
          },
          disconnected() { },
          received(data) { handleGameLobbyMessage(data); }
        }
      );
    }

    // Join a broadcast-only channel (no P2P matching)
    function joinBroadcastChannel(channelName) {
      if (broadcastChannels.has(channelName)) {
        return broadcastChannels.get(channelName);
      }
      
      const broadcastChannel = GETFIREP2P.consumer.subscriptions.create(
        { channel: "P2pChannel", game_lobby: `broadcast-${channelName}` },
        {
          connected() { 
            currentBroadcastChannels.add(channelName);
          },
          disconnected() { 
            currentBroadcastChannels.delete(channelName);
          },
          received(data) { 
            onBroadcastMessage(data);
          }
        }
      );
      
      broadcastChannels.set(channelName, broadcastChannel);
      return broadcastChannel;
    }

    // Send broadcast message (server-relayed only)
    function sendBroadcast(data, channelName) {
      const channel = broadcastChannels.get(channelName);
      if (!channel) {
        console.error('Not connected to broadcast channel:', channelName);
        return;
      }
      
      channel.perform('speak', {
        game_lobby: `broadcast-${channelName}`,
        type: 'broadcast',
        from: localUserId,
        content: data,
        timestamp: Date.now()
      });
    }

    // Create P2P signaling channel
    function createP2PSession(sessionId, peerId) {
      if (p2pSignalingChannels.has(sessionId)) {
        return p2pSignalingChannels.get(sessionId);
      }
      const signalingChannel = GETFIREP2P.consumer.subscriptions.create(
        { channel: "P2pChannel", p2p_session: sessionId },
        {
          connected() { },
          disconnected() { },
          received(data) { handleP2PSignalingMessage(data); }
        }
      );
      p2pSignalingChannels.set(sessionId, signalingChannel);
      return signalingChannel;
    }

    // Handle game lobby messages
    function handleGameLobbyMessage(data) {
      onGameLobbyMessage(data);
      
      // Skip auto-matching for broadcast channels
      if (currentGameLobby && currentGameLobby.startsWith('broadcast-')) {
        return; // Broadcast channels don't auto-match
      }
      
      if ((data.type === 'player_join' || data.type === 'player_rejoin') && data.from !== localUserId) {
        // Auto-request match with new players (avoid duplicates)
        setTimeout(() => {
          if (localUserId > data.from && !peers.has(data.from)) { 
            const roomId = generateSessionId();
            gameLobbyChannel.perform('speak', {
              game_lobby: currentGameLobby,
              type: 'match_request',
              from: localUserId,
              to: data.from,
              room_id: roomId
            });
          }
        }, 200);
      } else if (data.type === 'match_request') {
        if (data.to === localUserId) {
          acceptMatch(data.from, data.room_id);
        }
      } else if (data.type === 'match_accepted' && data.to === localUserId) {
        startP2PConnection(data.from, data.room_id, true);
      }
    }

    // Handle P2P signaling messages
    function handleP2PSignalingMessage(data) {
      if (data.to !== localUserId) return;
      const peerId = data.from;
      if (data.type === 'webrtc_offer') {
        handleOffer(data);
      } else if (data.type === 'webrtc_answer') {
        handleAnswer(data);
      } else if (data.type === 'webrtc_ice') {
        handleIceCandidate(data);
      }
    }

    // Accept match and start P2P
    function acceptMatch(peerId, roomId) {
      gameLobbyChannel.perform('speak', {
        game_lobby: currentGameLobby,
        type: 'match_accepted',
        from: localUserId,
        to: peerId,
        room_id: roomId
      });
      startP2PConnection(peerId, roomId, false);
    }

    // Start P2P connection
    function startP2PConnection(peerId, sessionId, isInitiator) {
      const signalingChannel = createP2PSession(sessionId, peerId);
      createPeerConnection(peerId, sessionId, isInitiator, signalingChannel);
    }

    // Create WebRTC peer connection
    function createPeerConnection(peerId, sessionId, isInitiator, signalingChannel) {
      if (peers.has(peerId)) return peers.get(peerId);
      const peerConnection = new RTCPeerConnection(rtcConfig);
      const peerData = {
        connection: peerConnection,
        dataChannel: null,
        state: 'connecting',
        sessionId: sessionId,
        signalingChannel: signalingChannel
      };
      peers.set(peerId, peerData);

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          signalingChannel.perform('speak', {
            p2p_session: sessionId,
            type: 'webrtc_ice',
            from: localUserId,
            to: peerId,
            candidate: event.candidate
          });
        }
      };

      // Monitor ICE connection for TURN detection
      peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'failed') {
          console.log('⚠️ Having trouble connecting? This might be due to network restrictions.');
        }
      };

      peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'connected') {
          peerData.state = 'connected';
          onPeerConnected(peerId);
        } else if (peerConnection.connectionState === 'disconnected' || 
                   peerConnection.connectionState === 'failed' ||
                   peerConnection.connectionState === 'closed') {
          peerData.state = 'disconnected';
          onPeerDisconnected(peerId);
          setTimeout(() => {
            cleanupPeer(peerId);
          }, 500);
        }
      };

      // Connection timeout detection
      const connectionTimeout = setTimeout(() => {
        if (peerConnection.connectionState !== 'connected') {
          console.log('Having trouble connecting? This might be due to network restrictions.');
        }
      }, 10000);

      if (isInitiator) {
        const dataChannel = peerConnection.createDataChannel('ftxxCanvas', { 
          ordered: true,
          maxRetransmits: 3
        });
        setupDataChannel(dataChannel, peerId);
        peerData.dataChannel = dataChannel;
        
        // Wait a bit before creating offer to ensure data channel is ready
        setTimeout(() => {
          peerConnection.createOffer().then(offer => {
            return peerConnection.setLocalDescription(offer);
          }).then(() => {
            signalingChannel.perform('speak', {
              p2p_session: sessionId,
              type: 'webrtc_offer',
              from: localUserId,
              to: peerId,
              offer: peerConnection.localDescription
            });
          }).catch(error => {
            console.error('Error creating offer:', error);
          });
        }, 100);
      } else {
        peerConnection.ondatachannel = (event) => {
          const dataChannel = event.channel;
          setupDataChannel(dataChannel, peerId);
          peerData.dataChannel = dataChannel;
        };
      }
      return peerData;
    }

    // Set up data channel
    function setupDataChannel(dataChannel, peerId) {
      dataChannel.onopen = () => {
        // Test the connection with a ping
        setTimeout(() => {
          if (dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify({type: 'ping', from: localUserId}));
          }
        }, 100);
      };
      
      dataChannel.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'ping') {
            // Respond to ping
            dataChannel.send(JSON.stringify({type: 'pong', from: localUserId}));
          } else if (data.type === 'pong') {
            // Connection confirmed
          } else {
            onDataChannelMessage(data, peerId);
          }
        } catch (e) {
          onDataChannelMessage(event.data, peerId);
        }
      };
      
      dataChannel.onclose = () => {
        // Channel closed
      };
      
      dataChannel.onerror = (error) => {
        console.error('Data channel error with peer:', peerId, error);
        // Force cleanup on data channel error to allow reconnection
        setTimeout(() => {
          cleanupPeer(peerId);
        }, 1000);
      };
    }

    // Handle WebRTC offer
    function handleOffer(data) {
      const peerData = peers.get(data.from);
      if (!peerData) return;
      peerData.connection.setRemoteDescription(new RTCSessionDescription(data.offer))
        .then(() => peerData.connection.createAnswer())
        .then(answer => peerData.connection.setLocalDescription(answer))
        .then(() => {
          peerData.signalingChannel.perform('speak', {
            p2p_session: peerData.sessionId,
            type: 'webrtc_answer',
            from: localUserId,
            to: data.from,
            answer: peerData.connection.localDescription
          });
        }).catch(error => console.error('Error handling offer:', error));
    }

    // Handle WebRTC answer
    function handleAnswer(data) {
      const peerData = peers.get(data.from);
      if (peerData) {
        peerData.connection.setRemoteDescription(new RTCSessionDescription(data.answer))
          .catch(error => console.error('Error handling answer:', error));
      }
    }

    // Handle ICE candidate
    function handleIceCandidate(data) {
      const peerData = peers.get(data.from);
      if (peerData) {
        peerData.connection.addIceCandidate(new RTCIceCandidate(data.candidate))
          .catch(error => console.error('Error adding ICE candidate:', error));
      }
    }

    // Clean up peer
    function cleanupPeer(peerId) {
      const peerData = peers.get(peerId);
      if (peerData) {
        try {
          if (peerData.dataChannel && peerData.dataChannel.readyState !== 'closed') {
            peerData.dataChannel.close();
          }
          if (peerData.connection && peerData.connection.connectionState !== 'closed') {
            peerData.connection.close();
          }
          if (peerData.signalingChannel) {
            peerData.signalingChannel.unsubscribe();
            p2pSignalingChannels.delete(peerData.sessionId);
          }
        } catch (e) {
          // Cleanup error
        }
        peers.delete(peerId);
        
        // Try to reconnect to any remaining peers in the lobby after cleanup
        setTimeout(() => {
          if (gameLobbyChannel && peers.size === 0) {
            gameLobbyChannel.perform('speak', {
              game_lobby: currentGameLobby,
              type: 'player_rejoin',
              from: localUserId,
              room_type: 'ftxx-canvas',
              content: 'ready for connections'
            });
          }
        }, 2000);
      }
    }

    // Public API
    
    // Broadcast-only channels (server-relayed, no P2P)
    GETFIREP2P.joinBroadcast = function(channelName) {
      return joinBroadcastChannel(channelName);
    };
    
    GETFIREP2P.broadcast = function(data, channelName) {
      if (!channelName && currentBroadcastChannels.size === 1) {
        channelName = Array.from(currentBroadcastChannels)[0];
      }
      if (!channelName) {
        console.error('Must specify channel name or join a single broadcast channel');
        return;
      }
      sendBroadcast(data, channelName);
    };
    
    // P2P matching lobbies (auto-connects peers)
    GETFIREP2P.joinMatchLobby = function(lobbyName) {
      joinGameLobby(lobbyName || roomType);
    };
    
    // Legacy alias for backward compatibility
    GETFIREP2P.joinLobby = function(lobbyName) {
      joinGameLobby(lobbyName || roomType);
    };

    GETFIREP2P.requestMatch = function(targetPeerId) {
      if (!gameLobbyChannel) {
        console.error('Not connected to game lobby');
        return;
      }
      const roomId = generateSessionId();
      gameLobbyChannel.perform('speak', {
        game_lobby: currentGameLobby,
        type: 'match_request',
        from: localUserId,
        to: targetPeerId,
        room_id: roomId
      });
    };

    GETFIREP2P.sendData = function(data, targetPeerId = null) {
      const message = {
        type: 'game_data',
        content: data,
        from: localUserId,
        timestamp: Date.now()
      };
      
      if (targetPeerId) {
        const peerData = peers.get(targetPeerId);
        if (peerData && peerData.dataChannel && peerData.dataChannel.readyState === 'open') {
          peerData.dataChannel.send(JSON.stringify(message));
        }
      } else {
        peers.forEach((peerData, peerId) => {
          if (peerData.dataChannel && peerData.dataChannel.readyState === 'open') {
            peerData.dataChannel.send(JSON.stringify(message));
          }
        });
      }
    };

    GETFIREP2P.getConnectedPeers = function() {
      return Array.from(peers.keys()).filter(peerId => {
        const peerData = peers.get(peerId);
        return peerData.state === 'connected';
      });
    };

    GETFIREP2P.disconnect = function() {
      peers.forEach((peerData, peerId) => cleanupPeer(peerId));
      if (gameLobbyChannel) {
        gameLobbyChannel.unsubscribe();
        gameLobbyChannel = null;
      }
      p2pSignalingChannels.forEach((channel) => channel.unsubscribe());
      p2pSignalingChannels.clear();
    };

    GETFIREP2P.getUserId = function() {
      return localUserId;
    };

    // Initialize
    if (ssl) {
      initializeConsumer();
      GETFIREP2P.ready = true;
      console.log('GetFire P2P ready! User ID:', localUserId);
    } else {
      console.log('P2P Connection failed: SSL Required.');
    }
    
    return GETFIREP2P;
  };
  
})();




////////////////////////////////////////////////////////////////
// ActionCable
////////////////////////////////////////////////////////////////
!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?e(exports):"function"==typeof define&&define.amd?define(["exports"],e):e((t="undefined"!=typeof globalThis?globalThis:t||self).ActionCable={})}(this,(function(t){"use strict";var e={logger:"undefined"!=typeof console?console:void 0,WebSocket:"undefined"!=typeof WebSocket?WebSocket:void 0},n={log(...t){this.enabled&&(t.push(Date.now()),e.logger.log("[ActionCable]",...t))}};const i=()=>(new Date).getTime(),s=t=>(i()-t)/1e3;class o{constructor(t){this.visibilityDidChange=this.visibilityDidChange.bind(this),this.connection=t,this.reconnectAttempts=0}start(){this.isRunning()||(this.startedAt=i(),delete this.stoppedAt,this.startPolling(),addEventListener("visibilitychange",this.visibilityDidChange),n.log(`ConnectionMonitor started. stale threshold = ${this.constructor.staleThreshold} s`))}stop(){this.isRunning()&&(this.stoppedAt=i(),this.stopPolling(),removeEventListener("visibilitychange",this.visibilityDidChange),n.log("ConnectionMonitor stopped"))}isRunning(){return this.startedAt&&!this.stoppedAt}recordMessage(){this.pingedAt=i()}recordConnect(){this.reconnectAttempts=0,delete this.disconnectedAt,n.log("ConnectionMonitor recorded connect")}recordDisconnect(){this.disconnectedAt=i(),n.log("ConnectionMonitor recorded disconnect")}startPolling(){this.stopPolling(),this.poll()}stopPolling(){clearTimeout(this.pollTimeout)}poll(){this.pollTimeout=setTimeout((()=>{this.reconnectIfStale(),this.poll()}),this.getPollInterval())}getPollInterval(){const{staleThreshold:t,reconnectionBackoffRate:e}=this.constructor;return 1e3*t*Math.pow(1+e,Math.min(this.reconnectAttempts,10))*(1+(0===this.reconnectAttempts?1:e)*Math.random())}reconnectIfStale(){this.connectionIsStale()&&(n.log(`ConnectionMonitor detected stale connection. reconnectAttempts = ${this.reconnectAttempts}, time stale = ${s(this.refreshedAt)} s, stale threshold = ${this.constructor.staleThreshold} s`),this.reconnectAttempts++,this.disconnectedRecently()?n.log(`ConnectionMonitor skipping reopening recent disconnect. time disconnected = ${s(this.disconnectedAt)} s`):(n.log("ConnectionMonitor reopening"),this.connection.reopen()))}get refreshedAt(){return this.pingedAt?this.pingedAt:this.startedAt}connectionIsStale(){return s(this.refreshedAt)>this.constructor.staleThreshold}disconnectedRecently(){return this.disconnectedAt&&s(this.disconnectedAt)<this.constructor.staleThreshold}visibilityDidChange(){"visible"===document.visibilityState&&setTimeout((()=>{!this.connectionIsStale()&&this.connection.isOpen()||(n.log(`ConnectionMonitor reopening stale connection on visibilitychange. visibilityState = ${document.visibilityState}`),this.connection.reopen())}),200)}}o.staleThreshold=6,o.reconnectionBackoffRate=.15;var r={message_types:{welcome:"welcome",disconnect:"disconnect",ping:"ping",confirmation:"confirm_subscription",rejection:"reject_subscription"},disconnect_reasons:{unauthorized:"unauthorized",invalid_request:"invalid_request",server_restart:"server_restart",remote:"remote"},default_mount_path:"/cable",protocols:["actioncable-v1-json","actioncable-unsupported"]};const{message_types:c,protocols:h}=r,l=h.slice(0,h.length-1),u=[].indexOf;class a{constructor(t){this.open=this.open.bind(this),this.consumer=t,this.subscriptions=this.consumer.subscriptions,this.monitor=new o(this),this.disconnected=!0}send(t){return!!this.isOpen()&&(this.webSocket.send(JSON.stringify(t)),!0)}open(){if(this.isActive())return n.log(`Attempted to open WebSocket, but existing socket is ${this.getState()}`),!1;{const t=[...h,...this.consumer.subprotocols||[]];return n.log(`Opening WebSocket, current state is ${this.getState()}, subprotocols: ${t}`),this.webSocket&&this.uninstallEventHandlers(),this.webSocket=new e.WebSocket(this.consumer.url,t),this.installEventHandlers(),this.monitor.start(),!0}}close({allowReconnect:t}={allowReconnect:!0}){if(t||this.monitor.stop(),this.isOpen())return this.webSocket.close()}reopen(){if(n.log(`Reopening WebSocket, current state is ${this.getState()}`),!this.isActive())return this.open();try{return this.close()}catch(t){n.log("Failed to reopen WebSocket",t)}finally{n.log(`Reopening WebSocket in ${this.constructor.reopenDelay}ms`),setTimeout(this.open,this.constructor.reopenDelay)}}getProtocol(){if(this.webSocket)return this.webSocket.protocol}isOpen(){return this.isState("open")}isActive(){return this.isState("open","connecting")}triedToReconnect(){return this.monitor.reconnectAttempts>0}isProtocolSupported(){return u.call(l,this.getProtocol())>=0}isState(...t){return u.call(t,this.getState())>=0}getState(){if(this.webSocket)for(let t in e.WebSocket)if(e.WebSocket[t]===this.webSocket.readyState)return t.toLowerCase();return null}installEventHandlers(){for(let t in this.events){const e=this.events[t].bind(this);this.webSocket[`on${t}`]=e}}uninstallEventHandlers(){for(let t in this.events)this.webSocket[`on${t}`]=function(){}}}a.reopenDelay=500,a.prototype.events={message(t){if(!this.isProtocolSupported())return;const{identifier:e,message:i,reason:s,reconnect:o,type:r}=JSON.parse(t.data);switch(this.monitor.recordMessage(),r){case c.welcome:return this.triedToReconnect()&&(this.reconnectAttempted=!0),this.monitor.recordConnect(),this.subscriptions.reload();case c.disconnect:return n.log(`Disconnecting. Reason: ${s}`),this.close({allowReconnect:o});case c.ping:return null;case c.confirmation:return this.subscriptions.confirmSubscription(e),this.reconnectAttempted?(this.reconnectAttempted=!1,this.subscriptions.notify(e,"connected",{reconnected:!0})):this.subscriptions.notify(e,"connected",{reconnected:!1});case c.rejection:return this.subscriptions.reject(e);default:return this.subscriptions.notify(e,"received",i)}},open(){if(n.log(`WebSocket onopen event, using '${this.getProtocol()}' subprotocol`),this.disconnected=!1,!this.isProtocolSupported())return n.log("Protocol is unsupported. Stopping monitor and disconnecting."),this.close({allowReconnect:!1})},close(t){if(n.log("WebSocket onclose event"),!this.disconnected)return this.disconnected=!0,this.monitor.recordDisconnect(),this.subscriptions.notifyAll("disconnected",{willAttemptReconnect:this.monitor.isRunning()})},error(){n.log("WebSocket onerror event")}};class d{constructor(t,e={},n){this.consumer=t,this.identifier=JSON.stringify(e),function(t,e){if(null!=e)for(let n in e){const i=e[n];t[n]=i}}(this,n)}perform(t,e={}){return e.action=t,this.send(e)}send(t){return this.consumer.send({command:"message",identifier:this.identifier,data:JSON.stringify(t)})}unsubscribe(){return this.consumer.subscriptions.remove(this)}}class p{constructor(t){this.subscriptions=t,this.pendingSubscriptions=[]}guarantee(t){-1==this.pendingSubscriptions.indexOf(t)?(n.log(`SubscriptionGuarantor guaranteeing ${t.identifier}`),this.pendingSubscriptions.push(t)):n.log(`SubscriptionGuarantor already guaranteeing ${t.identifier}`),this.startGuaranteeing()}forget(t){n.log(`SubscriptionGuarantor forgetting ${t.identifier}`),this.pendingSubscriptions=this.pendingSubscriptions.filter((e=>e!==t))}startGuaranteeing(){this.stopGuaranteeing(),this.retrySubscribing()}stopGuaranteeing(){clearTimeout(this.retryTimeout)}retrySubscribing(){this.retryTimeout=setTimeout((()=>{this.subscriptions&&"function"==typeof this.subscriptions.subscribe&&this.pendingSubscriptions.map((t=>{n.log(`SubscriptionGuarantor resubscribing ${t.identifier}`),this.subscriptions.subscribe(t)}))}),500)}}class g{constructor(t){this.consumer=t,this.guarantor=new p(this),this.subscriptions=[]}create(t,e){const n="object"==typeof t?t:{channel:t},i=new d(this.consumer,n,e);return this.add(i)}add(t){return this.subscriptions.push(t),this.consumer.ensureActiveConnection(),this.notify(t,"initialized"),this.subscribe(t),t}remove(t){return this.forget(t),this.findAll(t.identifier).length||this.sendCommand(t,"unsubscribe"),t}reject(t){return this.findAll(t).map((t=>(this.forget(t),this.notify(t,"rejected"),t)))}forget(t){return this.guarantor.forget(t),this.subscriptions=this.subscriptions.filter((e=>e!==t)),t}findAll(t){return this.subscriptions.filter((e=>e.identifier===t))}reload(){return this.subscriptions.map((t=>this.subscribe(t)))}notifyAll(t,...e){return this.subscriptions.map((n=>this.notify(n,t,...e)))}notify(t,e,...n){let i;return i="string"==typeof t?this.findAll(t):[t],i.map((t=>"function"==typeof t[e]?t[e](...n):void 0))}subscribe(t){this.sendCommand(t,"subscribe")&&this.guarantor.guarantee(t)}confirmSubscription(t){n.log(`Subscription confirmed ${t}`),this.findAll(t).map((t=>this.guarantor.forget(t)))}sendCommand(t,e){const{identifier:n}=t;return this.consumer.send({command:e,identifier:n})}}class b{constructor(t){this._url=t,this.subscriptions=new g(this),this.connection=new a(this),this.subprotocols=[]}get url(){return f(this._url)}send(t){return this.connection.send(t)}connect(){return this.connection.open()}disconnect(){return this.connection.close({allowReconnect:!1})}ensureActiveConnection(){if(!this.connection.isActive())return this.connection.open()}addSubProtocol(t){this.subprotocols=[...this.subprotocols,t]}}function f(t){if("function"==typeof t&&(t=t()),t&&!/^wss?:/i.test(t)){const e=document.createElement("a");return e.href=t,e.href=e.href,e.protocol=e.protocol.replace("http","ws"),e.href}return t}function m(t){const e=document.head.querySelector(`meta[name='action-cable-${t}']`);if(e)return e.getAttribute("content")}t.Connection=a,t.ConnectionMonitor=o,t.Consumer=b,t.INTERNAL=r,t.Subscription=d,t.SubscriptionGuarantor=p,t.Subscriptions=g,t.adapters=e,t.createConsumer=function(t=m("url")||r.default_mount_path){return new b(t)},t.createWebSocketURL=f,t.getConfig=m,t.logger=n,Object.defineProperty(t,"__esModule",{value:!0})}));




////////////////////////////////////////////////////////////////////
// Fin.
////////////////////////////////////////////////////////////////////