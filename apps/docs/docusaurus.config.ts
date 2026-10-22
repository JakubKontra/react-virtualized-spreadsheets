import type { Config } from '@docusaurus/types';
import type { Options, ThemeConfig } from '@docusaurus/preset-classic';
import { themes } from 'prism-react-renderer';

const repository = process.env.DOCS_REPOSITORY_URL?.replace(/\/$/, '');
const baseUrl =
  `/${(process.env.DOCS_BASE_URL ?? '/').split('/').filter(Boolean).join('/')}/`.replace('//', '/');

const config: Config = {
  title: 'react-virtualized-spreadsheets',
  tagline: 'Spreadsheet interactions. Your React application.',
  favicon: 'img/mark.svg',
  url: process.env.DOCS_URL ?? 'http://localhost:3000',
  baseUrl,
  trailingSlash: true,
  onBrokenLinks: 'throw',
  markdown: { hooks: { onBrokenMarkdownLinks: 'throw' } },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  presets: [
    [
      'classic',
      {
        docs: {
          path: '../../docs',
          sidebarPath: './sidebars.ts',
          ...(repository
            ? {
                editUrl: `${repository}/edit/${process.env.DOCS_REPOSITORY_BRANCH ?? 'main'}/docs/`,
              }
            : {}),
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Options,
    ],
  ],
  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        // A filename hash also works with static hosts that normalize query-string URLs.
        hashed: 'filename',
        language: 'en',
        docsDir: '../../docs',
        indexDocs: true,
        indexPages: true,
        indexBlog: false,
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],
  themeConfig: {
    colorMode: { defaultMode: 'light', respectPrefersColorScheme: true },
    navbar: {
      title: 'react-virtualized-spreadsheets',
      logo: { alt: 'Spreadsheet grid', src: 'img/mark.svg' },
      items: [
        { type: 'docSidebar', sidebarId: 'docs', label: 'Docs', position: 'left' },
        { to: '/docs/examples/basic', label: 'Examples', position: 'left' },
        { to: '/docs/roadmap', label: 'Roadmap', position: 'left' },
        ...(repository
          ? [{ href: repository, label: 'Repository', position: 'right' as const }]
          : []),
      ],
    },
    footer: {
      style: 'light',
      links: [
        {
          title: 'Build',
          items: [
            { label: 'Get started', to: '/docs/getting-started/installation' },
            { label: 'Live examples', to: '/docs/examples/basic' },
          ],
        },
        {
          title: 'Understand',
          items: [
            { label: 'Architecture', to: '/docs/getting-started/overview' },
            { label: 'Performance & limits', to: '/docs/performance' },
          ],
        },
        {
          title: 'Contribute',
          items: [
            { label: 'Roadmap', to: '/docs/roadmap' },
            { label: 'Contribution guide', to: '/docs/contributing' },
          ],
        },
      ],
      copyright: 'react-virtualized-spreadsheets · Built with Docusaurus',
    },
    prism: {
      theme: themes.github,
      darkTheme: themes.dracula,
      additionalLanguages: ['bash', 'json'],
    },
  } satisfies ThemeConfig,
};
export default config;
