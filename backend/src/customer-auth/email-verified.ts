// What the API reports as `emailVerified`: the address currently on the account
// is the one the owner proved. Derived, never stored, so it cannot drift from
// verifiedEmail.
export function isEmailVerified(c: {
  email: string | null;
  verifiedEmail: string | null;
}): boolean {
  return (
    !!c.email &&
    !!c.verifiedEmail &&
    c.email.toLowerCase() === c.verifiedEmail.toLowerCase()
  );
}
