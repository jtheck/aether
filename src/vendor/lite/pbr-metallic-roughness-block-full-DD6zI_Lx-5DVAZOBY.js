import{Y as b}from"./chunk-2GVZXICG.js";function Ae(r,a){if(!r)return"";let c="ccNormalW",e="ccNdotL";return`
let ccNdotL = clamp(dot(ccNormalW, L), 0.0000001, 1.0);
if (${e} > 0.0 && atten > 0.0) {
let ccH = normalize(V + L);
let ccNdotH = clamp(dot(${c}, ccH), 0.0000001, 1.0);
let ccVdotH = saturate(dot(V, ccH));
let ccD = nme_pbr_distGGX(ccNdotH, ccAlphaG);
let ccVis = 0.25 / (ccVdotH * ccVdotH + 0.0000001);
let ccF_d = nme_pbr_ccSchlick(ccF0, ccVdotH);
let ccTerm = ccF_d * ccD * ccVis * ${e};
ccDirectSpecAcc = ccDirectSpecAcc + v3(ccTerm) * color * atten * ccIntensity * sh;
baseLayerAtten = 1.0 - ccF_d * ccIntensity;
${a?`let ccLRefract = -refract(L, ${c}, ccIorInv);
let ccNdotLRefract = clamp(dot(${c}, ccLRefract), 0.0000001, 1.0);
let ccDirectAbsorption = nme_pbr_cocaLambert(ccAbsorptionColor, ccTintThickness * ((ccNdotLRefract + ccNdotVRefract) / (ccNdotLRefract * ccNdotVRefract)));
baseLayerAbsorption = mix(v3(1.0), ccDirectAbsorption, v3(ccIntensity));`:""}
}`}function Ne(r,a){if(!r)return"";let c="ccNormalW";return`
let ccNdotL_h = clamp(dot(${c}, Ldir), 0.0000001, 1.0);
if (nl > 0.0) {
let ccH_h = normalize(V + Ldir);
let ccNdotH_h = clamp(dot(${c}, ccH_h), 0.0000001, 1.0);
let ccVdotH_h = saturate(dot(V, ccH_h));
let ccD_h = nme_pbr_distGGX(ccNdotH_h, ccAlphaG);
let ccVis_h = 0.25 / (ccVdotH_h * ccVdotH_h + 0.0000001);
let ccF_h = nme_pbr_ccSchlick(ccF0, ccVdotH_h);
let ccTerm_h = ccF_h * ccD_h * ccVis_h * ccNdotL_h;
ccDirectSpecAcc = ccDirectSpecAcc + v3(ccTerm_h) * entry.vLightDiffuse.rgb * ccIntensity * sh;
baseLayerAtten = 1.0 - ccF_h * ccIntensity;
${a?`let ccLRefract_h = -refract(Ldir, ${c}, ccIorInv);
let ccNdotLRefract_h = clamp(dot(${c}, ccLRefract_h), 0.0000001, 1.0);
let ccDirectAbsorption_h = nme_pbr_cocaLambert(ccAbsorptionColor, ccTintThickness * ((ccNdotLRefract_h + ccNdotVRefract) / (ccNdotLRefract_h * ccNdotVRefract)));
baseLayerAbsorption = mix(v3(1.0), ccDirectAbsorption_h, v3(ccIntensity));`:""}
}`}function Ie(r){return r?`
if (NdotL > 0.0 && atten > 0.0) {
let shH = normalize(V + L);
let shNdotH = clamp(dot(N, shH), 0.0000001, 1.0);
let shD = nme_pbr_charlieD(shNdotH, shAlphaG);
let shV = 1.0 / (4.0 * (NdotL + NdotV - NdotL * NdotV) + 0.0000001);
shDirectAcc = shDirectAcc + shColorScaled * shD * shV * NdotL * color * atten * sh * baseLayerAtten;
}`:""}function ye(r){return r?`
if (nl > 0.0) {
let shH_h = normalize(V + Ldir);
let shNdotH_h = clamp(dot(N, shH_h), 0.0000001, 1.0);
let shD_h = nme_pbr_charlieD(shNdotH_h, shAlphaG);
let shV_h = 1.0 / (4.0 * (nl + NdotV - nl * NdotV) + 0.0000001);
shDirectAcc = shDirectAcc + shColorScaled * shD_h * shV_h * nl * entry.vLightSpecular.rgb * sh * baseLayerAtten;
}`:""}function be(r,a,c){return!r&&!a?`let finalRefraction = v3(0.0);
let refractionOpacity = 1.0;
let ssRefractionIrradiance = v3(0.0);`:`${a?`// Refraction: refract V through N at IOR, sample env at refraction LOD.
    let refrIntensity = clamp(refrIntensityIn, 0.0, 1.0);
    let invIor = 1.0 / max(refrIor, 1.0001);
    let refrV_raw = refract(-V, ${c?"aniN":"N"}, invIor);
    let refrV = v3(refrV_raw.x * cosA + refrV_raw.z * sinA, refrV_raw.y, -refrV_raw.x * sinA + refrV_raw.z * cosA);
    let refrAlphaG = mix(alphaG, 0.0, clamp(invIor * 3.0 - 2.0, 0.0, 1.0));
    let refrLod = log2(cubemapDim * refrAlphaG) * sceneU.vImageInfos.z;
    let envRefr = textureSampleLevel(nmeIblTexture, nmeIblSampler, refrV, clamp(refrLod, 0.0, maxLod)).rgb;
    let volumeAlbedo = nme_pbr_colorAtDistance(ssTintColor, refrTintAtDistance);
    let refrTransmittance = v3(refrIntensity) * nme_pbr_cocaLambert(volumeAlbedo, ssThickness);
    let finalRefractionRaw = envRefr * refrTransmittance * (v3(1.0) - refractionSpecEnvReflectance);
    let refractionOpacity = 1.0 - refrIntensity;`:`let finalRefractionRaw = v3(0.0);
let refractionOpacity = 1.0;`}
${r?`// Translucency: back-scattered SH irradiance with Burley transmittance.
    let nN_raw = -N;
    let nN_env = v3(nN_raw.x * cosA + nN_raw.z * sinA, nN_raw.y, -nN_raw.x * sinA + nN_raw.z * cosA);
    let backIrradiance = (sceneU.vSphericalL00.xyz
        + sceneU.vSphericalL1_1.xyz * nN_env.y + sceneU.vSphericalL10.xyz * nN_env.z + sceneU.vSphericalL11.xyz * nN_env.x
        + sceneU.vSphericalL2_2.xyz * (nN_env.y * nN_env.x) + sceneU.vSphericalL2_1.xyz * (nN_env.y * nN_env.z)
        + sceneU.vSphericalL20.xyz * (3.0 * nN_env.z * nN_env.z - 1.0) + sceneU.vSphericalL21.xyz * (nN_env.z * nN_env.x)
        + sceneU.vSphericalL22.xyz * (nN_env.x * nN_env.x - nN_env.y * nN_env.y));
    let ssRefractionIrradiance = backIrradiance * ssTransmittance;
    finalIrradiance = finalIrradiance * refractionOpacity;
    finalIrradiance = finalIrradiance * (1.0 - translucencyIntensity);`:`let ssRefractionIrradiance = v3(0.0);
finalIrradiance = finalIrradiance * refractionOpacity;`}
let finalRefraction = finalRefractionRaw;`}function Le(r){return ge(r.useEnv,r.useClearcoat,r.useSheen,r.useRefraction,r.useSubsurface,r.useAnisotropy,r.useIridescence,r.useShAlbedoScaling,r.useCcBump,r.useCcTint,r.useSpecularAA,r.remapClearcoatF0)}function ge(r,a,c,e,t,f,m,_,L,p,v,u){let g=a?`let ccIntensity = clamp(ccIntensityIn, 0.0, 1.0);
let ccRough = clamp(ccRoughnessIn, 0.0, 1.0);
let ccF0_raw = (ccIor - 1.0) / (ccIor + 1.0);
let ccF0 = ccF0_raw * ccF0_raw;
var ccDirectSpecAcc = v3(0.0);`:"let ccDirectSpecAcc = v3(0.0);",S=a?`var ccAA_factor_y = 0.0;
${v?`{ let ccNdfdx_AA = dpdx(ccNormalW);
let ccNdfdy_AA = dpdy(ccNormalW);
let ccSlopeSquare_AA = max(dot(ccNdfdx_AA, ccNdfdx_AA), dot(ccNdfdy_AA, ccNdfdy_AA));
ccAA_factor_y = sqrt(ccSlopeSquare_AA) * 0.75; }`:""}
let ccAlphaG = ccRough * ccRough + 0.0005 + ccAA_factor_y;`:"",A=a?L?`let ccNormalW = nme_perturbNormal(worldPos, Ng, ccBumpUv, ccBumpColor, 1.0);
let ccNdotV = abs(dot(ccNormalW, V)) + 0.0000001;${p?`
let ccIorInv = 1.0 / max(ccIor, 1.0001);
let ccAbsorptionColor = nme_pbr_colorAtDistance(max(ccTintColor, v3(0.0000001)), max(ccTintAtDistance, 0.0000001));
let ccVRefract = refract(-V, ccNormalW, ccIorInv);
let ccNdotVRefract = abs(dot(ccNormalW, ccVRefract)) + 0.0000001;`:""}`:`let ccNormalW = Ng;
let ccNdotV = abs(dot(ccNormalW, V)) + 0.0000001;${p?`
let ccIorInv = 1.0 / max(ccIor, 1.0001);
let ccAbsorptionColor = nme_pbr_colorAtDistance(max(ccTintColor, v3(0.0000001)), max(ccTintAtDistance, 0.0000001));
let ccVRefract = refract(-V, ccNormalW, ccIorInv);
let ccNdotVRefract = abs(dot(ccNormalW, ccVRefract)) + 0.0000001;`:""}`:`let ccNormalW = N;
let ccNdotV: f32 = 0.0;`,N=c?`let shIntensityRaw = clamp(shIntensityIn, 0.0, 1.0);
${_?"let shIntensity = shIntensityRaw;":`let reflectanceF0 = max(colorF0.r, max(colorF0.g, colorF0.b));
let shIntensity = shIntensityRaw * (1.0 - reflectanceF0);`}
let shRough = clamp(shRoughnessIn, 0.0, 1.0);
let shAlphaG = shRough * shRough + 0.0005;
let shColorScaled = shColorIn * shIntensity;
var shDirectAcc = v3(0.0);`:"let shDirectAcc = v3(0.0);",I=r&&c?`let shSpecLod = log2(cubemapDim * shAlphaG) * sceneU.vImageInfos.z;
    let shEnvRadiance = textureSampleLevel(nmeIblTexture, nmeIblSampler, R, clamp(shSpecLod, 0.0, maxLod)).rgb;
    let shBrdfBlue = textureSample(nmeBrdfLUT, nmeBrdfSampler, v2(NdotV, shRough)).b;
    let shFinalIbl = shEnvRadiance * shColorScaled * shBrdfBlue * seo * eho;
    ${_?`// SHEEN_ALBEDOSCALING: surface albedo and base specular scale by (1 - shInt \xD7 max(shColor) \xD7 envSheenBrdf.b).
    let shAlbedoScaling = 1.0 - shIntensity * max(max(shColorIn.r, shColorIn.g), shColorIn.b) * shBrdfBlue;`:"let shAlbedoScaling: f32 = 1.0;"}`:`let shFinalIbl = v3(0.0);
let shAlbedoScaling: f32 = 1.0;`,R=a&&u?`let _directF0S = sqrt(max(colorF0, v3(0.0)));
let _directF0T = ((1.0 - ccIor) + (1.0 + ccIor) * _directF0S) / ((1.0 + ccIor) + (1.0 - ccIor) * _directF0S);
let directSpecR0 = mix(colorF0, clamp(_directF0T * _directF0T, v3(0.0), v3(1.0)), ccIntensity);`:"let directSpecR0 = colorF0;",x=a?` * ccConsIBL${p?" * ccAbsorption":""}`:"",T=a?" * ccConsIBL":"",D=a?`let ccFresnelIBL = nme_pbr_ccSchlick(ccF0, ccNdotV);
    let ccConsIBL = 1.0 - ccFresnelIBL * ccIntensity;
    let ccBrdfSample = textureSample(nmeBrdfLUT, nmeBrdfSampler, v2(ccNdotV, ccRough)).rgb;
    let ccSpecEnvReflRaw = (v3(ccF0) * ccBrdfSample.y + (v3(1.0) - v3(ccF0)) * ccBrdfSample.x) * ccIntensity;
    let ccEnergyConservation = 1.0 + _coloredR0 * (1.0 / max(ccBrdfSample.y, 0.001) - 1.0);
    let ccEhoT = clamp(1.0 + 1.1 * dot(reflect(-V, ccNormalW), Ng), 0.0, 1.0);
    let ccSpecEnvRefl = ccSpecEnvReflRaw * (ccEhoT * ccEhoT);
    let ccSpecLod = log2(cubemapDim * ccAlphaG) * sceneU.vImageInfos.z;
    let ccR_raw = reflect(-V, ccNormalW);
    let ccR = v3(ccR_raw.x * cosA + ccR_raw.z * sinA, ccR_raw.y, -ccR_raw.x * sinA + ccR_raw.z * cosA);
    let ccEnvRadiance = textureSampleLevel(nmeIblTexture, nmeIblSampler, ccR, clamp(ccSpecLod, 0.0, maxLod)).rgb;
    ${p?`// Clearcoat absorption: BJS Beer-Lambert path length through the coat.
    let ccAbsorption = mix(v3(1.0), nme_pbr_cocaLambert(ccAbsorptionColor, ccTintThickness * ((ccNdotVRefract + ccNdotVRefract) / (ccNdotVRefract * ccNdotVRefract))), v3(ccIntensity));`:"let ccAbsorption = v3(1.0);"}
    let ccFinalRadiance = ccEnvRadiance * ccSpecEnvRefl;`:"",h=p?" * ccAbsorption":"",B=a?`${D}
${I}
r.lighting = finalIrradiance * shAlbedoScaling * ccConsIBL${h}
+ finalRadianceScaled * shAlbedoScaling * ccConsIBL${h}
+ ssRefractionIrradiance * ao_c
+ finalSpecularScaledDirect * shAlbedoScaling
+ diffuseAcc * shAlbedoScaling
+ diffuseTransmissionAcc
+ ccDirectSpecAcc * ccEnergyConservation
+ ccFinalRadiance
+ shDirectAcc
+ shFinalIbl${x}
+ finalRefraction${T}${h};`:`${I}
r.lighting = finalIrradiance * shAlbedoScaling + ssRefractionIrradiance * ao_c + (finalRadianceScaled + finalSpecularScaledDirect + diffuseAcc) * shAlbedoScaling + diffuseTransmissionAcc + shDirectAcc + shFinalIbl + finalRefraction;`,y=r?`
    let envRot = sceneU.envRotationY;
    let cosA = cos(envRot); let sinA = sin(envRot);
    let N_specSrc = ${f?"aniN":"N"};
    let R_raw = reflect(-V, N_specSrc);
    let R = v3(R_raw.x * cosA + R_raw.z * sinA, R_raw.y, -R_raw.x * sinA + R_raw.z * cosA);
    let N_env = v3(Ng.x * cosA + Ng.z * sinA, Ng.y, -Ng.x * sinA + Ng.z * cosA);
    let environmentIrradiance = (sceneU.vSphericalL00.xyz
        + sceneU.vSphericalL1_1.xyz * N_env.y + sceneU.vSphericalL10.xyz * N_env.z + sceneU.vSphericalL11.xyz * N_env.x
        + sceneU.vSphericalL2_2.xyz * (N_env.y * N_env.x) + sceneU.vSphericalL2_1.xyz * (N_env.y * N_env.z)
        + sceneU.vSphericalL20.xyz * (3.0 * N_env.z * N_env.z - 1.0) + sceneU.vSphericalL21.xyz * (N_env.z * N_env.x)
        + sceneU.vSphericalL22.xyz * (N_env.x * N_env.x - N_env.y * N_env.y));
    let brdfSample = textureSample(nmeBrdfLUT, nmeBrdfSampler, v2(NdotV, rough_c));
    let envBrdf = brdfSample.rgb;
    let reflectanceF0Scalar = max(colorF0.r, max(colorF0.g, colorF0.b));
    let baseSpecEnvReflectance = (colorF90 - v3(reflectanceF0Scalar)) * envBrdf.x + v3(reflectanceF0Scalar) * envBrdf.y;
    let seo = clamp((NdotVUnclamped + ao_c) * (NdotVUnclamped + ao_c) - 1.0 + ao_c, 0.0, 1.0);
    let _geoNF = select(-Ng, Ng, dot(Ng, V) > 0.0);
    let _ehoRefl = reflect(-V, N);
    let _ehoT = clamp(1.0 + 1.1 * dot(_ehoRefl, _geoNF), 0.0, 1.0);
    let eho = _ehoT * _ehoT;
    ${a&&u?`let _f0S = sqrt(max(colorF0, v3(0.0)));
    let _f0T = ((1.0 - ccIor) + (1.0 + ccIor) * _f0S) / ((1.0 + ccIor) + (1.0 - ccIor) * _f0S);
    let _coloredR0 = mix(colorF0, clamp(_f0T * _f0T, v3(0.0), v3(1.0)), ccIntensity);`:"let _coloredR0 = colorF0;"}
    let colorSpecEnvReflectance = ((colorF90 - _coloredR0) * envBrdf.x + _coloredR0 * envBrdf.y) * seo * eho;
    let energyConservation = 1.0 + _coloredR0 * (1.0 / max(envBrdf.y, 0.001) - 1.0);
    let maxLod = f32(textureNumLevels(nmeIblTexture) - 1);
    let cubemapDim = f32(textureDimensions(nmeIblTexture).x);
    let specLod = log2(cubemapDim * alphaG) * sceneU.vImageInfos.z;
    var environmentRadiance = textureSampleLevel(nmeIblTexture, nmeIblSampler, R, clamp(specLod, 0.0, maxLod)).rgb;
    ${e?"let refractionSpecEnvReflectance = baseSpecEnvReflectance;":""}
    var finalIrradiance = environmentIrradiance * surfaceAlbedo;
    let finalRadianceScaled = environmentRadiance * colorSpecEnvReflectance * energyConservation;
    let finalSpecularScaledDirect = specAcc * energyConservation;
    ${be(t,e,f)}
    finalIrradiance = finalIrradiance * ao_c;
    r.diffuseInd = finalIrradiance;
    r.specularInd = finalRadianceScaled;
    ${B}`:`
r.diffuseInd = v3(0.0);
r.specularInd = v3(0.0);
${a?"r.lighting = diffuseAcc + specAcc + diffuseTransmissionAcc + ccDirectSpecAcc + shDirectAcc;":"r.lighting = diffuseAcc + diffuseTransmissionAcc + specAcc + shDirectAcc;"}`;return`alias v2 = vec2<f32>;
alias v3 = vec3<f32>;
alias v4 = vec4<f32>;
struct NmePbrMrResult {
lighting: v3,
diffuseDir: v3,
specularDir: v3,
diffuseInd: v3,
specularInd: v3,
shadow: f32,
lumOverAlpha: f32,
};
const NME_PBR_PI: f32 = 3.14159265358979323846;
fn nme_pbr_distGGX(NdotH: f32, alphaG: f32) -> f32 {
let a2 = alphaG * alphaG;
let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
return a2 / (NME_PBR_PI * d * d);
}
fn nme_pbr_geomGGX(NdotL: f32, NdotV: f32, alphaG: f32) -> f32 {
let a2 = alphaG * alphaG;
let gl = NdotL * sqrt(NdotV * (NdotV - a2 * NdotV) + a2);
let gv = NdotV * sqrt(NdotL * (NdotL - a2 * NdotL) + a2);
return 0.5 / max(gl + gv, 0.00001);
}
fn nme_pbr_fresSchlick(c: f32, F0: v3, F90: v3) -> v3 {
let t = 1.0 - c;
let t2 = t * t;
return F0 + (F90 - F0) * (t2 * t2 * t);
}
fn nme_pbr_diffuseEON(albedo: v3, sigma: f32, NdotL: f32, NdotV: f32, LdotV: f32) -> v3 {
return albedo * (1.0 / NME_PBR_PI);
}
${a?`fn nme_pbr_ccSchlick(f0: f32, cosTheta: f32) -> f32 {
let t = 1.0 - cosTheta;
let t2 = t * t;
return f0 + (1.0 - f0) * (t2 * t2 * t);
}
`:""}${c?`fn nme_pbr_charlieD(NdotH: f32, alphaG: f32) -> f32 {
let invR = 1.0 / max(alphaG, 0.0005);
let cos2h = NdotH * NdotH;
let sin2h = 1.0 - cos2h;
return (2.0 + invR) * pow(sin2h, invR * 0.5) / (2.0 * NME_PBR_PI);
}
`:""}${f?`fn nme_pbr_anisoRoughness(alphaG: f32, anisotropy: f32) -> v2 {
let alphaT = max(alphaG * (1.0 + anisotropy), 0.0005);
let alphaB = max(alphaG * (1.0 - anisotropy), 0.0005);
return v2(alphaT, alphaB);
}
fn nme_pbr_anisoBentNormal(T: v3, B: v3, N: v3, V: v3, anisotropy: f32) -> v3 {
var anisotropicFrameDirection = B;
if (anisotropy < 0.0) {
anisotropicFrameDirection = T;
}
let anisoTan = cross(normalize(anisotropicFrameDirection), V);
let anisoNormal = cross(anisoTan, anisotropicFrameDirection);
return normalize(mix(N, anisoNormal, abs(anisotropy)));
}
fn nme_pbr_burleyAnisoD(NdotH: f32, TdotH: f32, BdotH: f32, alphaTB: v2) -> f32 {
let a2 = alphaTB.x * alphaTB.y;
let v = v3(alphaTB.y * TdotH, alphaTB.x * BdotH, a2 * NdotH);
let v2 = dot(v, v);
let w2 = a2 / max(v2, 0.0000001);
return a2 * w2 * w2 * (1.0 / NME_PBR_PI);
}
fn nme_pbr_visAnisoSmith(NdotL: f32, NdotV: f32, TdotV: f32, BdotV: f32, TdotL: f32, BdotL: f32, alphaTB: v2) -> f32 {
let lambdaV = NdotL * length(v3(alphaTB.x * TdotV, alphaTB.y * BdotV, NdotV));
let lambdaL = NdotV * length(v3(alphaTB.x * TdotL, alphaTB.y * BdotL, NdotL));
return 0.5 / max(lambdaV + lambdaL, 0.0000001);
}
`:""}${t||e||p?`fn nme_pbr_transmittanceBurley(tintColor: v3, diffusionDist: v3, thickness: f32) -> v3 {
let S = v3(1.0) / max(diffusionDist, v3(0.0000001));
let temp = exp(-0.333333333 * thickness * S);
return tintColor * 0.25 * (temp * temp * temp + 3.0 * temp);
}
fn nme_pbr_cocaLambert(volumeAlbedo: v3, distance: f32) -> v3 {
return exp(-volumeAlbedo * distance);
}
fn nme_pbr_colorAtDistance(color: v3, distance: f32) -> v3 {
return -log(color) / distance;
}
`:""}fn nme_pbr_mr_compute(
    worldPos: v3, geometricNormal: v3, worldNormal: v3, cameraPos: v3,
    baseColor: v3, metallic: f32, roughness: f32, ao: f32,
    ccIntensityIn: f32, ccRoughnessIn: f32, ccIor: f32,
    ccBumpColor: v3, ccBumpUv: v2,
    ccTintColor: v3, ccTintAtDistance: f32, ccTintThickness: f32,
    shIntensityIn: f32, shColorIn: v3, shRoughnessIn: f32,
    baseIor: f32,
    refrIntensityIn: f32, refrIor: f32, refrTintAtDistance: f32,
    ssTintColor: v3, ssThickness: f32,
    ssTranslucencyIntensityIn: f32, ssDiffusionDist: v3,
    anisoIntensityIn: f32, anisoDirection: v2, anisoUv: v2,
    iridescenceIntensityIn: f32, iridescenceIorIn: f32, iridescenceThicknessIn: f32,
    shadowFactors: array<f32, ${b}>
) -> NmePbrMrResult {
    var r: NmePbrMrResult;
    let Ng = normalize(geometricNormal);
    let N = normalize(worldNormal);
    let V = normalize(cameraPos - worldPos);
    let NdotVUnclamped = dot(N, V);
    let NdotV = abs(NdotVUnclamped) + 0.0000001;
    let metallic_c = clamp(metallic, 0.0, 1.0);
    let rough_c = clamp(roughness, 0.0, 1.0);
    var alphaG = rough_c * rough_c + 0.0005;
    ${v?`var AA_factor_x = 0.0;
var AA_factor_y = 0.0;
{ let nDfdx_AA = dpdx(N);
let nDfdy_AA = dpdy(N);
let slopeSquare_AA = max(dot(nDfdx_AA, nDfdx_AA), dot(nDfdy_AA, nDfdy_AA));
AA_factor_x = pow(saturate(slopeSquare_AA), 0.333);
AA_factor_y = sqrt(slopeSquare_AA) * 0.75;
alphaG = alphaG + AA_factor_y; }`:`let AA_factor_x = 0.0;
let AA_factor_y = 0.0;`}
    let dielectricF0Raw = (baseIor - 1.0) / (baseIor + 1.0);
    let dielectricF0Scalar = dielectricF0Raw * dielectricF0Raw;
    let dielectricF0 = v3(dielectricF0Scalar);
    var surfaceAlbedo = baseColor * (1.0 - metallic_c) * (1.0 - dielectricF0Scalar);
    let colorF0Base = mix(dielectricF0, baseColor, metallic_c);
    let colorF0 = ${m?"mix(colorF0Base, nme_pbr_evalIridescence(1.0, max(iridescenceIorIn, 1.0001), NdotV, max(iridescenceThicknessIn, 0.0), colorF0Base), clamp(iridescenceIntensityIn, 0.0, 1.0))":"colorF0Base"};
    let colorF90 = v3(1.0);
    let ao_c = clamp(ao, 0.0, 1.0);
    let directRoughness = max(rough_c, AA_factor_x);
    let directAlphaG = directRoughness * directRoughness + 0.0005;
    ${f?`let _adp1 = dpdx(worldPos);
let _adp2 = -dpdy(worldPos);
let _aduv1 = dpdx(anisoUv);
let _aduv2 = -dpdy(anisoUv);
let _adp2perp = cross(_adp2, Ng);
let _adp1perp = cross(Ng, _adp1);
let _atan = _adp2perp * _aduv1.x + _adp1perp * _aduv2.x;
let _abit = _adp2perp * _aduv1.y + _adp1perp * _aduv2.y;
let _adet = max(dot(_atan, _atan), dot(_abit, _abit));
let _ainvmax = select(0.0, inverseSqrt(_adet), _adet > 0.0);
let _aTBN0 = normalize(_atan * _ainvmax);
let _aTBN1 = normalize(_abit * _ainvmax);
let anisoIntensity = clamp(anisoIntensityIn, -1.0, 1.0);
let anisoDir = v3(anisoDirection, 0.0);
let anisoT_raw = _aTBN0 * anisoDir.x + _aTBN1 * anisoDir.y;
let anisoT = normalize(anisoT_raw);
let anisoB = normalize(cross(Ng, anisoT));
let aniAlphaTB = nme_pbr_anisoRoughness(alphaG, anisoIntensity);
let aniN = nme_pbr_anisoBentNormal(anisoT, anisoB, N, V, anisoIntensity);`:`let anisoT = v3(1.0, 0.0, 0.0);
let anisoB = v3(0.0, 0.0, 1.0);
let aniAlphaTB = v2(alphaG, alphaG);
let aniN = N;`}
    ${g}
    ${R}
    ${A}
    ${S}
    ${N}
    let translucencyIntensity = ${t?"clamp(ssTranslucencyIntensityIn, 0.0, 1.0)":"0.0"};
    let ssTransmittance = ${t?"nme_pbr_transmittanceBurley(ssTintColor, ssDiffusionDist, max(ssThickness, 0.0000001)) * translucencyIntensity":"v3(0.0)"};
    let directDiffuseTranslucencyScale = 1.0 - translucencyIntensity;
    ${e?`// LEGACY_SPECULAR_ENERGY_CONSERVATION is on for BJS NME PBR-MR. When refraction
    let _refractionOpacityPre = 1.0 - clamp(refrIntensityIn, 0.0, 1.0);
    surfaceAlbedo = surfaceAlbedo * _refractionOpacityPre;`:""}
    var diffuseAcc = v3(0.0);
    var diffuseTransmissionAcc = v3(0.0);
    var specAcc = v3(0.0);
    var aggShadow: f32 = 0.0;
    var nLights: f32 = 0.0;
    let lc = min(meshU.lc, ${b}u);
    for (var i: u32 = 0u; i < lc; i = i + 1u) {
        let lightIndex = nli(i);
        let entry = nmeLights.lights[lightIndex];
        let t = u32(entry.vLightData.w);
        let sh = shadowFactors[lightIndex];
        if (t == 3u) {
            let Ldir = normalize(entry.vLightData.xyz);
            let nl = clamp(0.5 + 0.5 * dot(N, Ldir), 0.0000001, 1.0);
            let groundSky = mix(entry.vLightDirection.xyz, entry.vLightDiffuse.rgb, nl);
            var baseLayerAtten: f32 = 1.0;
            var baseLayerAbsorption = v3(1.0);${Ne(a,p)}
            let H_h = normalize(V + Ldir);
            let NdotH_h = clamp(dot(N, H_h), 0.0000001, 1.0);
            let VdotH_h = saturate(dot(V, H_h));
            let cF_h = nme_pbr_fresSchlick(VdotH_h, directSpecR0, colorF90);
            ${f?`let TdotH_h = dot(anisoT, H_h);
            let BdotH_h = dot(anisoB, H_h);
            let TdotV_h = dot(anisoT, V);
            let BdotV_h = dot(anisoB, V);
            let TdotL_h = dot(anisoT, Ldir);
            let BdotL_h = dot(anisoB, Ldir);
            let D_h = nme_pbr_burleyAnisoD(NdotH_h, TdotH_h, BdotH_h, aniAlphaTB);
            let Vis_h = nme_pbr_visAnisoSmith(nl, NdotV, TdotV_h, BdotV_h, TdotL_h, BdotL_h, aniAlphaTB);
            specAcc = specAcc + cF_h * D_h * Vis_h * nl * entry.vLightDiffuse.rgb * sh * baseLayerAtten * baseLayerAbsorption;`:`let D_h = nme_pbr_distGGX(NdotH_h, directAlphaG);
            let G_h = nme_pbr_geomGGX(nl, NdotV, directAlphaG);
            specAcc = specAcc + cF_h * D_h * G_h * nl * entry.vLightDiffuse.rgb * sh * baseLayerAtten * baseLayerAbsorption;`}
            diffuseAcc = diffuseAcc + groundSky * surfaceAlbedo * sh * baseLayerAtten * baseLayerAbsorption;${ye(c)}
            aggShadow = aggShadow + sh;
            nLights = nLights + 1.0;
            continue;
        }
        var L: v3;
        var atten: f32 = 1.0;
        let color = entry.vLightDiffuse.rgb;
        if (t == 1u) {
            L = normalize(-entry.vLightData.xyz);
        } else {
            let toL = entry.vLightData.xyz - worldPos;
            let d2 = dot(toL, toL);
            let dist = sqrt(d2);
            L = toL / max(dist, 0.0001);
            let range = entry.vLightDiffuse.a;
            if (t == 2u) {
                let invD2 = 1.0 / max(d2, 0.0000001);
                let cosHalfAngle = entry.vLightDirection.w;
                let kappa = 6.64385618977 / max(1.0 - cosHalfAngle, 0.0001);
                let cd = dot(-entry.vLightDirection.xyz, L);
                let dirFall = exp2(kappa * (cd - 1.0));
                atten = invD2 * dirFall;
            } else {
                atten = 1.0 / max(d2, 0.0000001);
            }
        }
        let NdotLUnclamped = dot(N, L);
        let NdotL = clamp(NdotLUnclamped, 0.0000001, 1.0);
        var baseLayerAtten: f32 = 1.0;
        var baseLayerAbsorption = v3(1.0);${Ae(a,p)}
        let _LdotV = select(0.0, dot(L, V), t == 1u);
        let _eonDiffuse = nme_pbr_diffuseEON(surfaceAlbedo, 0.0, NdotL, NdotV, _LdotV);
        diffuseAcc = diffuseAcc + _eonDiffuse * directDiffuseTranslucencyScale * NdotL * color * atten * sh * baseLayerAtten * baseLayerAbsorption;
        if (NdotLUnclamped < 0.0 && translucencyIntensity > 0.0) {
            let _trNdotL = abs(NdotLUnclamped) + 0.0000001;
            let _wrapW = 0.02;
            let _wrapT = 1.0 + _wrapW;
            let _wrapNdotL = clamp((_trNdotL + _wrapW) / (_wrapT * _wrapT), 0.0, 1.0);
            let _clampedAlbT = clamp(surfaceAlbedo, v3(0.1), v3(1.0));
            let _eonTransmit = nme_pbr_diffuseEON(_clampedAlbT, 0.0, max(NdotL, 0.0000001), NdotV, _LdotV) / _clampedAlbT;
            diffuseTransmissionAcc = diffuseTransmissionAcc + _eonTransmit * (ssTransmittance * _wrapNdotL) * color * atten * sh * baseLayerAtten * baseLayerAbsorption;
        }
        if (NdotL > 0.0 && atten > 0.0) {
            let H = normalize(V + L);
            let NdotH = clamp(dot(N, H), 0.0000001, 1.0);
            let VdotH = saturate(dot(V, H));
            let cF = nme_pbr_fresSchlick(VdotH, directSpecR0, colorF90);
            ${f?`let TdotH = dot(anisoT, H);
            let BdotH = dot(anisoB, H);
            let TdotV = dot(anisoT, V);
            let BdotV = dot(anisoB, V);
            let TdotL = dot(anisoT, L);
            let BdotL = dot(anisoB, L);
            let D = nme_pbr_burleyAnisoD(NdotH, TdotH, BdotH, aniAlphaTB);
            let Vis = nme_pbr_visAnisoSmith(NdotL, NdotV, TdotV, BdotV, TdotL, BdotL, aniAlphaTB);
            specAcc = specAcc + cF * D * Vis * NdotL * color * atten * sh * baseLayerAtten * baseLayerAbsorption;`:`let D = nme_pbr_distGGX(NdotH, directAlphaG);
            let G = nme_pbr_geomGGX(NdotL, NdotV, directAlphaG);
            specAcc = specAcc + cF * D * G * NdotL * color * atten * sh * baseLayerAtten * baseLayerAbsorption;`}
        }${Ie(c)}
        aggShadow = aggShadow + sh;
        nLights = nLights + 1.0;
    }
    r.diffuseDir = diffuseAcc;
    r.specularDir = specAcc;
${y}
    ${r?`let _radLum = clamp(dot(finalRadianceScaled * shAlbedoScaling${a?` * ccConsIBL${h}`:""}, v3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    let _specLum = clamp(dot(finalSpecularScaledDirect * shAlbedoScaling, v3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);${a?`
    let _ccLum = clamp(dot(ccFinalRadiance, v3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    r.lumOverAlpha = _radLum + _specLum + _ccLum;`:`
    r.lumOverAlpha = _radLum + _specLum;`}`:`let _specLum = clamp(dot(specAcc, v3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    r.lumOverAlpha = _specLum;`}
    var colorOut = max(r.lighting, v3(0.0)) * sceneU.vImageInfos.x;
    if (sceneU.vImageInfos.w > 0.5) {
        colorOut = 1.0 - exp2(-1.590579 * colorOut);
    }
    colorOut = pow(max(colorOut, v3(0.0)), v3(0.45454545));
    colorOut = clamp(colorOut, v3(0.0), v3(1.0));
    let highContrast = colorOut * colorOut * (v3(3.0) - colorOut * 2.0);
    if (sceneU.vImageInfos.y < 1.0) {
        colorOut = mix(v3(0.5), colorOut, sceneU.vImageInfos.y);
    } else {
        colorOut = mix(colorOut, highContrast, sceneU.vImageInfos.y - 1.0);
    }
    r.lighting = max(colorOut, v3(0.0));
    if (nLights > 0.0) { r.shadow = aggShadow / nLights; } else { r.shadow = 1.0; }
    return r;
}
`}var Se="nme_pbr_mr",Re=`array<f32, ${b}>(${new Array(b).fill("1.0").join(", ")})`;function o(r,a,c,e,t,f,m){let _=r.inputs.get(a);return _?.source?m.cast(m.resolve(r,a,t,f),e).expr:c}var Te={className:"PBRMetallicRoughnessBlock",stage:"fragment",emit(r,a,c,e,t){var f,m,_,L,p,v,u,g,S;let A=!!((f=r.inputs.get("reflection"))!=null&&f.source);A&&(e.usesEnv=!0,t.resolve(r,"reflection",c,e));let N=(m=r.inputs.get("clearcoat"))==null?void 0:m.source,I="0.0",R="0.0",x="1.5",T="v3(0.5, 0.5, 1.0)",D="v2(0.0)",h=!1,B="v3(1.0)",w="1.0",H="0.0",y=!1,$=!1,V=!1;if(N){let n=t.graph.blocks.get(N.blockId);if(n&&n.className==="ClearCoatBlock"){if($=!0,V=n.serialized.remapF0OnInterfaceChange===!0,e.usesClearcoat=!0,t.resolveOutput(n,N.outputName,c,e),I=o(n,"intensity","1.0","f32",c,e,t),R=o(n,"roughness","0.0","f32",c,e,t),x=o(n,"indexOfRefraction","1.5","f32",c,e,t),(_=n.inputs.get("normalMapColor"))!=null&&_.source){h=!0,T=o(n,"normalMapColor","v3(0.5, 0.5, 1.0)","vec3f",c,e,t);let i=n.inputs.get("uv");if(i?.source){let l=t.resolve(n,"uv",c,e);D=l.type==="vec2f"?l.expr:`(${l.expr}).xy`}}(L=n.inputs.get("tintColor"))!=null&&L.source&&(y=!0,B=o(n,"tintColor","v3(1.0)","vec3f",c,e,t),w=o(n,"tintAtDistance","1.0","f32",c,e,t),H=o(n,"tintThickness","0.0","f32",c,e,t))}}let F=(p=r.inputs.get("sheen"))==null?void 0:p.source,E="0.0",z="v3(1.0)",G="0.0",O=!1,C=!1;if(F){let n=t.graph.blocks.get(F.blockId);if(n&&n.className==="SheenBlock"){O=!0,e.usesSheen=!0,C=n.serialized.albedoScaling===!0,t.resolveOutput(n,F.outputName,c,e),E=o(n,"intensity","1.0","f32",c,e,t),z=o(n,"color","v3(1.0)","vec3f",c,e,t);let i=n.inputs.get("roughness");G=i?.source?o(n,"roughness","0.0","f32",c,e,t):`clamp(${o(r,"roughness","0.5","f32",c,e,t)}, 0.0, 1.0)`}}let U=(v=r.inputs.get("subsurface"))==null?void 0:v.source,k=!1,P=!1,q="v3(1.0)",J="0.0",j="0.0",Q="v3(1.0)",Z="0.0",ee=o(r,"indexOfRefraction","1.5","f32",c,e,t),ce="1.0";if(U){let n=t.graph.blocks.get(U.blockId);if(n&&n.className==="SubSurfaceBlock"){k=!0,e.usesSubsurface=!0,t.resolveOutput(n,U.outputName,c,e),q=o(n,"tintColor","v3(1.0)","vec3f",c,e,t),J=o(n,"thickness","0.0","f32",c,e,t),j=o(n,"translucencyIntensity","0.0","f32",c,e,t),Q=o(n,"translucencyDiffusionDist","v3(1.0)","vec3f",c,e,t);let i=(u=n.inputs.get("refraction"))==null?void 0:u.source;if(i){let l=t.graph.blocks.get(i.blockId);if(l&&l.className==="RefractionBlock"){P=!0,t.resolveOutput(l,i.outputName,c,e),Z=o(l,"intensity","1.0","f32",c,e,t),ce=o(l,"tintAtDistance","1.0","f32",c,e,t);let s=l.inputs.get("volumeIndexOfRefraction");s?.source&&(ee=o(l,"volumeIndexOfRefraction","1.5","f32",c,e,t))}}}}let W=(g=r.inputs.get("anisotropy"))==null?void 0:g.source,M=!1,te="0.0",X="v2(1.0, 0.0)",re="v2(0.0)";if(W){let n=t.graph.blocks.get(W.blockId);if(n&&n.className==="AnisotropyBlock"){M=!0,e.usesAnisotropy=!0,t.resolveOutput(n,W.outputName,c,e),te=o(n,"intensity","0.0","f32",c,e,t),X=o(n,"direction","v2(1.0, 0.0)","vec3f",c,e,t);let i=n.inputs.get("direction");if(i?.source){let s=t.resolve(n,"direction",c,e);X=s.type==="vec2f"?s.expr:`(${s.expr}).xy`}let l=n.inputs.get("uv");if(l?.source){let s=t.resolve(n,"uv",c,e);re=s.type==="vec2f"?s.expr:`(${s.expr}).xy`}}}let Y=(S=r.inputs.get("iridescence"))==null?void 0:S.source,K=!1,ne="1.0",oe="1.3",ae="400.0";if(Y){let n=t.graph.blocks.get(Y.blockId);n&&n.className==="IridescenceBlock"&&(K=!0,e.usesIridescence=!0,t.resolveOutput(n,Y.outputName,c,e),ne=o(n,"intensity","1.0","f32",c,e,t),oe=o(n,"indexOfRefraction","1.3","f32",c,e,t),ae=o(n,"thickness","400.0","f32",c,e,t))}let le=r.serialized.enableSpecularAntiAliasing===!0,de=`${Se}_${A?"env":"noenv"}_${$?"cc":"nocc"}_${V?"ccF0R":"ccF0"}_${O?"sh":"nosh"}_${P?"refr":"norefr"}_${k?"ss":"noss"}_${M?"ani":"noani"}_${K?"iri":"noiri"}_${C?"shAS":"noShAS"}_${h?"ccB":""}_${y?"ccT":""}_${le?"aa":"noaa"}`;e.fragment.helpers.set(de,Le({useEnv:A,useClearcoat:$,useSheen:O,useRefraction:P,useSubsurface:k,useAnisotropy:M,useIridescence:K,useShAlbedoScaling:C,useCcBump:h,useCcTint:y,useSpecularAA:le,remapClearcoatF0:V})),e.usesLightsUbo=!0;let ie=`_pbrmr_${r.id}_call`,d,se=e.fragment.memo.get(ie);if(se)d=se.expr;else{let n=o(r,"worldPosition","v3(0.0)","vec3f",c,e,t),i=o(r,"worldNormal","v3(0.0, 1.0, 0.0)","vec3f",c,e,t),l=r.inputs.get("perturbedNormal"),s=l?.source?t.cast(t.resolve(r,"perturbedNormal",c,e),"vec3f").expr:i,fe=o(r,"cameraPosition","_NME_CAMERA_POS_","vec3f",c,e,t),pe=o(r,"baseColor","v3(1.0)","vec3f",c,e,t),_e=o(r,"metallic","0.0","f32",c,e,t),he=o(r,"roughness","0.5","f32",c,e,t),me=o(r,"ambientOcc","1.0","f32",c,e,t),ve=o(r,"indexOfRefraction","1.5","f32",c,e,t),ue=e.shadowLights.length>0?"nme_computeShadowFactors(in)":Re;d=`_pbrR${t.temp(e,"pbr")}`,e.fragment.body.push(`let ${d} = nme_pbr_mr_compute(${n}, ${i}, ${s}, ${fe}, ${pe}, ${_e}, ${he}, ${me}, ${I}, ${R}, ${x}, ${T}, ${D}, ${B}, ${w}, ${H}, ${E}, ${z}, ${G}, ${ve}, ${Z}, ${ee}, ${ce}, ${q}, ${J}, ${j}, ${Q}, ${te}, ${X}, ${re}, ${ne}, ${oe}, ${ae}, ${ue});`),e.fragment.memo.set(ie,{expr:d,type:"vec4f"})}switch(a){case"lighting":return{expr:`${d}.lighting`,type:"vec3f"};case"diffuseDir":return{expr:`${d}.diffuseDir`,type:"vec3f"};case"specularDir":return{expr:`${d}.specularDir`,type:"vec3f"};case"diffuseInd":return{expr:`${d}.diffuseInd`,type:"vec3f"};case"specularInd":return{expr:`${d}.specularInd`,type:"vec3f"};case"shadow":return{expr:`${d}.shadow`,type:"f32"};case"alpha":{let n=r.serialized,i=n.useSpecularOverAlpha===!0||n.useRadianceOverAlpha===!0,l=r.inputs.get("opacity"),s=l?.source?t.cast(t.resolve(r,"opacity",c,e),"f32").expr:"1.0";return i?{expr:`clamp(${s} + ${d}.lumOverAlpha * ${d}.lumOverAlpha, 0.0, 1.0)`,type:"f32"}:{expr:s,type:"f32"}}case"ambientClr":case"clearcoatDir":case"clearcoatInd":case"sheenDir":case"sheenInd":case"refraction":return{expr:"v3(0.0)",type:"vec3f"};default:return{expr:`${d}.lighting`,type:"vec3f"}}}};export{Te as emitter};
