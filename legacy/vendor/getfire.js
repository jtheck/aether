







////////////////////////////////
// GetFire.net chat API v1.8.3
////////////////////////////////



(function(){
  let GETFIRE = window.GETFIRE = function(config) {
    GETFIRE.ready = false;

    let topicNames = config.topicNames || ["test"];
    let defaultName = config.defaultName || "Guest";
    let startOpen = config.startOpen || false;
    let startPreview = config.startPreview || false;
    let clickAwayHide = config.clickAwayHide || false;
    let mouseOutFade = config.mouseOutFade || false;
    let topCorner = config.topCorner || false;


    // var fullHeight = config.fullHeight || false; // td: implement or clean
    let isMobile = false;
    if( /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ) {
      isMobile = true;
    }

    let uri = "https://getfire.net/";
    let ssl = document.location.protocol == "https:";
    let env = "production";

    let chatTopics = [];
    let chatCards = [];


    window.addEventListener('resize', resize.debounce(150,false), false);
    window.addEventListener('orientationchange', function() {resize.debounce(150,false)}, {once : true});
    window.addEventListener("click", handleClickAway);

    // styles - Override host site interference
    var styles = `
      /* Ensure GetFire widget elements can receive interactions */
      #getfire_wrapper, #getfire_wrapper * {
        pointer-events: auto !important;
        user-select: auto !important;
        -webkit-user-select: auto !important;
        -moz-user-select: auto !important;
        -ms-user-select: auto !important;
      }
      
      /* Ensure input and button elements are interactive */
      #getfire_wrapper .gf_message_entry_content,
      #getfire_wrapper .gf_message_submit_button,
      #getfire_wrapper button,
      #getfire_wrapper input,
      #getfire_wrapper textarea {
        pointer-events: auto !important;
        user-select: text !important;
        -webkit-user-select: text !important;
        -moz-user-select: text !important;
        -ms-user-select: text !important;
        cursor: text !important;
        z-index: 999999 !important;
      }
      
      /* Only apply position relative to text inputs, not buttons */
      #getfire_wrapper .gf_message_entry_content,
      #getfire_wrapper input[type="text"],
      #getfire_wrapper input[type="email"],
      #getfire_wrapper input[type="password"],
      #getfire_wrapper textarea {
        position: relative !important;
      }
      
      /* Ensure buttons have proper cursor */
      #getfire_wrapper .gf_message_submit_button,
      #getfire_wrapper button {
        cursor: pointer !important;
      }
      
      /* Ensure the widget container has high z-index */
      #getfire_wrapper {
        z-index: 999999 !important;
        position: fixed !important;
      }
      
      /* Prevent host site from disabling our events */
      #getfire_wrapper .gf_topic_container {
        z-index: 999999 !important;
        position: relative !important;
      }
      
      /* Reset all pseudo-elements to prevent host site interference */
      #getfire_wrapper *:before,
      #getfire_wrapper *:after,
      #getfire_wrapper *::before,
      #getfire_wrapper *::after {
        content: none !important;
        display: none !important;
        position: static !important;
        width: auto !important;
        height: auto !important;
        background: none !important;
        border: none !important;
        margin: 0 !important;
        padding: 0 !important;
        top: auto !important;
        left: auto !important;
        right: auto !important;
        bottom: auto !important;
        z-index: auto !important;
        opacity: 1 !important;
        visibility: visible !important;
        transform: none !important;
        box-shadow: none !important;
        text-shadow: none !important;
        font-size: inherit !important;
        font-family: inherit !important;
        color: inherit !important;
      }
      
      /* Hide only the specific (x) link that shouldn't appear in widget */
      #getfire_wrapper .tal_list_diminish {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        position: absolute !important;
        left: -9999px !important;
        width: 0 !important;
        height: 0 !important;
        overflow: hidden !important;
      }
    `;
    var $style = document.createElement('style');
    $style.innerHTML = styles;
    document.head.appendChild($style);
    
    // wrapper
    let $wrapper = newDiv({id:"getfire_wrapper"});
    document.body.append($wrapper);
    $wrapper.addEventListener("click", handleClick);
    $wrapper.addEventListener("keydown", handleKey);
    
    // Force event handling for widget elements to override host site interference
    $wrapper.addEventListener("click", function(e) {
      // Force focus on input elements when clicked
      if (e.target.classList.contains('gf_message_entry_content')) {
        e.stopPropagation();
        e.target.focus();
      }
      // Force click handling on submit buttons
      if (e.target.classList.contains('gf_message_submit_button')) {
        e.stopPropagation();
        e.preventDefault();
        // Find the topic this button belongs to
        let topicContainer = e.target.closest('.gf_topic_container');
        if (topicContainer) {
          let topicId = topicContainer.id;
          let topic = GETFIRE.findTopic(topicId);
          if (topic) {
            GETFIRE.postMessage(topic);
            e.target.disabled = true;
          }
        }
      }
    }, true); // Use capture phase to ensure we get the event first
    
    // Force keyboard event handling for Enter key in message inputs
    $wrapper.addEventListener("keydown", function(e) {
      if (e.target.classList.contains('gf_message_entry_content') && e.key === 'Enter' && !e.shiftKey) {
        e.stopPropagation();
        e.preventDefault();
        // Find the topic this input belongs to
        let topicContainer = e.target.closest('.gf_topic_container');
        if (topicContainer) {
          let topicId = topicContainer.id;
          let topic = GETFIRE.findTopic(topicId);
          if (topic && e.target.value.trim()) {
            GETFIRE.postMessage(topic);
            let submitButton = topicContainer.querySelector('.gf_message_submit_button');
            if (submitButton) submitButton.disabled = true;
          }
        }
      }
    }, true);
    
    // Force focus events to work properly
    $wrapper.addEventListener("focusin", function(e) {
      if (e.target.classList.contains('gf_message_entry_content')) {
        e.stopPropagation();
        // Ensure the element can receive focus
        e.target.style.pointerEvents = 'auto';
        e.target.style.userSelect = 'text';
      }
    }, true);
    
    // topic wrapper
    let $tWrapper = newDiv({id:"gf_active_topics_container", className: "gf_scrollable"});
    if (mouseOutFade) $tWrapper.classList.add('gf_app_fade');
    $wrapper.append($tWrapper);
    


    // icon
    let iconSVG = '<svg xmlns:svg="http://www.w3.org/2000/svg" xmlns="http://www.w3.org/2000/svg" height="100%" width="100%" version="1.1" viewBox="0 0 60 60"><g transform="translate(0 -992.36)"><g transform="matrix(.32337 0 0 .32337 -186.23 919.22)"><g class="ftb_fill" transform="matrix(1.2471055,0,0,1.2471055,-127.95546,-112.95681)" style="stroke-width:7.3;stroke:none;"><ellipse rx="8.7" ry="8.1" cy="352.8" cx="609.4"></ellipse><ellipse rx="10.2" ry="9.5" cy="351.4" cx="632.2"></ellipse></g><path d="m598 261.9c-10.9 6.6-22.6 71.8-1.8 94.5 16.4 17.9 116.6-11.1 129.9 34.7 12.6-29.8-1.1-16.3 15.9-33.7 21.5-22.1 9.9-89.6-0.8-94.8-14.6-7.6-129-7.2-143.1-0.6z" style="fill:none;stroke-width:11"></path></g></g></svg>'

    // button & rolodex
    let $iconM = newDiv({id:"getfire_icon", title:"Chat!"});
    let $iconB = newDiv({id:"icon_b", content:iconSVG});
    let $rolo = newDiv({id:"getfire_rolo"});
    $iconM.append($iconB);
    $iconM.append($rolo);
    $wrapper.append($iconM);


    // top corner adjustment
    if (topCorner){
      $wrapper.classList.add('tc_mod_wrapper');
    }

    // iframe
    var $ifWrapper = newDiv({id:"if_wrap"});
    var $iframe = document.createElement("iframe");
    var $ifButton = newDiv({id:"if_button", content:"&#215;"});
    $iframe.name = 'iFrame';
    $ifWrapper.append($iframe);
    $ifWrapper.append($ifButton);
    $wrapper.append($ifWrapper);

    // tokens
    var gfct = "none";
    if (document.cookie.indexOf("_gfc0=") >= 0) {
      gfct = getCookie("_gfc0");
    }

    window.onmessage = function (e) {
      if (!e.origin.includes('localhost:3000') && !e.origin.includes('getfire.net')){
        // $iframe.src = "about:blank";
        // GETFIRE.modal(false, "Sign in Failure!");
        return;
      } else {
        if (e.data == false){
          $iframe.src = "about:blank";
          var iframe = document.getElementById('if_wrap');
          iframe.style.display = 'none';
          GETFIRE.modal(false, "Sign in Failure!");
          console.log('msg!',e)
          return;
        }

  
        var jwtpack;
  
        if (e.data){//} && typeof e.data == 'string'){
          jwtpack = e.data;
          // console.log(jwtpack);
          // jwtpack = JSON.parse(jwtpack);
        }
  
        if (jwtpack){
          if (jwtpack.type == 'gfc') {
            // success
            signIn(jwtpack.cards);
            
            $iframe.src = "about:blank";
            $ifWrapper.style.display="none";
            GETFIRE.modal(false, "Sign in Success!");
            setCookie('_gfc0', jwtpack.token);
          }
        }
      }
    };

    // cards
    GETFIRE.Card = function(card){
      this.id = card.id;
      this.name = card.name || "Guest";
      this.title = card.name || "untitled";

      this.avatarHalf = card.half;
      this.color = card.color || "#fff";

    };

    GETFIRE.findCard = function(id){
      for (var i = 0; i < chatCards.length; i++){
        if (id == chatCards[i].id) return chatCards[i];
      }
      return false;
    }


    GETFIRE.buildTopicCardSelect = function(){
      return;
      var cardSelect = document.querySelectorAll('.gf_topic_card_select_content');
      if (!cardSelect) return true;
      for (var i=0; i<cardSelect.length; i++){
        var $card = newDiv({className: "gf_topic_card_selection_container", content: 'tCard.name'+"<br>"});
      // $card.setAttribute('data-id', tCard.id);
      // $card.style.color = tCard.color;
      // $card.style.backgroundImage = "url("+tCard.avatarHalf+")";
      // frag.append($card);
      }

    };

    signIn = function(cards){
      /// add cards
      var card, i;
      var topic, j;
      
      for (j=0; j<cards.length; j++){
        card = cards[j];
        if (!GETFIRE.findCard(card.id)){
          var tCard = new GETFIRE.Card(card);
          chatCards.push(tCard);
        }
      }

      for (i=0; i<chatTopics.length; i++){
        topic = chatTopics[i];
        topic.$settingsContainer.querySelector(".members_in").style.display = "none";
        topic.$settingsContainer.querySelector(".members_out").style.display = "block";
        
        for (j=0; j<cards.length; j++){
          card = cards[j];
          if (topic.name.toUpperCase() == card.topic.toUpperCase()){
            var tCard = GETFIRE.findCard(card.id);
            topic.setCard(tCard);
          }
        }
      }

      // GETFIRE.buildTopicCardSelect();
    };
    signOut = function(){
      gfct = "none";
      // kill cookie && var (&& broadcast)
      document.cookie = '_gfc0'+'=; Max-Age=-99999999;'
      // document.cookie = '_gfc1'+'=; Max-Age=-99999999;'
      
      
      // remove cards
      chatCards.length = 1;
      
      // reset cards



      var topic;
      for (i=0; i<chatTopics.length; i++){
        topic = chatTopics[i];
        
        topic.$settingsContainer.querySelector(".members_in").style.display = "block";
        topic.$settingsContainer.querySelector(".members_out").style.display = "none";
        
        // topic.card = charCards[0].id;
        topic.setCard(chatCards[0]);
      }

      GETFIRE.modal(false, "Signed out!");

      // GETFIRE.buildTopicCardSelect();
    };


    // topics
    GETFIRE.Topic = function(topic){
      this.name = topic.name;

      this.id = topic.hashish;
      this.ideal = topic.ideal;

      this.card = topic.card;// = new GETFIRE.Card(topic.card);
      // console.log(this.card);

      this.messages = topic.messages;
      this.seen = 0;
      
      this.lastUpdate = topic.recent || 0;

      this.$container;
      this.$contentContainer;
      this.$settingsContainer;
      this.$preview;
    };

    GETFIRE.Topic.prototype.show = function(){
      if (!this.$container) {
        // this.$container = document.getElementById("topic_die").cloneNode(true);
        // $tWrapper.appendChild(this.$container);
        // this.populateContainer();
      }
      // reset flash 
      if (this.$container.style.display == "block"){
        this.$container.classList.remove('gf_hi_fade');
        this.$container.offsetHeight;
        this.$container.classList.add('gf_hi_fade');
      }
      // show it
      this.$container.style.display = "block";
      this.scrollToBottom();
    };

    GETFIRE.Topic.prototype.populateContainer = function(){
      var $c = this.$container;
      this.$settingsContainer = $c.querySelector(".gf_topic_settings_container") || $c.querySelector(".topic_settings_container");
      this.$contentContainer = $c.querySelector(".gf_topic_content_container") || $c.querySelector(".topic_content_container");
      this.$preview = $c.querySelector(".gf_topic_preview") || $c.querySelector(".topic_preview");
      
      // Ensure content container has unique identifier
      if (this.$contentContainer) {
        this.$contentContainer.id = this.id + '_content';
      }
      // this.$preview.append("NO WAI")
      var $c = this.$container;
      $c.id = this.id;
      
      var $opsAnchor = $c.querySelector(".gf_ops_anchor") || $c.querySelector(".ops_anchor");
      if (!$opsAnchor) {
        console.error("ops_anchor (old or new) not found in container for topic:", this.id);
        console.log("Container HTML:", $c.innerHTML);
        return; // Skip this topic if template is malformed
      }
      
      $opsAnchor.setAttribute("data-id", this.id);
      $opsAnchor.setAttribute('data-name', this.name);
      
      var $form = $c.querySelector('.gf_new_message_form') || $c.querySelector('.new_message_form');
      if ($form) $form.setAttribute('id', 't-'+this.id);


      var $idealTextarea = $c.querySelector(".gf_topic_ideal_textarea") || $c.querySelector(".topic_ideal_textarea");
      if ($idealTextarea) $idealTextarea.value = this.ideal;
      
      var $nameContainer = $c.querySelector(".gf_topic_name_container") || $c.querySelector(".topic_name_container");
      if ($nameContainer) $nameContainer.innerHTML = this.name;
      $c.querySelector(".new_message_topic").value = this.id;
      $c.querySelector(".tideal_id").value = this.id;

      if (this.lastUpdate == 0) {
        var $lastMessageTime = $c.querySelector(".gf_last_message_time") || $c.querySelector(".last_message_time");
        if ($lastMessageTime) $lastMessageTime.innerHTML = "(a word has yet to be spoken)";
      } else {
        var time = timeago().format(this.lastUpdate);
        var $timeago = $c.querySelector(".timeago");
        if ($timeago) $timeago.innerHTML = time;
      } 
        
      this.populateCardButton();
      this.populateMessages();
    };


    GETFIRE.Topic.prototype.populateCardButton = function(){
      var $c = this.$container;
      var card = GETFIRE.findCard(this.card);

      var iurl = "url("+card.avatarHalf+")";
      var $settingsButton = $c.querySelector(".gf_topic_settings_button") || $c.querySelector(".topic_settings_button");
      if ($settingsButton) $settingsButton.style.backgroundImage = iurl;
      
      var $tsbName = $c.querySelector(".gf_tsb_name") || $c.querySelector(".tsb_name");
      if ($tsbName) {
        $tsbName.style.color = card.color;
        $tsbName.innerHTML = card.name;
      }
    };
    
    GETFIRE.Topic.prototype.setCard = function(card) {
      var $c = this.$container;

      var $b = $c.querySelector(".gf_topic_settings_button") || $c.querySelector(".topic_settings_button");
      var iurl = "url("+card.avatarHalf+")";
      if ($b) $b.style.backgroundImage = iurl;
      
      var $n = $c.querySelector(".gf_tsb_name") || $c.querySelector(".tsb_name");
      if ($n) {
        $n.style.color = card.color;
        $n.innerHTML = card.name;
      }
      
      this.card = card.id;
    };



    GETFIRE.Topic.prototype.populateMessages = function(){
      var msg, prev;
      for (var i=0; i<this.messages.length; i++){
        msg = this.messages[i];
        prev = false;
        if (this.messages.length-i < 4) prev = true;
        
        renderMessage(msg, this, prev);

      }
    };


    GETFIRE.Topic.prototype.populatePreview = function(){
      // this.$container.querySelector(".gf_topic_preview").innerHTML = "";
      var msg;
      for (var i=Math.max(0, this.messages.length-4); i<this.messages.length; i++){
        msg = this.messages[i];

      }
    };



    GETFIRE.Topic.prototype.hide = function(){
      this.$container.style.display = "none";
      this.$container.classList.remove('gf_hi_fade');
    };

    GETFIRE.Topic.prototype.toggleOpen = function(){
      var $c = this.$container;
      var $wrapper = $c.querySelector(".gf_topic_content_wrapper") || $c.querySelector(".topic_content_wrapper");
      if ($wrapper && $wrapper.style.display == "none") this.open();
        else this.close();
    };

    GETFIRE.Topic.prototype.open = function(){
      var $c = this.$container;
      var $wrapper = $c.querySelector(".gf_topic_content_wrapper") || $c.querySelector(".topic_content_wrapper");
      var $settingsButton = $c.querySelector(".gf_topic_settings_button") || $c.querySelector(".topic_settings_button");
      var $preview = $c.querySelector(".gf_topic_preview") || $c.querySelector(".topic_preview");
      
      if ($wrapper) $wrapper.style.display = "block";
      if ($settingsButton) $settingsButton.style.display = "block";
      if ($preview) $preview.style.display = "none";

      this.scrollToShowAll();
      this.scrollToBottom();
    };

    GETFIRE.Topic.prototype.close = function(){
      var $c = this.$container;
      var $wrapper = $c.querySelector(".gf_topic_content_wrapper") || $c.querySelector(".topic_content_wrapper");
      var $settingsButton = $c.querySelector(".gf_topic_settings_button") || $c.querySelector(".topic_settings_button");
      var $preview = $c.querySelector(".gf_topic_preview") || $c.querySelector(".topic_preview");
      
      if ($wrapper) $wrapper.style.display = "none";
      if ($settingsButton) $settingsButton.style.display = "none";
      if ($preview) $preview.style.display = "block";
    };

    GETFIRE.Topic.prototype.scrollToShowAll = function(){
      var $c = this.$container;
      var eOffset = $c.offsetTop; // offset of element
      $tWrapper.scrollTop = eOffset;
    };

    GETFIRE.Topic.prototype.scrollToBottom = function(){
      this.$contentContainer.scrollTop = this.$contentContainer.scrollHeight;
    };

    GETFIRE.Topic.prototype.toggleSize = function(){
      $w = this.$container.querySelector(".gf_topic_content_wrapper");
      if ($w.style.height != "555px"){
        $w.style.height = 555+"px";
      } else {
        $w.style.height = 293+"px";
      }
    };

    GETFIRE.Topic.prototype.toggleSettingsRelated = function(){
      var $c = this.$settingsContainer;

      xreq({type: 'post', addr: 'api/v1/nearby',
        data: {topic_id: this.id},
        success: function(dat){
          $c.querySelector(".related_content").innerHTML = dat.html;
          $c.querySelector(".gf_topic_related_w").style.display = "block";;
          $c.querySelector(".gf_topic_ideal_w").style.display = "none";
          $c.querySelector(".gf_topic_lobby_w").style.display = "none";
        },
        failure: function(){console.log('failure to show nearby')}});
    }

    GETFIRE.Topic.prototype.toggleSettingsLobby = function(){
      var $c = this.$settingsContainer;
    
      xreq({type: 'post', addr: 'api/v1/lobby',
        data: {topic_id: this.id},
        success: function(dat){
          $c.querySelector(".lobby_content").innerHTML = dat.html;
          $c.querySelector(".gf_topic_related_w").style.display = "none";
          $c.querySelector(".gf_topic_ideal_w").style.display = "none";
          $c.querySelector(".gf_topic_lobby_w").style.display = "block";;
        },
        failure: function(){console.log('failure to show lobby')}});
    }

    GETFIRE.Topic.prototype.toggleSettingsIdeal = function(){
      var $c = this.$settingsContainer;
      $c.querySelector(".gf_topic_related_w").style.display = "none";
      $c.querySelector(".gf_topic_ideal_w").style.display = "block";
      $c.querySelector(".gf_topic_lobby_w").style.display = "none";
    }

    GETFIRE.findTopic = function(id){
      for (var i = 0; i < chatTopics.length; i++){
        if (id == chatTopics[i].id) return chatTopics[i];
      }
      return false;
    }




    // // messages wrapper
    GETFIRE.$messages = newDiv({id:"gf_messages", content:"<BR><BR>"});

    GETFIRE.$messages.addEventListener('mouseover', function(e){
      var $t = e.target;
      if ($t.tagName != "DIV" && $t.tagName != "SPAN") return false;//return false;
      if ($t.tagName == "SPAN") $t = $t.parentNode;

      if ($t.className.includes("user_message")) {
        // clear responding highlight
        var $og = document.querySelector(".gf_mHovermod");
        if ($og) $og.classList.remove("gf_mHovermod");

        $mTime.setAttribute("datetime", $t.getAttribute("data-time"));

        if ($t.getAttribute("data-response-id")) {
          var $og = document.querySelector("[data-msg-id='"+$t.getAttribute("data-response-id")+"']");
          if ($og) {
            $og.classList.add("gf_mHovermod");
            /// td: fix thread display

          } else {
            // console.log("older");
          }
          // console.log($og);
        }
      } else {
        // clear response highlights
        var highlitMessages = document.querySelectorAll('.gf_mHovermod');
        if (!highlitMessages) return true;
        for (var i=0; i<highlitMessages.length; i++){
          highlitMessages[i].classList.remove("gf_mHovermod");
        }

      }
    });



    $wrapper.addEventListener('mouseleave', function(e){
      // clear response highlights
      var highlitMessages = document.querySelectorAll('.gf_mHovermod');
      if (!highlitMessages) return true;
      for (var i=0; i<highlitMessages.length; i++){
        highlitMessages[i].classList.remove("gf_mHovermod");
      }
    });
    
    let devMode = config.devMode || false;
    if (devMode == true) {
      uri = "http://localhost:3000/";
      ssl = true;
      env = "development";
    }

    var uuuid;
    if (document.cookie.indexOf("_gfc1") >= 0) 
      uuuid = getCookie("_gfc1") || Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    else
      uuuid = setCookie("_gfc1", Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2));
    // ActionCable WebSocket connection
    var wsUrl;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      // For development, always connect to the Rails server on port 3000
      wsUrl = 'ws://localhost:3000/ws/cable';
    } else {
      wsUrl = 'wss://getfire.net/ws/cable';
    }
    GETFIRE.consumer = ActionCable.createConsumer(wsUrl);
    GETFIRE.subscriptions = {};
    
    // ActionCable message handling
    GETFIRE.handleMessage = function(data, topicId) {
      if (data.type == "new_message") {
        var topic = GETFIRE.findTopic(topicId);
        if (topic) {
          renderMessage(data.content, topic, true);
          topic.scrollToBottom();
        }
      }
        
      if (data.type == "seent") {
        var topic = GETFIRE.findTopic(topicId);
        if (topic) {
          topic.seen += 1;
          if (topic.$settingsContainer) topic.$settingsContainer.querySelector(".tsvc").innerHTML = topic.seen;
        }
      }
    };
    if (ssl)
      subscribe(topicNames);
    else
      console.log('Connection failed: SSL Required.')
    
    resize();

    
    if (startOpen) {
      // GETFIRE.$topic.style.display = "block";
      // GETFIRE.$preview.style.display = "none";
      // $icon.style.display = "none";
    }




    function subscribe(topics){
      xreq({type: 'post', addr: 'api/v1/index',
        data: {topic_names: topics, name: defaultName},
        success: function(dat){
          if (!dat.html) dat.html = '';

          // init cards
          for (var i=0; i<dat.cards.length; i++){
            var tCard = new GETFIRE.Card(dat.cards[i]);
            chatCards.push(tCard);
          }
          
          // init topics
          $tWrapper.innerHTML = dat.html;
          let $tFooter = newDiv({id:"topic_footer"});
          $tWrapper.append($tFooter);
          if (!dat.topics) dat.topics = [];
          var channelQueue = ['gtc-0'];
          
          // Use requestAnimationFrame to ensure DOM is updated before cloning
          requestAnimationFrame(function() {
            for (var i=0; i<dat.topics.length; i++){
              var tTopic = new GETFIRE.Topic(dat.topics[i]);
              //
              var topicDieTemplate = document.getElementById("topic_die");
              if (!topicDieTemplate) {
                console.error("topic_die template not found in DOM");
                continue;
              }
              tTopic.$container = topicDieTemplate.cloneNode(true);
            tTopic.$container.id = tTopic.id; // Set unique container ID immediately
            $tWrapper.prepend(tTopic.$container);
            tTopic.populateContainer();
            //
            chatTopics.push(tTopic);

            $rolo_topic = newDiv({className:"gf_topic_rolodex_topic", content: tTopic.name});
            $rolo_topic.dataset.id = tTopic.id;
            $rolo.append($rolo_topic);

            channelQueue.push("ft-"+ tTopic.id);

            if (startOpen) tTopic.show();
            if (startPreview){
              tTopic.show();
              tTopic.close();
            }
            }

            // reposition modal higher in dom
            var modal = document.getElementById("gf_modal_wrapper");
            if (modal) $wrapper.appendChild(modal);
            
            // Subscribe to ActionCable channels
            for (var j = 0; j < channelQueue.length; j++) {
            var channel = channelQueue[j];
            if (channel.startsWith('ft-')) {
              var topicId = channel.substring(3);
              // Use closure to capture the correct topicId for each subscription
              (function(capturedTopicId, capturedChannel) {
                GETFIRE.subscriptions[capturedChannel] = GETFIRE.consumer.subscriptions.create(
                  {
                    channel: "MessageChannel",
                    topic_id: capturedTopicId
                  },
                  {
                    connected() {
                    },
                    disconnected() {
                    },
                    received(data) {
                      GETFIRE.handleMessage(data, capturedTopicId);
                    }
                  }
                );
              })(topicId, channel);
            }
            }

            $wrapper.style.display = "block";
            GETFIRE.ready = true;
          }); // End requestAnimationFrame
        },
        failure: function(){console.log('chat subscription failure')}});
      return true;
    };




    GETFIRE.postMessage = function(topic){
      if (!GETFIRE.ready) return false;

      card = GETFIRE.findCard(topic.card);

      xreq({type: 'post', addr: 'api/v1/message',
      data: {topic_id: topic.id,
              user_id: card.id,
              name: card.name,
              content: topic.$container.querySelector(".gf_message_entry_content").value,
              color:  card.color,
              response_to: topic.$container.querySelector(".um_response_to").value
        },
      success: function(dat){

        document.getElementById(topic.id).querySelector(".gf_new_message_form").reset();
        document.getElementById(topic.id).querySelector(".gf_message_submit_button").disabled=false;
        document.getElementById(topic.id).querySelector(".gf_message_submit_button").value='Send';
        
      },
      failure: function(){
        console.log('failure to send message');
        
        document.getElementById(topic.id).querySelector(".gf_message_submit_button").disabled=false;
        document.getElementById(topic.id).querySelector(".gf_message_submit_button").value='Send';
        
      }});

      document.getElementById(topic.id).querySelector(".gf_message_submit_button").value='Sending...';
      
      // document.getElementById("gf_submit").disabled = true;
      // document.getElementById("gf_submit").value = "Sending...";
    };









    function renderMessage(m, topic, prev){
      if (!m) return false;
      
      // message
      var mContent = parseMessage(m.content);
      var mPreview = parsePreview(m.content);
      var $tMsg = newDiv({className: "gf_user_message", content: mContent});
      $tMsg.setAttribute("data-time", m.created_at);
      $tMsg.setAttribute("data-id", m.user_id);
      $tMsg.setAttribute("data-name", m.name);
      $tMsg.setAttribute("data-msg-id", m.hashish);
      // name
      var $name = document.createElement("span");
      $name.classList.add("gf_name_plate");
      // $name.classList.add("gf_hcmod");
      $name.style.color = m.color;
      $name.title = m.name;


      if (prev) renderPreview(mContent, topic);
      // alert
      // if (GETFIRE.$topic.style.display == "none" && GETFIRE.$preview.style.display == "none") {
      //   GETFIRE.$preview.style.display = "block";
      //   // $icon.style.display = "none";
      // }

      // normal message
      if (!m.response_to || m.response_to == "null") {
        $name.innerHTML = m.name+" ";
        $tMsg.prepend($name);
      } else {
        // admin message
        if (m.response_to == "ADMIN") {
          var $tMsg = newDiv({className:"gf_am", content: mContent});
        } else {
          // response message
          $name.innerHTML = " "+m.name;
          $tMsg.append($name);
          $tMsg.classList.add("gf_mResponse");
          $tMsg.setAttribute("data-response-id", m.response_to);
        }
      }
      
      if (!topic.$contentContainer) {
        console.error("topic.$contentContainer is null for topic:", topic.id);
        return false;
      }
      
      topic.$contentContainer.append($tMsg);
      return true;
    };



    function renderPreview(m, topic){

      var pCount = topic.$preview.getElementsByClassName("gf_pMsg").length;
      // if (pCount == 0) topic.$preview.innerHTML = "";

  		var $newMsg = newDiv({className:"gf_pMsg", content:m});
      topic.$preview.append($newMsg);

      // console.log(topic.$preview)

      if (pCount > 4) topic.$preview.getElementsByClassName("gf_pMsg")[0].remove();

      return true;
    };



    function parsePreview(text){
      // TODO: cut message short before parsing links and images
      // if (string.length > 50)
      //      return string.substring(0,50)+'...';
      return text;
    };

    function parseMessage(text){
      if (!text) return "";
      
      text = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");

      
      // // regexes
  		// var _reHttpLink = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
  		// var _reWwwLink = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
      // var _reImg= /https?:\/\/.*?\.(?:png|jpg|jpeg|gif|webp)/ig;
      // var _reVid = /\.(?:mp4|webm|ogg)$/i;

      // replace images
      // var testText = text;
      // text = text.replace(_reImg, '<div class="found_image_wrapper"><img src="$&" class="found_image" onerror="this.onerror=null;this.src=&quot;'+uri+'/images/missing_wallpaper_tiny.jpg&quot;;" /><a href="$&" target="_blank" class="found_image_link" title="open image">'+ linkSVG +'</a></div>');
      // if (testText !== text) return text;

      // // replace links
  		// text = text.replace(_reHttpLink, '<a href="$1" target="_blank" title="$1" rel="noopener">$1</a>');
  		// text = text.replace(_reWwwLink, '$1<a href="http://$2" target="_blank" title="$1" rel="noopener">$2</a>');


      
    // html.replace(/</g, "&lt;").replace(/>/g, "&gt;");

      
  // regexes
  var _reHttpLink = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
  var _reWwwLink = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
  var _reImg = /https?:\/\/.*?\.(?:png|jpg|jpeg|gif|webp)/ig;
  // var _reVid = /\.(?:mp4|webm|ogg)$/i;
  
  // var _reGlyph = /(\/\.\[(.*?)\]+)/g;
  var _reGlyph = /(\/\.\[(.*?)\]+(\[(.*?)\])*)/g;
  var _gthttpswww = />((http)s*:\/\/)*(www\.)*/ig

          // replace links
    text = text.replace(_reHttpLink, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    text = text.replace(_reWwwLink, '$1<a href="http://$2" target="_blank" rel="noopener">$2</a>');
    // replace glyphs
    text = text.replace(_reGlyph, '<div class="glyph" title="" style="background: url($2) no-repeat;" data-id="$4"></div>');
    
    // strip http from display
    text = text.replace(_gthttpswww, '>');


  		return text;
    };




    
    function populateAvatarPopup(e, msg, topic) {
      var popup = document.getElementById("gf_avatar_popup");
      popup.style.display = "block";
      
      var hpx = Math.max(33, Math.min(e.clientX-75, window.innerWidth-185));
      var hpy = Math.max(20, (e.clientY-98));
      popup.style.left = hpx+"px";
      popup.style.top = hpy+"px";
      
      var name = msg.getAttribute("data-name");
      var time = timeago().format(msg.getAttribute("data-time"));
      var id = msg.getAttribute("data-id");
      // var iurl = "https://s3.amazonaws.com/getfire-paperclip-"+env+"/avatars/"+id+"/half.jpg";

  
      
      //STAY SAFE ADD gfgi- #
      var iurl = "https://getfire-uploads-"+env+".s3.us-west-2.amazonaws.com/avatars/"+id+"/half.jpg";

      var guest = id.includes('gfgi-');
      if (guest){
        // public avatars
        var avaNum = id.split('-')[2];
        var avaUrl = "ruination-one/";
        avaUrl = avaUrl + avaNum;
        iurl = "https://s3.amazonaws.com/getfire-paperclip-dev/default-avatars/"+avaUrl+"/half.jpg";
      } 



      // document.getElementById("message_time_ago").innerHTML = time;
      document.getElementById("gf_popup_name").innerHTML = name;
      popup.setAttribute("data-id", id);
      popup.setAttribute("data-topic-id", topic);
      popup.setAttribute("data-name", name);
      popup.setAttribute("data-msg-id", id);
      popup.style.backgroundImage = "url("+iurl+")";
    };


    function handleKey(e){
      if (e.target.classList.contains('gf_message_entry_content')){
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.altKey === true) {
            e.target.value += "\n";
            e.target.focus();
          } else {
            e.target.nextElementSibling.click();
          }
        }
        e.stopPropagation();
      }
    }


    // global click handler
    function handleClick(e){
      var path = e.path;
      var target = e.target || e.srcElement;
      if (target.tagName === 'A') {
        var url = target.getAttribute('href');

        var modalfunc = function(){
          if (url.toLowerCase().includes("getfire.net/") || url.toLowerCase().includes("localhost:3000")) {
            var id = url.toLowerCase().split("getfire.net/").pop();
            if (id == url) id = url.toLowerCase().split("localhost:3000/").pop();
          
            // td: enable in-applet subbing
            // $.ajax({
            //   type : "GET",
            //   url : "/topic_subs/create/"+id
            // });
            
          } else {
            window.open(url, "_blank");
          }
        };
        GETFIRE.modal(true, "Open link? <br>"+url, modalfunc);
        
        e.preventDefault();
      }

      if (path.includes($iconB)){
        if ($tWrapper.offsetParent !== null){
          $tWrapper.style.display = "none";
        } else {
          $tWrapper.style.display = "block";
        }
      }
      
      // click is inside applet
      if (path.includes($wrapper)) {
        // $tWrapper.style.display = "block";
        for (var i=0; i<chatTopics.length; i++){
          var t = chatTopics[i];
          var $c = t.$container;
          if (path.includes($c)){
            t.scrollToShowAll();

            if (path.includes(t.$contentContainer) || classHit(path, "gf_message_entry_content")){
              t.$settingsContainer.style.display = "none";
            }


            if (classHit(path, "gf_hide_topic_button")){
              t.hide();
            }

            if (classHit(path, "gf_topic_head")){
              t.toggleOpen();
            }

            
            if (classHit(path, "gf_topic_toggle_size")){
              t.toggleSize();
              continue;
            }

            // Toggle settings
            if (classHit(path, "gf_topic_settings_button")){
              if (t.$settingsContainer.style.display != "block") 
                t.$settingsContainer.style.display = "block";
              else
                t.$settingsContainer.style.display = "none";
            }


            if (classHit(path, "gf_message_submit_button")){
              GETFIRE.postMessage(t);
              e.preventDefault();
              document.getElementById(t.id).querySelector(".gf_message_submit_button").disabled=true;
              // return false; // prevent default form submission
            }

            if (classHit(path, "gf_um_rclose")){
              // t.toggleOpen();
              var tt = $c.querySelector('.gf_um_rwrapper');
              tt.style.display = 'none';
            }

                    

            if (classHit(path, "gf_related_topics_b")){
              t.toggleSettingsRelated();
            }
            if (classHit(path, "gf_topic_lobby_b")){
              t.toggleSettingsLobby();
            }
            if (classHit(path, "gf_topic_ideal_b")){
              t.toggleSettingsIdeal();
            }

            // Sign in
            if (classHit(path, "members_in")){
              var func = function(){
                topics = "";
                for (var i=0; i<chatTopics.length; i++){
                  topics += chatTopics[i].name + ',';
                }
                // topics = chatTopics
                var url = uri+"api/v1/treq"+"?topics="+topics;
                // window.open(url, 'treq', 'location=yes,height=570,width=520,scrollbars=yes,status=yes');

                // TD: for mobile: iframe key fetch
                $ifWrapper.style.display="block";
                window.open(url, 'iFrame');
              }
              if (isMobile){
                //
                // GETFIRE.modal(false, 'Mobile sign in not yet available!');
                GETFIRE.modal(true, "Sign in to GetFire.net? <br><br>", func);
              } else {
                GETFIRE.modal(true, "Sign in to GetFire.net? <br><br>", func);
              }
            }
            // Sign out
            if (classHit(path, "members_out")){
              var func = function(){
                xreq({type:'post', addr: 'api/v1/sign_out',
                success: function(){
                  signOut();
                }});
              }
              GETFIRE.modal(true, "Sign out? <br><br>", func);
            }

            if (classHit(path, "gf_topic_unsubscribe_b")){
              
              if(window.confirm("Leave chat topic?")) {
                var channelId = "ft-" + t.id;
                if (GETFIRE.subscriptions[channelId]) {
                  GETFIRE.subscriptions[channelId].unsubscribe();
                  delete GETFIRE.subscriptions[channelId];
                }
                document.getElementById(t.id).remove();
                document.querySelector("[data-id="+t.id+"]").remove();
                chatTopics.splice(i, 1);
              }
            }


            if (classHit(path, "gf_user_message")){
              var msg;
              if (e.srcElement.classList.contains('gf_user_message')){
                 msg = e.srcElement;
              } else {
                msg = e.srcElement.parentNode;                
              }
              
              var wasTagged = msg.classList.contains('gf_um_select');
              var prevTagged = msg.parentNode.querySelector('.gf_um_select');
              if (prevTagged){
                prevTagged.classList.remove('gf_um_select');
                prevTagged.querySelector('.gf_message_time').remove();
              }
              
              
              if (msg){
                msg.classList.add('gf_um_select');
                
                var timeAgo = newDiv({className:'gf_message_time', content: timeago().format(msg.getAttribute("data-time"))})
                msg.append(timeAgo);
                
                if (!wasTagged) return;

                var hit = classHit(path, "gf_topic_container")
                var topic;
                if (hit){
                  topic = hit.id;
                }
                populateAvatarPopup(e, msg, topic);
              }



            }

          }
        } // end topic hit test



        if (path.includes(document.getElementById("if_button"))){
          $ifWrapper.style.display="none";
        }
        
        // rolodex
        if (hit = classHit(path, "gf_topic_rolodex_topic")){
          $tWrapper.style.display = "block";
          var id = hit.getAttribute("data-id");
          var t = GETFIRE.findTopic(id);
          if (t) {
            if (t.$container.offsetParent == null){
              t.show();
              hit.classList.add("gf_active_rolo_mod");

            } else {
              t.hide();
              hit.classList.remove("gf_active_rolo_mod");
            }
          }
        }


        // modal dialogue
        var modal = document.getElementById("gf_modal_wrapper");
        if (path.includes(modal)){
          // close & cancel buttons & click-away from modal
          if(path.includes(document.getElementById("gf_modal_close")) || 
              path.includes(document.getElementById("gf_modal_cancel")) ||
              !path.includes(document.getElementById("gf_fire_modal"))) {
            modal.style.display = "none";
          }
        }


        // avatar popup click handlers
        var popup = document.getElementById("gf_avatar_popup");
        if (path.includes(popup)){
          var msgID = popup.getAttribute("data-msg-id");
          var userID = popup.getAttribute("data-id");
          var userName = popup.getAttribute("data-name");
          var topicID = popup.getAttribute("data-topic-id");


          // avatar name
          if (path.includes(document.getElementById("gf_popup_name"))){
            var func = function(){
              // open card in new tab
              window.open(uri+"card/"+userID+"?name="+userName, "_blank");
            };
            GETFIRE.modal(true, "Open card in new tab?", func);
          }


          // commend
          if (path.includes(document.getElementById("gf_message_commend"))){
            xreq({type: 'post', addr: 'api/v1/commend',
              data: {id:msgID},
              success: function(dat){
                // temp enlarge
                // document.querySelectorAll(".user_message[data-msg-id='"+msgID+"']").forEach(el => el.style.fontSize = '1.1em');
              },
              failure: function(){console.log('failure to commend')}});
          }


          // abhor
          if (path.includes(document.getElementById("gf_message_abhor"))){
            var func = function(){
              xreq({type: 'post', addr: 'api/v1/abhor',
                data: {id:msgID},
                success: function(dat){
                  // temp shrink
                  //   document.querySelectorAll(".user_message[data-msg-id='"+msgID+"']").forEach(el => el.style.fontSize = '.8em');
               },
                failure: function(){console.log('failure to abhor')}});
            }
            GETFIRE.modal(true, "Abhor this message?<br><br>", func);
          }


          // delete
          if (path.includes(document.getElementById("gf_message_delete"))){
            var func = function(){
              xreq({type: 'post', addr: 'api/v1/remove',
                data: {id:msgID},
                success: function(dat){
                  // delete td:
                },
                failure: function(){console.log('failure to remove')}});
            }

            // td: check if user message

            GETFIRE.modal(true, "Remove this message?<br><br>", func);
          }


          // reply
          if (path.includes(document.getElementById("gf_message_reply"))){
            var $w = document.getElementById(topicID);
            var $responding = $w.querySelector(".gf_um_rwrapper");
            var $rname = $responding.querySelector(".gf_um_rname");
            $responding.style.display = "block";
            $rname.innerHTML = userName;

            var $in = $w.querySelector(".gf_message_entry_content");
            $in.focus();
            $w.querySelector(".um_response_to").value = msgID;
          }
        } // end path includes popup


        // click-away/on clean avatar popup
        if(popup && !path.includes(popup) && !classHit(path, "gf_user_message")) {
          popup.style.display = "none";
        }
        if (e.srcElement.id == "gf_avatar_popup" || e.srcElement.id == "gf_message_reply" || !classHit(path, "gf_user_message")){
          popup.style.display = "none";
        }


        // clear responding notifier
        // if (!path.includes($responding) && !path.includes($input) && !path.includes($submit) && !path.includes($respondB) || path.includes(document.getElementById("gf_res_x"))) {
        //   $responding.style.display = "none";
        //   $responding.setAttribute("data-id", null);
        // }


        // end click inside applet
      }
    }; // end click handler


    function handleClickAway(e){
      if (clickAwayHide) {
        if (!e.path.includes($wrapper)){
          $tWrapper.style.display = "none";
        }
      }
    }


    function xreq(obj, test){
      if (!obj.type) obj.type = 'get';
      if (!obj.addr) obj.addr = '';
      if (!obj.data) obj.data = {};
      if (!obj.success) obj.success = function(){};
      if (!obj.failure) obj.failure = function(){};

      let xhr = new XMLHttpRequest();
      xhr.onerror= function(e) {
      };
      
      xhr.open(obj.type, uri+obj.addr);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Content-Type','application/json; charset=utf-8');
      
      xhr.responseType = 'text';
      // if (test) xhr.responseType = 'application/json';
      // if (obj.addr == 'api/v1/test')
      //    xhr.responseType = 'document';
      obj.data.jwt = getCookie("_gfc0");
      let data = JSON.stringify(obj.data);

      xhr.send(data);
      xhr.onload = function(){
        if (xhr.status === 200) {
          // success
            if (xhr.responseText) obj.success(JSON.parse(xhr.responseText).data);
        } else {
          // failure
          // console.log(xhr)
          obj.failure();
        }
      };
    };


    function getCookie(name) {
      match = document.cookie.match(new RegExp(name + '=([^;]+)'));
      if (match) return match[1];
      else return false;
    };

    function setCookie(name, value) {
    	var cookie = name + "=" + encodeURIComponent(value);
    	cookie += "; max-age=" + (4*365*24*60*60);
    	cookie += "; path=/";

    	document.cookie = cookie;
      return value;
    };

    function newDiv(div){
    	var $div = document.createElement('div');

    	if (div.id) $div.id = div.id;
    	if (div.className) $div.className = div.className;
    	if (div.title) $div.setAttribute('title', div.title);
    	if (div.content) $div.innerHTML = div.content;

    	return $div;
    };

    function classHit(path, className){
      for (var i=0; i<path.length; i++){
        if (path[i].classList && path[i].classList.contains(className)) return path[i];
      }
      return false;
    }

    function resize() {
      var width = Math.min(Math.max(window.innerWidth/3, 400), window.innerWidth-45);
      var height = window.innerHeight;
      // var halfHeight = height < 316 ? height : 316;
      var buffer = 41;
      $tWrapper.style.maxHeight = (height - buffer)+"px";
      $tWrapper.style.maxWidth = (width)+"px";
      // individual chats
      // GETFIRE.$topic.style.width = width+"px";
      // GETFIRE.$topic.style.height = fullHeight ? height+"px" : halfHeight+"px";

      return true;
    };
        
    GETFIRE.modal = function(confirmation, message, func){
      var modal = document.getElementById("gf_modal_wrapper");
      modal.style.display = "table";
      
      document.getElementById("gf_modal_message").innerHTML = message;

      // set auto-timeout
      if (!confirmation) {
        document.getElementById("gf_modal_cancel").style.display = "none";
        document.getElementById("gf_modal_confirm").style.display = "none";
  
        setTimeout(function() {
          // close
          modal.style.display = "none";
        }, 3600);
      } else {
        document.getElementById("gf_modal_confirm").addEventListener("click", function(e) {
          e.target.removeEventListener(e.type, arguments.callee);
          modal.style.display = "none";
          func();
        });
    
        document.getElementById("gf_modal_cancel").style.display = "initial";
        document.getElementById("gf_modal_confirm").style.display = "initial";
      }
    };
    
    GETFIRE.rules = function(){
      alert("be a baws<br>dont be traj");
      return true;
    };
    
    // Method to open a topic dynamically
    GETFIRE.openTopic = function(topicName) {
      // Make API call to get topic data
      xreq({
        type: 'post', 
        addr: 'api/v1/open_topic',
        data: {topic_name: topicName, name: 'Guest'},
        success: function(dat) {
          if (dat.topic && dat.card) {
            // Add card if it doesn't exist
            if (!GETFIRE.findCard(dat.card.id)) {
              var newCard = new GETFIRE.Card(dat.card);
              chatCards.push(newCard);
            }
            
            // Check if topic already exists
            var existingTopic = GETFIRE.findTopic(dat.topic.hashish);
            if (!existingTopic) {
              // Create new topic
              var newTopic = new GETFIRE.Topic(dat.topic);
              
              // Clone template and set up container
              var topicDieTemplate = document.getElementById("topic_die");
              if (topicDieTemplate) {
                newTopic.$container = topicDieTemplate.cloneNode(true);
                newTopic.$container.id = newTopic.id;
                $tWrapper.prepend(newTopic.$container);
                newTopic.populateContainer();
                
                // Add to collections
                chatTopics.push(newTopic);
                
                // Add to rolodex
                var $roloTopic = newDiv({className:"gf_topic_rolodex_topic", content: newTopic.name});
                $roloTopic.dataset.id = newTopic.id;
                $rolo.append($roloTopic);
                
                // Subscribe to ActionCable
                var channelId = "ft-" + newTopic.id;
                GETFIRE.subscriptions[channelId] = GETFIRE.consumer.subscriptions.create(
                  {
                    channel: "MessageChannel",
                    topic_id: newTopic.id
                  },
                  {
                    connected() {
                      // console.log("Connected to topic:", newTopic.name);
                    },
                    disconnected() {
                      // console.log("Disconnected from topic:", newTopic.name);
                    },
                    received(data) {
                      GETFIRE.handleMessage(data, newTopic.id);
                    }
                  }
                );
                
                // Show and open the topic by default
                $tWrapper.style.display = "block"; // Make sure widget is visible
                newTopic.show();
                newTopic.open();
                newTopic.scrollToShowAll();
              }
            } else {
              // Topic exists, just show and open it
              $tWrapper.style.display = "block"; // Make sure widget is visible
              existingTopic.show();
              existingTopic.open();
              existingTopic.scrollToShowAll();
            }
          }
        },
        failure: function() {
          console.log('Failed to open topic:', topicName);
        }
      });
    };
    
    return GETFIRE;
  };
})();













////////////////////////////////////////////////////////////////
// Polyfills Utils
////////////////////////////////////////////////////////////////


Function.prototype.debounce = function (threshold, execAsap) {
  var func = this, // reference to original function
      timeout; // handle to setTimeout async task (detection period)
  // return the new debounced function which executes the original function only once
  // until the detection period expires
  return function debounced () {
      var obj = this, // reference to original context object
          args = arguments; // arguments at execution time
      // this is the detection function. it will be executed if/when the threshold expires
      function delayed () {
          // if we're executing at the end of the detection period
          if (!execAsap)
              func.apply(obj, args); // execute now
          // clear timeout handle
          timeout = null;
      }
      // stop any current detection period
      if (timeout)
          clearTimeout(timeout);
      // otherwise, if we're not already waiting and we're executing at the beginning of the detection period
      else if (execAsap)
          func.apply(obj, args); // execute now
      // reset the detection period
      timeout = setTimeout(delayed, threshold || 100);
  };
};

// click event path
if (!("path" in Event.prototype))
  Object.defineProperty(Event.prototype, "path", {
    get: function() {
      var path = [];
      var currentElem = this.target;
      while (currentElem) {
        path.push(currentElem);
        currentElem = currentElem.parentElement;
      }
      if (path.indexOf(window) === -1 && path.indexOf(document) === -1)
        path.push(document);
      if (path.indexOf(window) === -1)
        path.push(window);
      return path;
    }
  });

// https://tc39.github.io/ecma262/#sec-array.prototype.findIndex
if (!Array.prototype.findIndex) {
  Object.defineProperty(Array.prototype, 'findIndex', {
    value: function(predicate) {
      if (this == null) {
        throw new TypeError('"this" is null or not defined');
      }
      var o = Object(this);
      var len = o.length >>> 0;
      if (typeof predicate !== 'function') {
        throw new TypeError('predicate must be a function');
      }
      var thisArg = arguments[1];
      var k = 0;
      while (k < len) {
        var kValue = o[k];
        if (predicate.call(thisArg, kValue, k, o)) {
          return k;
        }
        k++;
      }
      return -1;
    },
    configurable: true,
    writable: true
  });
}

if (!Array.prototype.includes) {
  Array.prototype.includes = function(searchElement /*, fromIndex*/) {
    'use strict';
    if (this == null) {
      throw new TypeError('Array.prototype.includes called on null or undefined');
    }

    var O = Object(this);
    var len = parseInt(O.length, 10) || 0;
    if (len === 0) {
      return false;
    }
    var n = parseInt(arguments[1], 10) || 0;
    var k;
    if (n >= 0) {
      k = n;
    } else {
      k = len + n;
      if (k < 0) {k = 0;}
    }
    var currentElement;
    while (k < len) {
      currentElement = O[k];
      if (searchElement === currentElement ||
         (searchElement !== searchElement && currentElement !== currentElement)) { // NaN !== NaN
        return true;
      }
      k++;
    }
    return false;
  };
}

// .includes
if (!String.prototype.includes) {
  String.prototype.includes = function(search, start) {
    'use strict';
    if (typeof start !== 'number') {
      start = 0;
    }
    if (start + search.length > this.length) {
      return false;
    } else {
      return this.indexOf(search, start) !== -1;
    }
  };
}

// Source: https://github.com/jserz/js_piece/blob/master/DOM/ParentNode/append()/append().md
(function (arr) {
  arr.forEach(function (item) {
    if (item.hasOwnProperty('append')) {
      return;
    }
    Object.defineProperty(item, 'append', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function append() {
        var argArr = Array.prototype.slice.call(arguments),
          docFrag = document.createDocumentFragment();
        argArr.forEach(function (argItem) {
          var isNode = argItem instanceof Node;
          docFrag.appendChild(isNode ? argItem : document.createTextNode(String(argItem)));
        });
        this.appendChild(docFrag);
      }
    });
  });
})([Element.prototype, Document.prototype, DocumentFragment.prototype]);

// Source: https://github.com/jserz/js_piece/blob/master/DOM/ParentNode/prepend()/prepend().md
(function (arr) {
  arr.forEach(function (item) {
    if (item.hasOwnProperty('prepend')) {
      return;
    }
    Object.defineProperty(item, 'prepend', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function prepend() {
        var argArr = Array.prototype.slice.call(arguments),
          docFrag = document.createDocumentFragment();
        argArr.forEach(function (argItem) {
          var isNode = argItem instanceof Node;
          docFrag.appendChild(isNode ? argItem : document.createTextNode(String(argItem)));
        });
        this.insertBefore(docFrag, this.firstChild);
      }
    });
  });
})([Element.prototype, Document.prototype, DocumentFragment.prototype]);

// from:https://github.com/jserz/js_piece/blob/master/DOM/ChildNode/remove()/remove().md
(function (arr) {
  arr.forEach(function (item) {
    if (item.hasOwnProperty('remove')) {
      return;
    }
    Object.defineProperty(item, 'remove', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function remove() {
        if (this.parentNode !== null)
          this.parentNode.removeChild(this);
      }
    });
  });
})([Element.prototype, CharacterData.prototype, DocumentType.prototype]);




// classList
/*! @source http://purl.eligrey.com/github/classList.js/blob/master/classList.js */
"document"in self&&("classList"in document.createElement("_")&&(!document.createElementNS||"classList"in document.createElementNS("http://www.w3.org/2000/svg","g"))||!function(t){"use strict";if("Element"in t){var e="classList",n="prototype",i=t.Element[n],s=Object,r=String[n].trim||function(){return this.replace(/^\s+|\s+$/g,"")},o=Array[n].indexOf||function(t){for(var e=0,n=this.length;n>e;e++)if(e in this&&this[e]===t)return e;return-1},c=function(t,e){this.name=t,this.code=DOMException[t],this.message=e},a=function(t,e){if(""===e)throw new c("SYNTAX_ERR","The token must not be empty.");if(/\s/.test(e))throw new c("INVALID_CHARACTER_ERR","The token must not contain space characters.");return o.call(t,e)},l=function(t){for(var e=r.call(t.getAttribute("class")||""),n=e?e.split(/\s+/):[],i=0,s=n.length;s>i;i++)this.push(n[i]);this._updateClassName=function(){t.setAttribute("class",this.toString())}},u=l[n]=[],h=function(){return new l(this)};if(c[n]=Error[n],u.item=function(t){return this[t]||null},u.contains=function(t){return~a(this,t+"")},u.add=function(){var t,e=arguments,n=0,i=e.length,s=!1;do t=e[n]+"",~a(this,t)||(this.push(t),s=!0);while(++n<i);s&&this._updateClassName()},u.remove=function(){var t,e,n=arguments,i=0,s=n.length,r=!1;do for(t=n[i]+"",e=a(this,t);~e;)this.splice(e,1),r=!0,e=a(this,t);while(++i<s);r&&this._updateClassName()},u.toggle=function(t,e){var n=this.contains(t),i=n?e!==!0&&"remove":e!==!1&&"add";return i&&this[i](t),e===!0||e===!1?e:!n},u.replace=function(t,e){var n=a(t+"");~n&&(this.splice(n,1,e),this._updateClassName())},u.toString=function(){return this.join(" ")},s.defineProperty){var f={get:h,enumerable:!0,configurable:!0};try{s.defineProperty(i,e,f)}catch(p){void 0!==p.number&&-2146823252!==p.number||(f.enumerable=!1,s.defineProperty(i,e,f))}}else s[n].__defineGetter__&&i.__defineGetter__(e,h)}}(self),function(){"use strict";var t=document.createElement("_");if(t.classList.add("c1","c2"),!t.classList.contains("c2")){var e=function(t){var e=DOMTokenList.prototype[t];DOMTokenList.prototype[t]=function(t){var n,i=arguments.length;for(n=0;i>n;n++)t=arguments[n],e.call(this,t)}};e("add"),e("remove")}if(t.classList.toggle("c3",!1),t.classList.contains("c3")){var n=DOMTokenList.prototype.toggle;DOMTokenList.prototype.toggle=function(t,e){return 1 in arguments&&!this.contains(t)==!e?e:n.call(this,t)}}"replace"in document.createElement("_").classList||(DOMTokenList.prototype.replace=function(t,e){var n=this.toString().split(" "),i=n.indexOf(t+"");~i&&(n=n.slice(i),this.remove.apply(this,n),this.add(e),this.add.apply(this,n.slice(1)))}),t=null}());



////////////////////////////////////////////////////////////////
// ActionCable
////////////////////////////////////////////////////////////////
!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?e(exports):"function"==typeof define&&define.amd?define(["exports"],e):e((t="undefined"!=typeof globalThis?globalThis:t||self).ActionCable={})}(this,(function(t){"use strict";var e={logger:"undefined"!=typeof console?console:void 0,WebSocket:"undefined"!=typeof WebSocket?WebSocket:void 0},n={log(...t){this.enabled&&(t.push(Date.now()),e.logger.log("[ActionCable]",...t))}};const i=()=>(new Date).getTime(),s=t=>(i()-t)/1e3;class o{constructor(t){this.visibilityDidChange=this.visibilityDidChange.bind(this),this.connection=t,this.reconnectAttempts=0}start(){this.isRunning()||(this.startedAt=i(),delete this.stoppedAt,this.startPolling(),addEventListener("visibilitychange",this.visibilityDidChange),n.log(`ConnectionMonitor started. stale threshold = ${this.constructor.staleThreshold} s`))}stop(){this.isRunning()&&(this.stoppedAt=i(),this.stopPolling(),removeEventListener("visibilitychange",this.visibilityDidChange),n.log("ConnectionMonitor stopped"))}isRunning(){return this.startedAt&&!this.stoppedAt}recordMessage(){this.pingedAt=i()}recordConnect(){this.reconnectAttempts=0,delete this.disconnectedAt,n.log("ConnectionMonitor recorded connect")}recordDisconnect(){this.disconnectedAt=i(),n.log("ConnectionMonitor recorded disconnect")}startPolling(){this.stopPolling(),this.poll()}stopPolling(){clearTimeout(this.pollTimeout)}poll(){this.pollTimeout=setTimeout((()=>{this.reconnectIfStale(),this.poll()}),this.getPollInterval())}getPollInterval(){const{staleThreshold:t,reconnectionBackoffRate:e}=this.constructor;return 1e3*t*Math.pow(1+e,Math.min(this.reconnectAttempts,10))*(1+(0===this.reconnectAttempts?1:e)*Math.random())}reconnectIfStale(){this.connectionIsStale()&&(n.log(`ConnectionMonitor detected stale connection. reconnectAttempts = ${this.reconnectAttempts}, time stale = ${s(this.refreshedAt)} s, stale threshold = ${this.constructor.staleThreshold} s`),this.reconnectAttempts++,this.disconnectedRecently()?n.log(`ConnectionMonitor skipping reopening recent disconnect. time disconnected = ${s(this.disconnectedAt)} s`):(n.log("ConnectionMonitor reopening"),this.connection.reopen()))}get refreshedAt(){return this.pingedAt?this.pingedAt:this.startedAt}connectionIsStale(){return s(this.refreshedAt)>this.constructor.staleThreshold}disconnectedRecently(){return this.disconnectedAt&&s(this.disconnectedAt)<this.constructor.staleThreshold}visibilityDidChange(){"visible"===document.visibilityState&&setTimeout((()=>{!this.connectionIsStale()&&this.connection.isOpen()||(n.log(`ConnectionMonitor reopening stale connection on visibilitychange. visibilityState = ${document.visibilityState}`),this.connection.reopen())}),200)}}o.staleThreshold=6,o.reconnectionBackoffRate=.15;var r={message_types:{welcome:"welcome",disconnect:"disconnect",ping:"ping",confirmation:"confirm_subscription",rejection:"reject_subscription"},disconnect_reasons:{unauthorized:"unauthorized",invalid_request:"invalid_request",server_restart:"server_restart",remote:"remote"},default_mount_path:"/cable",protocols:["actioncable-v1-json","actioncable-unsupported"]};const{message_types:c,protocols:h}=r,l=h.slice(0,h.length-1),u=[].indexOf;class a{constructor(t){this.open=this.open.bind(this),this.consumer=t,this.subscriptions=this.consumer.subscriptions,this.monitor=new o(this),this.disconnected=!0}send(t){return!!this.isOpen()&&(this.webSocket.send(JSON.stringify(t)),!0)}open(){if(this.isActive())return n.log(`Attempted to open WebSocket, but existing socket is ${this.getState()}`),!1;{const t=[...h,...this.consumer.subprotocols||[]];return n.log(`Opening WebSocket, current state is ${this.getState()}, subprotocols: ${t}`),this.webSocket&&this.uninstallEventHandlers(),this.webSocket=new e.WebSocket(this.consumer.url,t),this.installEventHandlers(),this.monitor.start(),!0}}close({allowReconnect:t}={allowReconnect:!0}){if(t||this.monitor.stop(),this.isOpen())return this.webSocket.close()}reopen(){if(n.log(`Reopening WebSocket, current state is ${this.getState()}`),!this.isActive())return this.open();try{return this.close()}catch(t){n.log("Failed to reopen WebSocket",t)}finally{n.log(`Reopening WebSocket in ${this.constructor.reopenDelay}ms`),setTimeout(this.open,this.constructor.reopenDelay)}}getProtocol(){if(this.webSocket)return this.webSocket.protocol}isOpen(){return this.isState("open")}isActive(){return this.isState("open","connecting")}triedToReconnect(){return this.monitor.reconnectAttempts>0}isProtocolSupported(){return u.call(l,this.getProtocol())>=0}isState(...t){return u.call(t,this.getState())>=0}getState(){if(this.webSocket)for(let t in e.WebSocket)if(e.WebSocket[t]===this.webSocket.readyState)return t.toLowerCase();return null}installEventHandlers(){for(let t in this.events){const e=this.events[t].bind(this);this.webSocket[`on${t}`]=e}}uninstallEventHandlers(){for(let t in this.events)this.webSocket[`on${t}`]=function(){}}}a.reopenDelay=500,a.prototype.events={message(t){if(!this.isProtocolSupported())return;const{identifier:e,message:i,reason:s,reconnect:o,type:r}=JSON.parse(t.data);switch(this.monitor.recordMessage(),r){case c.welcome:return this.triedToReconnect()&&(this.reconnectAttempted=!0),this.monitor.recordConnect(),this.subscriptions.reload();case c.disconnect:return n.log(`Disconnecting. Reason: ${s}`),this.close({allowReconnect:o});case c.ping:return null;case c.confirmation:return this.subscriptions.confirmSubscription(e),this.reconnectAttempted?(this.reconnectAttempted=!1,this.subscriptions.notify(e,"connected",{reconnected:!0})):this.subscriptions.notify(e,"connected",{reconnected:!1});case c.rejection:return this.subscriptions.reject(e);default:return this.subscriptions.notify(e,"received",i)}},open(){if(n.log(`WebSocket onopen event, using '${this.getProtocol()}' subprotocol`),this.disconnected=!1,!this.isProtocolSupported())return n.log("Protocol is unsupported. Stopping monitor and disconnecting."),this.close({allowReconnect:!1})},close(t){if(n.log("WebSocket onclose event"),!this.disconnected)return this.disconnected=!0,this.monitor.recordDisconnect(),this.subscriptions.notifyAll("disconnected",{willAttemptReconnect:this.monitor.isRunning()})},error(){n.log("WebSocket onerror event")}};class d{constructor(t,e={},n){this.consumer=t,this.identifier=JSON.stringify(e),function(t,e){if(null!=e)for(let n in e){const i=e[n];t[n]=i}}(this,n)}perform(t,e={}){return e.action=t,this.send(e)}send(t){return this.consumer.send({command:"message",identifier:this.identifier,data:JSON.stringify(t)})}unsubscribe(){return this.consumer.subscriptions.remove(this)}}class p{constructor(t){this.subscriptions=t,this.pendingSubscriptions=[]}guarantee(t){-1==this.pendingSubscriptions.indexOf(t)?(n.log(`SubscriptionGuarantor guaranteeing ${t.identifier}`),this.pendingSubscriptions.push(t)):n.log(`SubscriptionGuarantor already guaranteeing ${t.identifier}`),this.startGuaranteeing()}forget(t){n.log(`SubscriptionGuarantor forgetting ${t.identifier}`),this.pendingSubscriptions=this.pendingSubscriptions.filter((e=>e!==t))}startGuaranteeing(){this.stopGuaranteeing(),this.retrySubscribing()}stopGuaranteeing(){clearTimeout(this.retryTimeout)}retrySubscribing(){this.retryTimeout=setTimeout((()=>{this.subscriptions&&"function"==typeof this.subscriptions.subscribe&&this.pendingSubscriptions.map((t=>{n.log(`SubscriptionGuarantor resubscribing ${t.identifier}`),this.subscriptions.subscribe(t)}))}),500)}}class g{constructor(t){this.consumer=t,this.guarantor=new p(this),this.subscriptions=[]}create(t,e){const n="object"==typeof t?t:{channel:t},i=new d(this.consumer,n,e);return this.add(i)}add(t){return this.subscriptions.push(t),this.consumer.ensureActiveConnection(),this.notify(t,"initialized"),this.subscribe(t),t}remove(t){return this.forget(t),this.findAll(t.identifier).length||this.sendCommand(t,"unsubscribe"),t}reject(t){return this.findAll(t).map((t=>(this.forget(t),this.notify(t,"rejected"),t)))}forget(t){return this.guarantor.forget(t),this.subscriptions=this.subscriptions.filter((e=>e!==t)),t}findAll(t){return this.subscriptions.filter((e=>e.identifier===t))}reload(){return this.subscriptions.map((t=>this.subscribe(t)))}notifyAll(t,...e){return this.subscriptions.map((n=>this.notify(n,t,...e)))}notify(t,e,...n){let i;return i="string"==typeof t?this.findAll(t):[t],i.map((t=>"function"==typeof t[e]?t[e](...n):void 0))}subscribe(t){this.sendCommand(t,"subscribe")&&this.guarantor.guarantee(t)}confirmSubscription(t){n.log(`Subscription confirmed ${t}`),this.findAll(t).map((t=>this.guarantor.forget(t)))}sendCommand(t,e){const{identifier:n}=t;return this.consumer.send({command:e,identifier:n})}}class b{constructor(t){this._url=t,this.subscriptions=new g(this),this.connection=new a(this),this.subprotocols=[]}get url(){return f(this._url)}send(t){return this.connection.send(t)}connect(){return this.connection.open()}disconnect(){return this.connection.close({allowReconnect:!1})}ensureActiveConnection(){if(!this.connection.isActive())return this.connection.open()}addSubProtocol(t){this.subprotocols=[...this.subprotocols,t]}}function f(t){if("function"==typeof t&&(t=t()),t&&!/^wss?:/i.test(t)){const e=document.createElement("a");return e.href=t,e.href=e.href,e.protocol=e.protocol.replace("http","ws"),e.href}return t}function m(t){const e=document.head.querySelector(`meta[name='action-cable-${t}']`);if(e)return e.getAttribute("content")}t.Connection=a,t.ConnectionMonitor=o,t.Consumer=b,t.INTERNAL=r,t.Subscription=d,t.SubscriptionGuarantor=p,t.Subscriptions=g,t.adapters=e,t.createConsumer=function(t=m("url")||r.default_mount_path){return new b(t)},t.createWebSocketURL=f,t.getConfig=m,t.logger=n,Object.defineProperty(t,"__esModule",{value:!0})}));




////////////////////////////////////////////////////////////////////
// timeago https://timeago.org
////////////////////////////////////////////////////////////////////

!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define(e):t.timeago=e()}(this,function(){"use strict";var t="second_minute_hour_day_week_month_year".split("_"),e="秒_分钟_小时_天_周_月_年".split("_"),n=[60,60,24,7,365/7/12,12],r={en:function(e,n){if(0===n)return["just now","right now"];var r=t[parseInt(n/2)];return e>1&&(r+="s"),[e+" "+r+" ago","in "+e+" "+r]},zh_CN:function(t,n){if(0===n)return["刚刚","片刻后"];var r=e[parseInt(n/2)];return[t+" "+r+"前",t+" "+r+"后"]}},a=function(t){return parseInt(t)},i=function(t){return t instanceof Date?t:!isNaN(t)||/^\d+$/.test(t)?new Date(a(t)):(t=(t||"").trim().replace(/\.\d+/,"").replace(/-/,"/").replace(/-/,"/").replace(/(\d)T(\d)/,"$1 $2").replace(/Z/," UTC").replace(/([\+\-]\d\d)\:?(\d\d)/," $1$2"),new Date(t))},o=function(t,e,i){e=r[e]?e:r[i]?i:"en";for(var o=0,u=t<0?1:0,c=t=Math.abs(t);t>=n[o]&&o<n.length;o++)t/=n[o];return(t=a(t))>(0===(o*=2)?9:1)&&(o+=1),r[e](t,o,c)[u].replace("%s",t)},u=function(t,e){return((e=e?i(e):new Date)-i(t))/1e3},c=function(t,e){return t.getAttribute?t.getAttribute(e):t.attr?t.attr(e):void 0},f=function(t){return c(t,"data-timeago")||c(t,"datetime")},d=[],l=function(t){t&&(clearTimeout(t),delete d[t])},s=function(t){if(t)l(c(t,"data-tid"));else for(var e in d)l(e)},h=function(){function t(t,e){for(var n=0;n<e.length;n++){var r=e[n];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,r.key,r)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}();var p=function(){function t(e,n){!function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}(this,t),this.nowDate=e,this.defaultLocale=n||"en"}return h(t,[{key:"setLocale",value:function(t){this.defaultLocale=t}},{key:"doRender",value:function(t,e,r){var a=this,i=u(e,this.nowDate);t.innerHTML=o(i,r,this.defaultLocale);var c=function(t,e){var n=setTimeout(function(){l(n),t()},e);return d[n]=0,n}(function(){a.doRender(t,e,r)},Math.min(1e3*function(t){for(var e=1,r=0,a=Math.abs(t);t>=n[r]&&r<n.length;r++)t/=n[r],e*=n[r];return a=(a%=e)?e-a:e,Math.ceil(a)}(i),2147483647));!function(t,e){t.setAttribute?t.setAttribute("data-tid",e):t.attr&&t.attr("data-tid",e)}(t,c)}},{key:"render",value:function(t,e){void 0===t.length&&(t=[t]);for(var n=void 0,r=0,a=t.length;r<a;r++)n=t[r],s(n),this.doRender(n,f(n),e)}},{key:"format",value:function(t,e){return o(u(t,this.nowDate),e,this.defaultLocale)}}]),t}(),v=function(t,e){return new p(t,e)};return v.register=function(t,e){r[t]=e},v.cancel=s,v});







////////////////////////////////////////////////////////////////////
// Fin.
////////////////////////////////////////////////////////////////////
