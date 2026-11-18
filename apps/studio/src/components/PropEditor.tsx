/**
 * Editor genérico de propiedades a partir de los valores (defaults del catálogo + overrides).
 * Cada cambio confirmado se traduce en una operación `update_component`.
 */
import { useEffect, useState } from 'react';
import { PROTOCOLS } from '@asa/core-model';

const ENUMS: Record<string, readonly string[]> = {
  defaultAction: ['allow', 'deny'],
  action: ['allow', 'deny'],
  rejectMode: ['reject', 'drop'],
  protocol: ['ANY', ...PROTOCOLS],
  algorithm: ['round_robin']
};

const LABELS: Record<string, string> = {
  targetHost: 'Host destino',
  sourceIp: 'IP de origen',
  timeoutMs: 'Timeout (ms)',
  records: 'Registros DNS',
  resolveMs: 'Resolución (ms)',
  defaultAction: 'Acción por defecto',
  rejectMode: 'Modo de rechazo',
  rules: 'Reglas',
  inspectMs: 'Inspección (ms)',
  healthChecks: 'Health checks',
  processingMs: 'Procesamiento (ms)',
  targetTimeoutMs: 'Timeout destino (ms)',
  requireAuth: 'Requiere autenticación',
  integrationTimeoutMs: 'Timeout integración (ms)',
  runtime: 'Runtime',
  retries: 'Reintentos',
  retryBackoffMs: 'Backoff base (ms)',
  circuitBreaker: 'Circuit breaker',
  failureThreshold: 'Umbral de fallas',
  resetTimeoutMs: 'Reset (ms)',
  poolSize: 'Tamaño del pool',
  iamPermissions: 'Permisos IAM',
  engine: 'Motor',
  queryMs: 'Consulta (ms)',
  multiAz: 'Multi-AZ',
  failoverMs: 'Failover estimado (ms)',
  securityGroup: 'Security Group',
  inbound: 'Reglas de entrada',
  requiresIam: 'Requiere IAM',
  requiredAction: 'Acción IAM requerida',
  enabled: 'Habilitado',
  algorithm: 'Algoritmo'
};

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export function PropEditor({ value, onChange, path = '' }: { value: Record<string, Json>; onChange: (key: string, v: Json) => void; path?: string }) {
  return (
    <div className="props">
      {Object.entries(value).map(([k, v]) => (
        <Field key={k} name={k} value={v} id={`${path}${k}`} onChange={(nv) => onChange(k, nv)} />
      ))}
    </div>
  );
}

function Field({ name, value, onChange, id }: { name: string; value: Json; onChange: (v: Json) => void; id: string }) {
  const label = LABELS[name] ?? name;
  if (typeof value === 'boolean') {
    return (
      <label className="field field--check" htmlFor={id}>
        <input id={id} type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
    );
  }
  if (ENUMS[name] && typeof value === 'string') {
    return (
      <label className="field" htmlFor={id}>
        <span>{label}</span>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {ENUMS[name]!.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </label>
    );
  }
  if (typeof value === 'number' || typeof value === 'string' || value === null) {
    return <TextField id={id} label={label} value={value} onCommit={onChange} portLike={name === 'port'} />;
  }
  if (Array.isArray(value)) {
    if (value.every((x) => typeof x === 'string')) {
      return <TextField id={id} label={`${label} (separados por coma)`} value={(value as string[]).join(', ')} onCommit={(v) => onChange(String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean))} />;
    }
    if (value.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      return <ObjectList label={label} items={value as Record<string, Json>[]} onChange={onChange} id={id} />;
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return (
      <fieldset className="fieldset">
        <legend>{label}</legend>
        <PropEditor value={value} path={`${id}.`} onChange={(k, v) => onChange({ ...value, [k]: v })} />
      </fieldset>
    );
  }
  return null;
}

function TextField({ id, label, value, onCommit, portLike }: { id: string; label: string; value: string | number | null; onCommit: (v: Json) => void; portLike?: boolean }) {
  const [draft, setDraft] = useState(String(value ?? ''));
  useEffect(() => setDraft(String(value ?? '')), [value]);
  const numeric = typeof value === 'number';
  const commit = () => {
    if (draft === String(value ?? '')) return;
    if (numeric || portLike) {
      if (portLike && draft.toUpperCase() === 'ANY') return onCommit('ANY');
      const n = Number(draft);
      if (!Number.isFinite(n) || n < 0) {
        setDraft(String(value ?? ''));
        return;
      }
      return onCommit(n);
    }
    onCommit(draft);
  };
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        value={draft}
        inputMode={numeric ? 'numeric' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

function ObjectList({ label, items, onChange, id }: { label: string; items: Record<string, Json>[]; onChange: (v: Json) => void; id: string }) {
  const template = items[0] ? Object.fromEntries(Object.entries(items[0]).map(([k, v]) => [k, typeof v === 'number' ? v : typeof v === 'boolean' ? v : k === 'id' ? `nuevo-${items.length + 1}` : v])) : null;
  return (
    <fieldset className="fieldset">
      <legend>
        {label} ({items.length})
      </legend>
      {items.map((it, i) => (
        <div key={i} className="list-item">
          <PropEditor value={it} path={`${id}.${i}.`} onChange={(k, v) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)))} />
          <button className="btn btn--small btn--danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            Eliminar
          </button>
        </div>
      ))}
      {template && (
        <button className="btn btn--small" onClick={() => onChange([...items, template])}>
          + Agregar
        </button>
      )}
      {!items.length && <p className="muted small">Lista vacía.</p>}
    </fieldset>
  );
}
