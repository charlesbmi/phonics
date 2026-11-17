/** Bundled regular (400) Latin fonts; provenance and licenses: public/fonts/README.txt. */
export interface ReadingFont {
  readonly id: string
  readonly name: string
  /** Exact family name for FontFace or @font-face registration. */
  readonly faceFamily: string
  /** CSS font-family value, including fallback. */
  readonly family: string
  readonly src: string
  readonly sample: string
  readonly description: string
}

export const DEFAULT_READING_FONT_ID = 'mono'

const fontUrl = (file: string) => `${import.meta.env.BASE_URL}fonts/${file}`

export const READING_FONTS: readonly ReadingFont[] = [
  {
    id: "mono",
    name: "Fira Mono",
    faceFamily: "Reading Fira Mono",
    family: "\"Reading Fira Mono\", monospace",
    src: fontUrl("fira-mono-latin-400.woff2"),
    sample: "a g l i j t I 1",
    description: "Double-storey a; curved l and t feet; equal-width letters.",
  },
  {
    id: "andika",
    name: "Andika",
    faceFamily: "Reading Andika",
    family: "\"Reading Andika\", sans-serif",
    src: fontUrl("andika-latin-400.woff2"),
    sample: "a g l i j t I 1",
    description: "Single-storey a; straight l; curved t foot.",
  },
  {
    id: "atkinson",
    name: "Atkinson Hyperlegible",
    faceFamily: "Reading Atkinson Hyperlegible",
    family: "\"Reading Atkinson Hyperlegible\", sans-serif",
    src: fontUrl("atkinson-hyperlegible-latin-400.woff2"),
    sample: "a g l i j t I 1",
    description: "Double-storey a; curved l foot; distinct i and j.",
  },
  {
    id: "lexend",
    name: "Lexend",
    faceFamily: "Reading Lexend",
    family: "\"Reading Lexend\", sans-serif",
    src: fontUrl("lexend-latin-400.woff2"),
    sample: "a g l i j t I 1",
    description: "Single-storey a; straight l and t stem endings.",
  },
  {
    id: "comic-neue",
    name: "Comic Neue",
    faceFamily: "Reading Comic Neue",
    family: "\"Reading Comic Neue\", cursive",
    src: fontUrl("comic-neue-latin-400.woff2"),
    sample: "a g l i j t I 1",
    description: "Single-storey a; rounded handwriting-style strokes.",
  },
  {
    id: "noto-sans",
    name: "Noto Sans",
    faceFamily: "Reading Noto Sans",
    family: "\"Reading Noto Sans\", sans-serif",
    src: fontUrl("noto-sans-latin-400.woff2"),
    sample: "a g l i j t I 1",
    description: "Double-storey a; straight l; curved t foot.",
  },
  {
    id: "noto-serif",
    name: "Noto Serif",
    faceFamily: "Reading Noto Serif",
    family: "\"Reading Noto Serif\", serif",
    src: fontUrl("noto-serif-latin-400.woff2"),
    sample: "a g l i j t I 1",
    description: "Double-storey a; visible serifs on l, i, j and t.",
  },
  {
    id: "jetbrains-mono",
    name: "JetBrains Mono",
    faceFamily: "Reading JetBrains Mono",
    family: "\"Reading JetBrains Mono\", monospace",
    src: fontUrl("jetbrains-mono-latin-400.woff2"),
    sample: "a g l i j t I 1",
    description: "Double-storey a; curved l foot; equal-width letters.",
  },
]
