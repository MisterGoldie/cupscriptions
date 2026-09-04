"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { SUPPLY } from "@/lib/cups";

export function JumpToCup({ className }: { className?: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const id = Number(value.trim());
    if (!Number.isInteger(id) || id < 1 || id > SUPPLY) return;
    router.push(`/cup/${id}`);
  }

  return (
    <form
      onSubmit={onSubmit}
      className={`flex items-center gap-2 ${className ?? ""}`}
    >
      <label htmlFor="jump-cup" className="sr-only">
        Jump to cup number
      </label>
      <input
        id="jump-cup"
        type="number"
        min={1}
        max={SUPPLY}
        inputMode="numeric"
        placeholder={`#1–${SUPPLY}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-28 border border-ash bg-ink-soft px-3 py-2 text-sm text-bone outline-none placeholder:text-mute/60 focus:border-volt"
      />
      <button
        type="submit"
        className="border border-ash px-3 py-2 text-sm text-bone transition hover:border-volt hover:text-volt"
      >
        Go
      </button>
    </form>
  );
}
