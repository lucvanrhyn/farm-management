/**
 * FxBackground — the locked Retro `bgFx: aurora` atmosphere.
 *
 * Renders one fixed, full-viewport, pointer-events:none layer that drifts a
 * soft teal→indigo glow behind the whole authenticated product (Home /
 * Operations / Logger / Map / Einstein). All styling lives in
 * app/design-system.css (.ft-fx-bg / .ft-fx-bg-aurora) so it stays token-driven
 * (the glow is keyed off --ft-accent) and honours prefers-reduced-motion.
 *
 * Mount once, high in the authenticated layout. It is purely decorative, so it
 * is hidden from assistive tech.
 */
export function FxBackground() {
  return <div className="ft-fx-bg ft-fx-bg-aurora" aria-hidden="true" />;
}
