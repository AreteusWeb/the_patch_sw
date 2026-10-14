import React, { useState } from 'react';
import { Cpu, LogOut, User } from 'lucide-react';
import useStore from '../store/useStore';
import { logout } from '../hooks/useAuth';
import { AUTO_LOGIN_ENABLED, GENERAL_MODE_ENABLED } from '../lib/appConfig';
import { AGENT_PRODUCT_NAME, DEVELOPMENT_DISCLAIMER } from '../lib/agent';
import AiCoachPanel from './desktop/AiCoachPanel';
import ProfileDrawer from './ProfileDrawer';
import { cn } from '../utils/cn';

const iconButtonClass =
  'flex items-center justify-center gap-1.5 h-9 min-w-9 px-2.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors';

/**
 * StandaloneAgentScreen
 * Full-page AI agent for signed-in users without a Patch. Reuses AiCoachPanel
 * (no live vitals, no charts) and keeps a way back to device selection.
 */
export default function StandaloneAgentScreen() {
  const setStandaloneAgentActive = useStore(s => s.setStandaloneAgentActive);
  const [profileOpen, setProfileOpen] = useState(false);

  const goToDevices = () => setStandaloneAgentActive(false);

  const headerActions = (
    <>
      <button
        type="button"
        onClick={goToDevices}
        className={cn(
          iconButtonClass,
          'bg-teal-500/15 border border-teal-500/40 text-teal-300 hover:bg-teal-500/25 hover:text-teal-200'
        )}
        title="Connect your Patch to access your vitals"
      >
        <Cpu size={14} />
        <span className="hidden lg:inline">Connect Patch</span>
      </button>
      <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-slate-900/50 border border-slate-800/90">
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          className={cn(iconButtonClass, 'text-[#A0A0A8] hover:bg-slate-800/80 hover:text-[#F5F5F5]')}
          title="Profile"
          aria-label="Profile"
        >
          <User size={14} />
          <span className="hidden xl:inline">Profile</span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (!AUTO_LOGIN_ENABLED) void logout();
          }}
          disabled={AUTO_LOGIN_ENABLED}
          title={
            AUTO_LOGIN_ENABLED
              ? 'Sign out disabled during auto-login testing'
              : 'Sign out'
          }
          aria-label="Sign out"
          className={cn(
            iconButtonClass,
            AUTO_LOGIN_ENABLED
              ? 'text-[#6B7280]/50 cursor-not-allowed opacity-50'
              : 'text-[#A0A0A8] hover:bg-rose-500/10 hover:text-rose-400'
          )}
        >
          <LogOut size={14} />
          <span className="hidden xl:inline">Sign out</span>
        </button>
      </div>
    </>
  );

  return (
    <div
      className="fixed inset-0 bg-black text-slate-100 font-sans selection:bg-teal-500/30 overflow-hidden flex flex-col pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]"
      style={{ height: '100dvh' }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-teal-900/15 blur-[140px] rounded-full" />
      </div>

      <main className="relative flex-1 min-h-0">
        <AiCoachPanel
          presentation="page"
          noDevice
          enableGeneralMode={GENERAL_MODE_ENABLED}
          title={AGENT_PRODUCT_NAME}
          headerActions={headerActions}
          onConnectDevice={goToDevices}
        />
      </main>

      <footer className="relative flex-shrink-0 px-4 pb-2.5 pt-1">
        <p className="text-[9px] text-slate-600 uppercase tracking-wider text-center">
          {DEVELOPMENT_DISCLAIMER}
        </p>
      </footer>

      <ProfileDrawer open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
