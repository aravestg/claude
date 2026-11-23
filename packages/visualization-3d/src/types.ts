import type { Layer, Vec3 } from '@asa/core-model';

export type Selection = { kind: 'component' | 'connection'; id: string } | null;
export type LayerKey = Layer | 'communications' | 'groups' | 'failures';
export type CameraViewName = 'perspective' | 'top' | 'side' | 'iso' | 'front' | 'focus' | 'fit';
export interface CameraRequest {
  view: CameraViewName;
  nonce: number;
}
export type Tool = 'select' | 'connect';
export type { Vec3 };
export type VisualStyle = 'illustrated' | 'classic';
