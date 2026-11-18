import { describe, expect, it } from 'vitest';
import { applyOperations, createProposal, getTemplate } from '@asa/core-model';
import { rebaseIfSafe } from './rebase';

describe('rebase seguro de propuestas', () => {
  const base = getTemplate('demo-three-tier').model();
  const p = createProposal(base, { id: 'p', source: 'rule-engine', title: 't', rationale: 'r', operations: [{ op: 'update_component', componentId: 'db', patch: { props: { multiAz: true } } }] });
  it('re-basa si los elementos tocados no cambiaron', () => {
    const r = applyOperations(base, [{ op: 'update_component', componentId: 'app-1', patch: { props: { retries: 5 } } }]);
    if (!r.ok) throw new Error();
    expect(rebaseIfSafe(p, r.model, [base]).baseRevision).toBe(r.model.revision);
  });
  it('no re-basa si el elemento tocado cambió', () => {
    const r = applyOperations(base, [{ op: 'update_component', componentId: 'db', patch: { props: { queryMs: 50 } } }]);
    if (!r.ok) throw new Error();
    expect(rebaseIfSafe(p, r.model, [base]).baseRevision).toBe(base.revision);
  });
});
