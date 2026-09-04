import React, { useState } from 'react';
import { Bell, User, LogOut, X, ChevronRight, Cpu, Sparkles, Zap, Cable } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import useStore from '../store/useStore';
import { logout } from '../hooks/useAuth';
import { AUTO_LOGIN_ENABLED } from '../lib/appConfig';
import { openElectrodeGuide } from '../lib/electrodeGuide';
import AlertsDrawer from './AlertsDrawer';
import ProfileDrawer from './ProfileDrawer';
import { backdropMotion, drawerMotion } from '../utils/motionPresets';
import { cn } from '../utils/cn';

interface SideMenuProps {
  /** Mobile: open AI Coach as full-screen sheet. Omit on desktop (bar button). */
  onOpenAiCoach?: () => void;
}

/**
 * SideMenu Component.
 * Displays a side navigation menu panel allowing users to navigate between the main
 * dashboard, the alerts logs drawer, profile settings drawer, and sign out of the system.
 * Visual system aligned with AiCoachPanel (width, header, text palette).
 */
const SideMenu: React.FC<SideMenuProps> = ({ onOpenAiCoach }) => {
  const {
    isAdvancedMenuOpen,
    setIsAdvancedMenuOpen,
    currentUser,
    setIsDeviceSelected,
    notchFilterEnabled,
    setNotchFilterEnabled,
  } = useStore();
  const [activeDrawer, setActiveDrawer] = useState<'alerts' | 'profile' | null>(null);

  const displayName =
    currentUser?.displayName?.split(' ')[0] ?? currentUser?.email?.split('@')[0] ?? 'User';

  const handleLogout = async () => {
    if (AUTO_LOGIN_ENABLED) return;
    setIsAdvancedMenuOpen(false);
    await logout();
  };

  const openDrawer = (drawer: 'alerts' | 'profile') => {
    setActiveDrawer(drawer);
    setIsAdvancedMenuOpen(false);
  };

  const navItemClass =
    'flex items-center gap-3 w-full px-3.5 py-3 rounded-2xl text-[#A0A0A8] hover:text-[#F5F5F5] hover:bg-slate-800/50 border border-transparent hover:border-slate-700/50 transition-colors group';

  return (
    <>
      <AnimatePresence>
        {isAdvancedMenuOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={backdropMotion.initial}
              animate={backdropMotion.animate}
              exit={backdropMotion.exit}
              transition={backdropMotion.transition}
              className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-md"
              onClick={() => setIsAdvancedMenuOpen(false)}
            />

            <motion.div
              key="panel"
              initial={drawerMotion.initial}
              animate={drawerMotion.animate}
              exit={drawerMotion.exit}
              transition={drawerMotion.transition}
              className="fixed right-0 top-0 h-full w-full max-w-[28rem] sm:max-w-[32rem] z-[70] flex flex-col bg-slate-950/95 backdrop-blur-2xl shadow-2xl border-l border-slate-800/80"
            >
              {/* Header — same family as AI Coach */}
              <div className="flex items-center justify-between px-5 pt-6 pb-4 border-b border-slate-800/80 flex-shrink-0 gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-[0.22em]">
                    Signed in as
                  </p>
                  <p className="text-base font-bold text-[#F5F5F5] mt-0.5 truncate leading-tight">
                    {displayName}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 p-0.5 rounded-xl bg-slate-900/50 border border-slate-800/90">
                  <button
                    type="button"
                    onClick={() => setIsAdvancedMenuOpen(false)}
                    className="w-9 h-9 flex items-center justify-center rounded-lg text-[#A0A0A8] hover:text-[#F5F5F5] hover:bg-slate-800/80 transition-colors"
                    aria-label="Close menu"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              {/* Nav */}
              <nav className="flex-1 overflow-y-auto scrollbar-hide px-5 py-5 flex flex-col gap-5">
                <div>
                  <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-[0.18em] mb-2 px-0.5">
                    Navigation
                  </p>
                  <div className="flex flex-col gap-1">
                    {onOpenAiCoach && (
                      <button
                        type="button"
                        onClick={() => {
                          onOpenAiCoach();
                          setIsAdvancedMenuOpen(false);
                        }}
                        className={navItemClass}
                      >
                        <Sparkles size={16} className="shrink-0 text-[#A0A0A8] group-hover:text-teal-400 transition-colors" />
                        <span className="text-[13px] font-medium">AI Coach</span>
                        <ChevronRight size={14} className="ml-auto text-[#6B7280] group-hover:text-[#A0A0A8] transition-colors" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setIsAdvancedMenuOpen(false);
                        openElectrodeGuide();
                      }}
                      className={navItemClass}
                    >
                      <Cable size={16} className="shrink-0 text-[#A0A0A8] group-hover:text-teal-400 transition-colors" />
                      <span className="text-[13px] font-medium">Electrode Guide</span>
                      <ChevronRight size={14} className="ml-auto text-[#6B7280] group-hover:text-[#A0A0A8] transition-colors" />
                    </button>

                    <button
                      type="button"
                      onClick={() => openDrawer('alerts')}
                      className={navItemClass}
                    >
                      <Bell size={16} className="shrink-0 text-[#A0A0A8] group-hover:text-teal-400 transition-colors" />
                      <span className="text-[13px] font-medium">Alerts</span>
                      <ChevronRight size={14} className="ml-auto text-[#6B7280] group-hover:text-[#A0A0A8] transition-colors" />
                    </button>

                    <button
                      type="button"
                      onClick={() => openDrawer('profile')}
                      className={navItemClass}
                    >
                      <User size={16} className="shrink-0 text-[#A0A0A8] group-hover:text-teal-400 transition-colors" />
                      <span className="text-[13px] font-medium">Profile</span>
                      <ChevronRight size={14} className="ml-auto text-[#6B7280] group-hover:text-[#A0A0A8] transition-colors" />
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-[0.18em] mb-2 px-0.5">
                    Session
                  </p>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => setNotchFilterEnabled(!notchFilterEnabled)}
                      className={navItemClass}
                      title={
                        notchFilterEnabled
                          ? '60 Hz notch filter ON — removes electrical hum from the ECG'
                          : '60 Hz notch filter OFF — tap to cut electrical hum from the ECG'
                      }
                    >
                      <Zap
                        size={16}
                        className={cn(
                          'shrink-0 transition-colors',
                          notchFilterEnabled
                            ? 'text-teal-400'
                            : 'text-[#A0A0A8] group-hover:text-teal-400'
                        )}
                      />
                      <span className="text-[13px] font-medium">60 Hz filter</span>
                      <span
                        className={cn(
                          'ml-auto text-[10px] font-bold uppercase tracking-wider',
                          notchFilterEnabled ? 'text-teal-400' : 'text-[#6B7280]'
                        )}
                      >
                        {notchFilterEnabled ? 'On' : 'Off'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsDeviceSelected(false);
                        setIsAdvancedMenuOpen(false);
                      }}
                      className={navItemClass}
                    >
                      <Cpu size={16} className="shrink-0 text-[#A0A0A8] group-hover:text-teal-400 transition-colors" />
                      <span className="text-[13px] font-medium">Switch Device</span>
                      <ChevronRight size={14} className="ml-auto text-[#6B7280] group-hover:text-[#A0A0A8] transition-colors" />
                    </button>
                  </div>
                </div>
              </nav>

              {/* Logout — disabled while staging auto-login is on */}
              <div className="flex-shrink-0 border-t border-slate-800/80 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={AUTO_LOGIN_ENABLED}
                  title={
                    AUTO_LOGIN_ENABLED
                      ? 'Sign out disabled during auto-login testing'
                      : 'Sign out'
                  }
                  className={cn(
                    'flex items-center gap-3 w-full px-3.5 py-3 rounded-2xl border border-transparent transition-colors group',
                    AUTO_LOGIN_ENABLED
                      ? 'text-[#6B7280]/50 cursor-not-allowed opacity-50 pointer-events-none'
                      : 'text-[#6B7280] hover:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/20'
                  )}
                >
                  <LogOut size={16} className="shrink-0" />
                  <span className="text-[13px] font-medium">Sign out</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

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
