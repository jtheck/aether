#!/bin/sh
# Optional Steam wrapper. Partner launch executable should be Aether (ELF).
# To use this script: executable /bin/sh, arguments Aether.sh, OS Linux.
set -e
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$HERE"

if [ ! -x "$HERE/Aether" ]; then
  chmod +x "$HERE/Aether" 2>/dev/null || true
fi
if [ -f "$HERE/package.nw/node-steam/node" ] && [ ! -x "$HERE/package.nw/node-steam/node" ]; then
  chmod +x "$HERE/package.nw/node-steam/node" 2>/dev/null || true
fi

if [ -d "$HERE/lib" ]; then
  LD_LIBRARY_PATH="$HERE:$HERE/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
else
  LD_LIBRARY_PATH="$HERE${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
export LD_LIBRARY_PATH
export CHROME_DEVEL_SANDBOX=""

# X11 + Vulkan ANGLE — Chromium WebGPU on Linux is off without these.
exec "$HERE/Aether" \
  --ozone-platform=x11 \
  --no-sandbox \
  --disable-gpu-sandbox \
  --enable-unsafe-webgpu \
  --enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE \
  --use-angle=vulkan \
  --ignore-gpu-blocklist \
  "$@"
