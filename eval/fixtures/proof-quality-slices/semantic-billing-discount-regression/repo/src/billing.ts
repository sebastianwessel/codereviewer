export type InvoiceItem = {
  readonly quantity: number
  readonly unitCents: number
  readonly discountCents: number
  readonly prorated: boolean
}

export const totalDueCents = (items: readonly InvoiceItem[]): number =>
  items.reduce((total, item) => {
    const subtotal = item.quantity * item.unitCents

    if (item.prorated) {
      return total + subtotal
    }

    return total + subtotal - item.discountCents
  }, 0)
