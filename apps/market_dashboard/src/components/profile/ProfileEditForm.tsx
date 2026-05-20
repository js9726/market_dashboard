"use client";

import { useCallback, useEffect, useState } from "react";

interface ProfileDto {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  username: string | null;
  bio: string | null;
  dashboardTagline: string | null;
  publicProfileEnabled: boolean;
}

const BIO_MAX = 200;
const TAGLINE_MAX = 60;

export default function ProfileEditForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileDto | null>(null);

  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [tagline, setTagline] = useState("");
  const [publicEnabled, setPublicEnabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSavedAt(null);
    try {
      const r = await fetch("/api/user/profile", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const p = (await r.json()) as ProfileDto;
      setProfile(p);
      setUsername(p.username ?? "");
      setBio(p.bio ?? "");
      setTagline(p.dashboardTagline ?? "");
      setPublicEnabled(p.publicProfileEnabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const r = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim() || null,
          bio: bio || null,
          dashboardTagline: tagline || null,
          publicProfileEnabled: publicEnabled,
        }),
      });
      const payload = (await r.json()) as { error?: string } & Partial<ProfileDto>;
      if (!r.ok) throw new Error(payload.error || `HTTP ${r.status}`);
      setProfile(payload as ProfileDto);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="market-panel p-5">
      <div className="market-section-head">
        <div>
          <p className="t-overline">Profile</p>
          <p className="t-caption">
            Your public identity on the leaderboard + at <code>/profile/&lt;username&gt;</code>.
            Toggle visibility off to hide your profile completely.
          </p>
        </div>
        {profile ? (
          <p className="t-caption t-mono">{profile.email}</p>
        ) : null}
      </div>

      {error ? <p className="mb-3 t-caption text-[var(--loss-fg)]">{error}</p> : null}
      {savedAt ? <p className="mb-3 t-caption text-[var(--gain-fg)]">Saved at {savedAt}</p> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Username">
          <div className="flex items-center gap-1 rounded border border-[var(--line)] bg-[var(--bg-surface)] px-3 py-2">
            <span className="font-mono text-[var(--fg-3)]">@</span>
            <input
              type="text"
              value={username}
              disabled={loading}
              maxLength={30}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="trader_handle"
              className="flex-1 bg-transparent font-mono text-[13px] outline-none"
              pattern="[a-z0-9_]{3,30}"
              title="3-30 chars; lowercase letters, digits, underscore"
            />
          </div>
          <p className="mt-1 t-caption">
            3-30 chars, lowercase letters, digits, underscores. Public URL: {" "}
            <code>/profile/{username.trim() || "<empty>"}</code>
          </p>
        </Field>

        <Field label="Dashboard Tagline">
          <input
            type="text"
            value={tagline}
            disabled={loading}
            maxLength={TAGLINE_MAX}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="Trust the process. Execute the plan."
            className="w-full rounded border border-[var(--line)] bg-[var(--bg-surface)] px-3 py-2 text-[13px]"
          />
          <p className="mt-1 t-caption">{tagline.length} / {TAGLINE_MAX}</p>
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Bio">
          <textarea
            rows={3}
            value={bio}
            disabled={loading}
            maxLength={BIO_MAX}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Tell others about your trading style, setups, or edge."
            className="w-full rounded border border-[var(--line)] bg-[var(--bg-surface)] px-3 py-2 text-[13px] leading-relaxed"
          />
          <p className="mt-1 t-caption">{bio.length} / {BIO_MAX}</p>
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-md bg-[var(--bg-raised)] p-3">
        <input
          id="public-toggle"
          type="checkbox"
          checked={publicEnabled}
          disabled={loading}
          onChange={(e) => setPublicEnabled(e.target.checked)}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        <label htmlFor="public-toggle" className="text-[13px]">
          <span className="font-medium">Show me on the public Leaderboard</span>
          <span className="ml-2 t-caption">
            (your username, bio, tagline + composite score become visible to other signed-in users)
          </span>
        </label>
      </div>

      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={load}
          disabled={loading || saving}
          className="mds-button h-9 px-4 text-[12px]"
        >
          Discard changes
        </button>
        <button
          type="button"
          onClick={save}
          disabled={loading || saving}
          className="mds-button mds-button--primary h-9 px-4 text-[12px]"
        >
          {saving ? "Saving..." : "Save profile"}
        </button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="t-overline">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
