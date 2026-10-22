import type { DragPreview as Preview } from '@sheet/react';
import { axisNoun } from './axis';

function previewText(preview: Preview): string {
  return preview.kind === 'resize'
    ? `${preview.size} px`
    : `Move ${preview.count} ${axisNoun(preview.axis, preview.count)}`;
}

export function DragPreview({ preview }: { readonly preview: Preview }) {
  return (
    <>
      <div className="drop-line" data-testid="drop-line" style={preview.line} />
      <div className="drag-preview" style={{ left: preview.x + 16, top: preview.y + 14 }}>
        {previewText(preview)}
      </div>
    </>
  );
}
