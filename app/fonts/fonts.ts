import localFont from 'next/font/local'

// Regular font 
export const abcRepro = localFont({
  src: [
    {
      path: './ABCRepro-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './ABCRepro-Regular.woff',
      weight: '400',
      style: 'normal',
    },
    {
      path: './ABCRepro-Regular.otf',
      weight: '400',
      style: 'normal',
    },
    {
      path: './ABCRepro-Bold.woff2',
      weight: '700',
      style: 'normal',
    },
    {
      path: './ABCRepro-Bold.woff',
      weight: '700',
      style: 'normal',
    },
    {
      path: './ABCRepro-Bold.otf',
      weight: '700',
      style: 'normal',
    },
    {
      path: './ABCRepro-Black.woff2',
      weight: '800',
      style: 'oblique',
    },
    {
      path: './ABCRepro-Black.woff',
      weight: '800',
      style: 'oblique',
    },
    {
      path: './ABCRepro-Black.otf',
      weight: '800',
      style: 'oblique',
    },
  ],
  variable: '--font-abc-repro-src'
})

// Mono font
export const abcReproMono = localFont({
  src: [
    {
      path: './ABCReproMono-Regular.woff',
      weight: '400',
      style: 'normal',
    },
    {
      path: './ABCReproMono-Bold.woff',
      weight: '800',
      style: 'normal',
    },
  ],
  variable: '--font-abc-repro-mono-src'
})
