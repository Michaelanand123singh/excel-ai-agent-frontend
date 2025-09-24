export function formatINR(amount: number | string): string {
  if (amount === null || amount === undefined) return 'N/A'
  const n = typeof amount === 'number' ? amount : Number(String(amount).replace(/[^0-9.-]/g, ''))
  if (Number.isNaN(n)) return String(amount)
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n)
  } catch {
    return `₹${n.toFixed(2)}`
  }
}
