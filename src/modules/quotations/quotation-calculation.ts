export function calculateQuotation(input: { rate?: number; ratePerKW?: number; requiredCapacityKW: number; panelCount?: number; wattsPerPanel?: number }) {
  const modern = input.rate !== undefined;
  const capacity = modern ? input.requiredCapacityKW : Number(input.requiredCapacityKW.toFixed(3));
  const rate = Number((modern ? input.rate! : input.ratePerKW!).toFixed(2));
  const total = modern ? rate : Math.round(capacity * rate * 100) / 100;
  return { modern, capacity, rate, total };
}
