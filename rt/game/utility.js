











Function.prototype.debounce = function (threshold, execAsap) {
  let func = this, timeout;
  return function debounced() {
      let obj = this, args = arguments;
      function delayed() {
          if (!execAsap) func.apply(obj, args);
          timeout = null;
      }
      if (timeout) clearTimeout(timeout);
      else if (execAsap) func.apply(obj, args);
      timeout = setTimeout(delayed, threshold || 100);
  };
};




