import { useState, useEffect } from 'react';

/**
 * useIsDesktop
 * ------------------------------------------------------------------
 * Detecta si el viewport actual debe usar el layout de escritorio.
 * Usa `matchMedia` (más eficiente que escuchar `resize` a mano) y se
 * actualiza en vivo si el usuario redimensiona la ventana o rota el
 * dispositivo — útil por ejemplo si alguien usa la app en una tablet
 * y gira la pantalla.
 *
 * Breakpoint: 1024px (el estándar "lg" de Tailwind). Ajusta este
 * número si tu especificación de escritorio define otro punto de corte.
 */
const DESKTOP_BREAKPOINT_PX = 1024;

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT_PX}px)`).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT_PX}px)`);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);

    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isDesktop;
}
