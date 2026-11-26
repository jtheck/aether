'use strict';

window.addEventListener('error', function (event) {
  var detail = event.error && event.error.stack ? event.error.stack : event.message;
  console.error('[frame-launch:error]', detail);
}, true);

try {
  chrome.app.window.create('frame.html', {
    id: 'aether-frame',
    state: 'fullscreen',
    innerBounds: {
      width: 1280,
      height: 720,
      minWidth: 320,
      minHeight: 240,
    },
  });
} catch (error) {
  console.error('[frame-launch:open]', error && error.stack ? error.stack : error);
}
