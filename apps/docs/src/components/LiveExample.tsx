import { useEffect, useRef, useState } from 'react';
import { useColorMode } from '@docusaurus/theme-common';
import useBaseUrl from '@docusaurus/useBaseUrl';

export default function LiveExample({ name, title }: { name: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(name === 'independent' ? 810 : 650);
  const { colorMode } = useColorMode();
  const src = useBaseUrl(`/examples/?example=${encodeURIComponent(name)}`);
  const syncTheme = () =>
    frame.current?.contentWindow?.postMessage(
      { type: 'sheet-docs-theme', theme: colorMode },
      window.location.origin,
    );
  useEffect(syncTheme, [colorMode]);
  useEffect(() => {
    const resize = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow)
        return;
      if (event.data?.type === 'sheet-docs-size' && Number.isFinite(event.data.height))
        setHeight(Math.max(200, Math.min(2000, event.data.height)));
    };
    window.addEventListener('message', resize);
    return () => window.removeEventListener('message', resize);
  }, []);
  return (
    <div className="live-example">
      <iframe
        ref={frame}
        src={src}
        title={title}
        loading="lazy"
        onLoad={syncTheme}
        style={{ height }}
      />
      <div className="example-caption">
        Runs locally in your browser.{' '}
        <a href={`${src}&theme=${colorMode}`} target="_blank" rel="noreferrer">
          Open full screen ↗
        </a>
      </div>
    </div>
  );
}
