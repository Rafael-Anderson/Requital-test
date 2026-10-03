"use client";

import { useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import ChangePasswordModal from "@/components/ChangePasswordModal";

export default function PasswordCard() {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-text-primary dark:text-zinc-50">Password</h2>
          <p className="mt-1 text-sm text-text-muted">
            Use a long, unusual phrase. Common passwords and ones found in known data breaches are not accepted.
            Changing it signs you out everywhere.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Change password
        </Button>
      </div>
      {open && <ChangePasswordModal onClose={() => setOpen(false)} />}
    </Card>
  );
}
