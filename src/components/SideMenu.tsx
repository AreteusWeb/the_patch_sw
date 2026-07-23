import React, { useState } from 'react';
import { Home, Bell, User, LogOut, X, ChevronRight, Cpu } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import useStore from '../store/useStore';
import { logout } from '../hooks/useAuth';
import AlertsDrawer from './AlertsDrawer';
import ProfileDrawer from './ProfileDrawer';

/**
 * SideMenu Component.
 * Displays a side navigation menu panel allowing users to navigate between the main
 * dashboard, the alerts logs drawer, profile settings drawer, and sign out of the system.
 */
const SideMenu: React.FC = () => {
  const { isAdvancedMenuOpen, setIsAdvancedMenuOpen, currentUser, setIsDeviceSelected } = useStore();
  const [activeDrawer, setActiveDrawer] = useState<'alerts' | 'profile' | null>(null);

  const displayName =
    currentUser?.displayName?.split(' ')[0] ?? currentUser?.email?.split('@')[0] ?? 'User';

  const handleLogout = async () => {
    setIsAdvancedMenuOpen(false);
    await logout();
  };

  const openDrawer = (drawer: 'alerts' | 'profile') => {
    setActiveDrawer(drawer);
    setIsAdvancedMenuOpen(false);
  };

  return (
    <>
      {/* ── Side Panel ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {isAdvancedMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
              onClick={() => setIsAdvancedMenuOpen(false)}
            />

            {/* Panel */}
            <motion.div
              key="panel"
              initial={{ x: '100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed right-0 top-0 h-full w-64 z-[70] flex flex-col"
            >
              <div className="flex flex-col h-full bg-slate-950/95 backdrop-blur-2xl shadow-2xl border-l border-slate-800/80">

                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-6 pb-4 border-b border-slate-800/80">
                  <div>
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.25em]">
                      Signed in as
                    </p>
                    <p className="text-sm font-semibold text-white mt-0.5 truncate max-w-[140px]">
                      {displayName}
                    </p>
                  </div>
                  <button
                    onClick={() => setIsAdvancedMenuOpen(false)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:text-white hover:border-slate-700 transition-all"
                  >
                    <X size={15} />
                  </button>
                </div>

                {/* Nav items */}
                <nav className="flex flex-col gap-1 px-3 pt-4 flex-1">
                  <button
                    onClick={() => setIsAdvancedMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl text-white bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 transition-all group"
                  >
                    <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-teal-500/15 text-teal-400 border border-teal-500/20">
                      <Home size={16} />
                    </div>
                    <span className="text-sm font-medium">Dashboard</span>
                    <ChevronRight size={14} className="ml-auto text-slate-600 group-hover:text-slate-400 transition-colors" />
                  </button>

                  <button
                    onClick={() => openDrawer('alerts')}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl text-slate-300 hover:text-white bg-slate-900/40 border border-slate-800/80 hover:border-slate-700 transition-all group"
                  >
                    <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-900/60 text-slate-400 border border-slate-800 group-hover:bg-teal-500/15 group-hover:text-teal-400 group-hover:border-teal-500/20 transition-all">
                      <Bell size={16} />
                    </div>
                    <span className="text-sm font-medium">Alerts</span>
                    <ChevronRight size={14} className="ml-auto text-slate-600 group-hover:text-slate-400 transition-colors" />
                  </button>

                  <button
                    onClick={() => openDrawer('profile')}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl text-slate-300 hover:text-white bg-slate-900/40 border border-slate-800/80 hover:border-slate-700 transition-all group"
                  >
                    <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-900/60 text-slate-400 border border-slate-800 group-hover:bg-teal-500/15 group-hover:text-teal-400 group-hover:border-teal-500/20 transition-all">
                      <User size={16} />
                    </div>
                    <span className="text-sm font-medium">Profile</span>
                    <ChevronRight size={14} className="ml-auto text-slate-600 group-hover:text-slate-400 transition-colors" />
                  </button>

                  <button
                    onClick={() => {
                      setIsDeviceSelected(false);
                      setIsAdvancedMenuOpen(false);
                    }}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl text-slate-300 hover:text-white bg-slate-900/40 border border-slate-800/80 hover:border-slate-700 transition-all group"
                  >
                    <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-900/60 text-slate-400 border border-slate-800 group-hover:bg-teal-500/15 group-hover:text-teal-400 group-hover:border-teal-500/20 transition-all">
                      <Cpu size={16} />
                    </div>
                    <span className="text-sm font-medium">Switch Device</span>
                    <ChevronRight size={14} className="ml-auto text-slate-600 group-hover:text-slate-400 transition-colors" />
                  </button>
                </nav>

                {/* Logout */}
                <div className="px-3 pb-6 pt-2 border-t border-slate-800/80">
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-all group"
                  >
                    <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-900/60 border border-slate-800 group-hover:bg-rose-500/15 group-hover:border-rose-500/20 transition-all">
                      <LogOut size={16} />
                    </div>
                    <span className="text-sm font-medium">Sign out</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Drawers ─────────────────────────────────────────────────────────── */}
      <AlertsDrawer
        open={activeDrawer === 'alerts'}
        onClose={() => setActiveDrawer(null)}
      />
      <ProfileDrawer
        open={activeDrawer === 'profile'}
        onClose={() => setActiveDrawer(null)}
      />
    </>
  );
};

export default SideMenu;
