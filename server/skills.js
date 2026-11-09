'use strict';
// Skill groups: every skill belongs to one group, so lists, filters, forms and reports can show skills grouped.
// Each group has a starting list (what forms offer) and a pattern that places free-text skills read from resumes.
// The order matters: the first group whose pattern fits a skill takes it (Photoshop is design software, not office).
// Settings › skill_groups can replace the lists; the patterns stay here.
const GROUPS = [
  { name: 'Soft skills', skills: ['Communication', 'Customer handling', 'Negotiation', 'Convincing skills', 'Team handling', 'Leadership', 'Presentation', 'Problem solving', 'Time management', 'Complaint handling', 'Telephone etiquette', 'Grooming & etiquette'],
    match: /communicat|customer (handl|service|relation)|negotiat|convinc|persua|team (handl|lead|work|manag)|leader|presentation|problem solv|time manag|complaint|etiquette|grooming|interpersonal|relationship build|people manag|patience|listening/i },
  { name: 'Languages', skills: ['English', 'Hindi', 'Marathi', 'Gujarati', 'Marwari / Rajasthani', 'Bengali', 'Punjabi', 'Tamil', 'Telugu', 'Kannada', 'Malayalam'],
    match: /^(english|hindi|marathi|gujarati|marwari|rajasthani|bengali|bangla|punjabi|tamil|telugu|kannada|malayalam|urdu|odia|sindhi)\b/i },
  { name: 'Sales & retail', skills: ['Retail sales', 'Upselling & cross-selling', 'Target achievement', 'Walk-in conversion', 'Client follow-up', 'Cold calling', 'Lead generation', 'B2B sales', 'Billing software', 'Cash handling', 'Visual merchandising', 'After-sales service'],
    match: /sales|upsell|cross.?sell|target|walk.?in|follow.?up|cold call|lead gen|billing|pos\b|cash|merchandis|after.?sales|counter|showroom|retail|crm|key account|business development|b2b|wholesale|export/i },
  { name: 'Jewellery & product knowledge', skills: ['Gold knowledge', 'Diamond knowledge', 'Diamond grading (4Cs)', 'Gemstone knowledge', 'Polki & Kundan', 'Bridal jewellery', 'Silver jewellery', 'Platinum jewellery', 'Hallmarking & HUID', 'Purity testing (karat)', 'Old gold exchange', 'Jewellery valuation'],
    match: /gold|diamond|gem|polki|kundan|bridal|silver|platinum|hallmark|huid|karat|carat|purity|4c|jewel|ornament|valuation|assort/i },
  { name: 'Design software', skills: ['CAD (Matrix)', 'CAD (Rhino)', 'JewelCAD', 'ZBrush', 'KeyShot rendering', '3D modelling', 'Hand sketching', 'Photoshop', 'Illustrator', 'CorelDRAW'],
    match: /matrix|rhino|zbrush|jewelcad|keyshot|cad\b|\bcad|render|3d|sketch|photoshop|illustrator|corel|blender|design software|autocad/i },
  { name: 'Craft & production', skills: ['Stone setting', 'Polishing', 'Casting', 'Filing', 'Soldering', 'Wax carving', 'Meenakari / enamelling', 'Kundan setting', 'Laser marking', 'Rhodium / electroplating', 'Assembly', 'Quality checking'],
    match: /setting|polish|casting|filing|solder|wax|meena|enamel|laser|rhodium|plating|assembl|karigar|craft|quality (check|control)|\bqc\b|hand ?made|cutting|engrav|repair/i },
  { name: 'Computer & office', skills: ['MS Excel', 'MS Word', 'PowerPoint', 'Google Sheets', 'Email writing', 'Typing', 'Data entry', 'Jewellery ERP software', 'Inventory software'],
    match: /excel|\bword\b|powerpoint|ppt|google (sheet|doc)|ms office|office|email|typing|data entry|computer|erp|software|internet/i },
  { name: 'Accounts & finance', skills: ['Tally', 'GST filing', 'TDS', 'Bank reconciliation', 'Accounts payable & receivable', 'Payroll', 'Costing', 'Audit support'],
    match: /tally|gst|tds|reconcil|payable|receivable|payroll|costing|audit|ledger|accounting|accounts|finance|invoice|bookkeep|taxation/i },
  { name: 'Marketing & digital', skills: ['Social media', 'Instagram marketing', 'Meta ads', 'Google ads', 'SEO', 'Content writing', 'Canva', 'Video editing', 'Photography', 'Influencer marketing', 'Email marketing'],
    match: /social media|instagram|facebook|meta ads|google ads|seo|content|canva|video|photograph|influencer|digital|marketing|branding|copywrit|campaign/i },
  { name: 'Operations & inventory', skills: ['Inventory management', 'Stock counting', 'Dispatch & courier', 'Packaging & insurance', 'Vendor coordination', 'Purchase & procurement', 'Barcode / RFID tagging', 'Warehouse handling'],
    match: /inventor|stock|dispatch|courier|logistic|packag|insurance|vendor|purchase|procure|barcode|rfid|tagging|warehouse|supply chain/i },
  { name: 'Admin & HR', skills: ['Recruitment', 'Onboarding', 'Attendance & leave', 'Front desk', 'Documentation', 'Office administration', 'Security & vault handling'],
    match: /recruit|\bhr\b|human resource|onboard|attendance|front desk|reception|documentation|admin|security|vault|compliance/i },
];
const OTHER = 'Other skills';
// The groups a department usually needs, most important first (forms show these first; the rest stay one tap away).
const DEPT_GROUPS = {
  Sales: ['Soft skills', 'Sales & retail', 'Jewellery & product knowledge', 'Languages', 'Computer & office'],
  Design: ['Design software', 'Jewellery & product knowledge', 'Soft skills', 'Computer & office'],
  Production: ['Craft & production', 'Jewellery & product knowledge', 'Soft skills'],
  Marketing: ['Marketing & digital', 'Computer & office', 'Soft skills', 'Languages'],
  Purchase: ['Operations & inventory', 'Jewellery & product knowledge', 'Computer & office', 'Soft skills'],
  Dispatch: ['Operations & inventory', 'Computer & office', 'Soft skills'],
  Accounts: ['Accounts & finance', 'Computer & office', 'Soft skills'],
  Admin: ['Admin & HR', 'Computer & office', 'Soft skills', 'Languages'],
  Support: ['Soft skills', 'Computer & office', 'Languages'],
};

function groups(settings) {
  const own = (settings && settings.skill_groups) || {};
  return GROUPS.map((g) => ({ name: g.name, skills: [...new Set([...(own[g.name] || g.skills)])], match: g.match }));
}
// The group a skill belongs to: listed skills first (exact, any case), then the patterns, else Other skills.
function groupOf(skill, list) {
  const s = String(skill || '').trim(); if (!s) return OTHER; const low = s.toLowerCase();
  const gs = list || groups();
  const exact = gs.find((g) => g.skills.some((x) => x.toLowerCase() === low)); if (exact) return exact.name;
  const pat = gs.find((g) => g.match.test(s)); return pat ? pat.name : OTHER;
}
// For the browser: lists plus each pattern as text (the same rules run there).
const forBoot = (settings) => ({ groups: groups(settings).map((g) => ({ name: g.name, skills: g.skills, match: g.match.source, flags: g.match.flags })), other: OTHER, by_dept: DEPT_GROUPS });

module.exports = { GROUPS, OTHER, DEPT_GROUPS, groups, groupOf, forBoot };
