/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
// TODO: importa aquí los componentes compartidos que reutilices
// (VitalsDisplay, WaveformContainer, etc. — los mismos que usa MobileApp)
// y/o los componentes nuevos específicos de escritorio que armemos en
// src/components/desktop/ una vez lleguen las specs.

/**
 * DesktopApp Component.
 * PLACEHOLDER — se arma cuando lleguen las specs de escritorio.
 * Mismo patrón que MobileApp: consume los mismos hooks de datos
 * (useWebSocket vía WaveformContainer, useStore, etc.), solo cambia
 * cómo se acomodan los componentes en pantalla.
 */
export default function DesktopApp() {
  return (
    <div className="min-h-screen bg-black text-slate-100 flex items-center justify-center">
      <p className="text-slate-500 text-sm">Desktop layout — pendiente de especificaciones.</p>
    </div>
  );
}
