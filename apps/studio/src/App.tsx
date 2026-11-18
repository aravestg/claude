import { useEffect } from 'react';
import { Catalog } from './components/Catalog';
import { Console } from './components/Console';
import { ProposalDialog } from './components/ProposalDialog';
import { RightPanel } from './components/RightPanel';
import { TopBar } from './components/TopBar';
import { Viewport } from './components/Viewport';
import { useStudio } from './store';

export function App() {
  const theme = useStudio((s) => s.theme);
  const toast = useStudio((s) => s.toast);
  const playing = useStudio((s) => s.playing);

  // reloj de reproducción
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      useStudio.getState().tick(Math.min(0.1, (now - last) / 1000));
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // atajos de teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable], dialog')) return;
      const s = useStudio.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (s.playing) s.pause();
        else s.play();
      } else if (e.key === 'ArrowRight') s.step(1);
      else if (e.key === 'ArrowLeft') s.step(-1);
      else if (e.key === 'Escape') {
        s.setTool('select');
        s.select(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection) {
        const sel = s.selection;
        s.apply([sel.kind === 'component' ? { op: 'remove_component', componentId: sel.id } : { op: 'remove_connection', connectionId: sel.id }], 'Elemento eliminado (Ctrl+Z para deshacer).');
      } else if (e.key.toLowerCase() === 'f') s.setCamera('focus');
      else if (e.key.toLowerCase() === 'c') s.setTool('connect');
      else if (e.key.toLowerCase() === 'v') s.setTool('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => useStudio.setState({ toast: null }), 4500);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <div className="app" data-theme={theme}>
      <TopBar />
      <Catalog />
      <main className="center">
        <Viewport />
        <Console />
      </main>
      <RightPanel />
      <ProposalDialog />
      {toast && (
        <div className={`toast toast--${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
