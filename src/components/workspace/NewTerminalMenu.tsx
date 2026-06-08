import { useMemo, useRef, useState } from 'react';
import type { TerminalProfile, Workspace } from '../../shared/types';

interface Props { workspaces: Workspace[]; profiles: TerminalProfile[]; defaultProfileId?: string; onCreate(input: { workspace: Workspace; profileId: string }): Promise<void>; }

export function NewTerminalMenu({ workspaces, profiles, defaultProfileId, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [profileId, setProfileId] = useState(defaultProfileId ?? profiles[0]?.id ?? 'powershell');
  const ref = useRef<HTMLDivElement | null>(null);
  const filtered = useMemo(() => workspaces.filter((workspace) => `${workspace.name} ${workspace.path}`.toLowerCase().includes(query.toLowerCase())), [query, workspaces]);
  return (
    <div className="new-terminal-menu" ref={ref}>
      <button className="primary" onClick={() => setOpen((value) => !value)}>New Terminal ▾</button>
      {open ? <div className="new-terminal-popover">
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Workspace" />
        <div className="profile-pills">{profiles.map((profile) => <button key={profile.id} className={profile.id === profileId ? 'ghost active-toggle' : 'ghost'} onClick={() => setProfileId(profile.id)}>{profile.name}</button>)}</div>
        <div className="workspace-pick-list">{filtered.map((workspace) => <button key={workspace.id} className="workspace-pick" onClick={async () => { setOpen(false); await onCreate({ workspace, profileId }); }}><strong>{workspace.name}</strong><small>{workspace.path}</small></button>)}</div>
      </div> : null}
    </div>
  );
}
