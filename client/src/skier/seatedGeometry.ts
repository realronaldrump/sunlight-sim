import * as THREE from 'three/webgpu';
import { SkierModel } from './skierModel';
import { RIDER_ROOT_BELOW_SEAT, RIDER_ROOT_FORWARD } from '../../../shared/lifts';

let cached: THREE.BufferGeometry | null = null;
/** Bake the same human and equipment into a seated instancing mesh for non-player chair riders.
 * A 15 mm vertex weld preserves their silhouette and gear without hundreds of full skeletons.
 */
export function seatedSkierGeometry() {
  if (cached) return cached.clone();
  const model=new SkierModel(new THREE.Color(1,1,1));
  model.update({speed:0,edge:0,plow:0,tuck:0,skid:0,fallen:0,sitting:1,time:0,pushing:false});
  model.root.position.set(0, -RIDER_ROOT_BELOW_SEAT, -RIDER_ROOT_FORWARD);model.root.updateMatrixWorld(true);
  const positions:number[]=[],colors:number[]=[],jackets:number[]=[],hats:number[]=[],skins:number[]=[],indices:number[]=[];
  const welded=new Map<string,number>(),p=new THREE.Vector3(),c=new THREE.Color();
  model.root.traverse(o=>{
    const m=o as THREE.Mesh;if(!m.isMesh)return;
    const geo=m.geometry,skin=m as THREE.SkinnedMesh,mat=m.material as THREE.MeshStandardNodeMaterial;
    const remap:number[]=[];
    // Helmet shells take the rider's own helmet colour; boots share the material but stay dark.
    let helmet=false;for(let q=m.parent;q;q=q.parent)if(q.name==='helmet-and-goggles'){helmet=true;break;}
    const hat=helmet&&mat.color?.getHex()===0x333c48?1:0;
    for(let i=0;i<geo.attributes.position.count;i++){
      p.fromBufferAttribute(geo.attributes.position,i);
      if(skin.isSkinnedMesh)skin.applyBoneTransform(i,p);
      p.applyMatrix4(m.matrixWorld);
      const ca=geo.getAttribute('color');
      if(ca)c.fromBufferAttribute(ca,i);else c.copy(mat.color);
      const jacket=geo.getAttribute('jacket')?.getX(i)??(mat.color?.getHex()===0xffffff?1:0);
      const skinTone=geo.getAttribute('skinTone')?.getX(i)??0;
      const key=`${Math.round(p.x/.015)},${Math.round(p.y/.015)},${Math.round(p.z/.015)},${jacket},${hat},${skinTone>.5?1:0},${Math.round(c.r*5)},${Math.round(c.g*5)},${Math.round(c.b*5)}`;
      let idx=welded.get(key);
      if(idx===undefined){idx=positions.length/3;welded.set(key,idx);positions.push(p.x,p.y,p.z);colors.push(c.r,c.g,c.b);jackets.push(jacket);hats.push(hat);skins.push(skinTone);}
      remap.push(idx);
    }
    const count=geo.index?.count??geo.attributes.position.count;
    for(let i=0;i<count;i+=3){const a=remap[geo.index?.getX(i)??i],b=remap[geo.index?.getX(i+1)??i+1],c=remap[geo.index?.getX(i+2)??i+2];if(a!==b&&b!==c&&a!==c)indices.push(a,b,c);}
  });
  cached=new THREE.BufferGeometry();cached.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));cached.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));const masks=new Float32Array(jackets.length*3);for(let i=0;i<jackets.length;i++){masks[i*3]=jackets[i];masks[i*3+1]=hats[i];masks[i*3+2]=skins[i];}
  // jacket, helmet shell and skin masks share one vertex buffer (WebGPU allows only eight per draw)
  cached.setAttribute('masks',new THREE.BufferAttribute(masks,3));cached.setIndex(indices);cached.computeVertexNormals();
  return cached.clone();
}
