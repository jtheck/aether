







const Mote = function(){
    // alert("bam");
}

var mote = new Mote();

  
// Check compatibility for the browser we're running this in
if ("serviceWorker" in navigator) {
    if (navigator.serviceWorker.controller) {
      console.log("sw active service worker found, no need to register");
    } else {
      // Register the service worker
      navigator.serviceWorker
        .register("sw-aether.js", {
          scope: "./"
        })
        .then(function (reg) {
          console.log("sw Service worker has been registered for scope: " + reg.scope);
        });
    }
  }