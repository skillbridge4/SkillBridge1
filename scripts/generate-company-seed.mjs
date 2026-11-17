import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'data/seed/companies.json');
const groups = [
  ['IT services / MNC India', 'MNC', [
    'Mphasis', 'Hexaware', 'Persistent Systems', 'Coforge', 'Zensar',
    'LTIMindtree', 'Birlasoft', 'Cyient', 'KPIT', 'Sonata Software',
    'Happiest Minds', 'Deloitte India', 'EY GDS', 'KPMG India', 'PwC India',
    'Oracle India', 'SAP Labs India', 'Salesforce India', 'Cisco India', 'Dell',
    'Qualcomm India', 'NVIDIA India', 'Samsung R&D India',
    'Texas Instruments India', 'Honeywell India', 'Goldman Sachs India',
    'JP Morgan India', 'Morgan Stanley India', 'Walmart Global Tech India',
    'Atlassian India', 'Uber India', 'IBM India', 'Wipro', 'HCLTech',
    'Cognizant India', 'TCS'
  ]],
  ['Startups / product', 'Startup', [
    'Zoho', 'Freshworks', 'Razorpay', 'CRED', 'Meesho', 'Groww', 'Zerodha',
    'PhonePe', 'Paytm', 'Swiggy', 'Zomato', 'Flipkart', 'Ola', 'Nykaa',
    'Postman', 'BrowserStack', 'Chargebee', 'Juspay', 'Zepto', 'Dream11',
    'upGrad', 'PhysicsWallah', 'Unacademy', 'Lenskart', 'Urban Company',
    'Delhivery', 'Pine Labs', 'Cars24', 'Licious', 'Darwinbox'
  ]],
  ['Core engineering / manufacturing / auto / energy', 'MNC', [
    'L&T', 'Tata Motors', 'Tata Steel', 'Tata Power', 'Mahindra', 'Bajaj Auto',
    'TVS Motor', 'Hero MotoCorp', 'Ashok Leyland', 'Bosch India',
    'Siemens India', 'ABB India', 'Schneider Electric India',
    'GE Vernova India', 'Reliance Industries', 'Adani Group', 'JSW', 'Godrej',
    'Havells'
  ]],
  ['Government / PSU', 'PSU/Govt', [
    'ISRO', 'DRDO', 'BARC', 'CSIR', 'NITI Aayog', 'ONGC', 'BHEL', 'NTPC',
    'Indian Oil', 'HAL', 'BEL', 'GAIL', 'SAIL', 'Coal India', 'Power Grid',
    'C-DAC', 'NIC', 'PM Internship Scheme', 'Skill India Digital'
  ]],
  ['Research', 'Research', ['IISc']],
  ['Learning programs', 'Program', [
    'Infosys Springboard', 'TCS iON', 'NPTEL', 'SWAYAM',
    'Google Career Certificates', 'Microsoft Learn India', 'AWS Educate',
    'Internshala Trainings'
  ]]
];

function slugify(value) {
  return value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const companies = groups.flatMap(([sector, type, names]) => names.map(name => ({
  id: slugify(name),
  name,
  sector,
  type,
  city: null,
  state: null,
  website: null,
  careersUrl: null,
  logo: null,
  verified: false,
  lastVerified: '2026-11-10'
})));

const ids = companies.map(company => company.id);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate company IDs in catalog source.');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(companies, null, 2)}\n`);
console.log(`Generated ${companies.length} organizations; all require official-site verification.`);
