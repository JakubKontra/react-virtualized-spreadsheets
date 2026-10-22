import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Basic from './basic';
import Inventory from './inventory';
import Quotation from './quotation';
import Independent from './independent';
import './style.css';

const examples = {
  basic: Basic,
  inventory: Inventory,
  quotation: Quotation,
  independent: Independent,
};
const params = new URLSearchParams(location.search);
const name = params.get('example') ?? 'basic';
const Example = examples[name as keyof typeof examples] ?? Basic;
function setTheme(theme: unknown) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}
setTheme(params.get('theme'));
// The host and iframe are built together and served from the same origin.
window.addEventListener('message', (event) => {
  if (
    event.origin === location.origin &&
    event.source === parent &&
    event.data?.type === 'sheet-docs-theme'
  )
    setTheme(event.data.theme);
});
function App() {
  const [generation, setGeneration] = useState(0);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = root.current!;
    const observer = new ResizeObserver(() => {
      parent.postMessage(
        { type: 'sheet-docs-size', height: Math.ceil(element.getBoundingClientRect().height) },
        location.origin,
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <main ref={root}>
      <div className="example-actions">
        <span>Interactive example · changes stay in this page</span>
        <button onClick={() => setGeneration((value) => value + 1)}>Reset data</button>
      </div>
      <div className="example-body">
        <Example key={generation} />
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
