"use client";

import Input from "@/components/ui/Input";
import PasswordRequirements from "@/components/ui/PasswordRequirements";
import type { AccountSetupFormState } from "@/lib/useAccountSetupForm";

export default function AccountSetupStepPersonal({
  form,
  registerFieldRef,
}: {
  form: AccountSetupFormState;
  registerFieldRef: (field: string) => (el: HTMLElement | null) => void;
}) {
  return (
    <div className="space-y-4">
      <Input
        ref={registerFieldRef("firstName")}
        label="First Name"
        required
        autoComplete="given-name"
        value={form.firstName}
        onChange={(e) => form.firstNameHandlers.onChange(e.target.value)}
        onBlur={(e) => form.firstNameHandlers.onBlur(e.target.value)}
        error={form.touched.firstName ? form.fieldErrors.firstName : undefined}
      />
      <Input
        ref={registerFieldRef("email")}
        label="Email"
        type="email"
        required
        autoComplete="email"
        value={form.email}
        onChange={(e) => form.emailHandlers.onChange(e.target.value)}
        onBlur={(e) => form.emailHandlers.onBlur(e.target.value)}
        error={form.touched.email ? form.fieldErrors.email : undefined}
      />
      <Input
        ref={registerFieldRef("phone")}
        label="Phone Number"
        type="tel"
        required
        autoComplete="tel"
        placeholder="+971501234567"
        value={form.phone}
        onChange={(e) => form.phoneHandlers.onChange(e.target.value)}
        onBlur={(e) => form.phoneHandlers.onBlur(e.target.value)}
        error={form.touched.phone ? form.fieldErrors.phone : undefined}
      />
      <div>
        <Input
          ref={registerFieldRef("password")}
          label="Password"
          type="password"
          required
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => form.passwordHandlers.onChange(e.target.value)}
          onBlur={(e) => form.passwordHandlers.onBlur(e.target.value)}
          error={form.touched.password ? form.fieldErrors.password : undefined}
        />
        <PasswordRequirements password={form.password} />
      </div>
    </div>
  );
}
