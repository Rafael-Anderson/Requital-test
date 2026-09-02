"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { updateShopDomain } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import {
  normalizeCustomDomain,
  normalizePhone,
  normalizeTrn,
  slugifySubdomain,
  validateCustomDomain,
  validateEmail,
  validatePassword,
  validatePhone,
  validateRequired,
  validateSubdomain,
  validateTrn,
} from "@/lib/validators";

export type DomainType = "subdomain" | "custom";

export const BUSINESS_TYPES = ["Retail", "F&B", "Services", "Other"] as const;

export const OPERATING_MODELS = [
  { value: "online_only", label: "Online Only" },
  { value: "in_person_only", label: "In-Person Only" },
  { value: "both", label: "Both" },
] as const;
export type OperatingModelValue = (typeof OPERATING_MODELS)[number]["value"];

export const BRANCH_COUNTS = ["1", "2-5", "6-10", "10+"] as const;

// Purely informational for now (see CLAUDE.md's country-selector note) — not
// a general ISO-3166 list, just the Gulf markets this app already targets
// plus an escape hatch.
export const COUNTRIES = [
  "United Arab Emirates",
  "Saudi Arabia",
  "Qatar",
  "Kuwait",
  "Bahrain",
  "Oman",
  "Other",
] as const;

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
  subdomain: 1,
  customDomain: 1,
  address: 2,
  operatingModel: 2,
  branchCount: 2,
  country: 2,
};

export const FIELD_LABELS: Record<string, string> = {
  firstName: "First Name",
  email: "Email",
  phone: "Phone Number",
  password: "Password",
  businessName: "Business Name",
  businessType: "Business Type",
  trn: "TRN",
  subdomain: "Subdomain",
  customDomain: "Custom Domain",
  address: "Primary Location / Address",
  operatingModel: "Operating Model",
  branchCount: "Number of Branches",
  country: "Country",
};

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
    case "subdomain":
      return validateSubdomain(value).message;
    case "customDomain":
      return validateCustomDomain(value).message;
    case "address":
      return validateRequired(value, "Address").message;
    case "branchCount":
      return validateRequired(value, "Number of branches").message;
    case "country":
      return validateRequired(value, "Country").message;
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

  const [domainType, setDomainTypeRaw] = useState<DomainType>("subdomain");
  const [subdomain, setSubdomainRaw] = useState("");
  const [customDomain, setCustomDomainRaw] = useState("");
  // Once the user edits the subdomain field directly, stop overwriting it
  // from businessName — same "auto-fill until touched" convention as any
  // slug picker (e.g. a CMS post-URL field keyed off its title).
  const [subdomainManuallyEdited, setSubdomainManuallyEdited] = useState(false);

  const [address, setAddressRaw] = useState("");
  const [operatingModel, setOperatingModelRaw] = useState<OperatingModelValue | null>(null);
  const [branchCount, setBranchCountRaw] = useState("");
  // Default to the primary market this app already assumes elsewhere
  // (currency, timezone, phone normalization are all UAE-scoped today).
  const [country, setCountryRaw] = useState<string>("United Arab Emirates");
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
  const trnHandlers = normalizingHandlers("trn", setTrnRaw, normalizeTrn);
  const addressHandlers = fieldHandlers("address", setAddressRaw);

  const phoneHandlers = normalizingHandlers("phone", setPhoneRaw, normalizePhone);

  // businessName's own onChange/onBlur, plus (unless the user has directly
  // edited the subdomain field) keeping the subdomain picker's auto-filled
  // value in sync — same handler shape as fieldHandlers() above, just with
  // this one extra side effect.
  const businessNameHandlers = {
    onChange: (value: string) => {
      setBusinessNameRaw(value);
      if (touched.businessName) commitError("businessName", validateField("businessName", value));
      if (!subdomainManuallyEdited) setSubdomainRaw(slugifySubdomain(value));
    },
    onBlur: (value: string) => {
      markTouched("businessName");
      commitError("businessName", validateField("businessName", value));
    },
  };

  const subdomainHandlers = {
    onChange: (value: string) => {
      setSubdomainManuallyEdited(true);
      setSubdomainRaw(value);
      if (touched.subdomain) commitError("subdomain", validateField("subdomain", value));
    },
    onBlur: (value: string) => {
      const normalized = value.trim().toLowerCase();
      setSubdomainRaw(normalized);
      markTouched("subdomain");
      commitError("subdomain", validateField("subdomain", normalized));
    },
  };

  const customDomainHandlers = normalizingHandlers("customDomain", setCustomDomainRaw, normalizeCustomDomain);

  function setDomainType(value: DomainType) {
    setDomainTypeRaw(value);
    // Switching tabs shouldn't leave a validation error showing for the
    // field that's no longer even rendered.
    commitError(value === "subdomain" ? "customDomain" : "subdomain", undefined);
  }

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

  function setCountry(value: string) {
    setCountryRaw(value);
    markTouched("country");
    commitError("country", validateField("country", value));
  }

  const fieldValues: Record<string, string> = {
    firstName,
    email,
    phone,
    password,
    businessName,
    businessType,
    trn,
    subdomain,
    customDomain,
    address,
    branchCount,
    country,
  };

  // Validates every field on one wizard step, marking them all touched (so
  // inline errors render) and returning just that step's error map — used
  // both to gate "Next" and to build the cross-field error modal.
  function validateStep(step: number): Record<string, string> {
    let fields = Object.keys(FIELD_STEP).filter((f) => FIELD_STEP[f] === step);
    if (step === 1) {
      // Only the domain-picker field matching the currently-selected tab is
      // actually rendered — validating the hidden one would block "Next" on
      // an error the user can't even see.
      fields = fields.filter((f) => f !== (domainType === "subdomain" ? "customDomain" : "subdomain"));
    }
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
      // shop.subdomain is required regardless of which domain tab is
      // selected (it's still the internal /public/:shopSlug/... routing
      // slug) — subdomain itself already tracks businessName by default, so
      // this is only ever empty if the user cleared it by hand while on the
      // Custom domain tab, in which case falling back to a fresh slug is
      // better than sending an empty string.
      await signup({
        name: firstName,
        email,
        password,
        shopName: businessName,
        subdomain: subdomain || slugifySubdomain(businessName),
        phone,
        businessType,
        trn: trn.trim() || undefined,
        address,
        operatingModel: operatingModel ? [operatingModel] : [],
        branchCount,
        productEditorMode,
        country,
      });

      // A custom domain is a separate, optional connect step on top of the
      // account that was just created successfully — a failure here (a
      // race on the uniqueness check, a network blip) shouldn't surface as
      // "account creation failed" when it didn't. This only starts the claim
      // (a pending DNS-TXT verification); the merchant finishes it, adds the
      // DNS record, and can retry from Settings > Business Settings > Domain
      // (AccountSetup.tsx deep-links there after signup for the custom case).
      if (domainType === "custom" && customDomain.trim()) {
        try {
          await updateShopDomain({ type: "custom", customDomain: normalizeCustomDomain(customDomain) });
        } catch {
          toast("Account created. Finish connecting your custom domain in Settings > Domain.");
        }
      }
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
    domainType,
    setDomainType,
    subdomain,
    subdomainHandlers,
    customDomain,
    customDomainHandlers,
    address,
    addressHandlers,
    operatingModel,
    setOperatingModel,
    branchCount,
    setBranchCount,
    country,
    setCountry,
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
