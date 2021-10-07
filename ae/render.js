

window.addEventListener('DOMContentLoaded', function() {
    var canvas = document.getElementById('canvas');
    var engine = new BABYLON.Engine(canvas, true);

    var createScene = function() {
        // Create a basic BJS Scene object.
        var scene = new BABYLON.Scene(engine);

        // Clear color
        scene.clearColor = new BABYLON.Color3(.15, .15, .15);
        
        // Create a FreeCamera, and set its position to (x:0, y:5, z:-10).
        // var camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 5,-5), scene);
        var camera = new BABYLON.VRDeviceOrientationFreeCamera('camera', new BABYLON.Vector3(10, 15,-15), scene);
        
        // Target the camera to scene origin.
        camera.setTarget(BABYLON.Vector3.Zero());
        
        
        // console.log(camera.position);
        // camera.position.z = -5;
        // camera.position.x = -5;
        // console.log(camera.position);
        // var vrHelper = scene.createDefaultVRExperience();
        
                var vrHelper = scene.createDefaultVRExperience();
          
                // vrHelper.useMultiview = false; // multiview true is faster
                // vrHelper.createDeviceOrientationCamera = false;
                // vrHelper.createFallbackVRDeviceOrientationFreeCamera = false;
                // vrHelper.defaultLightingOnControllers = false;
            
                // camera = null;
                // // // Create a WebVR camera with the trackPosition property set to false so that we can control movement with the gamepad
                // camera = new BABYLON.WebVRFreeCamera("vrcamera", new BABYLON.Vector3(0, 14, 0), scene, true, { trackPosition: false });
                
        
        
        // Attach the camera to the canvas.
        camera.attachControl(canvas, true);

        camera.inputs.add(new BABYLON.FreeCameraGamepadInput());
        camera.inputs.attached.gamepad.gamepadAngularSensibility *= -1;
        console.log(camera.inputs.attached.gamepad);



//         scene.onPointerDown = function () {
//             scene.onPointerDown = undefined
//             camera.attachControl(canvas, true);
//         }
//         let button = document.getElementById('vrButton');
//         function attachWebVR() {
//             camera.attachControl(canvas, true);
//             window.removeEventListener('click', attachWebVR, false);
//             console.log("wowee");
//         }

// button.addEventListener('click', attachWebVR, false );



        // Create a basic light, aiming 0,1,0 - meaning, to the sky.
        // var light = new BABYLON.HemisphericLight('light1', new BABYLON.Vector3(0,1,0), scene);
        var light = new BABYLON.DirectionalLight("DirectionalLight", new BABYLON.Vector3(-.5, -1, -1.25), scene);
        light.intensity = .8;
        light.position.y = 55;

    
        // Create a built-in "ground" shape.
        var ground = BABYLON.MeshBuilder.CreateGround('ground1', {height:16, width:16, subdivisions: 2}, scene);
        ground.position.y = -2;

        var matGrass = new BABYLON.StandardMaterial("matGrass", scene);
        matGrass.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.4);
        // matGrass.texture
        var grass = "./untitled-q.png";
        matGrass.emissiveTexture = new BABYLON.Texture(grass, scene);
        // gfx.matGrass.emissiveColor = new BABYLON.Color3(0.01,0.01,0.01);
        matGrass.ambientTexture = new BABYLON.Texture(grass, scene);



        var matChaos = new BABYLON.StandardMaterial("matGrass", scene);
        matChaos.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.4);
        // matGrass.texture
        var grass2 = "./sphere-q.jpg";
        matChaos.emissiveTexture = new BABYLON.Texture(grass2, scene);
        // gfx.matGrass.emissiveColor = new BABYLON.Color3(0.01,0.01,0.01);
        matChaos.ambientTexture = new BABYLON.Texture(grass2, scene);
        matChaos.wireframe = true;

        ground.material = matGrass;
        ground.receiveShadows = true;




        var tetrahedron = BABYLON.MeshBuilder.CreatePolyhedron("tetrahedron", {type: 0, size: .01}, scene);
        tetrahedron.position.y = 2;

        for (var ix=-10;ix<10;ix+=.5) {
          for (var iz=-10;iz<10;iz+=.5){
            tt = tetrahedron.createInstance();
            tt.position.x = ix;
            tt.position.y = Math.cos(ix)+Math.sin(iz);
            tt.position.z = iz;
          }
        }
        

        // Create a built-in "sphere" shape. 
        var sphere = BABYLON.MeshBuilder.CreateIcoSphere("icosphere", {radius:1, subdivisions:3}, scene);
        // var ico2 = BABYLON.MeshBuilder.CreateIcoSphere("icosphere", {radius:.005, subdivisions: 2}, scene);
        // ico2.position.x = -1
        sphere.material = matChaos;

        
        var shadowGenerator00 = new BABYLON.ShadowGenerator(512, light);
        shadowGenerator00.getShadowMap().renderList.push(sphere); 
        shadowGenerator00.useBlurExponentialShadowMap = true;

        // Return the created scene.
        return scene;

        
    }

    
    var scene = createScene();

    engine.runRenderLoop(function() {
        scene.render();
    });

    window.addEventListener('resize', function() {
        engine.resize();
    });
    window.addEventListener('orientationchange', engine.resize, false);

    // alert("WHAMMO");
});
