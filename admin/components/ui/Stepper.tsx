"use client";

import { Check } from "lucide-react";

export type StepStatus = "completed" | "active" | "upcoming";

export interface StepperStep {
  label: string;
  status: StepStatus;
}

// Generic numbered-step progress indicator: filled teal circle for the
// active step, teal circle + checkmark for completed steps, grey outline for
// upcoming ones — connecting lines fill teal only between completed steps.
// Collapses to a plain "Step X of Y" label below `sm` since circles for 3+
// steps get cramped on narrow viewports.
export default function Stepper({
  steps,
  onStepClick,
}: {
  steps: StepperStep[];
  onStepClick?: (index: number) => void;
}) {
  const activeIndex = steps.findIndex((s) => s.status === "active");

  return (
    <nav aria-label="Progress">
      <p className="sm:hidden text-sm font-medium text-zinc-600 dark:text-zinc-400">
        Step {activeIndex + 1} of {steps.length}: {steps[activeIndex]?.label}
      </p>
      <ol className="hidden sm:flex items-center">
        {steps.map((step, i) => {
          const clickable = step.status === "completed" && !!onStepClick;
          return (
            <li key={step.label} className="flex items-center flex-1 last:flex-none">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onStepClick?.(i)}
                aria-current={step.status === "active" ? "step" : undefined}
                className={`flex items-center gap-2 shrink-0 ${clickable ? "cursor-pointer" : "cursor-default"}`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                    step.status === "upcoming"
                      ? "border-2 border-black/20 dark:border-white/20 text-zinc-400"
                      : "bg-accent text-white"
                  }`}
                >
                  {step.status === "completed" ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                <span
                  className={`text-sm ${
                    step.status === "active"
                      ? "font-semibold text-zinc-900 dark:text-zinc-100"
                      : step.status === "completed"
                        ? "font-medium text-zinc-600 dark:text-zinc-400"
                        : "text-zinc-400"
                  }`}
                >
                  {step.label}
                </span>
              </button>
              {i < steps.length - 1 && (
                <span
                  className={`mx-3 h-0.5 flex-1 rounded transition-colors ${
                    step.status === "completed" ? "bg-accent" : "bg-black/10 dark:bg-white/10"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
