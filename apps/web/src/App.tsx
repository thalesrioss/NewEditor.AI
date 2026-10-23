import { useEffect, useState } from 'react';
import { api } from './lib/api.ts';
import type { Brain } from './components/AgentPanel.tsx';
import { EditorShell } from './editor/EditorShell.tsx';
import { Home } from './components/Home.tsx';
import { ProfilesPage } from './components/ProfilesPage.tsx';
import { AvatarGallery } from './components/AvatarGallery.tsx';
import { CerebroPage } from './components/CerebroPage.tsx';
import { VideosPage } from './components/VideosPage.tsx';

function useHash(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const [brain, setBrain] = useState<Brain>({ kind: 'local', ready: true });
  useEffect(() => {
    // O cérebro local está sempre pronto; se o servidor estiver reiniciando, tenta de novo em vez de assustar.
    let stop = false;
    const probe = () =>
      api
        .health()
        .then((h) => setBrain({ kind: h.brain, ready: h.ready }))
        .catch(() => {
          if (!stop) setTimeout(probe, 3000);
        });
    void probe();
    return () => {
      stop = true;
    };
  }, []);

  if (hash === '#/avatar') return <AvatarGallery />;
  if (hash === '#/perfis') return <ProfilesPage />;
  if (hash === '#/cerebro') return <CerebroPage />;
  // O app abre na galeria de vídeos editados (FB-0169); o Kanban de projetos fica em #/.
  if (hash === '' || hash === '#' || hash === '#/videos') return <VideosPage />;
  const m = /^#\/p\/([\w-]+)/.exec(hash);
  return m ? <EditorShell projectId={m[1]!} brain={brain} /> : <Home />;
}
