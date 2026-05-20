"use client";

import { MOOD_OPTIONS } from "@/lib/journal/mood";

interface Props {
  value: string | null;
  onChange: (emoji: string | null) => void;
  disabled?: boolean;
}

/**
 * 5-button emoji selector for the daily mood field. Click the same emoji to
 * clear the selection (so user can un-set without a separate Clear button).
 */
export default function MoodEmojiPicker({ value, onChange, disabled }: Props) {
  return (
    <div className="flex items-center gap-2" role="radiogroup" aria-label="Mood">
      {MOOD_OPTIONS.map((opt) => {
        const active = value === opt.emoji;
        return (
          <button
            key={opt.emoji}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            title={opt.label}
            disabled={disabled}
            onClick={() => onChange(active ? null : opt.emoji)}
            className={`flex h-9 w-9 items-center justify-center rounded-full text-lg transition ${
              active
                ? "bg-[var(--accent-soft-bg)] ring-2 ring-[var(--accent)]"
                : "bg-[var(--bg-raised)] hover:bg-[var(--bg-elev)]"
            } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            <span aria-hidden>{opt.emoji}</span>
          </button>
        );
      })}
    </div>
  );
}
