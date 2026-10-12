import type {AnalyticsDatum} from './analytics-studio.ts';

export type MetricReading={
 label:string;unit:string;aggregation:'sum'|'average';
 description:string;caution:string;
};
const human=(key:string)=>key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ').replace(/\b\w/g,(c)=>c.toUpperCase());
const MEASURE_EXPLANATIONS:Record<string,string>={
 recordCount:'Counts the source records visible in this dataset, not physical stock units or transaction value.',
 units:'Number of product units recorded by the source, not distinct orders.',
 jobCards:'Number of linked job cards, not production output.',
 shortageLines:'Count of requirement lines with a material shortfall on linked orders; not a company-wide shortage certificate.',
 shortageUnits:'Material requirement units reported as short. Do not combine unlike units of measure.',
 quantity_balance:'Recorded stock quantity. Separate SKUs and measurement units before comparing or totaling.',
 quantity:'Transaction quantity. Compare only records sharing the same unit of measure.',
 purchaseOrders:'Number of purchase orders linked to committed orders.',
 invoiceCount:'Number of invoices linked to committed orders; not necessarily all corporate invoices.',
 unit_price_inr:'Price for one supplier unit in INR, not total purchase spending.',
 revenue:'Revenue amount in lakh rupees. Actuals exist only for recorded periods.',
 cogs:'Cost of goods sold in lakh rupees, where recorded.',
 opex:'Operating expenditure in lakh rupees, where recorded.',
 closingCash:'End-of-period cash balance in lakh rupees, not revenue or an amount to add across months.',
};
export function describeAnalyticsMetric(metric:string,dataset:string):MetricReading{
 const label=human(metric);
 const isRecord=metric==='recordCount';
 const isLakh=['revenue','cogs','opex','closingCash','inventory','receivables','payables','collectionAmountLakh','amount_lakh'].includes(metric)&&
   (dataset==='finance'||metric==='collectionAmountLakh'||metric==='amount_lakh');
 const isMoneyRupees=/(?:_inr$|_inr_)/i.test(metric);
 const isUnitPrice=/unit.?price|per.?unit|unit_cost|(?:^|_)rate(?:_|$)|percentage|percent|margin|ratio|average|mean|age_days|rating|closingcash|balance$|balance_/.test(metric.toLowerCase().replace(/_/g,''))||
  /(price|rate|percent|ratio|margin|average|mean|age_days|closingcash)/i.test(metric);
 // Stock quantity balance is additive only after unit/SKU partition, which is
 // not guaranteed by arbitrary chart grouping. Force average for safety.
 const aggregation:isAnyAverage = isUnitPrice||metric==='quantity_balance'||metric==='inventory'||metric==='receivables'||metric==='payables'?'average':'sum';
 const unit=isRecord?'records':metric==='unit_price_inr'?'₹ per unit':isLakh?'₹ lakh':isMoneyRupees?'₹':/lines/i.test(metric)?'lines':/units|quantity/i.test(metric)?'units':'recorded value';
 const description=MEASURE_EXPLANATIONS[metric]||(
  aggregation==='average'
   ?'Average recorded '+label.toLowerCase()+' across the matching source rows. This is not a transaction total.'
   :'Sum of '+label.toLowerCase()+' across matching source rows; check source unit consistency.'
 );
 const caution=aggregation==='average'
  ?'Non-additive measure: values are averaged per matched record. Do not interpret the result as total spend, stock or cash. Pareto and pie share charts are disabled.'
  :isRecord?'A record is not necessarily a product, payment or physical unit.':'Totals include only the visible matching source records.';
 return {label,unit,aggregation,description,caution};
}
type isAnyAverage='sum'|'average';

const MEANINGS:Record<string,{name:string;what:string;lookFor:string;decision:string;limitation:string}>={
 crmCustomers:{name:'CRM customers and prospect segments',
  what:'Counts customer CRM records grouped by customer segment and lifecycle (prospect, active or inactive).',
  lookFor:'Which customer segments have prospects, and which are active?',
  decision:'Use Sales → CRM to follow up customers and connect confirmed sales orders.',
  limitation:'A CRM prospect is not necessarily a qualified sales opportunity or an accepted sale; no personal contact details are exposed here.'},
 crmFollowups:{name:'CRM activities and follow-up backlog',
  what:'Counts CRM calls, meetings, notes and follow-ups, distinguishing overdue, open and completed follow-ups.',
  lookFor:'How many overdue customer follow-ups need attention?',
  decision:'Open Sales → CRM to complete the corresponding governed activities.',
  limitation:'Counts activities, not distinct customers; overdue requires a recorded due date. Do not infer conversion rates from activity count.'},
 hrWorkforce:{name:'HR workforce and hiring plans',
  what:'Counts People Office records by approved/draft lifecycle and employee, contractor, consultant or planned role.',
  lookFor:'How many personnel records have been approved and how many planned roles remain drafts?',
  decision:'Review staffing capacity and approved hiring needs in the People Office.',
  limitation:'Draft positions and planned roles are not active headcount. Names, pay details and individual records are excluded.'},
 hrAttendance:{name:'HR attendance status',
  what:'Counts recorded person-day attendance observations by the latest status for each recorded date.',
  lookFor:'How are recorded present, leave and absence entries distributed?',
  decision:'Review gaps in attendance recording in the authorized People Office.',
  limitation:'These are person-day observations across all recorded dates, not the percentage attendance or unique headcount.'},
 hrPayrollReadiness:{name:'HR payroll readiness',
  what:'Counts person-period payroll-readiness statuses, grouped by reporting period.',
  lookFor:'Which recorded periods have payroll preparation HOLDs?',
  decision:'Resolve readiness holds through the protected People Office and finance authority workflow.',
  limitation:'Readiness counts do not reveal salaries, prove payroll posting, or authorize any payment.'},
 flow:{name:'Order-to-cash journey',what:'One row is a committed sales order and its linked job card, purchase orders, receipts, quality, invoices and collections.',
  lookFor:'Which committed orders are stuck at a material shortage, receiving, build or invoicing stage?',
  decision:'Open the owning order, production or procurement workspace to investigate the blockage.',
  limitation:'Stage is a summary from linked records; it is not an approved workflow transition or a count of every enterprise transaction.'},
 demand:{name:'All sales orders',what:'Sales orders registered in VYNDI OS, including current statuses and quantities.',
  lookFor:'How many orders and product units are recorded by status or month?',
  decision:'Check new demand against the approved production and purchasing plan.',
  limitation:'An order count differs from its unit quantity. An order may not yet have a linked job card.'},
 jobCards:{name:'Production job cards',what:'Production work records, whether or not they are linked to the committed-order overview.',
  lookFor:'How many active or blocked cards are recorded, and where are they in the workflow?',
  decision:'Open Production to inspect assigned capacity, operations, materials and release evidence.',
  limitation:'A job card is a work instruction, not proof that a finished frame was accepted.'},
 purchaseOrders:{name:'Supplier purchase orders',what:'Purchase commitments and expected supplier deliveries.',
  lookFor:'Issued versus pending orders, delivery timing and received quantities.',
  decision:'Investigate late orders and material shortages before releasing manufacturing work.',
  limitation:'Purchase order count is not expenditure. Unit prices are not invoice totals.'},
 salesInvoices:{name:'Customer invoices',what:'Recorded sales invoices and their statuses.',
  lookFor:'How many invoices are issued or pending?',
  decision:'Review overdue receivables before making a cash-flow decision.',
  limitation:'An issued invoice is not necessarily money collected.'},
 supplierInvoices:{name:'Supplier invoices',what:'Supplier invoices received for purchase orders.',
  lookFor:'Invoice counts, disputed items and unmatched records.',
  decision:'Reconcile invoice, purchase order and goods receipt before approval or payment.',
  limitation:'An invoice is not the same as a payment, approved liability or settled balance.'},
 inventoryBalances:{name:'Current stock balances',what:'Quantity on hand by recorded inventory item.',
  lookFor:'Which SKUs have insufficient available quantity for upcoming jobs?',
  decision:'Open Inventory for unit-consistent stock valuation, reservation and replenishment.',
  limitation:'Never add kilograms, pieces and metres into one stock total.'},
 materials:{name:'Material purchase requirements',what:'Material requirements and the quantities needed to restore procurement coverage.',
  lookFor:'Which SKUs require action and how large are their recorded gaps?',
  decision:'Prioritize purchase requests for the largest operationally relevant material shortages.',
  limitation:'A requirement is not a placed purchase order or confirmed supplier delivery.'},
 inventory:{name:'Minimum stock health',what:'Inventory records grouped by whether they meet established minimum levels.',
  lookFor:'Items below minimum stock level (MSL) or requiring review.',
  decision:'Check stock, consumption rate and lead time before raising a replenishment request.',
  limitation:'Record count is number of SKUs/health rows, not number of pieces available.'},
 receiving:{name:'Receiving exceptions',what:'Goods receipts flagged for inspection, quantity or delivery exceptions.',
  lookFor:'Which exceptions are preventing inventory acceptance or production readiness?',
  decision:'Resolve outstanding goods receipt and quality discrepancies.',
  limitation:'Only exceptional receipts appear; an empty exception report is not an independently certified receiving audit.'},
 production:{name:'Production release controls',what:'Release-gate status for job cards and manufacturing quality evidence.',
  lookFor:'Open release holds, quality or engineering issues before production advances.',
  decision:'Resolve the exact hold at its authoritative production or quality control.',
  limitation:'A release gate summary is not an authorization to bypass inspection or engineering sign-off.'},
 backlog:{name:'Unfulfilled customer demand',what:'Sales orders that remain in backlog.',
  lookFor:'Volume of outstanding units by product or status.',
  decision:'Review production slots and procurement lead times.',
  limitation:'Backlog is not cash collected or recognized revenue.'},
 receivables:{name:'Customer money outstanding',what:'Recorded customer invoices and receivables ageing.',
  lookFor:'Overdue accounts and their recorded age or value.',
  decision:'Follow up overdue amounts and reconcile receipts before making a cash forecast.',
  limitation:'The existence of an invoice does not prove payment receipt.'},
 payables:{name:'Supplier money outstanding',what:'Recorded supplier obligations and ageing.',
  lookFor:'Upcoming and overdue approved supplier liabilities.',
  decision:'Prioritize due items in the authorized cash-payment workflow.',
  limitation:'Recorded payable is not permission to execute a payment.'},
 finance:{name:'Monthly business actuals',what:'Recorded revenue, expenses, stock/cash and working-capital metrics by month.',
  lookFor:'Compare genuine actual figures against the approved 36-month business plan.',
  decision:'Investigate budget variances before changing purchasing or hiring plans.',
  limitation:'Actuals may be incomplete by month. A plan or what-if figure is not a posted transaction.'},
};
export type ChartType='bar'|'line'|'area'|'pie'|'scatter'|'pareto'|'kanban';
export function interpretAnalyticsSelection(input:{
 dataset:string;metric:string;dimension:string;visual:ChartType;rowsCount:number;sourceState?:string;
}){
 const meaning=MEANINGS[input.dataset]||{name:'Source analytics',what:'Recorded operational entries from VYNDI OS.',lookFor:'Examine category-level variations.',decision:'Confirm the source record before acting.',limitation:'Only visible source records are included.'};
 const m=describeAnalyticsMetric(input.metric,input.dataset);
 const timeBased=input.dimension==='month';
 const chartExplanation:Record<ChartType,string>={
  bar:'Each bar compares '+m.label.toLowerCase()+' grouped by '+human(input.dimension)+'. '+(m.aggregation==='average'?'Bars represent group averages, not sums.':'Bars represent the sum of matching source observations.'),
  line:timeBased?'Points show recorded observations by business-plan month. Missing months are not interpolated.':'Points connect categories, not dates: this is not a time series. Choose Month on the X axis for a genuine trend.',
  area:timeBased?'Shaded area compares the selected measure across business-plan months.':'This area joins grouped categories, not chronological dates. Choose Month for a true trend.',
  pie:'Each slice is a share of the chosen additive measure, not necessarily a share of company revenue.',
  scatter:'Each point compares number of source records (horizontal) against selected metric (vertical) for a grouped category.',
  pareto:'Bars rank biggest contributors first. The line adds their cumulative percentage; the 80% reference highlights priority contributors.',
  kanban:'Each order card is placed into a derived stage. Moving cards is not enabled here; update actual work in its owning ERP workspace.',
 };
 const caution=input.sourceState==='HOLD'
  ?'HOLD: this authoritative source could not be verified. Unavailable records must not be interpreted as zero.'
  :input.rowsCount===0
    ?'There are no matching recorded rows for these filters. This does not prove that the underlying business risk is absent.'
    :m.caution+' '+meaning.limitation;
 return {title:meaning.name,what:meaning.what,lookFor:meaning.lookFor,decision:meaning.decision,chartExplanation:chartExplanation[input.visual],caution,metric:m};
}
export function buildFounderReading(input:{
 scope:'group'|'vyndi';linkedOrders:number;committedUnits:number;shortageLines:number;jobCards:number;sourceCoverage:Record<string,string>;
}){
 const holds=Object.entries(input.sourceCoverage).filter(([,status])=>status!=='PASS').map(([source])=>source);
 return {
 groupCaution:input.scope==='group'
  ?'This is not consolidated group reporting. Only VYNDI OS is currently an authorized business source; other divisions have not been reconciled.'
  :'This is a VYNDI OS operating view, not a statutory group consolidation.',
 supplyCaution:holds.length
  ?'HOLD sources: '+holds.join(', ')+'. Missing source records cannot be treated as zero.'
  :'Connected read-only source coverage is verified for the listed full-order datasets; this is not a statutory audit.',
 shortageExplanation:'There are '+input.shortageLines+' recorded material shortage lines across '+input.linkedOrders+' linked orders. Zero recorded lines do not establish that all products and stores have sufficient material.',
 forecastCaution:'Forecast sliders represent illustrative scenarios and planning estimates, not posted actuals, accepted orders or approved new budgets.',
 currentMeaning:'Currently showing '+input.linkedOrders+' linked committed orders, '+input.committedUnits+' units and '+input.jobCards+' linked job cards. This is not necessarily every order or job card in the database.',
 };
}
