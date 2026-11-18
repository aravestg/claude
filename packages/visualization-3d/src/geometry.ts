import * as THREE from 'three';
import type { Vec3 } from '@asa/core-model';

/** Curva de una conexión (presentación pura). Arco proporcional a la distancia. */
export function connectionCurve(a: Vec3, b: Vec3, lane = 0): THREE.QuadraticBezierCurve3 {
  const start = new THREE.Vector3(a.x, 0.9, a.z);
  const end = new THREE.Vector3(b.x, 0.9, b.z);
  const mid = start.clone().add(end).multiplyScalar(0.5);
  const dist = start.distanceTo(end);
  mid.y += 0.6 + dist * 0.12;
  if (lane) {
    const dir = end.clone().sub(start).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(lane * 0.6);
    mid.add(side);
  }
  return new THREE.QuadraticBezierCurve3(start, mid, end);
}

export function bounds(points: Vec3[]): { min: Vec3; max: Vec3; center: Vec3; size: number } {
  if (!points.length) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, center: { x: 0, y: 0, z: 0 }, size: 10 };
  const min = { x: Infinity, y: 0, z: Infinity };
  const max = { x: -Infinity, y: 0, z: -Infinity };
  for (const p of points) {
    min.x = Math.min(min.x, p.x);
    min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x);
    max.z = Math.max(max.z, p.z);
  }
  return {
    min,
    max,
    center: { x: (min.x + max.x) / 2, y: 0, z: (min.z + max.z) / 2 },
    size: Math.max(max.x - min.x, max.z - min.z, 8)
  };
}
