import { LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { getAdminProfile } from '../AdminGuard';

export default function AdminHeader() {
  const navigate = useNavigate();
  const admin = getAdminProfile();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  return (
    <header className="h-14 bg-[#0d0d1a] border-b border-[#1e1e3a] flex items-center justify-between px-6 flex-shrink-0">
      <div /> {/* Placeholder for breadcrumbs */}
      <div className="flex items-center gap-4">
        {admin && (
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
              style={{ backgroundColor: admin.avatar_color }}
            >
              {admin.username[0]?.toUpperCase()}
            </div>
            <div className="text-right">
              <div className="text-white text-xs font-semibold leading-tight">{admin.username}</div>
              <div className="text-slate-500 text-[10px] leading-tight capitalize">{admin.role.replace('_', ' ')}</div>
            </div>
          </div>
        )}
        <button
          onClick={handleSignOut}
          className="p-2 text-slate-500 hover:text-white hover:bg-[#1a1a2e] rounded-lg transition-colors"
          title="Sign out"
        >
          <LogOut size={15} />
        </button>
      </div>
    </header>
  );
}
