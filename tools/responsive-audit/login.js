// Staff login through the API with a retry on the per-IP login throttle (429).
async function loginAdmin(ctx, api, fx) {
  for (let i = 0; i < 4; i++) {
    const res = await ctx.request.post(`${api}/auth/login`, { data: { email: fx.email, password: fx.password } });
    if (res.ok()) return;
    if (res.status() !== 429) throw new Error(`admin login failed: ${res.status()}`);
    await new Promise((r) => setTimeout(r, 65000));
  }
  throw new Error('admin login throttled');
}
module.exports = { loginAdmin };
