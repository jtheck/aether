











const tileSize = 1;


function Tile(ops){
  this.loc = ops.loc;
  this.type = ops.type;

  this.mesh = BABYLON.MeshBuilder.CreateBox("tile", {size: tileSize}, scene);
  this.mesh.position.x = this.loc.x * tileSize;
  this.mesh.position.z = this.loc.y * tileSize;



}




function Field(ops){
  let width = ops.width? ops.width : 10;
  let height = ops.height? ops.height : 10;
  this.tiles = [];

for(let x = 0; x < width; x++){
  for(let y = 0; y < height; y++){
    this.tiles.push(new Tile({loc: {x, y}, type: "grass"}));
  }
}



// let liveMap = new Field();







