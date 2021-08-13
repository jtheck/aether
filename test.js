
// function WorldVox(ops){
//   this.loc = ops.loc;
//   this.sLoc = stringifyVec(this.loc);
//   this.region = ops.region;
//   this.rLoc = ops.loc.clone().multiplyByFloats(D8,D8,D8).floor();
  
//   this.planarVoxels = new Map();

//   this.type = ops.type || vEARTH;
//   this.grainType = vSAND;
  
//   this.surface = []; // base material
//   this.grain = []; // snow, water, etc

//   this.neighbors = new Array(6);

//   this.chunks = new Array(8); // planar chunks
// }


// Block 32^3
//  8 octs ea containing one 16vox 
function Block(ops){
  this.loc = ops.loc;

  this.region;
  this.middle;

  this.voxels = new Map();
  this.pVoxels = new Map();

  this.mesh;
  this.wireMesh;
};

// []
// [[][]]
// [[[][]] [[][]]]
// [[[[][]] [[][]]]  [[[][]] [[][]]]]]
// [[[[[][]] [[][]]]]  [[[[][]] [[][]]]    [[[[][]] [[][]]]  [[[[][]] [[][]]]]]]




// function Voxel(ops){
//   this.loc = ops.loc;
//   this.region = ops.region;
//   this.planarVox = ops.planarVox;
//   this.worldVox = ops.worldVox;
//   this.type = vEARTH;

//   this.surface = []; // base material
 
//   this.faces = new Array(6);
//   this.neighbors = new Array(6);

// };

// Voxel
function Voxel(ops){
  this.loc = ops.loc;
  this.size; // 2, 4, 8, 16
  
  this.block;

  this.middle; // coordinate of center{x,y,z}
  this.parent; // parent
  this.oct; // oct loc in parent
  
  
  //this.region;
  // this.parentVox;
  // this.octLoc;
  // this.childrenOct = []; // children

};
var vv = new Voxel({});




function createVoxels(){

};



console.log(vv);







