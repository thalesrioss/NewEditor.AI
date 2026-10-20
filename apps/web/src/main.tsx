import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import { installEditMenu } from './lib/editMenu.ts';
import { fontFaceCss, LETTERING_CSS, MOTION_CSS, TEXT_CSS } from '@neweditor/core';

// Dentro do app de desktop (Electron) no Mac, a barra de título é da janela: as barras do topo abrem espaço para os semáforos e viram área de arrasto.
if (/Electron/.test(navigator.userAgent)) document.documentElement.classList.add('electron', /Mac/.test(navigator.platform) ? 'electron-mac' : 'electron-win');

installEditMenu();

// Mesmo CSS de texto do export (Chrome headless) — o preview é o que vai para o vídeo.
const style = document.createElement('style');
// Fontes empacotadas (apps/web/public/fonts): as mesmas que o export embute.
style.textContent = fontFaceCss((f) => `/fonts/${f}`) + TEXT_CSS + MOTION_CSS + LETTERING_CSS;
document.head.appendChild(style);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
