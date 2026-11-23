import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { QuotationPdfData } from './pdf-template.service.js';

const navy = '#080875', ink = '#131946', muted = '#495586', orange = '#ef7000', line = '#d6dcf5', gray = '#a3a3a3';
const money = (n: number) => `Rs. ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)}`;
const date = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const ones = ['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const tens = ['', '', 'Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function integerWords(n: number): string {
  if (n < 20) return ones[n]!;
  if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`;
  for (const [unit, name] of [[10000000,'Crore'],[100000,'Lakh'],[1000,'Thousand'],[100,'Hundred']] as const) if (n >= unit) return `${integerWords(Math.floor(n / unit))} ${name}${n % unit ? ` ${integerWords(n % unit)}` : ''}`;
  return '';
}
export function amountInWords(amount: number): string {
  const paise = Math.round(amount * 100), remainder = paise % 100;
  return `Rupees ${integerWords(Math.floor(paise / 100))}${remainder ? ` and ${integerWords(remainder)} Paise` : ''} Only`;
}

export async function sampleQuotationPdf(data: QuotationPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 36, right: 34, bottom: 55, left: 34 }, bufferPages: true, info: { Title: `Quotation ${data.quotationNumber}`, Author: data.companyName } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => { doc.on('data', (part: Buffer) => chunks.push(Buffer.from(part))); doc.once('error', reject); doc.once('end', () => resolve(Buffer.concat(chunks))); });
  const logo = fileURLToPath(new URL('../../../../assets/quotation-logo.png', import.meta.url));
  const number = data.quotationNumber;
  const validUntil = data.validUntil ? date(data.validUntil) : '-';
  const stateName = data.quoteStateName || 'Rajya';
  const capacity = data.requiredCapacityKW.toLocaleString('en-IN', { maximumFractionDigits: 10 });
  const dcCapacity = Number(((data.panelCount || 0) * (data.wattsPerPanel || 0) / 1000).toFixed(3));
  const headline = `${capacity} kW ${data.systemType || ''} Solar System`;
  const details = `${data.panelBrand} · ${data.panelCount || 0} x ${data.wattsPerPanel || 0}W · ${data.panelTechnology}`;
  const subsidyTotal = (data.centralSubsidy || 0) + (data.stateSubsidy || 0);
  function text(value: string, x: number, y: number, width: number, height: number, opts: { size?: number; bold?: boolean; color?: string; align?: 'left'|'center'|'right'; label?: string; tracking?: number } = {}) {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size ?? 8.5).fillColor(opts.color || ink);
    doc.text(value, x, y, { width, height, align: opts.align || 'left', ellipsis: true, characterSpacing: opts.tracking || 0 });
  }
  function rect(x: number, y: number, width: number, height: number, border = line) { doc.lineWidth(0.5).strokeColor(border).rect(x,y,width,height).stroke(); }
  function rule(x1: number, y: number, x2: number) { doc.lineWidth(0.5).strokeColor(line).moveTo(x1,y).lineTo(x2,y).stroke(); }
  function header(first: boolean) {
    doc.image(logo, 31, first ? 27 : 25, { fit: first ? [180, 50] : [150, 42], valign: 'center' });
    text('QUOTATION', 410, first ? 38 : 36, 151, 15, { size: first ? 17 : 13, bold: true, color: navy, align: 'right', tracking: 1.4 });
    text(`No. ${number}`, 375, first ? 59 : 53, 186, 12, { size: 8.5, bold: true, align: 'right', label: 'Quotation number' });
    if (first) text(`Date: ${date(data.quotationDate)}  ·  Valid till: ${validUntil}`, 360, 70, 201, 11, { size: 8, color: muted, align: 'right' });
  }
  function footer(page: number, total: number, y: number) {
    rule(34, y, 561);
    text([data.companyName, data.policy?.website, data.policy?.contactPhone].filter(Boolean).join(' · '), 34, y + 6, 340, 12, { size: 7, color: muted, label: 'Footer contact details' });
    text(`Quotation ${number} · Page ${page} / ${total}`, 377, y + 6, 184, 12, { size: 7, color: muted, align: 'right', label: 'Footer quotation number' });
  }

  header(true);
  rect(34,96,527,60); doc.moveTo(340,96).lineTo(340,156).strokeColor(line).stroke();
  text('CUSTOMER',43,103,270,10,{size:7,bold:true,color:'#b95000',tracking:1});
  text(data.customerName,43,116,285,12,{size:10.5,bold:true,color:navy,label:'Customer name'});
  text(`${data.customerMobile} · ${data.siteAddress}`,43,130,285,12,{size:8.4,label:'Customer contact and site'});
  text(stateName,43,142,285,10,{size:8,color:muted,label:'State'});
  text('SALES ADVISOR',349,103,200,10,{size:7,bold:true,color:'#b95000',tracking:1});
  text(data.salesAdvisorName || '-',349,116,200,12,{size:10.5,bold:true,color:navy,label:'Sales advisor'});
  text(data.salesAdvisorPhone || '-',349,130,200,12,{size:8.4,label:'Sales advisor phone'});
  text(headline,34,165,390,17,{size:14.5,bold:true,color:navy,label:'System title'});
  doc.font('Helvetica-Bold').fontSize(14.5);
  const categoryX = Math.min(425, 40 + doc.widthOfString(headline));
  text(data.category ? `· ${data.category}` : '',categoryX,170,561-categoryX,12,{size:8.5,color:muted,label:'Category'});

  const systemRows: Array<[string,string]> = [
    ['System type',data.systemType || '-'], ['Capacity',`${capacity} kW (${dcCapacity} kWp DC)`],
    ['Phase',data.phase || '-'], ['Category',data.category || '-'], ['Solar panel',details],
    ['Inverter',data.inverter || '-'], ['Inverter battery',data.inverterBattery || 'Shamil nahi'],
    ['Subsidy',`PM Surya Ghar + ${stateName} state top-up`], ['Payment mode',data.paymentMode]
  ];
  const sy=189, rowH=19, sysH=19 + systemRows.length*rowH;
  rect(34,sy,527,sysH); text('SYSTEM DETAILS',42,sy+5,300,10,{size:8,bold:true,color:gray,tracking:1});
  systemRows.forEach(([label,value], index) => { const y=sy+19+index*rowH; rule(34,y,561); text(label,42,y+5,190,11,{size:8,color:muted}); text(value,242,y+5,310,11,{size:8.8,bold:true,label}); });

  const py=sy+sysH+7, priceH=157;
  rect(34,py,527,priceH); text('VIVARAN',42,py+6,200,10,{size:8,bold:true,color:gray,tracking:1}); text('AMOUNT',440,py+6,112,10,{size:8,bold:true,color:gray,align:'right',tracking:1}); rule(34,py+19,561);
  text(headline,42,py+25,370,12,{size:9.5,bold:true,label:'System title'}); text(`${data.panelBrand} ${data.panelCount || 0} x ${data.wattsPerPanel || 0}W ${data.panelTechnology} · ${data.inverter || '-'}`,42,py+39,365,11,{size:8,color:muted,label:'Panel and inverter details'}); text(money(data.totalProjectAmount),418,py+25,134,13,{size:10,bold:true,align:'right'});
  rule(34,py+50,561); text('Kul system keemat',42,py+57,280,12,{size:9.5,bold:true,color:navy}); text('GST sahit',42,py+71,200,10,{size:8,color:muted}); text(money(data.totalProjectAmount),418,py+58,134,14,{size:11,bold:true,color:navy,align:'right'});
  rule(34,py+82,561); text('Kendra subsidy (PM Surya Ghar)',42,py+88,350,12,{size:9,bold:true,color:navy}); text(`- ${money(data.centralSubsidy || 0)}`,418,py+88,134,12,{size:9.5,bold:true,color:navy,align:'right'});
  rule(34,py+104,561); text(`State subsidy (${stateName})`,42,py+110,350,12,{size:9,bold:true,color:navy,label:'State subsidy'}); text(`- ${money(data.stateSubsidy || 0)}`,418,py+110,134,12,{size:9.5,bold:true,color:navy,align:'right'});
  text('Subsidy ke baad aapka asli kharch',42,py+136,340,12,{size:10,bold:true,color:gray}); text(money(data.netCost ?? data.totalProjectAmount),410,py+134,142,16,{size:14,bold:true,color:orange,align:'right'});
  text(`Kul system keemat (shabdon mein): ${amountInWords(data.totalProjectAmount)}`,34,py+priceH+7,527,14,{size:8,bold:true,color:navy,label:'Total in words'});
  let after=py+priceH+24;
  if (data.termsAndConditions) { text(`Remark: ${data.termsAndConditions}`,34,after,527,22,{size:8,color:muted,label:'Remark'}); after += 26; }
  if (data.policy?.subsidyDeadline) {
    rect(34,after,527,49,'#ffd4ad'); doc.rect(34,after,3,49).fill(orange);
    text(`Subsidy ki nirdharit antim tithi: ${data.policy.subsidyDeadline}`,46,after+7,502,12,{size:9,bold:true,color:'#b95000'});
    text(`Anumanit subsidy ${money(subsidyTotal)} hai. Antim rashi aur claim lagu niyamon aur approvals ke adheen hai.`,46,after+22,502,21,{size:8});
    after += 55;
  }
  const footer1=Math.max(605,after+5);

  doc.addPage(); header(false);
  text(`PM Surya Ghar subsidy (${stateName})`,34,82,527,15,{size:11.5,bold:true,color:navy,label:'Subsidy state'});
  const rules = (data.policy?.rules || []).filter(r => r.stateId === data.quoteStateId).sort((a,b)=>a.minKW-b.minKW);
  const active = rules.findIndex(r => data.requiredCapacityKW >= r.minKW && data.requiredCapacityKW <= r.maxKW);
  const selectedRules = rules.length <= 3 ? rules : rules.slice(Math.max(0,Math.min(active, rules.length-3)), Math.max(0,Math.min(active, rules.length-3))+3);
  const tableY=100, cols=selectedRules.length || 1, colW=420/cols;
  rect(34,tableY,527,80); [19,39,59].forEach(offset => rule(34,tableY+offset,561));
  ['Kendra','State','Kul'].forEach((label,i)=>text(label,42,tableY+25+i*20,85,11,{size:8,bold:i===2,color:i===2?navy:muted}));
  selectedRules.forEach((r,i) => { const x=136+i*colW, isActive=data.requiredCapacityKW >= r.minKW && data.requiredCapacityKW <= r.maxKW, range=r.maxKW >= 100000 ? `${r.minKW} kW se upar` : `${r.minKW} - ${r.maxKW} kW`; text(range,x,tableY+6,colW-8,10,{size:8,bold:true,color:isActive?orange:gray,align:'right'}); [r.central,r.state,r.central+r.state].forEach((n,j)=>text(money(n),x,tableY+25+j*20,colW-8,11,{size:8,bold:true,color:j===2?navy:ink,align:'right'})); });
  text(`Aapka system: ${capacity} kW ${data.systemType || ''}. Subsidy lagu niyamon, eligibility aur approval ke adheen hai.`,34,186,527,23,{size:8,color:muted,label:'Subsidy note'});

  text('Zaroori documents',34,216,225,16,{size:11.5,bold:true,color:navy});
  text('Kaam kaise hoga',274,216,287,16,{size:11.5,bold:true,color:navy});
  const documents=['Aadhaar card','Latest bijli bill','Bank passbook ya cancelled cheque','Chhat ka malikana / adhikar proof','Passport size photo'];
  documents.forEach((item,i)=>{const y=233+i*17;rect(34,y,225,17);doc.save().lineWidth(1.4).strokeColor(orange).moveTo(43,y+8).lineTo(45,y+10).lineTo(49,y+5).stroke().restore();text(item,56,y+4,195,11,{size:8});});
  text('Bank khate ka naam bijli bill wale naam se match hona chahiye.',34,322,225,21,{size:7,color:'#b95000'});
  const steps=[['Site survey','Chhat, chhaya aur bijli load ki jaanch'],['Registration','PM Surya Ghar portal aur DISCOM approval'],['Installation','Panel, inverter aur wiring'],['Net metering','DISCOM net meter aur jaanch'],['Subsidy','Portal par claim aur approval'],['Service & AMC','Installation ke baad bhi support']];
  steps.forEach(([name,description],i)=>{const y=236+i*19;text(`${i+1}`,278,y,15,11,{size:8,bold:true,color:navy});text(`${name} · ${description}`,296,y,260,13,{size:8,label:`Step ${i+1}`});});
  text('Niyam va sharten',34,352,527,15,{size:11.5,bold:true,color:navy});
  const terms=[`Yeh quotation ${date(data.quotationDate)} se ${data.policy?.validityDays ?? 15} din, yaani ${validUntil} tak valid hai.`, 'Sabhi rates GST sahit hain.', 'Subsidy PM Surya Ghar Yojana aur state sarkar ke niyamon aur eligibility ke adheen hai. Final subsidy portal aur DISCOM approval ke baad tay hoti hai.', 'System ki poori keemat customer dega. Subsidy seedha customer ke bank khate mein aati hai.', 'Final system design aur panel placement site survey ke baad tay hoga.', 'Rates bina soochna ke badal sakte hain; quotation ki validity ke andar order par yahi rate lagu hoga.'];
  let ty=372; terms.forEach((term,i)=>{const h=i===2?24:15;text(`${i+1}.`,34,ty,15,11,{size:8,bold:true,color:'#b95000'});text(term,47,ty,514,h,{size:8,label:`Term ${i+1}`});ty+=h;});
  const cy=Math.max(471,ty+8); text('Sampark karein',44,cy+10,285,16,{size:10,bold:true,color:orange});
  const contact=data.policy;
  text(`Mobile: ${[contact?.contactPhone,contact?.contactEmail,contact?.website].filter(Boolean).join(' · ') || '-'}`,44,cy+28,310,15,{size:7.5,color:muted,label:'Company contact'});
  text(`Head Office: ${contact?.officeAddress || '-'}`,44,cy+41,310,15,{size:7.5,color:muted,label:'Office address'});
  text(`Branches: ${contact?.branches || '-'}`,44,cy+54,310,15,{size:7.5,color:muted,label:'Branches'});
  rect(371,cy,190,70,'#ffd4ad');text('AAPKE SALES ADVISOR',381,cy+10,170,11,{size:7,bold:true,color:'#b95000',tracking:0.8});text(data.salesAdvisorName || '-',381,cy+26,170,13,{size:11,bold:true,color:navy,label:'Sales advisor'});text(data.salesAdvisorPhone || '-',381,cy+43,170,11,{size:9,bold:true,label:'Sales advisor phone'});
  const signY=Math.max(605,cy+90); rule(34,signY,306); rule(325,signY,561);
  text('Customer ke hastakshar',34,signY+7,260,12,{size:8,bold:true,color:navy});text(data.customerName,34,signY+20,260,12,{size:8,color:muted,label:'Customer name'});
  text(data.companyName,325,signY+7,236,12,{size:8,bold:true,color:navy});text('Authorised Signatory',325,signY+20,236,12,{size:8,color:muted});
  const footer2=signY+36;
  const pages=doc.bufferedPageRange();
  for(let i=0;i<pages.count;i++){ doc.switchToPage(i); doc.page.margins.bottom=0; footer(i+1,pages.count,i===0?footer1:i===1?footer2:805); }
  doc.end(); return result;
}
