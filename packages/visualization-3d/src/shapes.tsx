/** Formas 3D por tipo: reconocibles por silueta, no sólo por color (accesibilidad). */
import type { ShapeKind } from '@asa/core-model';

interface ShapeProps {
  shape: ShapeKind;
  color: string;
  emissive: string;
  emissiveIntensity: number;
  opacity: number;
}

function Mat({ color, emissive, emissiveIntensity, opacity }: Omit<ShapeProps, 'shape'>) {
  return (
    <meshStandardMaterial
      color={color}
      emissive={emissive}
      emissiveIntensity={emissiveIntensity}
      roughness={0.45}
      metalness={0.25}
      transparent={opacity < 1}
      opacity={opacity}
    />
  );
}

const ACCENT = '#e2e8f0';

export function Shape(p: ShapeProps) {
  const m = <Mat color={p.color} emissive={p.emissive} emissiveIntensity={p.emissiveIntensity} opacity={p.opacity} />;
  switch (p.shape) {
    case 'device':
      return (
        <group>
          <mesh position={[0, 0.1, 0.25]} castShadow>
            <boxGeometry args={[1.5, 0.1, 1]} />
            {m}
          </mesh>
          <mesh position={[0, 0.65, -0.25]} rotation={[-0.25, 0, 0]} castShadow>
            <boxGeometry args={[1.5, 1, 0.08]} />
            {m}
          </mesh>
          <mesh position={[0, 0.65, -0.2]} rotation={[-0.25, 0, 0]}>
            <planeGeometry args={[1.3, 0.8]} />
            <meshBasicMaterial color="#0f172a" />
          </mesh>
        </group>
      );
    case 'globe':
      return (
        <group position={[0, 1, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.75, 32, 16]} />
            {m}
          </mesh>
          <mesh>
            <icosahedronGeometry args={[0.95, 1]} />
            <meshBasicMaterial color={ACCENT} wireframe transparent opacity={0.35} />
          </mesh>
        </group>
      );
    case 'dns':
      return (
        <group>
          <mesh position={[0, 0.6, 0]} castShadow>
            <cylinderGeometry args={[0.08, 0.08, 1.2, 12]} />
            {m}
          </mesh>
          <mesh position={[0.35, 1.05, 0]} castShadow>
            <boxGeometry args={[0.8, 0.3, 0.08]} />
            {m}
          </mesh>
          <mesh position={[-0.3, 0.75, 0]} castShadow>
            <boxGeometry args={[0.7, 0.25, 0.08]} />
            {m}
          </mesh>
        </group>
      );
    case 'wall':
      return (
        <group>
          {[0, 1, 2, 3].map((row) =>
            [-1, 0, 1].map((col) => (
              <mesh key={`${row}-${col}`} position={[0, 0.2 + row * 0.38, col * 0.62 + (row % 2 ? 0.31 : 0) - 0.15]} castShadow>
                <boxGeometry args={[0.35, 0.34, 0.58]} />
                {m}
              </mesh>
            ))
          )}
        </group>
      );
    case 'distributor':
      return (
        <group>
          <mesh position={[0, 0.25, 0]} castShadow>
            <cylinderGeometry args={[0.9, 1, 0.5, 32]} />
            {m}
          </mesh>
          {[-0.5, 0, 0.5].map((z) => (
            <mesh key={z} position={[0.55, 0.75, z]} rotation={[0, 0, -Math.PI / 2]} castShadow>
              <coneGeometry args={[0.14, 0.4, 12]} />
              <meshStandardMaterial color={ACCENT} />
            </mesh>
          ))}
        </group>
      );
    case 'gateway':
      return (
        <group>
          <mesh position={[0, 0.85, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
            <torusGeometry args={[0.75, 0.16, 12, 32, Math.PI]} />
            {m}
          </mesh>
          <mesh position={[0, 0.1, 0]} castShadow>
            <boxGeometry args={[0.6, 0.2, 1.9]} />
            {m}
          </mesh>
        </group>
      );
    case 'server':
      return (
        <group>
          <mesh position={[0, 0.85, 0]} castShadow>
            <boxGeometry args={[1, 1.7, 1]} />
            {m}
          </mesh>
          {[0.35, 0.75, 1.15, 1.55].map((y) => (
            <mesh key={y} position={[0.505, y, 0]}>
              <boxGeometry args={[0.02, 0.08, 0.7]} />
              <meshBasicMaterial color={p.emissive === '#000000' ? '#38bdf8' : p.emissive} />
            </mesh>
          ))}
        </group>
      );
    case 'function':
      return (
        <mesh position={[0, 1, 0]} castShadow>
          <octahedronGeometry args={[0.75, 0]} />
          {m}
        </mesh>
      );
    case 'database':
      return (
        <group>
          {[0.3, 0.8, 1.3].map((y) => (
            <mesh key={y} position={[0, y, 0]} castShadow>
              <cylinderGeometry args={[0.8, 0.8, 0.42, 32]} />
              {m}
            </mesh>
          ))}
        </group>
      );
    case 'nosql':
      return (
        <group>
          {[0.35, 0.95].map((y) => (
            <mesh key={y} position={[0, y, 0]} castShadow>
              <cylinderGeometry args={[0.85, 0.85, 0.5, 6]} />
              {m}
            </mesh>
          ))}
        </group>
      );
    case 'tunnel':
    case 'key':
    case 'chart':
    case 'mail':
    case 'saas':
      return (
        <mesh position={[0, 0.6, 0]} castShadow>
          <cylinderGeometry args={[0.85, 0.85, 1.2, 6]} />
          {m}
        </mesh>
      );
    case 'bucket':
      return (
        <mesh position={[0, 0.6, 0]} castShadow>
          <cylinderGeometry args={[0.8, 0.55, 1.2, 24, 1, true]} />
          {m}
        </mesh>
      );
  }
}
