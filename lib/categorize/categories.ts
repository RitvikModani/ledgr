/**
 * The seeded category set.
 *
 * Deliberately Indian-shaped — EMI and Mobile & Internet are separate lines
 * because they are separate decisions here, and Transfer exists so money moving
 * between the user's own accounts can be excluded from income and expense
 * rather than double-counted.
 */
export const CATEGORIES = [
  "Income",
  "Rent",
  "Groceries",
  "Dining",
  "Transport",
  "Fuel",
  "Utilities",
  "Mobile & Internet",
  "Health",
  "Insurance",
  "Education",
  "Shopping",
  "Entertainment",
  "Subscriptions",
  "EMI",
  "Investments",
  "Transfer",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const UNCATEGORIZED: Category = "Other";

/**
 * Categories excluded from spending analysis.
 *
 * Income is not spending. Transfers are the user's own money changing pockets.
 * Investments leave the current account but are not consumption — they are
 * counted as saving, so folding them into expenses would understate the savings
 * rate by exactly the amount being saved.
 */
export const NON_EXPENSE_CATEGORIES: ReadonlySet<string> = new Set([
  "Income",
  "Transfer",
  "Investments",
]);

/** Categories that do not belong in a monthly spending envelope. */
export const NON_BUDGETABLE: ReadonlySet<string> = new Set([
  "Income",
  "Transfer",
  "Investments",
  "EMI",
]);

interface CategoryRule {
  category: Category;
  keywords: string[];
}

/**
 * Merchant keyword rules, matched against the normalised merchant string.
 *
 * Order matters: the first match wins, so narrower rules come first. Insurance
 * precedes Health because "star health insurance" is a premium, not a hospital
 * bill; Subscriptions precedes Entertainment because a Netflix charge is a
 * recurring subscription first.
 */
export const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "Transfer",
    keywords: [
      "self", "own account", "credit card payment", "card payment", "cc payment",
      "autopay", "billdesk", "sweep", "transfer to", "transfer from",
    ],
  },
  {
    category: "Investments",
    keywords: [
      "sip", "mutual fund", "mf purchase", "groww", "zerodha", "coin", "kuvera",
      "upstox", "angelone", "angel broking", "icicidirect", "hdfcsec", "kotaksec",
      "nps", "ppf", "elss", "smallcase", "indmoney", "paytm money", "etmoney",
      "recurring deposit", "fixed deposit", "rd instal", "sovereign gold",
    ],
  },
  {
    category: "EMI",
    keywords: [
      "emi", "loan", "instalment", "installment", "hdfc ltd", "bajaj finance",
      "bajaj finserv", "home loan", "car loan", "personal loan", "tata capital",
    ],
  },
  {
    category: "Insurance",
    keywords: [
      "insurance", "premium", "lic", "policybazaar", "hdfc life", "icici pru",
      "sbi life", "max life", "star health", "niva bupa", "care health", "acko",
      "digit", "tata aig", "bajaj allianz",
    ],
  },
  {
    category: "Rent",
    keywords: ["rent", "landlord", "nobroker", "housing society", "maintenance charge", "society due"],
  },
  {
    category: "Mobile & Internet",
    keywords: [
      "airtel", "jio", "vodafone", "vi", "bsnl", "act fibernet", "hathway",
      "excitel", "broadband", "recharge", "mobile bill", "postpaid", "prepaid",
    ],
  },
  {
    category: "Utilities",
    keywords: [
      "electricity", "bescom", "mseb", "adani electricity", "tata power",
      "torrent power", "bses", "water bill", "gas", "indane", "hp gas",
      "bharat gas", "piped gas", "mahanagar gas", "igl", "municipal",
    ],
  },
  {
    category: "Subscriptions",
    keywords: [
      "netflix", "prime video", "hotstar", "jiocinema", "sonyliv", "zee5",
      "spotify", "gaana", "wynk", "youtube premium", "apple", "icloud",
      "google one", "adobe", "microsoft", "notion", "canva", "chatgpt",
      "openai", "anthropic", "figma", "dropbox", "audible", "kindle unlimited",
    ],
  },
  {
    category: "Groceries",
    keywords: [
      "bigbasket", "blinkit", "zepto", "instamart", "dmart", "reliance fresh",
      "reliance smart", "more retail", "spencer", "star bazaar", "nature basket",
      "grofers", "jiomart", "kirana", "supermarket", "grocery", "vegetable",
      "milk", "amul", "mother dairy", "licious", "freshtohome",
    ],
  },
  {
    category: "Dining",
    keywords: [
      "swiggy", "zomato", "eatsure", "dominos", "pizza", "mcdonald", "kfc",
      "burger king", "subway", "starbucks", "cafe", "coffee", "restaurant",
      "dhaba", "bakery", "barbeque", "biryani", "chai", "food", "eatery",
      "dineout", "faasos", "behrouz", "wow momo", "haldiram",
    ],
  },
  {
    category: "Fuel",
    keywords: [
      "petrol", "diesel", "fuel", "hpcl", "bpcl", "iocl", "indian oil",
      "hp petrol", "bharat petroleum", "shell", "nayara", "reliance petro",
    ],
  },
  {
    category: "Transport",
    keywords: [
      "uber", "ola", "rapido", "metro", "irctc", "railway", "redbus", "abhibus",
      "indigo", "spicejet", "air india", "vistara", "akasa", "makemytrip",
      "goibibo", "cleartrip", "yatra", "fastag", "parking", "toll", "namma yatri",
      "blusmart", "bounce", "yulu",
    ],
  },
  {
    category: "Health",
    keywords: [
      "pharmacy", "apollo", "medplus", "netmeds", "pharmeasy", "1mg", "tata 1mg",
      "hospital", "clinic", "diagnostic", "lab", "dental", "doctor", "medical",
      "practo", "cult fit", "cultfit", "gym", "fitness", "wellness",
    ],
  },
  {
    category: "Education",
    keywords: [
      "school", "college", "university", "tuition", "fees", "coursera", "udemy",
      "byju", "unacademy", "vedantu", "physics wallah", "upgrad", "great learning",
      "scaler", "book", "stationery",
    ],
  },
  {
    category: "Entertainment",
    keywords: [
      "bookmyshow", "pvr", "inox", "cinepolis", "cinema", "movie", "gaming",
      "steam", "playstation", "xbox", "nintendo", "dream11", "concert", "event",
    ],
  },
  {
    category: "Shopping",
    keywords: [
      "amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa", "tata cliq",
      "snapdeal", "shoppers stop", "lifestyle", "westside", "pantaloons",
      "zara", "h&m", "uniqlo", "decathlon", "croma", "reliance digital",
      "vijay sales", "ikea", "urban ladder", "pepperfry", "firstcry", "purplle",
      "boat", "titan", "tanishq", "lenskart",
    ],
  },
  {
    category: "Income",
    keywords: [
      "salary", "sal cr", "payroll", "stipend", "bonus", "incentive", "reimburse",
      "refund", "cashback", "interest credit", "dividend", "freelance", "consulting",
    ],
  },
];

/** Categories a positive amount is allowed to fall into. */
export const INCOME_CATEGORIES: ReadonlySet<string> = new Set(["Income", "Transfer"]);
