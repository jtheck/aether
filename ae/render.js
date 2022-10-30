
var xx;

window.addEventListener('DOMContentLoaded', function() {
  var canvas = document.getElementById('canvas');
  var engine = new BABYLON.Engine(canvas, true);
  var scene;

    
  let xrButton = document.getElementById('xr_button');
  xrButton.addEventListener('click', startXR, false );

  document.onkeydown = function(evt) {
    if (evt.key == "Escape") {
      xrHelper.exitXRAsync();
    }
  };


  var createScene = async function() {
    // Create a basic BJS Scene object.
    scene = new BABYLON.Scene(engine);

    // Clear color
    scene.clearColor = new BABYLON.Color3(.15, .15, .15);
    

    // Create a FreeCamera, and set its position to (x:0, y:5, z:-10).
    var camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 5,-5), scene);
    // var camera2 = new BABYLON.VRDeviceOrientationFreeCamera('camera2', new BABYLON.Vector3(10, 15,-15), scene);

    // Target the camera to scene origin.
    camera.setTarget(BABYLON.Vector3.Zero());
    camera.attachControl(canvas, true);
    

    // Create a basic light, aiming 0,1,0 - meaning, to the sky.
    // var light = new BABYLON.HemisphericLight('light1', new BABYLON.Vector3(0,1,0), scene);
    var light = new BABYLON.DirectionalLight("DirectionalLight", new BABYLON.Vector3(-.5, -1, -1.25), scene);
    light.intensity = .8;
    light.position.y = 55;


    var grounds = [];
    // Create a built-in "ground" shape.
    var ground = BABYLON.MeshBuilder.CreateGround('ground', {height:42, width:42, subdivisions: 2}, scene);
    ground.position.y = -2;
    grounds.push(ground);

    var ground = BABYLON.MeshBuilder.CreateGround('roof', {height:16, width:16, subdivisions: 2}, scene);
    ground.position.y = 16;
    ground.rotation.x = 3.14;
    grounds.push(ground);


    var ground = BABYLON.MeshBuilder.CreateGround('ground1', {height:50, width:50, subdivisions: 2}, scene);
    ground.position.y = -4;
    ground.position.x = 32;
    ground.rotation.z = 1;
    grounds.push(ground);

    var ground = BABYLON.MeshBuilder.CreateGround('ground1', {height:50, width:50, subdivisions: 2}, scene);
    ground.position.y = -4;
    ground.position.x = -32;
    ground.rotation.z = -1;
    grounds.push(ground);
    
    var ground = BABYLON.MeshBuilder.CreateGround('ground1', {height:50, width:50, subdivisions: 2}, scene);
    ground.position.y = -4;
    ground.position.z = 32;
    ground.rotation.x = -1;
    grounds.push(ground);
    
    var ground = BABYLON.MeshBuilder.CreateGround('ground1', {height:50, width:50, subdivisions: 2}, scene);
    ground.position.y = -4;
    ground.position.z = -32;
    ground.rotation.x = 1;
    grounds.push(ground);


    var matGrass = new BABYLON.StandardMaterial("matGrass", scene);
    matGrass.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.4);
    // matGrass.texture
    var grass = "./untitled-q.png";
    matGrass.emissiveTexture = new BABYLON.Texture(grass, scene);
    // gfx.matGrass.emissiveColor = new BABYLON.Color3(0.01,0.01,0.01);
    matGrass.ambientTexture = new BABYLON.Texture(grass, scene);



    var matChaos = new BABYLON.StandardMaterial("matChaos", scene);
    matChaos.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.4);
    // matGrass.texture
    var grass2 = "./sphere-q.jpg";
    matChaos.emissiveTexture = new BABYLON.Texture(grass2, scene);
    // gfx.matGrass.emissiveColor = new BABYLON.Color3(0.01,0.01,0.01);
    matChaos.ambientTexture = new BABYLON.Texture(grass2, scene);
    matChaos.wireframe = true;

    for(var i=0; i<grounds.length; i++){
      ground = grounds[i];
      ground.material = matGrass;
      ground.receiveShadows = true;
      // teleporter.addFloorMesh(ground);
    }




    var tetrahedron = BABYLON.MeshBuilder.CreatePolyhedron("tetrahedron", {type: 0, size: .03}, scene);
    tetrahedron.position.y = 2;
    mQ = [];
    for (var ix=-10;ix<10;ix+=.75) {
      for (var iz=-10;iz<10;iz+=.75){
        tt = tetrahedron.createInstance();
        tt.position.x = ix;
        tt.position.y = Math.cos(ix)+Math.sin(iz);
        tt.position.z = iz;
        mQ.push(tt);
      }
    }
    

    // Create a built-in "sphere" shape. 
    var sphere = BABYLON.MeshBuilder.CreateIcoSphere("icosphere", {radius:1, subdivisions:3}, scene);
    // var ico2 = BABYLON.MeshBuilder.CreateIcoSphere("icosphere", {radius:.005, subdivisions: 2}, scene);
    // ico2.position.x = -1
    sphere.material = matChaos;

    var sphere = BABYLON.MeshBuilder.CreateIcoSphere("icosphere", {radius:1, subdivisions:3}, scene);
    sphere.position.y = 14;
    sphere.material = matChaos;

    
    var shadowGenerator00 = new BABYLON.ShadowGenerator(512, light);
    shadowGenerator00.getShadowMap().renderList.push(sphere); 
    shadowGenerator00.useBlurExponentialShadowMap = true;


    // Return the created scene.
    return scene;
  }

  let mQ = [];
  let gY = 0;



  var scene;// = createScene();
  var xrHelper;
  var xrSession;
  var xrCam;
  var xrFeatures;

var axes;
var squeeze;

  xx = function(){
    return xrCam;
  }

  // scene.beforeRender(function(){
  //   gY++;
  //   for(var i=0;i<mQ.length; i++){
  //     var tt = mQ[i]
  //     tt.position.y = tt.position.y + gY;
  //   }
  // });


  async function begin(){
    scene = await createScene();

    tryXR();

    engine.runRenderLoop(function() {
      
      if (axes){

        if (axes.x > 0){
          xrCam.cameraRotation.y += .02*axes.x;
        }
      if (axes.x < 0){
        xrCam.cameraRotation.y += .02*axes.x;
      }
      var s = .5;
      if (axes.y > 0){
        xrCam.position.addInPlace(xrCam.getForwardRay().direction.multiplyByFloats(s,s,s));
      }
      if (axes.y < 0){
        xrCam.position.subtractInPlace(xrCam.getForwardRay().direction.multiplyByFloats(s,s,s));
      }
      
    }
    if (squeeze){

      if (squeeze.pressed) {
        // console.log("sqee");
      }
    }



      gY+=.00314;
      for(var i=0;i<mQ.length; i++){
        var tt = mQ[i];
        tt.position.y = Math.cos(tt.position.x+gY)+Math.sin(tt.position.z+gY);
      }
      // console.log(scene)
      scene.render();
    });

  }

  begin();


  async function startXR(){
    xrSession = await xrHelper.enterXRAsync("immersive-vr", "local-floor" /*, optionalRenderTarget */ );
  }


  async function tryXR() {
    // Check XR support
    xrHelper = await BABYLON.WebXRExperienceHelper.CreateAsync(scene);

    var hasXR = await xrHelper.sessionManager.isSessionSupportedAsync("immersive-vr");

    if(hasXR){
      xrButton.style.display = "block";
      xrFeatures = xrHelper.featuresManager;
      xrCam = xrHelper.camera;

      const controllers = new BABYLON.WebXRInput(xrHelper.sessionManager, xrHelper.camera);
      const xrayPointer = new BABYLON.WebXRControllerPointerSelection(xrHelper.sessionManager, {
        disablePointerUpOnTouchOut: false,
        disableScenePointerVectorUpdate: false,
        forceGazeMode: false,
        xrInput: controllers,
      });
      xrayPointer.attach();
      //controller input
      controllers.onControllerAddedObservable.add((controller) => {
        
        // console.log(controller);
        controller.onMotionControllerInitObservable.add((motionController) => {
          const xr_ids = motionController.getComponentIds();
          console.log(xr_ids)
          // 0 "xr-standard-trigger"
          // 1 "xr-standard-squeeze"
          // 2 "xr-standard-thumbstick"
          // 3 "a-button"
          // 4 "b-button"
          // 5 "thumbrest"
          if (motionController.handness === 'right') {

            let triggerComponent = motionController.getComponent(xr_ids[0]);//xr-standard-trigger
            triggerComponent.onButtonStateChangedObservable.add(() => {
              squeeze = triggerComponent;
                if (triggerComponent.pressed) {
                  console.log("boop")
                }else{
                }
            });
            let squeezeComponent = motionController.getComponent(xr_ids[2]);//xr-standard-thumbstick
            squeezeComponent.onButtonStateChangedObservable.add(() => {
                if (squeezeComponent.isAxes()) {
                  // we have axes data
                  axes = squeezeComponent.axes;
                }

                if (squeezeComponent.pressed) {
                  console.log("beep")
                }else{
                }
            });
            let squeezeComponent2 = motionController.getComponent(xr_ids[5]);//thumbrest
            squeezeComponent2.onButtonStateChangedObservable.add(() => {
                if (squeezeComponent2.pressed) {
                  console.log("bang")
                    // Box_Left_Squeeze.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                }else{
                    // Box_Left_Squeeze.scaling=new BABYLON.Vector3(1,1,1);
                }
            });
          }

          //     /*
          //     let rotationValue = 0;
          //     const matrix = new BABYLON.Matrix();
          //     let deviceRotationQuaternion = webXRInput.xrCamera.getDirection(BABYLON.Axis.Z).toQuaternion(); // webXRInput.xrCamera.rotationQuaternion;
          //     var angle = rotationValue * (Math.PI / 8);
          //     var quaternion = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, angle);
          //     const move = new BABYLON.Vector3(0,0,0);
          //     deviceRotationQuaternion = deviceRotationQuaternion.multiply(quaternion);
          //     BABYLON.Matrix.FromQuaternionToRef(deviceRotationQuaternion, matrix);
          //     const addPos = BABYLON.Vector3.TransformCoordinates(move, matrix);
          //     addPos.y = 0;

          //     webXRInput.xrCamera.position = webXRInput.xrCamera.position.add(addPos);
          //     // webXRInput.xrCamera.rotationQuaternion = BABYLON.Quaternion.Identity();
              
          //     //webXRInput.xrCamera.rotation = new BABYLON.Vector3(0,0,0);
          //     */
          //     //Box_Left_ThumbStick is moving according to stick axes but camera rotation is also changing..
          //     // Box_Left_ThumbStick.position.x += (axes.x)/100;
          //   //  Box_Left_ThumbStick.position.y -= (axes.y)/100;
          //     // console.log(values.x, values.y);
          // });

        })

    });




  
      // console.log(controllers);
      controllers.onControllerAddedObservable.add((controller) => {

        console.log(controller);

      });
      // console.log(xrHelper);
      // console.log(xrFeatures);
      // console.log(xrFeatures.GetAvailableFeatures());
      // console.log("XR supported!");
    }else{
      // console.log("No XR support.");
    }

    return xrHelper;
  };




  window.addEventListener('resize', function() {
    engine.resize();
  });
  window.addEventListener('orientationchange', engine.resize, false);

  var log = function (log) {
    log = JSON.stringify(log) + '<br />';
    document.getElementById("console_log").innerHTML += log; 
  };
});
