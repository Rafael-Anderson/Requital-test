import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest.config.ts doesn't set test.globals, so @testing-library/react's own
// auto-cleanup (which registers against a global `afterEach`) never fires —
// each render() left its DOM mounted for the next test, so a later test's
// document.querySelector could pick up a previous test's element. Explicit
// afterEach(cleanup) doesn't depend on that global and always runs.
afterEach(cleanup);
