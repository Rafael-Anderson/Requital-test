"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import AuthCard from "@/components/auth/AuthCard";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import Stepper, { type StepperStep } from "@/components/ui/Stepper";
import FieldErrorMessage from "@/components/ui/FieldErrorMessage";
import { useToast } from "@/components/ui/Toast";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";
import { FIELD_LABELS, FIELD_STEP, STEP_LABELS, useAccountSetupForm } from "@/lib/useAccountSetupForm";
import AccountSetupStepPersonal from "@/components/AccountSetupStepPersonal";
import AccountSetupStepBusiness from "@/components/AccountSetupStepBusiness";
import AccountSetupStepLocation from "@/components/AccountSetupStepLocation";
import AccountSetupStepReview from "@/components/AccountSetupStepReview";

// Card is wider than the other pre-auth screens (AuthCard's max-w-sm
// default) so Steps 2-3's field groups have room, same "measure the real
// content before capping the width" reasoning as PageShell's variants
// (see CLAUDE.md's "Page width convention").
const WIZARD_CARD_WIDTH = "max-w-2xl";

// Focus-after-jump waits this long — matches Modal.tsx's own exit-animation
// duration so it runs after the modal has actually unmounted, not mid-fade.
const MODAL_EXIT_MS = 160;

export default function AccountSetup() {
  const form = useAccountSetupForm();
  const toast = useToast();

  const [currentStep, setCurrentStep] = useState(0);
  const [visited, setVisited] = useState<Set<number>>(new Set([0]));
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [crossFieldErrors, setCrossFieldErrors] = useState<string[] | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);

  const suppressGuardRef = useRef(false);
  useUnsavedChangesGuard(suppressGuardRef);

  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  function registerFieldRef(field: string) {
    return (el: HTMLElement | null) => {
      fieldRefs.current[field] = el;
    };
  }

  function goToStep(index: number, dir: "forward" | "backward") {
    setDirection(dir);
    setCurrentStep(index);
    setVisited((prev) => new Set(prev).add(index));
  }

  function jumpToEarliestError(erroredFields: string[]) {
    const earliestStep = Math.min(...erroredFields.map((f) => FIELD_STEP[f] ?? 0));
    const earliestField = erroredFields.find((f) => FIELD_STEP[f] === earliestStep) ?? erroredFields[0];
    goToStep(earliestStep, earliestStep < currentStep ? "backward" : "forward");
    setTimeout(() => {
      const el = fieldRefs.current[earliestField];
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus?.();
    }, MODAL_EXIT_MS);
  }

  function handleNext() {
    const errors = form.validateStep(currentStep);
    if (Object.keys(errors).length === 0) {
      toast(`✓ ${STEP_LABELS[currentStep]} complete`);
      goToStep(currentStep + 1, "forward");
    } else {
      setCrossFieldErrors(Object.keys(errors));
    }
  }

  function handleBack() {
    goToStep(currentStep - 1, "backward");
  }

  function handleStepperClick(index: number) {
    goToStep(index, index < currentStep ? "backward" : "forward");
  }

  async function handleCreateAccount() {
    const { ok, errors } = await form.handleSubmit();
    if (ok) {
      suppressGuardRef.current = true;
      setSuccessOpen(true);
      return;
    }
    if (Object.keys(errors).length > 0) {
      setCrossFieldErrors(Object.keys(errors));
    }
    // Otherwise a real backend error — form.submitError drives the error modal below.
  }

  function handleEnterApp() {
    suppressGuardRef.current = true;
    form.router.push("/");
  }

  function handleErrorBack() {
    form.setSubmitError(null);
    goToStep(0, "backward");
  }

  const steps: StepperStep[] = STEP_LABELS.map((label, i) => ({
    label,
    status: i === currentStep ? "active" : visited.has(i) ? "completed" : "upcoming",
  }));

  const crossFieldEarliestStep = crossFieldErrors
    ? Math.min(...crossFieldErrors.map((f) => FIELD_STEP[f] ?? 0))
    : 0;

  return (
    <AuthCard heading="Set up your account" subtitle="A few details to get your shop ready" maxWidthClassName={WIZARD_CARD_WIDTH}>
      <div className="space-y-5">
        <Stepper steps={steps} onStepClick={handleStepperClick} />

        <div key={currentStep} className={direction === "forward" ? "step-enter-forward" : "step-enter-backward"}>
          {currentStep === 0 && <AccountSetupStepPersonal form={form} registerFieldRef={registerFieldRef} />}
          {currentStep === 1 && <AccountSetupStepBusiness form={form} registerFieldRef={registerFieldRef} />}
          {currentStep === 2 && <AccountSetupStepLocation form={form} registerFieldRef={registerFieldRef} />}
          {currentStep === 3 && <AccountSetupStepReview form={form} />}
        </div>

        <div className="flex justify-between gap-2 pt-2">
          {currentStep > 0 ? (
            <Button type="button" variant="secondary" onClick={handleBack}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {currentStep < 3 ? (
            <Button type="button" variant="primary" onClick={handleNext}>
              Next
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              onClick={handleCreateAccount}
              disabled={form.submitting}
              loading={form.submitting}
            >
              {form.submitting ? "Creating…" : "Create Account"}
            </Button>
          )}
        </div>

        <p className="text-sm text-center text-zinc-500 dark:text-zinc-400">
          Already have a shop?{" "}
          <Link href="/login" className="underline decoration-transparent hover:decoration-current">
            Sign in
          </Link>
        </p>
      </div>

      {crossFieldErrors && (
        <Modal
          title="Fix these issues to continue"
          size="sm"
          onClose={() => setCrossFieldErrors(null)}
          footer={(requestClose) => (
            <>
              <Button variant="secondary" onClick={requestClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  jumpToEarliestError(crossFieldErrors);
                  requestClose();
                }}
              >
                Back to Step {crossFieldEarliestStep + 1}
              </Button>
            </>
          )}
        >
          <ul className="space-y-2">
            {crossFieldErrors.map((field) => (
              <li key={field}>
                <FieldErrorMessage message={`${FIELD_LABELS[field]}: ${form.fieldErrors[field]}`} />
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {form.submitError && (
        <Modal
          title="Unable to create account"
          size="sm"
          onClose={() => form.setSubmitError(null)}
          footer={(requestClose) => (
            <>
              <Button variant="secondary" onClick={() => { handleErrorBack(); requestClose(); }}>
                Back
              </Button>
              <Button variant="primary" onClick={requestClose}>
                Try Again
              </Button>
            </>
          )}
        >
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{form.submitError}</p>
        </Modal>
      )}

      {successOpen && (
        // onClose === handleEnterApp: the modal has no header/X (title
        // omitted), so its only close paths are the CTA and Escape — with
        // the account already created, both should have the same effect
        // rather than leaving a half-closed modal behind (see Modal.tsx's
        // always-on Escape handling, which this component has no prop to
        // opt out of).
        <Modal title={undefined} size="sm" onClose={handleEnterApp} bodyClassName="text-center">
          <CheckCircle2 className="mx-auto size-12 text-accent" />
          <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-white">Welcome, {form.firstName}!</h2>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            Your account is ready. Let&apos;s get you set up.
          </p>
          <Button variant="primary" className="w-full mt-6" onClick={handleEnterApp}>
            Enter App
          </Button>
        </Modal>
      )}
    </AuthCard>
  );
}
