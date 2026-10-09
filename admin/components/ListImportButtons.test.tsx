import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  CollectionImportButton,
  CustomerImportButton,
} from "./ListImportButtons";

afterEach(cleanup);

let role = "admin";
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { role } }) }));

describe("import buttons", () => {
  it("show for an admin", () => {
    role = "admin";
    render(
      <>
        <CollectionImportButton onImported={() => {}} />
        <CustomerImportButton onImported={() => {}} />
      </>,
    );
    expect(screen.getAllByRole("button", { name: /Import/ })).toHaveLength(2);
  });

  it.each(["viewer", "branch", "order_manager"])("are hidden for %s", (r) => {
    role = r;
    render(
      <>
        <CollectionImportButton onImported={() => {}} />
        <CustomerImportButton onImported={() => {}} />
      </>,
    );
    expect(screen.queryByRole("button", { name: /Import/ })).toBeNull();
  });
});
