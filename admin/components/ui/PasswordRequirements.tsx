"use client";

import { Check, Minus } from "lucide-react";
import { passwordRequirements } from "@/lib/validators";

// Live checklist below the Account Setup wizard's password field — grey
// dash for an unmet requirement, green check once it's met. Reads the same
// four conditions validatePassword() enforces (see lib/validators.ts) so the
// checklist can't silently drift from what actually gates the field.
export default function PasswordRequirements({ password }: { password: string }) {
  return (
    <ul className="mt-2 space-y-1">
      {passwordRequirements(password).map((req) => (
        <li
          key={req.label}
          className={`flex items-center gap-1.5 text-xs ${
            req.met ? "text-green-600 dark:text-green-400" : "text-zinc-400"
          }`}
        >
          {req.met ? <Check className="size-3.5 shrink-0" /> : <Minus className="size-3.5 shrink-0" />}
          {req.label}
        </li>
      ))}
    </ul>
  );
}
