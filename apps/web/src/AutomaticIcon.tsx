import { createContext, useContext, useState, type ReactNode } from 'react';
import type { HomepageShortcut } from '@luypage/contracts';
import { useWorkspace } from './data';

const AutomaticIcons = createContext(false);
export function AutomaticIconsProvider({ children }: { children: ReactNode }) {
  const { bootstrap } = useWorkspace(true, false);
  return <AutomaticIcons.Provider value={bootstrap.data?.preferences.autoIcons ?? false}>{children}</AutomaticIcons.Provider>;
}
export function AutomaticIcon({ bookmark, children }: { bookmark: HomepageShortcut; children: ReactNode }) {
  const enabled = useContext(AutomaticIcons);
  return enabled && bookmark.icon.type === 'auto'
    ? <RemoteIcon key={`${bookmark.id}:${bookmark.url}`} bookmark={bookmark}>{children}</RemoteIcon>
    : children;
}
function RemoteIcon({ bookmark, children }: { bookmark: HomepageShortcut; children: ReactNode }) {
  const [failed, setFailed] = useState(false);
  return failed ? children : <img className="automatic-site-icon" src={`/api/bookmarks/${encodeURIComponent(bookmark.id)}/icon`} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
