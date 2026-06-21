import{Y as a}from"./chunk-LFLB3D3T.js";var p="nme_lighting",w=`struct NmeLightResult {
    diffuse: vec3<f32>,
    specular: vec3<f32>,
    shadow: f32,
};

fn nme_computeLighting(
    worldPos: vec3<f32>,
    worldNormal: vec3<f32>,
    cameraPos: vec3<f32>,
    diffuseColor: vec3<f32>,
    specularColor: vec3<f32>,
    glossiness: f32,
    shadowFactors: array<f32, ${a}>
) -> NmeLightResult {
    var result: NmeLightResult;
    result.diffuse = vec3<f32>(0.0);
    result.specular = vec3<f32>(0.0);
    var aggShadow: f32 = 0.0;
    var numLights: f32 = 0.0;
    let viewDir = normalize(cameraPos - worldPos);
    let N = normalize(worldNormal);
     let lc = min(meshU.lc, ${a}u);
     for (var i: u32 = 0u; i < lc; i = i + 1u) {
        let lightIndex = nli(i);
        let L = nmeLights.lights[lightIndex];
        let t = u32(L.vLightData.w);
        let sh = shadowFactors[lightIndex];
        var lv: vec3<f32>;
        var atten: f32 = 1.0;
        if (t == 3u) {
            // Hemispheric: ground/sky mix via half-lambert.
            let nl = 0.5 + 0.5 * dot(N, normalize(L.vLightData.xyz));
            let diff = mix(L.vLightDirection.xyz, L.vLightDiffuse.rgb, nl);
            result.diffuse = result.diffuse + diff * diffuseColor * sh;
            let H = normalize(viewDir + normalize(L.vLightData.xyz));
            let sf = pow(max(0.0, dot(N, H)), max(1.0, glossiness));
            result.specular = result.specular + sf * L.vLightSpecular.rgb * specularColor * sh;
            aggShadow = aggShadow + sh;
            numLights = numLights + 1.0;
            continue;
        }
        if (t == 1u) {
            // Directional: vLightData.xyz is the light's forward direction.
            lv = normalize(-L.vLightData.xyz);
        } else {
            // Point / Spot: vLightData.xyz is world-space position; range in vLightDiffuse.a.
            let d = L.vLightData.xyz - worldPos;
            atten = max(0.0, 1.0 - length(d) / L.vLightDiffuse.a);
            lv = normalize(d);
            if (t == 2u) {
                // Spot cone falloff (vLightDirection.xyz=dir, .w=cosHalfAngle; vLightSpecular.a=exp).
                let c = max(0.0, dot(L.vLightDirection.xyz, -lv));
                if (c >= L.vLightDirection.w) {
                    atten = atten * max(0.0, pow(c, L.vLightSpecular.a));
                } else {
                    atten = 0.0;
                }
            }
        }
        let NdotL = max(0.0, dot(N, lv));
        result.diffuse = result.diffuse + L.vLightDiffuse.rgb * diffuseColor * NdotL * atten * sh;
        let H = normalize(lv + viewDir);
        let NdotH = max(0.0, dot(N, H));
        let specFactor = pow(NdotH, max(1.0, glossiness));
        result.specular = result.specular + L.vLightSpecular.rgb * specularColor * specFactor * atten * sh;
        aggShadow = aggShadow + sh;
        numLights = numLights + 1.0;
    }
    if (numLights > 0.0) {
        result.shadow = aggShadow / numLights;
    } else {
        result.shadow = 1.0;
    }
    return result;
}
`,x=`array<f32, ${a}>(${new Array(a).fill("1.0").join(", ")})`;function o(t,f,r,e,s,l,n){let i=t.inputs.get(f);return i?.source?l.cast(l.resolve(t,f,e,s),n).expr:r}var y={className:"LightBlock",stage:"fragment",emit(t,f,r,e,s){e.fragment.helpers.set(p,w),e.usesLightsUbo=!0;let l=`_light_${t.id}_call`,n=e.fragment.memo.get(l),i;if(n)i=n.expr;else{let u=o(t,"worldPosition","vec3<f32>(0.0)",r,e,s,"vec3f"),c=o(t,"worldNormal","vec3<f32>(0.0, 1.0, 0.0)",r,e,s,"vec3f"),g=o(t,"cameraPosition","_NME_CAMERA_POS_",r,e,s,"vec3f"),h=o(t,"diffuseColor","vec3<f32>(1.0)",r,e,s,"vec3f"),m=o(t,"specularColor","vec3<f32>(1.0)",r,e,s,"vec3f"),d=o(t,"glossiness","1.0",r,e,s,"f32"),v=o(t,"glossPower","1024.0",r,e,s,"f32"),L=e.shadowLights.length>0?"nme_computeShadowFactors(in)":x;i=`_lt${s.temp(e,"light")}`,e.fragment.body.push(`let ${i} = nme_computeLighting(${u}, ${c}, ${g}, ${h}, ${m}, (${d}) * (${v}), ${L});`),e.fragment.memo.set(l,{expr:i,type:"vec4f"})}return{diffuseOutput:{expr:`${i}.diffuse`,type:"vec3f"},specularOutput:{expr:`${i}.specular`,type:"vec3f"},shadow:{expr:`${i}.shadow`,type:"f32"}}[f]??{expr:`${i}.diffuse`,type:"vec3f"}}};export{y as emitter};
