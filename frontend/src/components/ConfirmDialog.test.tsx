import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders an accessible destructive confirmation dialog', () => {
    const markup = renderToStaticMarkup(
      <ConfirmDialog
        isOpen
        title="Delete column"
        description='Delete "Review" and all cards inside?'
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="danger"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('Delete column');
    expect(markup).toContain('Delete &quot;Review&quot; and all cards inside?');
    expect(markup).toContain('Delete');
    expect(markup).toContain('Cancel');
  });

  it('renders nothing when closed', () => {
    const markup = renderToStaticMarkup(
      <ConfirmDialog
        isOpen={false}
        title="Delete card"
        description="This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toBe('');
  });
});
