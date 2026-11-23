import { QuotationSequenceModel } from './models/quotation-sequence.model.js';

export function quotationNumberBase(customerName: string, at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const part = (name: string) => parts.find(item => item.type === name)?.value ?? '';
  const slug = customerName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/g, '') || 'CUSTOMER';
  return `QTN-${part('year')}-${part('month')}-${part('day')}-${slug}`;
}

export async function nextQuotationNumber(customerName: string, at: Date): Promise<string> {
  const base = quotationNumberBase(customerName, at);
  let sequence;
  try {
    sequence = await QuotationSequenceModel.findOneAndUpdate({ _id: base }, { $inc: { value: 1 } }, { new: true, upsert: true, setDefaultsOnInsert: true });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    sequence = await QuotationSequenceModel.findOneAndUpdate({ _id: base }, { $inc: { value: 1 } }, { new: true });
  }
  if (!sequence) throw new Error('Could not allocate a quotation number');
  return sequence.value === 1 ? base : `${base}-${sequence.value}`;
}
