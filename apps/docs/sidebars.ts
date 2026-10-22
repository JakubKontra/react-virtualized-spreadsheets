import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: 'Getting started',
      items: [
        'getting-started/overview',
        'getting-started/installation',
        'getting-started/first-sheet',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'ui',
        'guides/headless',
        'guides/coordinates',
        'guides/data-sources',
        'formulas',
        'guides/interactions',
        'views',
        'guides/lifecycle',
      ],
    },
    {
      type: 'category',
      label: 'Live examples',
      items: ['examples/basic', 'examples/inventory', 'examples/quotation', 'examples/independent'],
    },
    {
      type: 'category',
      label: 'Use cases',
      items: [
        'use-cases/inventory',
        'use-cases/quotation',
        'use-cases/server-reporting',
        'use-cases/custom-interface',
        'use-cases/independent-sheets',
      ],
    },
    {
      type: 'category',
      label: 'API reference',
      items: ['api/ui', 'api/react', 'api/store', 'api/adapters'],
    },
    'performance',
    'roadmap',
    'contributing',
  ],
};
export default sidebars;
