import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://beastyrabbit.github.io',
  base: '/tussel',
  integrations: [
    starlight({
      title: 'Tussel',
      description: 'Local-first TypeScript livecoding runtime inspired by Tidal and Strudel',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/beastyrabbit/tussel',
        },
      ],
      components: {
        Banner: './src/components/ExperimentalBanner.astro',
      },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Examples',
          autogenerate: { directory: 'examples' },
        },
        {
          label: 'Learning',
          items: [
            {
              label: 'Getting Started',
              slug: 'learning/getting-started',
            },
            {
              label: 'Mini Notation',
              slug: 'learning/mini-notation',
            },
            {
              label: 'Sounds & Synths',
              slug: 'learning/sounds-and-synths',
            },
            { label: 'Samples', slug: 'learning/samples' },
            { label: 'Effects', slug: 'learning/effects' },
            {
              label: 'Time Modifiers',
              slug: 'learning/time-modifiers',
            },
            {
              label: 'Pattern Combinators',
              slug: 'learning/pattern-combinators',
            },
            { label: 'Signals', slug: 'learning/signals' },
            {
              label: 'Scales & Notes',
              slug: 'learning/scales-and-notes',
            },
            {
              label: 'Building a Full Piece',
              slug: 'learning/building-a-full-piece',
            },
          ],
        },
        {
          label: 'Documentation',
          items: [
            {
              label: 'Scene TS Reference',
              slug: 'docs/scene-ts-reference',
            },
            {
              label: 'Script Syntax',
              slug: 'docs/script-syntax',
            },
            {
              label: 'Scene JSON Reference',
              slug: 'docs/scene-json-reference',
            },
            {
              label: 'Conversion Guide',
              slug: 'docs/conversion-guide',
            },
            {
              label: 'CLI Reference',
              slug: 'docs/cli-reference',
            },
            {
              label: 'API — DSL',
              slug: 'docs/api/dsl',
            },
            {
              label: 'API — Core',
              slug: 'docs/api/core',
            },
            {
              label: 'API — Audio',
              slug: 'docs/api/audio',
            },
            {
              label: 'API — Runtime',
              slug: 'docs/api/runtime',
            },
            {
              label: 'API — IR',
              slug: 'docs/api/ir',
            },
            {
              label: 'API — Mini',
              slug: 'docs/api/mini',
            },
            {
              label: 'API — CLI',
              slug: 'docs/api/cli',
            },
          ],
        },
        {
          label: 'Compare',
          items: [
            { label: 'Philosophy', slug: 'compare' },
            {
              label: 'Syntax Comparison',
              slug: 'compare/syntax-comparison',
            },
            {
              label: 'Feature Matrix',
              slug: 'compare/feature-matrix',
            },
            {
              label: 'Notation Mapping',
              slug: 'compare/notation-mapping',
            },
          ],
        },
      ],
    }),
  ],
});
