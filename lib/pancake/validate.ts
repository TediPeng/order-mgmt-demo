import { z } from "zod";
import type { Order } from "@/lib/types";

export interface PancakeFieldError {
  field: string;
  message: string;
}

/** Fields Pancake needs on a create-order call. Deliberately separate from
 * READY_TO_SHIP_REQUIRED_FIELDS: that gate is about the internal sale being
 * complete, this one is about the outbound request being sendable. The UI runs
 * both before allowing the Ready-to-Ship transition, so an order can never end
 * up stuck mid-sync because of a field we could have checked first. */
export const pancakeOrderSchema = z.object({
  customer_name: z.string().trim().min(1, "Customer name is required"),
  customer_phone: z.string().trim().min(1, "Phone number is required"),
  barangay: z.string().trim().min(1, "Barangay is required"),
  city: z.string().trim().min(1, "City / municipality is required"),
  province: z.string().trim().min(1, "Province is required"),
  product_name: z.string().trim().min(1, "Product is required"),
  quantity: z.number().int().positive("Quantity must be at least 1"),
  unit_price: z.number({ message: "Unit price is required" }).nonnegative("Unit price cannot be negative"),
  discount: z.number().nonnegative("Discount cannot be negative"),
  shipping_fee: z.number().nonnegative("Shipping fee cannot be negative").nullable(),
});

/** Field label lookup so the UI can point at the right input. */
export const PANCAKE_FIELD_LABELS: Record<string, string> = {
  customer_name: "Customer Name",
  customer_phone: "Phone Number",
  barangay: "Barangay",
  city: "City / Municipality",
  province: "Province",
  product_name: "Product",
  quantity: "Quantity",
  unit_price: "Unit Price",
  discount: "Discount",
  shipping_fee: "Shipping Fee",
};

export interface PancakeValidationResult {
  ok: boolean;
  errors: PancakeFieldError[];
}

/** Validates an order against Pancake's requirements. Pure — safe to call from
 * a server component to render the Review step before anything is sent. */
export function validateForPancake(
  order: Pick<
    Order,
    | "customer_name"
    | "customer_phone"
    | "barangay"
    | "city"
    | "province"
    | "product_name"
    | "quantity"
    | "unit_price"
    | "discount"
    | "shipping_fee"
  >
): PancakeValidationResult {
  const parsed = pancakeOrderSchema.safeParse({
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    barangay: order.barangay,
    city: order.city,
    province: order.province,
    product_name: order.product_name,
    quantity: order.quantity,
    unit_price: order.unit_price,
    discount: order.discount ?? 0,
    shipping_fee: order.shipping_fee,
  });
  if (parsed.success) return { ok: true, errors: [] };

  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => {
      const field = String(issue.path[0] ?? "");
      return { field, message: `${PANCAKE_FIELD_LABELS[field] || field}: ${issue.message}` };
    }),
  };
}

/** Grand total: line total less the discount, plus shipping. Single source of
 * truth — every write path and the UI preview call this. */
export function computeOrderTotal(input: {
  unit_price: number | null;
  quantity: number;
  discount: number | null;
  shipping_fee: number | null;
}): number {
  const line = (input.unit_price ?? 0) * (input.quantity || 0);
  const total = line - (input.discount ?? 0) + (input.shipping_fee ?? 0);
  return Math.round(total * 100) / 100;
}
