"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import {
  normalizePhone,
  normalizeTrn,
  normalizeWebsiteUrl,
  validateEmail,
  validatePassword,
  validatePhone,
  validateRequired,
  validateTrn,
  validateUrl,
} from "@/lib/validators";

export const BUSINESS_TYPES = ["Retail", "F&B", "Services", "Other"] as const;

export const OPERATING_MODELS = [
  { value: "online_only", label: "Online Only" },
  { value: "in_person_only", label: "In-Person Only" },
  { value: "both", label: "Both" },
] as const;
export type OperatingModelValue = (typeof OPERATING_MODELS)[number]["value"];

export const BRANCH_COUNTS = ["1", "2-5", "6-10", "10+"] as const;

export const STEP_LABELS = ["Personal Info", "Business Info", "Location & Setup", "Review & Confirm"];

// Which wizard step a validated field lives on — same jump-to-earliest-error
// technique as lib/useProductForm.ts's own FIELD_STEP.
export const FIELD_STEP: Record<string, number> = {
  firstName: 0,
  email: 0,
  phone: 0,
  password: 0,
  businessName: 1,
  businessType: 1,
  trn: 1,
  websiteUrl: 1,
  address: 2,
  operatingModel: 2,
  branchCount: 2,
};

export const FIELD_LABELS: Record<string, string> = {
  firstName: "First Name",
  email: "Email",
  phone: "Phone Number",
  password: "Password",
  businessName: "Business Name",
  businessType: "Business Type",
  trn: "TRN",
  websiteUrl: "Website URL",
  address: "Primary Location / Address",
  operatingModel: "Operating Model",
  branchCount: "Number of Branches",
};

function slugifySubdomain(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function validateField(field: string, value: string): string | undefined {
  switch (field) {
    case "firstName":
      return validateRequired(value, "First name").message;
    case "email":
      return validateEmail(value).message;
    case "phone":
      return validatePhone(value).message;
    case "password":
      return validatePassword(value).message;
    case "businessName":
      return validateRequired(value, "Business name").message;
    case "businessType":
      return validateRequired(value, "Business type").message;
    case "trn":
      return validateTrn(value).message;
    case "websiteUrl":
      return validateUrl(value).message;
    case "address":
      return validateRequired(value, "Address").message;
    case "branchCount":
      return validateRequired(value, "Number of branches").message;
    default:
      return undefined;
  }
}

// All Account Setup wizard state/validation/submit logic — mirrors
// lib/useProductForm.ts's split (state+logic here, presentation in the step
// components + AccountSetup.tsx's wizard shell).
export function useAccountSetupForm() {
  const router = useRouter();
  const { signup } = useAuth();
  const toast = useToast();

  const [firstName, setFirstNameRaw] = useState("");
  const [email, setEmailRaw] = useState("");
  const [phone, setPhoneRaw] = useState("");
  const [password, setPasswordRaw] = useState("");

  const [businessName, setBusinessNameRaw] = useState("");
  const [businessType, setBusinessTypeRaw] = useState("");
  const [trn, setTrnRaw] = useState("");
  const [websiteUrl, setWebsiteUrlRaw] = useState("");

  const [address, setAddressRaw] = useState("");
  const [operatingModel, setOperatingModelRaw] = useState<OperatingModelValue | null>(null);
  const [branchCount, setBranchCountRaw] = useState("");
  const [productEditorMode, setProductEditorMode] = useState<"simple" | "advanced">("simple");

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Sets (or clears) one field's error. Fires the "looks good" toast
  // specifically on the invalid -> valid transition, not on every field that
  // simply validates fine the first time it's touched.
  function commitError(field: string, message: string | undefined) {
    const hadError = !!fieldErrors[field];
    if (!message) {
      if (hadError) {
        setFieldErrors((prev) => {
          const next = { ...prev };
          delete next[field];
          return next;
        });
        toast(`✓ ${FIELD_LABELS[field]} looks good`);
      }
      return;
    }
    setFieldErrors((prev) => (prev[field] === message ? prev : { ...prev, [field]: message }));
  }

  function markTouched(field: string) {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }

  // Shared onChange/onBlur pair for every plain string field: onChange only
  // re-validates live once the field has already been touched (an error
  // shouldn't appear before the user's first chance to finish typing/blur).
  function fieldHandlers(field: string, setValue: (v: string) => void) {
    return {
      onChange: (value: string) => {
        setValue(value);
        if (touched[field]) commitError(field, validateField(field, value));
      },
      onBlur: (value: string) => {
        markTouched(field);
        commitError(field, validateField(field, value));
      },
    };
  }

  // Same onChange as fieldHandlers(), but onBlur also normalizes the raw
  // typed value to its canonical stored format (E.164 phone, https://-
  // prefixed URL, digits-only TRN) before validating — so a forgiving format
  // typed by the user (a local phone number, a bare domain, a dashed TRN)
  // both validates and displays as the canonical form afterward.
  function normalizingHandlers(field: string, setValue: (v: string) => void, normalize: (v: string) => string) {
    return {
      onChange: (value: string) => {
        setValue(value);
        if (touched[field]) commitError(field, validateField(field, value));
      },
      onBlur: (value: string) => {
        const normalized = normalize(value);
        setValue(normalized);
        markTouched(field);
        commitError(field, validateField(field, normalized));
      },
    };
  }

  const firstNameHandlers = fieldHandlers("firstName", setFirstNameRaw);
  const emailHandlers = fieldHandlers("email", setEmailRaw);
  const passwordHandlers = fieldHandlers("password", setPasswordRaw);
  const businessNameHandlers = fieldHandlers("businessName", setBusinessNameRaw);
  const trnHandlers = normalizingHandlers("trn", setTrnRaw, normalizeTrn);
  const websiteUrlHandlers = normalizingHandlers("websiteUrl", setWebsiteUrlRaw, normalizeWebsiteUrl);
  const addressHandlers = fieldHandlers("address", setAddressRaw);

  const phoneHandlers = normalizingHandlers("phone", setPhoneRaw, normalizePhone);

  function setBusinessType(value: string) {
    setBusinessTypeRaw(value);
    markTouched("businessType");
    commitError("businessType", validateField("businessType", value));
  }

  function setOperatingModel(value: OperatingModelValue) {
    setOperatingModelRaw(value);
    markTouched("operatingModel");
    commitError("operatingModel", undefined);
  }

  function setBranchCount(value: string) {
    setBranchCountRaw(value);
    markTouched("branchCount");
    commitError("branchCount", validateField("branchCount", value));
  }

  const fieldValues: Record<string, string> = {
    firstName,
    email,
    phone,
    password,
    businessName,
    businessType,
    trn,
    websiteUrl,
    address,
    branchCount,
  };

  // Validates every field on one wizard step, marking them all touched (so
  // inline errors render) and returning just that step's error map — used
  // both to gate "Next" and to build the cross-field error modal.
  function validateStep(step: number): Record<string, string> {
    const fields = Object.keys(FIELD_STEP).filter((f) => FIELD_STEP[f] === step);
    const errors: Record<string, string> = {};
    for (const field of fields) {
      const message =
        field === "operatingModel"
          ? operatingModel === null
            ? "Select an option"
            : undefined
          : validateField(field, fieldValues[field]);
      if (message) errors[field] = message;
    }
    setTouched((prev) => {
      const next = { ...prev };
      for (const field of fields) next[field] = true;
      return next;
    });
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const field of fields) {
        if (errors[field]) next[field] = errors[field];
        else delete next[field];
      }
      return next;
    });
    return errors;
  }

  function validateAll(): Record<string, string> {
    return { ...validateStep(0), ...validateStep(1), ...validateStep(2) };
  }

  async function handleSubmit(): Promise<{ ok: boolean; errors: Record<string, string> }> {
    const errors = validateAll();
    if (Object.keys(errors).length > 0) {
      setSubmitError(null);
      return { ok: false, errors };
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await signup({
        name: firstName,
        email,
        password,
        shopName: businessName,
        subdomain: slugifySubdomain(businessName),
        phone,
        businessType,
        trn: trn.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
        address,
        operatingModel: operatingModel ? [operatingModel] : [],
        branchCount,
        productEditorMode,
      });
      return { ok: true, errors: {} };
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create account");
      return { ok: false, errors: {} };
    } finally {
      setSubmitting(false);
    }
  }

  return {
    router,
    firstName,
    firstNameHandlers,
    email,
    emailHandlers,
    phone,
    phoneHandlers,
    password,
    passwordHandlers,
    businessName,
    businessNameHandlers,
    businessType,
    setBusinessType,
    trn,
    trnHandlers,
    websiteUrl,
    websiteUrlHandlers,
    address,
    addressHandlers,
    operatingModel,
    setOperatingModel,
    branchCount,
    setBranchCount,
    productEditorMode,
    setProductEditorMode,
    touched,
    fieldErrors,
    submitting,
    submitError,
    setSubmitError,
    validateStep,
    validateAll,
    handleSubmit,
  };
}

export type AccountSetupFormState = ReturnType<typeof useAccountSetupForm>;
