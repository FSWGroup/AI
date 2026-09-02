/**
 * FSW Talent Scout — Business Terms aptitude bank.
 *
 * 110 original items measuring practical business literacy for
 * sales / operations / office candidates at an industrial distributor.
 * All content is original FSW Group work; nothing is copied from any
 * third-party assessment instrument.
 *
 * Subtypes:
 *  - "definition":    what does the term mean
 *  - "application":   short scenario — which concept applies / consequence
 *  - "calculation":   simple mental math (margins, discounts, terms, etc.)
 *  - "document_flow": PO -> invoice -> payment ordering; who sends what
 */
import type { AptitudeBank } from "../types";

export const businessTermsBank: AptitudeBank = {
  construct: "BUSINESS_TERMS",
  items: [
    // ------------------------------------------------------------------
    // Definitions
    // ------------------------------------------------------------------
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What does \"revenue\" mean?",
      choices: [
        "The total amount a business earns from selling its goods and services, before any costs are subtracted",
        "The profit left over after all expenses are paid",
        "The cash a business keeps in its bank account",
        "The total value of everything the business owns",
      ],
      correctIndex: 0,
      explanation:
        "Revenue is the top line: total sales before any costs. Profit, cash balances, and assets are different concepts.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What is \"gross profit\"?",
      choices: [
        "Total sales before subtracting anything",
        "Revenue minus the direct cost of the goods that were sold",
        "Profit after every expense, including rent and salaries, is subtracted",
        "The cash collected from customers during the month",
      ],
      correctIndex: 1,
      explanation:
        "Gross profit = revenue minus cost of goods sold. It comes before operating expenses are deducted.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt:
        "A company's \"gross margin percentage\" expresses gross profit as a percentage of what?",
      choices: [
        "The cost of the goods",
        "Total operating expenses",
        "The selling price (revenue)",
        "The company's total assets",
      ],
      correctIndex: 2,
      explanation:
        "Margin is always profit divided by the selling price. Profit divided by cost is markup, not margin.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What is \"markup\"?",
      choices: [
        "The percentage of sales lost to discounts",
        "The fee a carrier adds for expedited freight",
        "The profit a company reports after taxes",
        "The amount added to an item's cost to set its selling price",
      ],
      correctIndex: 3,
      explanation:
        "Markup is the amount (usually expressed as a percentage of cost) added to cost to arrive at the selling price.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 3,
      prompt: "What is the key difference between profit margin and markup?",
      choices: [
        "Margin measures profit as a percentage of the selling price, while markup measures it as a percentage of cost",
        "Margin measures profit as a percentage of cost, while markup measures it as a percentage of the selling price",
        "There is no difference; the two terms are interchangeable",
        "Margin applies only to services, while markup applies only to physical goods",
      ],
      correctIndex: 0,
      explanation:
        "Same profit dollars, different base: margin uses price as the base, markup uses cost. A 25% markup is only a 20% margin.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What is \"cost of goods sold\" (COGS)?",
      choices: [
        "The cost of running the sales office",
        "The direct cost of the products a company sells, such as what it paid suppliers for them",
        "The total of all wages the company pays",
        "The amount spent on advertising and promotion",
      ],
      correctIndex: 1,
      explanation:
        "COGS is the direct cost of the products sold. Office costs, total wages, and advertising are operating expenses.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "Which of the following best describes an \"operating expense\"?",
      choices: [
        "The amount paid to suppliers for resale inventory",
        "A one-time cost of buying a building or major equipment",
        "An ongoing cost of running the business, such as rent, utilities, and office salaries",
        "The interest a company earns on its bank balance",
      ],
      correctIndex: 2,
      explanation:
        "Operating expenses are the recurring costs of running the business, separate from the direct cost of goods sold.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What does \"cash flow\" refer to?",
      choices: [
        "The total profit shown on the income statement",
        "The value of inventory moving through the warehouse",
        "The company's share price over time",
        "The movement of money into and out of a business over a period of time",
      ],
      correctIndex: 3,
      explanation:
        "Cash flow tracks actual money coming in and going out, which can differ sharply from reported profit.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "In business terms, what is \"inventory\"?",
      choices: [
        "Goods a company keeps on hand that are intended for sale",
        "The list of customers who owe the company money",
        "Office furniture and computers used by employees",
        "The company's outstanding loans",
      ],
      correctIndex: 0,
      explanation:
        "Inventory is stock held for sale. Amounts customers owe are receivables; office equipment is a fixed asset.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What is \"accounts payable\"?",
      choices: [
        "Money customers owe the company",
        "Money the company owes suppliers for goods or services it has received but not yet paid for",
        "The company's payroll for the current month",
        "Cash set aside for future equipment purchases",
      ],
      correctIndex: 1,
      explanation:
        "Accounts payable is what the company owes its suppliers. What customers owe the company is accounts receivable.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What is \"accounts receivable\"?",
      choices: [
        "Bills the company has not yet paid to its suppliers",
        "The value of unsold goods in the warehouse",
        "Money customers owe the company for purchases made on credit",
        "Cash received from bank loans",
      ],
      correctIndex: 2,
      explanation:
        "Receivables are amounts customers owe the company from credit sales. Unpaid supplier bills are payables.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 3,
      prompt:
        "A company both buys and sells on credit. Which statement correctly separates accounts payable from accounts receivable?",
      choices: [
        "Payable is money customers owe the company; receivable is money the company owes suppliers",
        "Both terms describe money the company owes; receivable is simply the overdue portion",
        "Payable tracks cash sales; receivable tracks credit sales",
        "Payable is money the company owes its suppliers; receivable is money customers owe the company",
      ],
      correctIndex: 3,
      explanation:
        "Payable = the company's own unpaid bills to suppliers; receivable = customers' unpaid bills to the company. The two are commonly reversed.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What is a \"purchase order\" (PO)?",
      choices: [
        "A document a buyer sends to a supplier authorizing the purchase of specific goods at stated prices",
        "A bill a supplier sends after delivering goods",
        "A receipt proving that payment was made",
        "A list of items packed inside a shipment",
      ],
      correctIndex: 0,
      explanation:
        "A PO is the buyer's formal authorization to purchase. The supplier's bill is the invoice; the shipment list is the packing slip.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What is an \"invoice\"?",
      choices: [
        "A document a buyer uses to place an order",
        "A bill a seller sends requesting payment for goods or services provided",
        "An internal record of warehouse stock levels",
        "A summary of employee hours for payroll",
      ],
      correctIndex: 1,
      explanation:
        "The invoice is the seller's request for payment. The buyer's ordering document is the purchase order.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What does \"lead time\" mean?",
      choices: [
        "The number of days a customer has to pay an invoice",
        "The time a salesperson spends preparing a quote",
        "The time between placing an order and receiving the goods",
        "The warranty period after a product is delivered",
      ],
      correctIndex: 2,
      explanation:
        "Lead time is the wait between ordering and receiving. Payment periods are terms; they are unrelated to delivery time.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What does \"return on investment\" (ROI) measure?",
      choices: [
        "The total revenue a company earns in a year",
        "The interest rate a bank charges on business loans",
        "The percentage of orders returned by customers",
        "A measure of how much profit an investment generates relative to its cost",
      ],
      correctIndex: 3,
      explanation:
        "ROI compares the profit gained to the amount invested, letting different investments be compared fairly.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What is a sales \"commission\"?",
      choices: [
        "Pay a salesperson earns that is based on the sales they make",
        "A fixed annual salary paid regardless of results",
        "A fee charged to customers for late payment",
        "A bonus paid to all employees when the company hits its budget",
      ],
      correctIndex: 0,
      explanation:
        "Commission is performance-based pay tied to the sales an individual generates, typically a percentage of revenue or gross profit.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What is \"market share\"?",
      choices: [
        "The number of shares of stock a company has issued",
        "A company's sales as a percentage of total sales in its market",
        "The portion of a company owned by outside investors",
        "The share of profit paid out to salespeople",
      ],
      correctIndex: 1,
      explanation:
        "Market share is the slice of the whole market's sales that one company captures. It has nothing to do with shares of stock.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 3,
      prompt: "Managers sometimes discuss \"EBITDA.\" What is it, at a basic level?",
      choices: [
        "The company's total cash in the bank at year end",
        "Revenue minus only the cost of goods sold",
        "A profit measure that looks at earnings before interest, taxes, depreciation, and amortization are subtracted",
        "The dividend paid to shareholders each quarter",
      ],
      correctIndex: 2,
      explanation:
        "EBITDA strips out financing costs, taxes, and non-cash charges to show underlying operating profitability. Revenue minus COGS is gross profit.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What is a \"supply chain\"?",
      choices: [
        "The chain of command between managers and employees",
        "The sequence of sales calls a rep makes each week",
        "A retail chain owned by a single supplier",
        "The network of suppliers, factories, warehouses, and carriers that moves a product from raw materials to the end customer",
      ],
      correctIndex: 3,
      explanation:
        "The supply chain is the end-to-end network that gets products made, stored, and delivered.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 2,
      prompt: "What is \"customer acquisition cost\"?",
      choices: [
        "The average amount spent on sales and marketing to win one new customer",
        "The price a customer pays for their first order",
        "The cost of servicing a customer's warranty claims",
        "The total revenue a customer generates over their lifetime",
      ],
      correctIndex: 0,
      explanation:
        "Customer acquisition cost is total sales/marketing spend divided by the number of new customers gained.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What is a \"budget\"?",
      choices: [
        "A record of what the company actually spent last year",
        "A plan that estimates income and spending for a future period",
        "The maximum credit limit a bank grants a company",
        "A list of all unpaid customer invoices",
      ],
      correctIndex: 1,
      explanation:
        "A budget is a forward-looking plan. Records of actual past spending are used to compare against it, but they are not the budget itself.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 2,
      prompt: "What is \"working capital\"?",
      choices: [
        "The total value of a company's buildings and equipment",
        "The money invested by the company's founders",
        "The difference between a company's short-term assets and its short-term liabilities",
        "Cash reserved exclusively for paying salaries",
      ],
      correctIndex: 2,
      explanation:
        "Working capital = current assets (cash, receivables, inventory) minus current liabilities. It funds day-to-day operations.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What is a \"quote\" (or quotation) in a sales context?",
      choices: [
        "A binding contract that obligates the customer to buy",
        "An invoice sent before goods are shipped",
        "A record of a completed sale",
        "A document that offers a customer stated prices for specified goods, usually valid for a limited time",
      ],
      correctIndex: 3,
      explanation:
        "A quote is a priced offer the customer can accept or decline; it does not obligate the customer to buy anything.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 3,
      prompt: "What is the practical difference between a quote and an order?",
      choices: [
        "A quote is a priced offer that the customer may accept or decline; an order is a commitment to buy",
        "A quote is legally binding on the customer; an order is not",
        "A quote is used only for services, while an order is used only for goods",
        "They are the same document with different titles",
      ],
      correctIndex: 0,
      explanation:
        "A quote proposes prices; nothing is committed until the customer places an order (typically by sending a purchase order).",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "An invoice is marked \"Net 30.\" What does that mean?",
      choices: [
        "The buyer gets a 30% discount for paying immediately",
        "The full invoice amount is due within 30 days of the invoice date",
        "Payment is due in 30 equal weekly installments",
        "The seller will ship the goods within 30 days",
      ],
      correctIndex: 1,
      explanation:
        "Net 30 is a payment term: the whole amount is due 30 days after the invoice date. It says nothing about discounts or shipping.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 2,
      prompt: "What do payment terms of \"2/10, net 30\" mean?",
      choices: [
        "The buyer must pay 2% of the invoice within 10 days and the rest within 30 days",
        "The seller charges 2% interest after 10 days",
        "The buyer may deduct 2% if paying within 10 days; otherwise the full amount is due within 30 days",
        "The buyer gets a 10% discount if paying within 2 days",
      ],
      correctIndex: 2,
      explanation:
        "2/10 net 30 offers a 2% early-payment discount for paying in 10 days; otherwise the full amount is due in 30.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What is a \"volume discount\"?",
      choices: [
        "A discount given for paying an invoice early",
        "A rebate paid at the end of the year regardless of purchases",
        "A discount given when goods are slightly damaged",
        "A lower unit price offered when a customer orders in larger quantities",
      ],
      correctIndex: 3,
      explanation:
        "Volume discounts reward bigger order quantities with a lower price per unit. Early-payment discounts are a separate concept.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "A shipment is sent \"freight prepaid.\" Who pays the freight carrier?",
      choices: [
        "The seller pays the carrier for the shipping",
        "The buyer pays the carrier upon delivery",
        "The carrier waives the charge",
        "The freight cost is split equally between buyer and seller",
      ],
      correctIndex: 0,
      explanation:
        "Freight prepaid means the seller (shipper) pays the carrier. The opposite arrangement is freight collect.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "A shipment is sent \"freight collect.\" What does that mean?",
      choices: [
        "The seller pays the carrier when the shipment leaves",
        "The buyer pays the freight charges when the goods arrive",
        "The carrier collects the goods but ships them for free",
        "The seller collects a freight surcharge from the carrier",
      ],
      correctIndex: 1,
      explanation:
        "Freight collect means the freight charge is collected from the buyer/receiver, not paid by the seller.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What is a \"backorder\"?",
      choices: [
        "An order that the customer has cancelled",
        "An order placed by phone rather than in writing",
        "An accepted order for an out-of-stock item that will ship when stock arrives",
        "A duplicate order entered by mistake",
      ],
      correctIndex: 2,
      explanation:
        "A backorder is a live order waiting on replenishment: the seller accepted it but cannot ship until new stock comes in.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "What is a \"packing slip\"?",
      choices: [
        "The invoice that must be paid before goods are released",
        "A label showing only the delivery address",
        "The carrier's bill for freight charges",
        "A document included with a shipment that lists the items inside",
      ],
      correctIndex: 3,
      explanation:
        "The packing slip travels with the goods and itemizes the shipment so the receiver can check what arrived.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 2,
      prompt: "What is a \"sales order\"?",
      choices: [
        "The seller's internal document confirming a customer's purchase so it can be processed and fulfilled",
        "The buyer's request for a price on future purchases",
        "A government form required to sell industrial goods",
        "The commission statement given to a salesperson",
      ],
      correctIndex: 0,
      explanation:
        "When a customer's purchase order is accepted, the seller creates a sales order to drive picking, shipping, and invoicing.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 2,
      prompt: "What is a \"credit memo\"?",
      choices: [
        "A document that increases the amount a customer owes",
        "A document from a seller that reduces the amount a buyer owes, for example after a return",
        "A memo requesting a credit check on a new customer",
        "A note recording a customer's credit card number",
      ],
      correctIndex: 1,
      explanation:
        "A credit memo offsets a previous invoice, lowering the customer's balance after returns, shortages, or billing errors.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 2,
      prompt: "What does \"inventory turnover\" measure?",
      choices: [
        "The rate at which warehouse staff leave and are replaced",
        "How often inventory is physically counted each year",
        "How many times a company sells and replaces its inventory during a period",
        "The percentage of inventory that is damaged in storage",
      ],
      correctIndex: 2,
      explanation:
        "Turnover measures how quickly stock sells through and is replaced. Higher turnover means less cash sitting on the shelf.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 2,
      prompt: "What is a company's \"breakeven point\"?",
      choices: [
        "The point at which a company runs out of cash",
        "The date when a loan is fully repaid",
        "The moment when revenue growth stops",
        "The sales level at which total revenue equals total costs, producing neither profit nor loss",
      ],
      correctIndex: 3,
      explanation:
        "Breakeven is where revenue exactly covers all costs. Above it the company profits; below it, it loses money.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 1,
      prompt: "Which best describes a \"fixed cost\"?",
      choices: [
        "A cost that stays roughly the same regardless of how much the company sells, such as rent",
        "A cost that rises and falls directly with sales volume",
        "A cost that has been paid and can never change again",
        "The cost of repairing defective products",
      ],
      correctIndex: 0,
      explanation:
        "Fixed costs (rent, insurance, salaried staff) do not move with sales volume; variable costs do.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "definition",
      difficulty: 3,
      prompt:
        "A branch reports strong gross profit but weak net profit. What explains the difference between these two measures?",
      choices: [
        "Gross profit includes interest income while net profit does not",
        "Gross profit subtracts only the cost of goods sold, while net profit also subtracts operating and other expenses",
        "Net profit is calculated before any costs, while gross profit comes after all costs",
        "Gross profit is measured in units and net profit in dollars",
      ],
      correctIndex: 1,
      explanation:
        "Gross profit stops after COGS. Net profit continues down the income statement, subtracting rent, salaries, and other expenses — which is where this branch is losing ground.",
    },

    // ------------------------------------------------------------------
    // Applications
    // ------------------------------------------------------------------
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "A distributor shows a healthy profit on its income statement but is struggling to pay this month's bills. Which concept best explains how both can be true at once?",
      choices: [
        "Market share",
        "Markup",
        "Cash flow — profit is recorded when sales are made, but the cash may arrive later than the bills are due",
        "Depreciation",
      ],
      correctIndex: 2,
      explanation:
        "Profit is an accounting result; bills are paid with cash. Slow collections or heavy inventory can leave a profitable company short of cash.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "A branch manager spends most of the company's available cash on a large discounted inventory buy. Soon the branch has trouble paying routine bills. What happened?",
      choices: [
        "The company's revenue declined",
        "Operating expenses increased",
        "The company's markup was set too low",
        "Cash became tied up in inventory, leaving too little working capital for day-to-day obligations",
      ],
      correctIndex: 3,
      explanation:
        "Inventory is an asset, but it is not cash. Converting most of the cash into stock left the branch unable to cover routine payables.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 3,
      prompt:
        "A company must pay its suppliers within 30 days, but its customers take 60 days to pay. What is the practical consequence?",
      choices: [
        "The company must cover roughly 30 days of costs with its own cash while waiting for customer payments",
        "The company automatically earns interest on the 30-day difference",
        "The suppliers are required to extend their terms to 60 days",
        "There is no consequence as long as sales keep growing",
      ],
      correctIndex: 0,
      explanation:
        "Paying out before collecting creates a funding gap the company must bridge with its own working capital. Growth actually makes the gap bigger, not smaller.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 1,
      prompt: "Which of the following would appear in a company's accounts receivable?",
      choices: [
        "A supplier's invoice for parts the company bought last week",
        "A customer's unpaid balance for equipment delivered two weeks ago",
        "Next month's rent payment",
        "The value of stock sitting in the warehouse",
      ],
      correctIndex: 1,
      explanation:
        "Receivables are what customers owe the company. The supplier's invoice is a payable; stock is inventory.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 1,
      prompt: "Which of the following belongs in accounts payable?",
      choices: [
        "A customer invoice awaiting payment",
        "Cash in the company's bank account",
        "An unpaid supplier invoice for goods the company has already received",
        "A quote the company sent to a prospect",
      ],
      correctIndex: 2,
      explanation:
        "Payables are the company's own unpaid supplier bills. A customer invoice awaiting payment is a receivable.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "A key supplier's lead time increases from 5 days to 20 days. What is the most sensible operational response?",
      choices: [
        "Stop stocking the supplier's products entirely",
        "Wait until items run out before reordering",
        "Raise prices to cover the delay",
        "Reorder earlier and carry more safety stock to cover the longer wait",
      ],
      correctIndex: 3,
      explanation:
        "Longer lead time means orders must be placed sooner and buffer stock increased, or the company will run out before replenishment arrives.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "To hit a monthly revenue target, a sales rep offers unusually deep discounts. Revenue rises. What is the most likely side effect?",
      choices: [
        "Gross margin falls, because each sale now earns less profit over the same cost",
        "Operating expenses fall automatically",
        "The company's lead times shorten",
        "Accounts payable disappears",
      ],
      correctIndex: 0,
      explanation:
        "Discounting lowers the selling price while cost stays the same, so gross profit per sale — and margin percentage — both shrink.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 1,
      prompt:
        "A manager compares two forklift models by asking which will generate more savings for each dollar spent. Which concept is she using?",
      choices: [
        "Market share",
        "Return on investment",
        "Accounts receivable",
        "Lead time",
      ],
      correctIndex: 1,
      explanation:
        "Comparing benefit gained per dollar invested is exactly what ROI measures.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "A company divides its total sales and marketing spending for the quarter by the number of new customers won in that quarter. What is it measuring?",
      choices: [
        "Market share",
        "Gross margin",
        "Customer acquisition cost",
        "Inventory turnover",
      ],
      correctIndex: 2,
      explanation:
        "Spend divided by new customers gained is the definition of customer acquisition cost.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "A competitor cuts prices sharply, saying it wants a bigger slice of the region's total sales. What is the competitor trying to grow?",
      choices: [
        "Its gross margin",
        "Its operating expenses",
        "Its accounts payable",
        "Its market share",
      ],
      correctIndex: 3,
      explanation:
        "Capturing a larger portion of total industry sales is growing market share — often at the expense of margin.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 1,
      prompt:
        "A branch repeatedly runs out of its fastest-selling items before the next delivery arrives. What is this problem called?",
      choices: ["Stockouts", "Overstocking", "Backhauling", "Cross-docking"],
      correctIndex: 0,
      explanation:
        "Running out of stock before replenishment is a stockout — it costs sales and frustrates customers.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "A warehouse has shelves of products that have not sold in over two years. What is the main business concern with this stock?",
      choices: [
        "It will increase this month's revenue",
        "It ties up cash and may eventually have to be sold at a loss or written off",
        "It improves the company's cash flow",
        "It counts as an account receivable",
      ],
      correctIndex: 1,
      explanation:
        "Dead stock is cash sitting on a shelf, losing value. It often ends up discounted below cost or written off entirely.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "Why would a seller offer terms like \"2/10, net 30\" instead of just \"net 30\"?",
      choices: [
        "To charge customers more overall",
        "To extend the time customers can take to pay",
        "To encourage customers to pay sooner, bringing cash in faster",
        "To comply with shipping regulations",
      ],
      correctIndex: 2,
      explanation:
        "The early-payment discount trades a small amount of margin for faster cash collection, improving the seller's cash flow.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 3,
      prompt:
        "A buyer with limited cash is deciding whether to take a 2% early-payment discount by paying in 10 days instead of 30. What is the real tradeoff?",
      choices: [
        "Whether the goods will arrive on time",
        "Whether the supplier will raise prices next year",
        "Whether the discount changes the sales tax owed",
        "Giving up the use of the cash 20 days sooner in exchange for a 2% saving",
      ],
      correctIndex: 3,
      explanation:
        "Taking the discount means parting with cash 20 days earlier. The buyer weighs that loss of liquidity against the 2% reduction in cost.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "A customer's invoice is now 15 days past its Net 30 due date. What is the most appropriate first step?",
      choices: [
        "Contact the customer, confirm they received the invoice, and ask when payment will be made",
        "Immediately turn the account over to a collection agency",
        "Write the invoice off as a bad debt",
        "Ship the customer more goods to encourage payment",
      ],
      correctIndex: 0,
      explanation:
        "A courteous reminder resolves most late payments. Collections and write-offs are last resorts; shipping more goods increases the exposure.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "The finance team produces a report listing unpaid customer invoices grouped by how long each has been outstanding (0-30, 31-60, 61-90 days). What is this report called?",
      choices: [
        "A purchase order log",
        "An accounts receivable aging report",
        "A packing slip summary",
        "An inventory turnover report",
      ],
      correctIndex: 1,
      explanation:
        "Grouping open receivables by how overdue they are is an AR aging report — the standard tool for managing collections.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "Each month, a manager compares what each department actually spent against what was planned, and investigates the differences. What is this practice called?",
      choices: [
        "Three-way matching",
        "Inventory cycle counting",
        "Budget variance analysis",
        "Market share analysis",
      ],
      correctIndex: 2,
      explanation:
        "Comparing actual results to the budget and examining the gaps (variances) is budget variance analysis.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "A storm closes a major port, and products a distributor ordered from overseas will now arrive six weeks late. This is best described as a problem in the company's...",
      choices: [
        "Accounts receivable",
        "Commission structure",
        "Pricing strategy",
        "Supply chain",
      ],
      correctIndex: 3,
      explanation:
        "A disruption in how goods physically move from supplier to company is a supply chain problem.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 3,
      prompt:
        "A new rep prices a job by adding 30% to the company's cost, believing this produces a 30% profit margin. What is the actual result?",
      choices: [
        "The margin on the selling price is less than 30%, because a 30% markup on cost yields roughly a 23% margin",
        "The margin is exactly 30%, as intended",
        "The margin is more than 30%",
        "The job is priced below cost",
      ],
      correctIndex: 0,
      explanation:
        "Cost $100 marked up 30% sells for $130; profit is $30 on a $130 price, about 23% margin. Markup percentages always overstate margin.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "A company needs to improve its cash position this quarter. Which action would help most directly?",
      choices: [
        "Letting customers take longer to pay",
        "Collecting overdue customer invoices more quickly",
        "Buying extra inventory ahead of need",
        "Paying supplier invoices earlier than required",
      ],
      correctIndex: 1,
      explanation:
        "Faster collection converts receivables into cash. The other three options all push cash out sooner or delay its arrival.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 3,
      prompt:
        "A rep closes a large sale on Net 60 terms on March 1 and the goods ship that day. Which statement about revenue and cash is correct?",
      choices: [
        "Neither revenue nor cash is affected until the customer pays",
        "Cash arrives on March 1, and revenue is recorded when the customer pays",
        "The sale counts as revenue right away, but the cash will not arrive until the customer pays, up to 60 days later",
        "Revenue and cash both always occur on the same day",
      ],
      correctIndex: 2,
      explanation:
        "Credit sales create revenue (and a receivable) at delivery; the cash follows when the customer pays under the agreed terms.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 3,
      prompt:
        "A company changes its commission plan to pay reps a percentage of gross profit instead of a percentage of revenue. What behavior is this change designed to encourage?",
      choices: [
        "Making more sales calls per day",
        "Selling only to new customers",
        "Offering bigger discounts to close deals faster",
        "Protecting selling prices, since heavy discounting now directly shrinks the rep's own commission",
      ],
      correctIndex: 3,
      explanation:
        "Paying on gross profit aligns reps with margin: every dollar of discount comes partly out of their own commission, so discounting is discouraged.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "A distributor qualifies a second supplier for a critical product line even though the first supplier's prices are slightly lower. What is the main benefit?",
      choices: [
        "Reduced risk of being unable to supply customers if one source fails",
        "A guaranteed increase in gross margin",
        "Elimination of the need to carry inventory",
        "Shorter payment terms from customers",
      ],
      correctIndex: 0,
      explanation:
        "Dual sourcing is supply chain risk management: a small cost premium buys protection against a single supplier's failure or delay.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "A customer urgently needs a part that normally ships by ground in 6 days. Air freight gets it there tomorrow at five times the shipping cost. What is the core tradeoff?",
      choices: [
        "Product quality versus product price",
        "Speed of delivery versus freight cost",
        "Markup versus margin",
        "Revenue versus market share",
      ],
      correctIndex: 1,
      explanation:
        "Expedited shipping is a classic speed-versus-cost decision: pay more to move goods faster.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 3,
      prompt:
        "A company negotiates Net 60 terms with its suppliers while continuing to offer its customers Net 30. If customers pay on time, what is the effect on the company's cash position?",
      choices: [
        "It worsens, because the company now pays suppliers before collecting from customers",
        "It has no effect on cash timing",
        "It improves, because the company collects from customers about 30 days before it must pay its suppliers",
        "It doubles the company's revenue",
      ],
      correctIndex: 2,
      explanation:
        "Collecting in 30 days while paying in 60 means customer cash arrives before supplier bills are due — the company's cash cushion grows.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "Which of the following is a variable cost for a distribution business — one that rises and falls with sales volume?",
      choices: [
        "The warehouse's annual property insurance",
        "The office manager's salary",
        "Monthly rent on the branch building",
        "Sales commissions paid as a percentage of each sale",
      ],
      correctIndex: 3,
      explanation:
        "Commissions scale directly with sales. Insurance, salaries, and rent stay roughly constant regardless of volume — they are fixed costs.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "A rep quotes a large job using last year's price list. Since then, supplier costs have risen 15%. If the customer accepts, what is the biggest risk?",
      choices: [
        "The job may earn little or no gross profit, or even lose money, because the quoted prices no longer cover current costs",
        "The customer will refuse delivery",
        "The supplier will cancel the company's account",
        "The invoice cannot legally be issued",
      ],
      correctIndex: 0,
      explanation:
        "Quoting off stale prices squeezes or eliminates gross profit once real, higher costs are applied to the sale.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 3,
      prompt:
        "Two distributors have the same annual sales. One turns its inventory 12 times a year; the other turns it 4 times. What advantage does the faster-turning company have?",
      choices: [
        "It always earns a higher gross margin on each sale",
        "It needs far less cash invested in inventory to support the same level of sales",
        "It can skip doing physical inventory counts",
        "Its suppliers are required to give it better prices",
      ],
      correctIndex: 1,
      explanation:
        "Higher turnover means the same sales are supported by a smaller stock investment, freeing cash for other uses. It says nothing about margin per sale.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "Before opening a Net 30 account for a new customer, a company runs a credit check. What risk is it protecting itself against?",
      choices: [
        "The customer ordering too frequently",
        "The customer demanding faster delivery",
        "The customer taking the goods and failing to pay, creating a bad debt",
        "The customer paying too early",
      ],
      correctIndex: 2,
      explanation:
        "Selling on credit means delivering before being paid. The credit check screens for customers likely to default.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 3,
      prompt:
        "A distributor of seasonal equipment builds up inventory in the two months before its busy season. How does this affect cash during those two months?",
      choices: [
        "Cash increases immediately because inventory counts as cash",
        "Cash is unaffected; only profit changes",
        "Cash increases because suppliers pay the distributor to stock their goods",
        "Cash goes down now, and comes back later once the goods are sold and customer payments are collected",
      ],
      correctIndex: 3,
      explanation:
        "Building stock consumes cash up front. The cash returns only after the season's sales are made and the receivables are collected.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 2,
      prompt:
        "A rep's prospect says cash is tight. The rep's company offers Net 60 terms while the competitor requires Net 30. How can the rep use this in selling?",
      choices: [
        "Point out that the longer payment terms let the customer hold onto their cash twice as long",
        "Offer to raise the price in exchange for the longer terms",
        "Explain that Net 60 means the goods arrive faster",
        "Suggest the customer pay in advance instead",
      ],
      correctIndex: 0,
      explanation:
        "Longer terms are a real financial benefit to a cash-constrained buyer: they keep their cash for 60 days instead of 30.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "application",
      difficulty: 3,
      prompt:
        "A supplier offers 10% off if a distributor buys a full year's supply of a product at once. What is the key tradeoff to weigh?",
      choices: [
        "The discount versus the commission owed to the sales rep",
        "The 10% cost saving versus the cash tied up for months, plus storage costs and the risk that demand changes",
        "The discount versus the freight class of small shipments",
        "There is no tradeoff; a discount is always worth taking",
      ],
      correctIndex: 1,
      explanation:
        "Bulk buys trade a lower unit cost against working capital tied up in stock, carrying costs, and obsolescence risk if demand shifts.",
    },

    // ------------------------------------------------------------------
    // Calculations (all arithmetic verified)
    // ------------------------------------------------------------------
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 1,
      prompt: "A branch sells 400 units at $25 each. What is the revenue from these sales?",
      choices: ["$1,000", "$4,000", "$10,000", "$25,000"],
      correctIndex: 2,
      explanation: "400 x $25 = $10,000.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 2,
      prompt:
        "A company has revenue of $200,000, and the goods it sold cost $150,000. What is its gross profit?",
      choices: ["$350,000", "$200,000", "$150,000", "$50,000"],
      correctIndex: 3,
      explanation: "Gross profit = revenue - COGS = $200,000 - $150,000 = $50,000.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 2,
      prompt:
        "An item costs the company $80 and sells for $100. What is the gross margin percentage?",
      choices: ["20%", "25%", "80%", "125%"],
      correctIndex: 0,
      explanation:
        "Profit is $20 on a $100 selling price: 20 / 100 = 20% margin. (20 / 80 = 25% would be the markup.)",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 3,
      prompt:
        "An item costs the company $80 and sells for $100. What is the markup percentage on cost?",
      choices: ["20%", "25%", "80%", "10%"],
      correctIndex: 1,
      explanation:
        "Markup is profit over cost: $20 / $80 = 25%. (20% would be the margin, which uses price as the base.)",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 2,
      prompt:
        "A product costs $60. The company prices it using a 40% markup on cost. What is the selling price?",
      choices: ["$64", "$80", "$84", "$100"],
      correctIndex: 2,
      explanation: "$60 + (40% of $60 = $24) = $84.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 3,
      prompt:
        "A product costs $75, and the company wants a 25% gross margin on the selling price. What must the selling price be?",
      choices: ["$93.75", "$90.00", "$95.00", "$100.00"],
      correctIndex: 3,
      explanation:
        "For a 25% margin, cost must be 75% of price: $75 / 0.75 = $100. ($93.75 is a 25% markup on cost — the common error.)",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 1,
      prompt: "A salesperson earns a 5% commission. How much does she earn on a $12,000 sale?",
      choices: ["$600", "$500", "$1,200", "$60"],
      correctIndex: 0,
      explanation: "5% of $12,000 = 0.05 x 12,000 = $600.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 2,
      prompt:
        "A company spends $8,000 on new shelving that generates $2,000 in extra profit in its first year. What is the first-year return on investment?",
      choices: ["20%", "25%", "40%", "4%"],
      correctIndex: 1,
      explanation: "ROI = profit / investment = $2,000 / $8,000 = 25%.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 2,
      prompt: "An invoice dated June 1 carries Net 30 terms. By what date is full payment due?",
      choices: ["June 15", "June 30", "July 1", "July 31"],
      correctIndex: 2,
      explanation: "30 days after June 1 is July 1 (June has 30 days).",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 3,
      prompt:
        "A $1,000 invoice carries terms of 2/10, net 30. The buyer pays on day 8. How much should the buyer pay?",
      choices: ["$1,000", "$900", "$998", "$980"],
      correctIndex: 3,
      explanation:
        "Paying within 10 days earns the 2% discount: $1,000 - $20 = $980.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 2,
      prompt:
        "A company has current (short-term) assets of $500,000 and current liabilities of $300,000. What is its working capital?",
      choices: ["$200,000", "$800,000", "$300,000", "$500,000"],
      correctIndex: 0,
      explanation: "Working capital = $500,000 - $300,000 = $200,000.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 2,
      prompt:
        "Total industry sales in a region are $50 million per year. A company sells $5 million per year there. What is its market share?",
      choices: ["5%", "10%", "20%", "50%"],
      correctIndex: 1,
      explanation: "$5M / $50M = 10% market share.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 1,
      prompt:
        "A customer receives a 20% discount off a $250 list price. What does the customer pay?",
      choices: ["$230", "$150", "$200", "$225"],
      correctIndex: 2,
      explanation: "20% of $250 is $50, so the price is $250 - $50 = $200.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 3,
      prompt:
        "An item lists for $100. The customer receives a 10% discount, then an additional 10% off the discounted price. What is the final price?",
      choices: ["$80", "$90", "$82", "$81"],
      correctIndex: 3,
      explanation:
        "$100 x 0.90 = $90, then $90 x 0.90 = $81. Chained discounts do not simply add to 20%.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 2,
      prompt:
        "A product sells for $50 and earns $10 of gross profit per unit. What is the gross margin percentage?",
      choices: ["20%", "25%", "10%", "40%"],
      correctIndex: 0,
      explanation: "Margin = profit / price = $10 / $50 = 20%.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 3,
      prompt:
        "An item costing $50 is marked up 100% to set its selling price. What is the gross margin percentage on the sale?",
      choices: ["100%", "50%", "25%", "75%"],
      correctIndex: 1,
      explanation:
        "A 100% markup on $50 gives a $100 price with $50 profit. Margin = 50 / 100 = 50%, not 100%.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 2,
      prompt:
        "A branch earns $80,000 in gross profit and has $60,000 in operating expenses. What is its operating income?",
      choices: ["$140,000", "$80,000", "$20,000", "$60,000"],
      correctIndex: 2,
      explanation: "Operating income = gross profit - operating expenses = $80,000 - $60,000 = $20,000.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 2,
      prompt:
        "A company spends $10,000 on marketing in a quarter and gains 50 new customers. What is its customer acquisition cost?",
      choices: ["$50", "$500", "$2,000", "$200"],
      correctIndex: 3,
      explanation: "$10,000 / 50 new customers = $200 per customer.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 2,
      prompt:
        "An order is placed on March 3 with a supplier whose lead time is 10 days. On about what date should the goods arrive?",
      choices: ["March 13", "March 10", "March 30", "April 3"],
      correctIndex: 0,
      explanation: "March 3 plus a 10-day lead time is March 13.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 3,
      prompt:
        "A department's budget for the quarter was $20,000, but it actually spent $23,000. By what percentage did it exceed its budget?",
      choices: ["3%", "15%", "13%", "23%"],
      correctIndex: 1,
      explanation:
        "The overage is $3,000 on a $20,000 budget: 3,000 / 20,000 = 15% over.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 3,
      prompt:
        "A product's cost rises to $44. The company wants to keep earning a 20% gross margin on the selling price. What should the new price be?",
      choices: ["$52.80", "$48.00", "$55.00", "$50.00"],
      correctIndex: 2,
      explanation:
        "At a 20% margin, cost is 80% of price: $44 / 0.80 = $55. ($52.80 is a 20% markup on cost — the common error.)",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 3,
      prompt:
        "A distributor's cost of goods sold is $600,000 per year, and its average inventory on hand is worth $100,000. How many times does its inventory turn over per year?",
      choices: ["60 times", "1.7 times", "12 times", "6 times"],
      correctIndex: 3,
      explanation: "Inventory turnover = COGS / average inventory = 600,000 / 100,000 = 6 turns per year.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 2,
      prompt:
        "A warehouse starts the month with 200 units, receives 500 more, and sells 600 during the month. How many units are left at month end?",
      choices: ["100", "300", "700", "1,300"],
      correctIndex: 0,
      explanation: "200 + 500 - 600 = 100 units remaining.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 3,
      prompt:
        "A product sells for $100 with a cost of $70. A rep cuts the price 10% to $90. Roughly how many more units must the rep sell to earn the same total gross profit as before?",
      choices: [
        "10% more",
        "50% more",
        "25% more",
        "No more — the discount does not affect gross profit",
      ],
      correctIndex: 1,
      explanation:
        "Profit per unit falls from $30 to $20. To match the old total, sales must rise by 30/20 = 1.5x — 50% more units for a 10% price cut.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 3,
      prompt:
        "A branch has fixed costs of $50,000 per month, and each unit sold contributes $25 after its direct costs. How many units must it sell each month to break even?",
      choices: ["500 units", "1,250 units", "2,000 units", "5,000 units"],
      correctIndex: 2,
      explanation: "Breakeven = fixed costs / contribution per unit = 50,000 / 25 = 2,000 units.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "calculation",
      difficulty: 3,
      prompt:
        "A commission plan pays 3% on the first $10,000 of a sale and 5% on anything above that. What commission does a rep earn on a $20,000 sale?",
      choices: ["$600", "$1,000", "$700", "$800"],
      correctIndex: 3,
      explanation:
        "3% of $10,000 = $300, plus 5% of the remaining $10,000 = $500. Total: $800.",
    },

    // ------------------------------------------------------------------
    // Document flow
    // ------------------------------------------------------------------
    {
      construct: "BUSINESS_TERMS",
      subtype: "document_flow",
      difficulty: 1,
      prompt: "Which sequence shows the usual order of documents in a business purchase?",
      choices: [
        "Quote → purchase order → invoice → payment",
        "Invoice → quote → payment → purchase order",
        "Purchase order → quote → payment → invoice",
        "Payment → invoice → purchase order → quote",
      ],
      correctIndex: 0,
      explanation:
        "The seller quotes, the buyer orders with a PO, the seller ships and invoices, and the buyer pays.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "document_flow",
      difficulty: 1,
      prompt: "In a typical transaction between two companies, who issues the purchase order?",
      choices: [
        "The seller, to confirm the sale",
        "The buyer, to authorize the purchase from the supplier",
        "The freight carrier, to schedule the delivery",
        "The bank, to release the payment",
      ],
      correctIndex: 1,
      explanation:
        "The PO comes from the buyer — it is the buyer's formal commitment to purchase from the supplier.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "document_flow",
      difficulty: 1,
      prompt: "Who sends the invoice, and to whom?",
      choices: [
        "The buyer sends it to the seller to place an order",
        "The carrier sends it to the seller to confirm delivery",
        "The seller sends it to the buyer to request payment",
        "The buyer sends it to the bank to release funds",
      ],
      correctIndex: 2,
      explanation:
        "The invoice flows from seller to buyer: it is the seller's bill for goods or services provided.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "document_flow",
      difficulty: 1,
      prompt:
        "A carton arrives at the receiving dock. Which document, found with the goods, lists what the carton should contain?",
      choices: ["The purchase order", "The invoice", "The quote", "The packing slip"],
      correctIndex: 3,
      explanation:
        "The packing slip ships with the goods and itemizes the contents so receiving can verify the delivery.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "document_flow",
      difficulty: 1,
      prompt:
        "A customer calls and asks, \"What would 200 of these units cost, delivered to our plant?\" What document should the salesperson send in response?",
      choices: ["A quote", "An invoice", "A credit memo", "A purchase order"],
      correctIndex: 0,
      explanation:
        "A request for pricing is answered with a quote. Invoicing happens only after goods are sold and delivered.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "document_flow",
      difficulty: 1,
      prompt:
        "A customer reviews a quote and decides to buy. What document does the customer typically send to commit to the purchase?",
      choices: ["An invoice", "A purchase order", "A packing slip", "A statement"],
      correctIndex: 1,
      explanation:
        "Accepting a quote is done by placing an order — the customer issues a purchase order to the seller.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "document_flow",
      difficulty: 2,
      prompt:
        "A distributor has shipped an order and the customer has received it. What does the distributor send next to get paid?",
      choices: ["A new quote", "A purchase order", "An invoice", "A receiving report"],
      correctIndex: 2,
      explanation:
        "After delivery, the seller issues an invoice to bill the customer under the agreed terms.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "document_flow",
      difficulty: 2,
      prompt:
        "In a \"three-way match\" before paying a supplier, the invoice is compared against which two other records?",
      choices: [
        "The budget and the sales forecast",
        "The quote and the credit memo",
        "The bank statement and the price list",
        "The purchase order and the receiving record showing what actually arrived",
      ],
      correctIndex: 3,
      explanation:
        "Matching invoice, PO, and receiving record confirms the company pays only for goods that were both ordered and received, at the agreed price.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "document_flow",
      difficulty: 2,
      prompt: "Why should a supplier's invoice reference the buyer's purchase order number?",
      choices: [
        "So the buyer's accounts payable team can match the invoice to an approved purchase before paying it",
        "Because carriers refuse to deliver without it",
        "It sets the sales tax rate for the order",
        "It guarantees the seller a faster delivery slot",
      ],
      correctIndex: 0,
      explanation:
        "The PO number ties the bill to an authorized purchase, letting accounts payable verify and approve payment quickly.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "document_flow",
      difficulty: 2,
      prompt:
        "A customer received damaged goods and is returning them. The invoice was already issued. What should the seller send to reduce what the customer owes?",
      choices: ["A second invoice", "A credit memo", "A purchase order", "A packing slip"],
      correctIndex: 1,
      explanation:
        "A credit memo offsets the original invoice, lowering the customer's balance for the returned goods.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "document_flow",
      difficulty: 3,
      prompt:
        "Which sequence best describes the buyer's side of a credit purchase, from start to finish?",
      choices: [
        "Pay the supplier → issue the purchase order → receive the goods → receive the invoice",
        "Receive the invoice → issue the purchase order → pay the supplier → receive the goods",
        "Issue the purchase order → receive the goods → match the invoice to the order and receipt → pay the supplier",
        "Receive the goods → pay the supplier → issue the purchase order → match the invoice",
      ],
      correctIndex: 2,
      explanation:
        "The buyer orders first, receives and checks the goods, verifies the invoice against order and receipt, and only then releases payment.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "document_flow",
      difficulty: 3,
      prompt:
        "A customer receives a monthly statement from a supplier as well as individual invoices. What is the difference?",
      choices: [
        "A statement is a new charge that must be paid in addition to the invoices",
        "Invoices summarize the statements issued during the month",
        "A statement replaces the invoices, which can then be ignored",
        "Each invoice bills a specific shipment, while the statement summarizes all invoices still unpaid on the account",
      ],
      correctIndex: 3,
      explanation:
        "Invoices are the individual bills; the statement is a recap of the account's open items. Paying the statement's listed invoices settles it — it is not an extra charge.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "document_flow",
      difficulty: 3,
      prompt:
        "A distributor receives a customer's purchase order for an item it does not stock. The distributor decides to buy the item from the manufacturer to fill the order. What document does the distributor send to the manufacturer?",
      choices: [
        "Its own purchase order, since the distributor is now the buyer",
        "The customer's original purchase order, unchanged",
        "An invoice billing the manufacturer",
        "A credit memo",
      ],
      correctIndex: 0,
      explanation:
        "Roles flip along the chain: the distributor is the seller to its customer but the buyer from the manufacturer, so it issues its own PO upstream.",
    },
    {
      construct: "BUSINESS_TERMS",
      subtype: "document_flow",
      difficulty: 2,
      prompt:
        "When a buyer pays a supplier's invoice, which two sets of records are settled by the payment?",
      choices: [
        "The buyer's accounts receivable and the seller's accounts payable",
        "The buyer's accounts payable and the seller's accounts receivable",
        "Both companies' payroll records",
        "The buyer's inventory records and the seller's marketing budget",
      ],
      correctIndex: 1,
      explanation:
        "The same debt sits in the buyer's payables and the seller's receivables; the payment clears it from both.",
    },
  ],
};
