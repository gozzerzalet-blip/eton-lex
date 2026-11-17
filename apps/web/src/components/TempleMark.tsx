/**
 * Marca de ETON LEX: templo clásico con libro abierto.
 *
 * Es el mismo símbolo de `public/icon.svg` y `public/favicon.svg`, en su
 * variante compacta para tamaños pequeños (encabezado, acceso, registro).
 * Usa `currentColor` para adaptarse al modo claro y oscuro sin perder la
 * identidad monocromática de la marca.
 */
export function TempleMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* frontón */}
      <path d="M256 62 L404 160 H108 Z" strokeWidth={26} />
      {/* columnas */}
      <g strokeWidth={22}>
        <path d="M152 190 V330" />
        <path d="M204 190 V330" />
        <path d="M256 190 V330" />
        <path d="M308 190 V330" />
        <path d="M360 190 V330" />
      </g>
      {/* estereóbato */}
      <path d="M112 340 H400" strokeWidth={24} />
      {/* libro abierto */}
      <path
        d="M256 372 C224 358, 172 354, 116 364 L116 440 C172 430, 224 434, 256 452 C288 434, 340 430, 396 440 L396 364 C340 354, 288 358, 256 372 Z"
        strokeWidth={24}
      />
      <path d="M256 372 V452" strokeWidth={18} />
    </svg>
  );
}
