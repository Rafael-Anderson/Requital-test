"use client";

import { useRef, useState } from "react";
import type { Product } from "@/lib/types";
import { FIELD_STEP, useProductForm } from "@/lib/useProductForm";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";
import Button from "@/components/ui/Button";
import PageShell from "@/components/ui/PageShell";
import Stepper, { type StepperStep } from "@/components/ui/Stepper";
import { useToast } from "@/components/ui/Toast";
import ProductFormStepBasics from "@/components/ProductFormStepBasics";
import ProductFormStepPricing from "@/components/ProductFormStepPricing";
import ProductFormStepOrganization from "@/components/ProductFormStepOrganization";
import VariantsSection from "@/components/VariantsSection";
import AttributesSection from "@/components/AttributesSection";
import FaqsSection from "@/components/FaqsSection";

const STEP_LABELS = ["Basics", "Pricing & Inventory", "Organization"];

const ADVANCED_SECTIONS = [
  { id: "basics", label: "Basics" },
  { id: "pricing", label: "Pricing & Inventory" },
  { id: "variants", label: "Variants" },
  { id: "attributes", label: "Attributes" },
  { id: "faqs", label: "FAQs" },
  { id: "organization", label: "Organization" },
];

export default function ProductForm({ product: initialProduct }: { product?: Product }) {
  const form = useProductForm(initialProduct);
  const toast = useToast();
  const isEdit = form.isEdit;

  // Editing an existing product opens on Step 1 (a merchant reviews from the
  // top) with every step already marked visited/completed, since the data
  // already exists for all three. A new product starts with only Step 1
  // visited — later steps unlock as Next is pressed.
  const [currentStep, setCurrentStep] = useState(0);
  const [visited, setVisited] = useState<Set<number>>(new Set(isEdit ? [0, 1, 2] : [0]));
  const [direction, setDirection] = useState<"forward" | "backward">("forward");

  const suppressGuardRef = useRef(false);
  useUnsavedChangesGuard(suppressGuardRef);

  function goToStep(index: number, dir: "forward" | "backward") {
    setDirection(dir);
    setCurrentStep(index);
    setVisited((prev) => new Set(prev).add(index));
  }

  function handleNext() {
    if (currentStep === 0 && !form.validateStep1()) return;
    goToStep(currentStep + 1, "forward");
  }

  function handleBack() {
    goToStep(currentStep - 1, "backward");
  }

  function handleStepperClick(index: number) {
    goToStep(index, index < currentStep ? "backward" : "forward");
  }

  async function handleFinalSubmit() {
    const { ok, fieldErrors } = await form.handleSubmit();
    if (ok) {
      suppressGuardRef.current = true;
      return;
    }
    const erroredFields = Object.keys(fieldErrors);
    if (erroredFields.length === 0) return; // save itself failed — that toast already fired
    const earliestStep = Math.min(...erroredFields.map((f) => FIELD_STEP[f] ?? 2));
    if (earliestStep < currentStep) {
      goToStep(earliestStep, "backward");
    }
    toast("Fix the highlighted fields to continue", "error");
  }

  // Advanced mode has no steps to jump between — on a validation failure,
  // scroll to the anchor section containing the earliest errored field
  // instead (same FIELD_STEP mapping, just resolved to a section id).
  async function handleAdvancedSubmit() {
    const { ok, fieldErrors } = await form.handleSubmit();
    if (ok) {
      suppressGuardRef.current = true;
      return;
    }
    const erroredFields = Object.keys(fieldErrors);
    if (erroredFields.length === 0) return;
    const earliestStep = Math.min(...erroredFields.map((f) => FIELD_STEP[f] ?? 2));
    const anchorId = ["basics", "pricing", "organization"][earliestStep] ?? "organization";
    document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Fix the highlighted fields to continue", "error");
  }

  function handleCancel() {
    suppressGuardRef.current = true;
    form.router.push("/products");
  }

  // Advanced mode: one scrollable page, no stepper/slide transitions — every
  // section stacked with a sticky left anchor nav (hidden below lg, per the
  // task's own "hand-roll it, no new deps" call) instead of Next/Back.
  // Variants/Attributes/FAQs render as their own top-level sections here
  // (ProductFormStepOrganization renders them itself in simple mode — see
  // hideFeatureSections).
  if (form.productEditorMode === "advanced") {
    return (
      <PageShell variant="wide">
        <div className="flex gap-6 flex-col lg:flex-row items-start">
          <nav className="hidden lg:block w-48 shrink-0 sticky top-6 space-y-1">
            {ADVANCED_SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="block px-3 py-1.5 rounded-lg text-sm text-text-secondary dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              >
                {s.label}
              </a>
            ))}
          </nav>

          <div className="flex-1 min-w-0 space-y-4">
            {form.error && <p className="text-red-600 text-sm">{form.error}</p>}

            <div id="basics" className="space-y-4 scroll-mt-6">
              <ProductFormStepBasics form={form} />
            </div>
            <div id="pricing" className="space-y-4 scroll-mt-6">
              <ProductFormStepPricing form={form} />
            </div>
            <div id="variants" className="scroll-mt-6">
              <VariantsSection
                product={form.product ?? null}
                enabled={form.showVariants}
                defaultOpen={false}
                onEnable={() => form.setShowVariants(true)}
                onDisable={() => form.setShowVariants(false)}
                onProductUpdate={form.setProduct}
                images={form.images}
                onImagesChange={form.setImages}
              />
            </div>
            <div id="attributes" className="scroll-mt-6">
              <AttributesSection
                attributes={form.attributes}
                onChange={form.setAttributes}
                enabled={form.showAttributes}
                defaultOpen={false}
                onEnable={() => form.setShowAttributes(true)}
                onDisable={() => form.setShowAttributes(false)}
              />
            </div>
            <div id="faqs" className="scroll-mt-6">
              <FaqsSection
                faqs={form.faqs}
                onChange={form.setFaqs}
                enabled={form.showFaqs}
                defaultOpen={false}
                onEnable={() => form.setShowFaqs(true)}
                onDisable={() => form.setShowFaqs(false)}
              />
            </div>
            <div id="organization" className="space-y-4 scroll-mt-6">
              <ProductFormStepOrganization form={form} hideFeatureSections />
            </div>

            <div className="sticky bottom-0 py-4 bg-[var(--background)] flex justify-between gap-2">
              <Button type="button" variant="secondary" onClick={handleCancel}>
                Cancel
              </Button>
              <div className="flex gap-2">
                {isEdit && (
                  <Button type="button" variant="secondary" onClick={form.handleDuplicate} disabled={form.duplicating}>
                    {form.duplicating ? "Duplicating…" : "Duplicate"}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleAdvancedSubmit}
                  disabled={form.saving}
                  loading={form.saving}
                >
                  {isEdit ? "Save changes" : "Create product"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  const steps: StepperStep[] = STEP_LABELS.map((label, i) => ({
    label,
    status: i === currentStep ? "active" : visited.has(i) ? "completed" : "upcoming",
  }));

  // "wide", not "form" — every step's own Cards manage internal grids
  // (Pricing's 3-up row, SKU/Barcode's 2-up row, etc.), which is exactly the
  // content shape PageShell.tsx's own doc comment calls out "wide" for
  // (it names this component as the example). "form"'s max-w-4xl cap was
  // tried here first and left ~700-1100px of dead space to the right of
  // Step 2's grids at 1024/1440px viewports — see tools/screenshot/
  // check-wizard-step2-width.js, the regression guard for this.
  return (
    <PageShell variant="wide">
      <div className="space-y-4">
        <div className="sticky top-0 z-10 bg-[var(--background)] pb-4">
          <Stepper steps={steps} onStepClick={handleStepperClick} />
        </div>

        {form.error && <p className="text-red-600 text-sm">{form.error}</p>}

        <div
          key={currentStep}
          className={`space-y-4 ${direction === "forward" ? "step-enter-forward" : "step-enter-backward"}`}
        >
          {currentStep === 0 && <ProductFormStepBasics form={form} />}
          {currentStep === 1 && <ProductFormStepPricing form={form} />}
          {currentStep === 2 && <ProductFormStepOrganization form={form} />}
        </div>

        <div className="sticky bottom-0 py-4 bg-[var(--background)] flex justify-between gap-2">
          <div className="flex gap-2">
            {currentStep > 0 && (
              <Button type="button" variant="secondary" onClick={handleBack}>
                Back
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
          <div className="flex gap-2">
            {isEdit && currentStep === 2 && (
              <Button type="button" variant="secondary" onClick={form.handleDuplicate} disabled={form.duplicating}>
                {form.duplicating ? "Duplicating…" : "Duplicate"}
              </Button>
            )}
            {currentStep < 2 ? (
              <Button type="button" variant="primary" onClick={handleNext}>
                Next
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                onClick={handleFinalSubmit}
                disabled={form.saving}
                loading={form.saving}
              >
                {isEdit ? "Save changes" : "Create product"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
