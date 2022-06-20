

window.addEventListener('DOMContentLoaded', function() {
    var canvas = document.getElementById('canvas');
    var engine = new BABYLON.Engine(canvas, true);
    var scene;
    var createScene = function() {
        // Create a basic BJS Scene object.
        scene = new BABYLON.Scene(engine);

        // Clear color
        scene.clearColor = new BABYLON.Color3(.303, .303, .303);
        
        // const xrSupport = await BABYLON.WebXRSessionManager.IsSessionSupportedAsync('immersive-vr');
    
    
        const xrSession = new BABYLON.WebXRSessionManager(scene);
console.log(xrSession);

        // Create a FreeCamera, and set its position to (x:0, y:5, z:-10).
        var camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 5,-5), scene);
        // var camera2 = new BABYLON.VRDeviceOrientationFreeCamera('camera2', new BABYLON.Vector3(10, 15,-15), scene);
        var camera2 = new BABYLON.WebXRCamera('camera2', scene, xrSession);

        // Target the camera to scene origin.
        camera.setTarget(BABYLON.Vector3.Zero());
        camera.attachControl(canvas, true);
        
        // var teleporter = BABYLON.WebXRMotionControllerTeleportation(xrSessionManager);
        // const teleporter = xrSessionManager.enableFeature(BABYLON.WebXRMotionControllerTeleportation.Name, "latest");//, {
          // floorMeshes: [environment.ground],
// console.log(teleporter)
console.log(xrSession.referenceSpace);

const fm = new BABYLON.WebXRFeaturesManager(xrSession);
console.log(fm)
// const availableFeatures = fm.GetAvailableFeatures();
// console.log(availableFeatures)


          // console.log(camera.position);
        // camera.position.z = -5;
        // camera.position.x = -5;
        // console.log(camera.position);
                
        // camera = null;
        // // // Create a WebVR camera with the trackPosition property set to false so that we can control movement with the gamepad
        // camera = new BABYLON.WebVRFreeCamera("vrcamera", new BABYLON.Vector3(0, 14, 0), scene, true, { trackPosition: false });

        // camera.inputs.add(new BABYLON.FreeCameraGamepadInput());
        // camera.inputs.attached.gamepad.gamepadAngularSensibility *= -1;
        // console.log(camera.inputs.attached.gamepad);

        //         //keep transform between camera types
        //         // if scene.activeCamera is still the non-VR camera:
        // xrCamera.setTransformationFromNonVRCamera();
        // // Otherwise, provide the non-vr camera to copy the transformation from:
        // xrCamera.setTransformationFromNonVRCamera(otherCamera);
        // // If you want XR o also reset the XR Reference space, set the 2nd variable to true:
        // xrCamera.setTransformationFromNonVRCamera(otherCamera, true);
        
        // BABYLON.WebXRExperienceHelper.CreateAsync(scene).then((xrHelper) => {
        //     // great success
        //     console.log('xr!')
        //     console.log(xrHelper)
        // }, (error) => {
          //   console.log('no xr');
          //     // no xr...
        // })
 
        // const xrCamera = new BABYLON.WebXRCamera("nameOfCamera", scene, xrSessionManager);
        
        
        //         scene.onPointerDown = function () {
          //             scene.onPointerDown = undefined
          //             camera.attachControl(canvas, true);
          //         }
          

          
        let button = document.getElementById('vrButton');
        button.addEventListener('click', attachWebVR, false );

        function attachWebVR() {
          console.log(scene.activeCamera);
          if (scene.activeCamera==camera2) {
            camera2.detachControl();
            scene.activeCamera=camera;
            camera.attachControl(canvas, true);
          }
          else {

            camera.detachControl();
            scene.activeCamera=camera2;
            camera2.attachControl(canvas, true);
          }

            // window.removeEventListener('click', attachWebVR, false);
            // console.log("wowee");
            log('make xr')
        }



        // Create a basic light, aiming 0,1,0 - meaning, to the sky.
        // var light = new BABYLON.HemisphericLight('light1', new BABYLON.Vector3(0,1,0), scene);
        var light = new BABYLON.DirectionalLight("DirectionalLight", new BABYLON.Vector3(-.5, -1, -1.25), scene);
        light.intensity = .8;
        light.position.y = 55;

        var grounds = [];
        // Create a built-in "ground" shape.
        var ground = BABYLON.MeshBuilder.CreateGround('ground1', {height:16, width:16, subdivisions: 2}, scene);
        ground.position.y = -2;
        grounds.push(ground);

        var ground = BABYLON.MeshBuilder.CreateGround('ground1', {height:16, width:16, subdivisions: 2}, scene);
        ground.position.y = 16;
        ground.rotation.x = 3.14;
        grounds.push(ground);

        var ground = BABYLON.MeshBuilder.CreateGround('ground1', {height:16, width:16, subdivisions: 2}, scene);
        ground.position.y = -4;
        ground.position.x = 32;
        ground.rotation.z = 1;
        grounds.push(ground);

        var ground = BABYLON.MeshBuilder.CreateGround('ground1', {height:16, width:16, subdivisions: 2}, scene);
        ground.position.y = -4;
        ground.position.x = -32;
        ground.rotation.z = -1;
        grounds.push(ground);

        
        var ground = BABYLON.MeshBuilder.CreateGround('ground1', {height:16, width:16, subdivisions: 2}, scene);
        ground.position.y = -4;
        ground.position.z = 32;
        ground.rotation.x = -1;
        grounds.push(ground);
        
        var ground = BABYLON.MeshBuilder.CreateGround('ground1', {height:16, width:16, subdivisions: 2}, scene);
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




        var tetrahedron = BABYLON.MeshBuilder.CreatePolyhedron("tetrahedron", {type: 0, size: .01}, scene);
        tetrahedron.position.y = 2;
        mQ = [];
        for (var ix=-10;ix<10;ix+=.5) {
          for (var iz=-10;iz<10;iz+=.5){
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

    var scene = createScene();

    // scene.beforeRender(function(){
    //   gY++;
    //   for(var i=0;i<mQ.length; i++){
    //     var tt = mQ[i]
    //     tt.position.y = tt.position.y + gY;
    //   }
    // });

    engine.runRenderLoop(function() {
      gY+=.00314;
      for(var i=0;i<mQ.length; i++){
        var tt = mQ[i];
        tt.position.y = Math.cos(tt.position.x+gY)+Math.sin(tt.position.z+gY);
      }
        scene.render();
    });

    window.addEventListener('resize', function() {
        engine.resize();
    });
    window.addEventListener('orientationchange', engine.resize, false);

    // alert("WHAMMO");
    var log = function (log) {
      log = JSON.stringify(log) + '<br />';
      document.getElementById("console_log").innerHTML += log; 
    };
});
