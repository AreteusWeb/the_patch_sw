import React from 'react';
import { FreshnessStatusLine } from '../DataFreshnessBadge';
import type { DataFreshness } from '../../types';

/**
 * Right-sidebar header: title on its own line, data status underneath.
 * Stacked instead of side-by-side because the w-56 sidebar can't fit a long
 * tracked-out title and a status chip on one row without squeezing both.
 */
const SidebarPanelHeader: React.FC<{
  title: string;
  freshness: DataFreshness;
  staleAgeLabel?: string | null;
}> = ({ title, freshness, staleAgeLabel }) => (
  <div className="px-4 pt-4 pb-3">
    <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 leading-none">
      {title}
    </h2>
    <FreshnessStatusLine
      freshness={freshness}
      staleAgeLabel={staleAgeLabel}
      className="mt-1.5"
    />
  </div>
);

export default SidebarPanelHeader;
