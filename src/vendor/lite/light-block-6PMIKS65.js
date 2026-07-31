import{a as l}from"./chunk-VQHJJFNH.js";var u="nme_lighting",c=`struct NmeLightResult {
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
    shadowFactors: array<f32, ${l}>
) -> NmeLightResult {
    var result: NmeLightResult;
    result.diffuse = vec3<f32>(0.0);
    result.specular = vec3<f32>(0.0);
    var aggShadow: f32 = 0.0;
    var numLights: f32 = 0.0;
    let viewDir = normalize(cameraPos - worldPos);
    let N = normalize(worldNormal);
     let lc = min(meshU.lc, ${l}u);
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
`;var _=`array<f32, ${l}>(${new Array(l).fill("1.0").join(", ")})`;function s(t,f,r,e,i,a,n){return t.inputs.get(f)?.source?a.cast(a.resolve(t,f,e,i),n).expr:r}var H={className:"LightBlock",stage:"fragment",emit(t,f,r,e,i){e.fragment.helpers.set(u,c),e.usesLightsUbo=!0;let a=`_light_${t.id}_call`,n=e.fragment.memo.get(a),o;if(n)o=n.expr;else{let g=s(t,"worldPosition","vec3<f32>(0.0)",r,e,i,"vec3f"),h=s(t,"worldNormal","vec3<f32>(0.0, 1.0, 0.0)",r,e,i,"vec3f"),m=s(t,"cameraPosition","_NME_CAMERA_POS_",r,e,i,"vec3f"),L=s(t,"diffuseColor","vec3<f32>(1.0)",r,e,i,"vec3f"),d=s(t,"specularColor","vec3<f32>(1.0)",r,e,i,"vec3f"),v=s(t,"glossiness","1.0",r,e,i,"f32"),p=s(t,"glossPower","1024.0",r,e,i,"f32"),w=e.shadowLights.length>0?"nme_computeShadowFactors(in)":_;o=`_lt${i.temp(e,"light")}`,e.fragment.body.push(`let ${o} = nme_computeLighting(${g}, ${h}, ${m}, ${L}, ${d}, (${v}) * (${p}), ${w});`),e.fragment.memo.set(a,{expr:o,type:"vec4f"})}return{diffuseOutput:{expr:`${o}.diffuse`,type:"vec3f"},specularOutput:{expr:`${o}.specular`,type:"vec3f"},shadow:{expr:`${o}.shadow`,type:"f32"}}[f]??{expr:`${o}.diffuse`,type:"vec3f"}}};export{H as emitter};
