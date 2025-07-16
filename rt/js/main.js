// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function() {
  // Get the canvas element
  const canvas = document.getElementById('rt-canvas');
  
  // Create the Babylon engine
  const engine = new BABYLON.Engine(canvas, true);
  
  // Create the scene
  const scene = new BABYLON.Scene(engine);
  
  // Create camera - RTS overhead view
  const camera = new BABYLON.ArcRotateCamera('camera', 0, Math.PI / 4, 25, BABYLON.Vector3.Zero(), scene);
  camera.detachControl(canvas); // Disable automatic camera controls
  camera.lowerRadiusLimit = 8;
  camera.upperRadiusLimit = 100; // Much further zoom out
  camera.lowerAlphaLimit = -Math.PI / 3; // More horizontal freedom
  camera.upperAlphaLimit = Math.PI / 3;
  
  // RTS-style camera controls
  camera.panningSensibility = 1000; // Faster panning
  camera.wheelPrecision = 50; // Faster zoom
  camera.angularSensibilityX = 1000; // Faster horizontal rotation
  camera.angularSensibilityY = 1000; // Faster vertical rotation
  
  // Enable panning with middle mouse button
  camera.panningInertia = 0.9;
  camera.panningAxis = new BABYLON.Vector3(1, 0, 1); // Only pan on X and Z
  
  // Create lights
  const ambientLight = new BABYLON.HemisphericLight('ambientLight', new BABYLON.Vector3(0, 1, 0), scene);
  ambientLight.intensity = 0.3; // Reduced ambient for better contrast
  
  // Create main directional light for terrain relief (default: ON)
  const directionalLight = new BABYLON.DirectionalLight('directionalLight', new BABYLON.Vector3(-1, -2, -1), scene);
  directionalLight.intensity = 1.2; // Increased intensity
  directionalLight.position = new BABYLON.Vector3(30, 30, 30);
  
  // Add shadows for better depth perception
  directionalLight.shadowMinZ = 0.1;
  directionalLight.shadowMaxZ = 100;
  directionalLight.shadowOrthoScale = 0.1;
  
  // Create a secondary fill light for better illumination
  const fillLight = new BABYLON.DirectionalLight('fillLight', new BABYLON.Vector3(1, -1, 1), scene);
  fillLight.intensity = 0.4;
  fillLight.position = new BABYLON.Vector3(-20, 15, -20);
  
  // Create a point light for dynamic lighting effects
  const pointLight = new BABYLON.PointLight('pointLight', new BABYLON.Vector3(0, 10, 0), scene);
  pointLight.intensity = 0.6;
  pointLight.range = 50;
  pointLight.diffuse = new BABYLON.Color3(1, 0.9, 0.8); // Warm light
  pointLight.specular = new BABYLON.Color3(1, 0.9, 0.8);
  
  // Store lights for UI control
  scene.directionalLight = directionalLight;
  scene.fillLight = fillLight;
  scene.ambientLight = ambientLight;
  scene.pointLight = pointLight;
  
  // Initialize FPS meter
  const fpsMeter = new FPSMeter(scene);
  
  // Create game instance
  const game = new Game(scene, engine);
  
  // Create UI instances
  const ui = new UI(game);
  const onScreenUI = new OnScreenUI(game);
  
  // Start the game
  game.start();
  
  // Start the render loop
  engine.runRenderLoop(() => {
    scene.render();
    onScreenUI.update();
  });
  
  // Handle window resize
  window.addEventListener('resize', () => {
    engine.resize();
  });
  
  // RTS-style keyboard controls
  const keys = {};
  window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
  });
  
  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });
  
  // Add keyboard camera movement to game loop
  scene.registerBeforeRender(() => {
    const moveSpeed = 0.5;
    const zoomSpeed = 0.02;
    
    // Animate point light for dynamic lighting
    if (scene.pointLight && scene.pointLight.intensity > 0) {
      const time = Date.now() * 0.001;
      scene.pointLight.position.x = Math.sin(time * 0.5) * 15;
      scene.pointLight.position.z = Math.cos(time * 0.3) * 15;
      scene.pointLight.position.y = 8 + Math.sin(time * 0.7) * 2;
    }
    
    // ESDF movement (superior to WASD!) + WASD for accessibility
    if (keys['e'] || keys['w'] || keys['arrowup']) {
      camera.target.z -= moveSpeed;
    }
    if (keys['d'] || keys['s'] || keys['arrowdown']) {
      camera.target.z += moveSpeed;
    }
    if (keys['s'] || keys['a'] || keys['arrowleft']) {
      camera.target.x -= moveSpeed;
    }
    if (keys['f'] || keys['d'] || keys['arrowright']) {
      camera.target.x += moveSpeed;
    }
    
    // RQ for zoom (R for zoom in, Q for zoom out)
    if (keys['r']) {
      camera.radius += zoomSpeed * camera.radius;
    }
    if (keys['q']) {
      camera.radius -= zoomSpeed * camera.radius;
    }
    
    // Space to reset camera
    if (keys[' ']) {
      camera.target = new BABYLON.Vector3(0, 0, 0);
      camera.radius = 25;
      camera.alpha = 0;
      camera.beta = Math.PI / 4;
    }
  });
});
