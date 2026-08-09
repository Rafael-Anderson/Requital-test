"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Wallet, ClipboardList, Calendar, CalendarClock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useShopMode } from "@/lib/useShopMode";
import { getCustomer, updateCustomer } from "@/lib/api";
import { normalizePhone } from "@/lib/validators";
import type { CustomerDetail } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import Skeleton, { CardSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import StatCard from "@/components/ui/StatCard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import BackButton from "@/components/ui/BackButton";
import StatusBadge from "@/components/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";

// Admin-only, same as the list page — see app/customers/page.tsx.
export default function CustomerDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const customerId = Number(params.id);
  const toast = useToast();
  const mode = useShopMode();
  const isSimple = mode === "simple";

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthday, setBirthday] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && user && user.role !== "admin") router.replace("/");
  }, [authLoading, user, router]);

  const refresh = useCallback(async () => {
    try {
      const data = await getCustomer(customerId);
      setCustomer(data);
      setName(data.name);
      setPhone(data.phone);
      setEmail(data.email ?? "");
      setBirthday(data.birthday ? data.birthday.slice(0, 10) : "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load customer");
    }
  }, [customerId]);

  useEffect(() => {
    if (user?.role === "admin") refresh();
  }, [refresh, user]);

  if (user && user.role !== "admin") return null;

  async function handleSave() {
    setSaving(true);
    try {
      await updateCustomer(customerId, {
        name,
        phone,
        email: email || undefined,
        birthday: birthday || undefined,
      });
      toast("Customer updated");
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update customer", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell>
      <BackButton href="/customers" />
      <h1 className="text-2xl font-semibold mb-4">{customer?.name ?? "Customer"}</h1>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      {!customer && !error ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
          <Skeleton className="h-48 w-full" />
        </div>
      ) : customer ? (
        <div className="space-y-6">
          {!isSimple && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Orders" value={String(customer.orderCount)} icon={<ClipboardList className="size-4" />} />
              <StatCard
                label="Lifetime Value"
                value={`${customer.lifetimeValue.toFixed(2)} AED`}
                icon={<Wallet className="size-4" />}
                subtext="Excludes cancelled orders"
              />
              <StatCard
                label="First Order"
                value={customer.firstOrderDate ? new Date(customer.firstOrderDate).toLocaleDateString() : "—"}
                icon={<Calendar className="size-4" />}
              />
              <StatCard
                label="Last Order"
                value={customer.lastOrderDate ? new Date(customer.lastOrderDate).toLocaleDateString() : "—"}
                icon={<CalendarClock className="size-4" />}
              />
            </div>
          )}

          <Card>
            <h2 className="font-medium mb-4">Contact info</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <Input
                label="Phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={(e) => setPhone(normalizePhone(e.target.value))}
              />
              <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              {!isSimple && (
                <Input
                  label="Birthday"
                  type="date"
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                />
              )}
            </div>
            <div className="flex justify-end mt-4">
              <Button variant="primary" onClick={handleSave} disabled={saving} loading={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </Card>

          <div>
            <h2 className="font-medium mb-3">Order history</h2>
            <Table>
              <THead>
                <tr>
                  <TH>Ref No</TH>
                  <TH>Status</TH>
                  <TH>Type</TH>
                  <TH>Grand Total</TH>
                  <TH>Placed At</TH>
                </tr>
              </THead>
              <TBody>
                {customer.orders.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState title="No orders yet" description="This customer hasn't placed an order." />
                    </td>
                  </tr>
                ) : (
                  customer.orders.map((order) => (
                    <TR key={order.id} className="cursor-pointer" onClick={() => router.push(`/orders/${order.id}`)}>
                      <TD className="font-medium">#{order.id}</TD>
                      <TD>
                        <StatusBadge status={order.status} />
                      </TD>
                      <TD className="capitalize text-zinc-500">{order.orderType ?? "—"}</TD>
                      <TD>{order.total} AED</TD>
                      <TD className="text-xs text-zinc-500">{new Date(order.createdAt).toLocaleString()}</TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
