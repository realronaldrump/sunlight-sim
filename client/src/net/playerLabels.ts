import { Vector3, type PerspectiveCamera, type Sprite } from 'three/webgpu';

const point=new Vector3();
/** Keep names readable without allowing nearby aircraft labels to cover the view. */
export function fitPlayerLabel(label:Sprite,camera:PerspectiveCamera,viewportHeight:number){
  camera.updateMatrixWorld();
  label.getWorldPosition(point).applyMatrix4(camera.matrixWorldInverse);
  const depth=-point.z;
  label.visible=depth>2 && depth<700;
  if(!label.visible)return;
  const height=32*2*depth*Math.tan(camera.fov*Math.PI/360)/Math.max(1,viewportHeight)/camera.zoom;
  label.scale.set(height*4,height,1);
}
