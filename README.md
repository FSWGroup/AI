# AI
Testing things out.
import { useState, useRef, useCallback, useEffect } from "react";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const MODEL = "claude-sonnet-4-20250514";
const CACHE_KEY = "vm_spec_cache_v5";
const CACHE_TTL_DAYS = 7;
const uid = () => Math.random().toString(36).slice(2, 9);

const PARTNER_WEIGHT = {
  "Strategic": 100, "Preferred": 80, "Reseller-Friendly": 60,
  "Reseller": 50, "Active": 50, "Transactional": 30, "Rep Model": 40,
};

// ─── MANUFACTURER REGISTRY ─────────────────────────────────────────────────
// website = the live URL Claude will search for real product data
const MFR_REGISTRY = [
  { id:"aquatrol",   name:"Aquatrol",                 website:"https://www.aquatrol.com",                 partnerStatus:"Strategic",     category:"Safety Relief Valves",       contacts:[{name:"Renee Cartee",role:"Quote POC",phone:"630-365-5400",email:"renee@aquatrol.com"}] },
  { id:"avco",       name:"AVCO",                     website:"https://www.avcovalve.com",                partnerStatus:"Strategic",     category:"Ball/Gate/Globe/Check/Knife Gate/Butterfly/Plug/Solenoid", contacts:[{name:"Sales Team",role:"Quote POC",phone:"714-427-0877",email:"sales@avcovalve.com"}] },
  { id:"bonomi",     name:"Bonomi",                   website:"https://www.bonominorthamerica.com",       partnerStatus:"Strategic",     category:"Ball Valves/Butterfly/Actuators", contacts:[{name:"Sammy Ellison",role:"Quote POC",phone:"704-412-9031",email:"sammye@bonominorthamerica.com"}] },
  { id:"chicago",    name:"Chicago Valves",            website:"https://www.chicagovalves.com",            partnerStatus:"Strategic",     category:"Gate/Globe/Check/Ball/Butterfly", contacts:[{name:"Carmel Winkler",role:"Quote POC",phone:"312-637-3557",email:"cwinkler@chicagovalves.com"}] },
  { id:"controlair", name:"ControlAir Inc.",           website:"https://www.controlair.com",               partnerStatus:"Strategic",     category:"Pressure Regulators/Positioners/Transducers", contacts:[{name:"Melissa Hidalgo",role:"Quote POC",phone:"603-886-9400",email:"Mhidalgo@controlair.com"}] },
  { id:"gcvalves",   name:"GC Valves",                 website:"https://www.gcvalves.com",                 partnerStatus:"Strategic",     category:"Solenoid Valves",            contacts:[{name:"Sara Shunkwiler",role:"Quote POC",phone:"800-828-0484 x10",email:"sara.shunkwiler@gcvalves.com"},{name:"Staci Chaney",role:"Quote POC",phone:"724-772-8900",email:"staci.chaney@gcvalves.com"}] },
  { id:"noshok",     name:"Noshok",                   website:"https://www.noshok.com",                   partnerStatus:"Strategic",     category:"Instrumentation/Gauges/Transmitters/Needle Valves", contacts:[{name:"Mark Klumpp",role:"Regional POC",phone:"216-645-0306",email:"mklumpp@noshok.com"}] },
  { id:"plastom",    name:"Plast-O-Matic",            website:"https://www.plastomatic.com",              partnerStatus:"Strategic",     category:"Thermoplastic Valves/Regulators/Check Valves", contacts:[{name:"Todd Simmons",role:"Quote POC",phone:"",email:"tsimmons@plastomatic.com"}] },
  { id:"rwv",        name:"Red White Valve",           website:"https://www.rwvcusa.com",                  partnerStatus:"Strategic",     category:"Ball/Gate/Globe/Check/Butterfly/Plumbing", contacts:[{name:"Martha Martinez",role:"Quote POC",phone:"800-222-7982 x106",email:"m.martinez@rwvcusa.com"}] },
  { id:"reotemp",    name:"Reotemp Instruments",       website:"https://www.reotemp.com",                  partnerStatus:"Strategic",     category:"Pressure/Temperature Gauges/Transmitters/Thermometers", contacts:[{name:"Amy Cannon",role:"Quote POC",phone:"858-410-5962",email:"acannon@reotemp.com"}] },
  { id:"sanitary",   name:"Sanitary Solutions",        website:"https://www.sanitarysolutionsinc.com",     partnerStatus:"Strategic",     category:"Sanitary Ball/Butterfly/Check/Sample Valves", contacts:[{name:"Deb",role:"Quote POC",phone:"803-999-1919",email:"deb@sanitarysolutionsinc.com"}] },
  { id:"smartmeas",  name:"SmartMeasurement",          website:"https://www.smartmeasurement.com",         partnerStatus:"Strategic",     category:"Flow Meters/Pressure Transmitters", contacts:[{name:"Tom Genack",role:"Quote POC",phone:"414-299-3896",email:"Sales@Smartmeasurement.com"}] },
  { id:"stc",        name:"STC / Sizto Tech",          website:"https://www.stcvalve.com",                 partnerStatus:"Strategic",     category:"Solenoid/Pneumatic/Fittings",contacts:[{name:"Ray Danan",role:"Quote POC",phone:"650-856-8833",email:"ray@stcvalve.com"}] },
  { id:"svf",        name:"SVF Flow Controls",         website:"https://www.svf.net",                      partnerStatus:"Strategic",     category:"Ball/Butterfly/Check/Strainers/Sanitary/Actuators", contacts:[{name:"Dave Reulbach",role:"Quote POC",phone:"440-554-2824",email:"dreulbach@svf.net"}] },
  { id:"tektrol",    name:"Tek-Trol",                  website:"https://www.tek-trol.com",                 partnerStatus:"Strategic",     category:"Flow Meters/Transmitters/Level/Control Valves", contacts:[{name:"Josh Waters",role:"Quote POC",phone:"815-909-5627",email:"jwaters@tek-trol.com"}] },
  { id:"tissin",     name:"Tissin",                   website:"https://www.tissinusa.com",                partnerStatus:"Strategic",     category:"Stainless/Sanitary Valves/Fittings", contacts:[{name:"Steven Hacker",role:"Quote POC",phone:"513-202-3270",email:"Shacker@Tissinusa.com"}] },
  { id:"titan",      name:"Titan Flow Control",        website:"https://www.titanfci.com",                 partnerStatus:"Strategic",     category:"Strainers/Check Valves/Butterfly/Relief Valves", contacts:[{name:"Bradley Cutrell",role:"Quote POC",phone:"",email:"bcutrell@titanfci.com"},{name:"Colby Kuhn",role:"Quote POC (Wiltech)",phone:"856-423-9400",email:"colby@wiltechinc.com"}] },
  { id:"triac",      name:"Triac / A-T Controls",      website:"https://www.atcontrols.com",               partnerStatus:"Strategic",     category:"Ball/Butterfly/Actuators/Cryogenic/Severe Service", contacts:[{name:"Kym Klak",role:"Quote POC",phone:"281-561-0530",email:"kym.klak@atcontrols.com"}] },
  { id:"adca",       name:"Adcapure / Valsteam ADCA",  website:"https://www.valsteam.com",                 partnerStatus:"Preferred",     category:"Steam Traps/Regulators/Control Valves/Sanitary", contacts:[{name:"João Ferreira",role:"Quote POC",phone:"+351 236 959 060",email:"Adca.Sales@Valsteam.com"}] },
  { id:"aquasyn",    name:"Aquasyn",                   website:"https://www.aquasyn.com",                  partnerStatus:"Preferred",     category:"Sanitary Diaphragm Valves/Custom Fabrication", contacts:[{name:"Chris Belieu",role:"Quote POC",phone:"888-676-4050",email:"cbelieu@aquasyn.com"}] },
  { id:"ari",        name:"ARI Armaturen",             website:"https://www.ari-armaturen.com",             partnerStatus:"Preferred",     category:"Control/Safety/Steam/Pressure Reducing Valves", contacts:[{name:"Kris Bollmann",role:"Quote POC",phone:"713-845-1500 X-203",email:"info@ari-armaturen.us"}] },
  { id:"dmic",       name:"DMIC",                     website:"https://www.dmic.com",                     partnerStatus:"Preferred",     category:"High Pressure Ball Valves up to 15000 PSI", contacts:[{name:"Scott Csepegi",role:"Quote POC",phone:"716-743-4360",email:"slc@dmic.com"}] },
  { id:"easytork",   name:"Easy Tork",                 website:"https://www.easytork.com",                 partnerStatus:"Preferred",     category:"Pneumatic Actuators/Valve Packages", contacts:[{name:"Tom Weeden",role:"Quote POC",phone:"843-263-7173",email:"tom.weeden@easytork.com"}] },
  { id:"flotite",    name:"Flo-Tite",                  website:"https://www.flotite.com",                  partnerStatus:"Preferred",     category:"Ball/Butterfly/Knife Gate/Control Valves/Actuators", contacts:[{name:"Kayla Guyton",role:"Quote POC",phone:"910-738-8904",email:"kguyton@flotite.com"}] },
  { id:"hayward",    name:"Hayward Flow Control",      website:"https://www.haywardflowcontrol.com",        partnerStatus:"Preferred",     category:"Thermoplastic Ball/Butterfly/Check Valves/Pumps", contacts:[{name:"Dan Mckeever",role:"HIPCO",phone:"215-657-2490",email:"dmckeever@hipco.com"}] },
  { id:"islip",      name:"Islip Flow Controls",       website:"https://www.islipflowcontrols.com",         partnerStatus:"Preferred",     category:"Strainers/Check Valves/Butterfly/Ball", contacts:[{name:"Jeff Robson",role:"Quote POC",phone:"905-335-8777",email:"jeff.robson@islipflowcontrols.com"}] },
  { id:"jflow",      name:"J Flow Controls",           website:"https://www.jflowcontrols.com",             partnerStatus:"Preferred",     category:"Ball/Butterfly/Control/Check/Cryogenic/Severe Service", contacts:[{name:"Blake Copeland",role:"East Coast Mgr",phone:"",email:""}] },
  { id:"maxair",     name:"Max-Air Technology",        website:"https://www.max-airtechnology.com",         partnerStatus:"Preferred",     category:"Actuators/Butterfly/Ball Valves/Accessories", contacts:[{name:"Emily Worful",role:"Quote POC",phone:"636-272-4934",email:"Emily.Worful@maxairtech.com"}] },
  { id:"praher",     name:"Praher Plastics",           website:"https://www.praherplastics.com",            partnerStatus:"Preferred",     category:"Thermoplastic Ball/Butterfly/Diaphragm/Check Valves", contacts:[{name:"Cesar Sacramento",role:"Quote POC",phone:"416-688-8532",email:"cesar.sacramento@praherplastics.com"}] },
  { id:"tempco",     name:"Tempco",                   website:"https://www.tempco.com",                   partnerStatus:"Preferred",     category:"Electric Heaters/Temperature Sensors/PID Controls", contacts:[{name:"Bob Hospodka",role:"Sales Mgr",phone:"630-477-3214",email:"Bobhospodka@Tempco.com"}] },
  { id:"watts",      name:"Watts / VBA",               website:"https://www.watts.com",                    partnerStatus:"Preferred",     category:"Backflow/Ball/Butterfly/PRV/Mixing/Strainers", contacts:[{name:"Sales Team",role:"VBA",phone:"215-443-7500",email:"jeppright@vbasales.com"}] },
  { id:"wayland",    name:"WayLand Sanitary",          website:"https://www.waylandindustries.com",         partnerStatus:"Preferred",     category:"Sanitary Ball/Butterfly/Diaphragm/Check/Fittings", contacts:[{name:"Ryan",role:"Quote POC",phone:"",email:"ryan@waylandindusties.com"}] },
  { id:"straval",    name:"Straval",                  website:"https://www.straval.com",                  partnerStatus:"Active",        category:"Pressure Regulators/Relief Valves/Sanitary/Custom", contacts:[{name:"Ed Simin",role:"Quote POC",phone:"973-340-9955",email:"customerservice@straval.com"}] },
  { id:"apollo",     name:"Apollo (Layden / Conbraco)", website:"https://www.conbraco.com",                partnerStatus:"Reseller-Friendly", category:"Ball/Gate/Globe/Check/Butterfly/Relief/PRV/Backflow/Fire Protection", contacts:[{name:"Will Layden",role:"Quotes & Technical",phone:"610-363-6639",email:"sales@layden.com"}] },
  { id:"itt",        name:"ITT Engineered Valves",     website:"https://www.ittcontrolflo.com",             partnerStatus:"Reseller-Friendly", category:"Diaphragm/Sanitary/Knife Gate/Slurry Valves", contacts:[{name:"Kevin Ruth",role:"Tri-State Tech",phone:"610-647-5700",email:"kruth@tristatetech.com"},{name:"Larry Palmer",role:"Secondary",phone:"717-201-7958",email:"Larry.Palmer@ITT.com"}] },
  { id:"belimo",     name:"Belimo Americas",           website:"https://www.belimo.us",                    partnerStatus:"Transactional", category:"HVAC Control Valves/Actuators/PICV", contacts:[{name:"Veronica Muschett",role:"Quote POC",phone:"800-543-9038 x3122",email:"Veronica.Muschett@Us.Belimo.com"}] },
  { id:"fike",       name:"Fike Corporation",          website:"https://www.fike.com",                     partnerStatus:"Transactional", category:"Rupture Discs/Explosion Venting/Fire Suppression", contacts:[{name:"Jan Kutyla",role:"Proconex",phone:"610-495-1835",email:"Jan.Kutyla@Proconexdirect.com"}] },
  { id:"trimteck",   name:"Trimteck",                  website:"https://www.trimteck.com",                 partnerStatus:"Transactional", category:"Control Valves/Globe/V-notch Ball/Severe Service", contacts:[{name:"Mario Villanueva",role:"Quote POC",phone:"954-817-2889",email:"m.villanueva@trimteck.com"}] },
  { id:"watson",     name:"Watson McDaniel",           website:"https://www.watsonmcdaniel.com",           partnerStatus:"Transactional", category:"Steam Traps/PRV/Control Valves/Condensate", contacts:[{name:"Lori Graefe",role:"Quote POC",phone:"610-495-5131",email:"LGraefe@watsonmcdaniel.com"}] },
  { id:"asco",       name:"ASCO (via Ives)",           website:"https://www.emerson.com/en-us/automation/asco", partnerStatus:"Reseller", category:"Solenoid Valves/Air Operated Valves", contacts:[{name:"Dan Fitzgerald",role:"Ives Rep",phone:"215-880-1695",email:"dfitzgerald@ivesmail.com"}] },
  { id:"zook",       name:"Zook Rupture Discs",        website:"https://www.zookdisk.com",                 partnerStatus:"Reseller",      category:"Rupture Discs/Explosion Vent Panels", contacts:[{name:"Charlene Howard",role:"Quote POC",phone:"",email:"Choward@Zookdisk.com"}] },
];

// ─── SPEC CACHE ─────────────────────────────────────────────────────────────
function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); }
  catch { return {}; }
}
function saveCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {}
}
function isFresh(ts) {
  if (!ts) return false;
  return (Date.now() - new Date(ts).getTime()) < CACHE_TTL_DAYS * 86400000;
}

// ─── CLAUDE API ──────────────────────────────────────────────────────────────
async function claudeRaw(body) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.REACT_APP_ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Call Claude with web search enabled — fetches live data from manufacturer sites
async function fetchLiveSpecs(mfr) {
  const data = await claudeRaw({
    model: MODEL,
    max_tokens: 1000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    system: `You are a valve product data extractor. Search the manufacturer's website and return ONLY a valid JSON object with NO markdown fences, NO preamble. Extract real product data.`,
    messages: [{
      role: "user",
      content: `Search ${mfr.website} and extract current product specs for ${mfr.name}.

Return this exact JSON structure (no markdown, just raw JSON):
{
  "valveTypes": ["list every valve type they make"],
  "sizeRange": "e.g. 1/4 inch to 24 inch",
  "pressureClasses": ["ANSI 150", "ANSI 300", etc],
  "materials": ["Carbon Steel", "316 SS", "PVC", etc],
  "endConnections": ["Threaded", "Flanged", "Wafer", "Butt Weld", etc],
  "certifications": ["API 6D", "API 608", "UL", "FM", "ATEX", etc],
  "cvRange": "e.g. 0.01 to 2000 or N/A",
  "tempRange": "e.g. -50F to 450F",
  "keyProductLines": ["Series 70", "Series 77F", etc],
  "specialFeatures": ["Fire safe", "Cryogenic", "Fugitive emission", etc],
  "industries": ["Oil and Gas", "Chemical", "Pharma", "Water", etc],
  "summary": "2 sentence plain summary of what this company specializes in",
  "fetchedAt": "${new Date().toISOString()}"
}`
    }],
  });

  // Extract text from possibly multi-step tool-use response
  const textBlocks = (data.content || []).filter(b => b.type === "text");
  const raw = textBlocks.map(b => b.text).join("").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    // If JSON parse fails, return a basic stub so app doesn't break
    return {
      valveTypes: [mfr.category],
      sizeRange: "See website", pressureClasses: [], materials: [],
      endConnections: [], certifications: [], cvRange: "N/A",
      tempRange: "N/A", keyProductLines: [], specialFeatures: [],
      industries: [], summary: `${mfr.name} — ${mfr.category}`,
      fetchedAt: new Date().toISOString(), fetchError: true
    };
  }
}

// Match query against enriched manufacturer data using Claude
async function runMatchQuery(query, enrichedMfrs) {
  const mfrCtx = enrichedMfrs.map(m => {
    const w = PARTNER_WEIGHT[m.partnerStatus] || 30;
    const s = m.liveSpecs;
    const specsText = s ? [
      `Valve Types: ${(s.valveTypes||[]).join(", ")}`,
      `Sizes: ${s.sizeRange || "Unknown"}`,
      `Pressure Classes: ${(s.pressureClasses||[]).join(", ")}`,
      `Materials: ${(s.materials||[]).join(", ")}`,
      `End Connections: ${(s.endConnections||[]).join(", ")}`,
      `Certifications: ${(s.certifications||[]).join(", ")}`,
      `Cv Range: ${s.cvRange || "N/A"}`,
      `Temp Range: ${s.tempRange || "N/A"}`,
      `Product Lines: ${(s.keyProductLines||[]).join(", ")}`,
      `Special Features: ${(s.specialFeatures||[]).join(", ")}`,
      `Industries: ${(s.industries||[]).join(", ")}`,
      s.summary ? `Summary: ${s.summary}` : "",
    ].filter(Boolean).join(" | ") : `Category: ${m.category}`;

    return `MANUFACTURER: ${m.name}
TIER: ${m.partnerStatus} (Priority ${w}/100)
WEBSITE: ${m.website}
${specsText}
CONTACTS: ${m.contacts.map(c=>`${c.name} (${c.role}) ${c.phone} ${c.email}`).join(" | ")}`;
  }).join("\n\n---\n\n");

  const system = `You are ValveMatch, a valve sales intelligence tool. 

Given a customer request and a database of manufacturer specs scraped live from their websites, return the best vendor matches as a JSON array.

RANKING RULES (STRICT):
1. Strategic partners (100pts) ALWAYS rank above Preferred (80pts) when they carry the product.
2. Preferred above Reseller-Friendly (60pts) above Transactional (30pts).
3. Only recommend a lower-tier vendor when no higher-tier vendor carries the item, OR when the spec difference is so significant you must explain it in relationshipNote.
4. A match should be INCLUDED if the manufacturer plausibly makes that product based on their specs. Do NOT return empty results just because you're uncertain — make your best assessment.
5. For simple requests like "1 inch ball valve" or "check valve" — if a manufacturer makes ball valves or check valves in that category, include them.

Return ONLY a valid JSON array. No markdown. Each object:
{
  "rank": number,
  "manufacturer": string,
  "partnerStatus": string,
  "seriesOrProduct": string (specific series if known, else empty string),
  "fitScore": number 0-100,
  "matchReason": string (2-3 sentences),
  "keySpecs": [3-6 short spec strings directly matching the request],
  "caveat": string or null,
  "relationshipNote": string or null,
  "contact": {"name": string, "role": string, "phone": string, "email": string},
  "websiteUrl": string (manufacturer website for reference)
}

Return 3-6 results. Never return empty array unless the product is genuinely outside all manufacturers' scope.`;

  const data = await claudeRaw({
    model: MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: `CUSTOMER REQUEST: ${query}\n\nFind best vendor matches. Return JSON array only.` }],
  });

  const raw = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").replace(/```json|```/g, "").trim();
  return JSON.parse(raw);
}

// ─── EXAMPLES ────────────────────────────────────────────────────────────────
const EXAMPLES = [
  '1" ball valve, stainless steel',
  '12" check valve, carbon steel',
  "Control valve Cv 15, 316SS",
  "Fire-safe ball valve, 4\" flanged",
  "Sanitary butterfly valve, tri-clamp",
  "Steam trap, condensate return",
  "Solenoid valve, explosion-proof",
  "Knife gate valve, slurry service",
  "High pressure ball valve, 5000 PSI",
  "Y-strainer, 3 inch, 300#",
];

const CHAT_STARTERS = [
  "Compare options for a 2\" ball valve in stainless",
  "Who stocks fire-safe certified valves?",
  "Best sanitary valve vendor for pharma?",
  "Cryogenic service — who do we call?",
  "Walk me through steam trap options",
  "Severe corrosive service recommendations",
];

// ─── STYLES ──────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --ink:#080c14;--steel:#0f1520;--plate:#141d2e;--panel:#1a2540;
  --card:#1f2d4a;--border:#263350;--border2:#2f3e60;
  --muted:#4d5f80;--text:#9eb3cc;--bright:#dce8ff;
  --accent:#f5a623;--green:#3ecf8e;--blue:#4da6ff;--red:#ff5c73;--purple:#a78bfa;
}
body{background:var(--ink);color:var(--text);font-family:'IBM Plex Sans',sans-serif;min-height:100vh;}
.app{display:flex;flex-direction:column;height:100vh;overflow:hidden;}
/* HEADER */
.header{background:var(--steel);border-bottom:2px solid var(--border);padding:0 1.75rem;display:flex;align-items:center;justify-content:space-between;height:56px;flex-shrink:0;}
.logo{font-family:'Bebas Neue',sans-serif;font-size:1.6rem;letter-spacing:0.15em;color:var(--bright);}
.logo em{color:var(--accent);font-style:normal;}
.logo-sub{font-family:'IBM Plex Mono',monospace;font-size:0.56rem;color:var(--muted);letter-spacing:0.2em;text-transform:uppercase;margin-top:-2px;}
.hdr-right{font-family:'IBM Plex Mono',monospace;font-size:0.58rem;color:var(--muted);text-align:right;line-height:1.9;}
/* TABS */
.tabs{display:flex;background:var(--steel);border-bottom:1px solid var(--border);padding:0 1.75rem;flex-shrink:0;}
.tab{font-family:'IBM Plex Mono',monospace;font-size:0.63rem;letter-spacing:0.12em;text-transform:uppercase;padding:0 1.1rem;height:44px;border:none;background:none;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;transition:all 0.2s;display:flex;align-items:center;gap:0.3rem;white-space:nowrap;}
.tab.on{color:var(--accent);border-bottom-color:var(--accent);}
.tab.on.chat{color:var(--green);border-bottom-color:var(--green);}
.tab:hover:not(.on){color:var(--bright);}
/* HOMEPAGE */
.page{flex:1;overflow-y:auto;display:flex;flex-direction:column;}
/* HERO */
.hero{background:linear-gradient(180deg,var(--steel) 0%,var(--ink) 100%);border-bottom:1px solid var(--border);padding:2.75rem 2rem 2.25rem;display:flex;flex-direction:column;align-items:center;text-align:center;}
.hero-eye{font-family:'IBM Plex Mono',monospace;font-size:0.6rem;letter-spacing:0.25em;text-transform:uppercase;color:var(--accent);margin-bottom:0.65rem;}
.hero-h1{font-family:'Bebas Neue',sans-serif;font-size:3rem;letter-spacing:0.1em;color:var(--bright);line-height:1;margin-bottom:0.5rem;}
.hero-h1 em{color:var(--accent);font-style:normal;}
.hero-sub{font-size:0.91rem;color:var(--text);max-width:480px;line-height:1.75;margin-bottom:2rem;}
/* SEARCH BOX */
.search-wrap{width:100%;max-width:740px;position:relative;}
.sbox{width:100%;background:var(--panel);border:2px solid var(--border2);border-radius:10px;color:var(--bright);font-family:'IBM Plex Sans',sans-serif;font-size:1rem;padding:.95rem 148px .95rem 1.15rem;outline:none;transition:border-color .2s,box-shadow .2s;line-height:1.45;resize:none;}
.sbox::placeholder{color:var(--muted);font-style:italic;}
.sbox:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(245,166,35,.09);}
.sgo{position:absolute;right:.65rem;bottom:.65rem;font-family:'IBM Plex Mono',monospace;font-size:0.67rem;letter-spacing:0.08em;text-transform:uppercase;background:var(--accent);color:var(--ink);font-weight:700;border:none;border-radius:6px;padding:.5rem .95rem;cursor:pointer;transition:background .2s;display:flex;align-items:center;gap:.33rem;}
.sgo:hover{background:#ffc150;}
.sgo:disabled{opacity:.35;cursor:not-allowed;}
.shint{font-family:'IBM Plex Mono',monospace;font-size:0.57rem;color:var(--muted);margin-top:.45rem;width:100%;text-align:right;}
.exrow{margin-top:1.3rem;display:flex;flex-wrap:wrap;gap:.4rem;justify-content:center;max-width:740px;}
.exchip{font-family:'IBM Plex Mono',monospace;font-size:0.59rem;background:var(--plate);border:1px solid var(--border);border-radius:20px;padding:.32rem .8rem;cursor:pointer;color:var(--muted);transition:all .15s;white-space:nowrap;}
.exchip:hover{border-color:var(--accent);color:var(--accent);background:rgba(245,166,35,.04);}
/* SEARCHING STATE */
.searching{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3rem 2rem;gap:1rem;}
.spin-ring{position:relative;width:52px;height:52px;}
.so{width:52px;height:52px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .85s linear infinite;}
.si{position:absolute;inset:9px;border:2px solid transparent;border-bottom-color:var(--green);border-radius:50%;animation:spin .55s linear infinite reverse;}
@keyframes spin{to{transform:rotate(360deg)}}
.searching-steps{display:flex;flex-direction:column;gap:.35rem;align-items:center;}
.sstep{font-family:'IBM Plex Mono',monospace;font-size:0.62rem;display:flex;align-items:center;gap:.5rem;transition:color .3s;}
.sstep.done{color:var(--green);}
.sstep.active{color:var(--accent);}
.sstep.waiting{color:var(--muted);}
/* RESULTS */
.results-pane{padding:1.65rem 2rem;flex:1;}
.rhd{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.35rem;}
.rtitle{font-family:'Bebas Neue',sans-serif;font-size:1.2rem;letter-spacing:0.08em;color:var(--bright);}
.rq{font-family:'IBM Plex Mono',monospace;font-size:0.62rem;color:var(--muted);margin-top:.12rem;}
.clrbtn{font-family:'IBM Plex Mono',monospace;font-size:0.58rem;background:none;border:1px solid var(--border);color:var(--muted);border-radius:4px;padding:.28rem .65rem;cursor:pointer;transition:all .15s;}
.clrbtn:hover{border-color:var(--bright);color:var(--bright);}
.rgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:1.05rem;}
/* RESULT CARD */
.rc{background:var(--panel);border:1px solid var(--border);border-radius:10px;overflow:hidden;animation:fadeUp .28s ease both;}
.rc:nth-child(2){animation-delay:.06s}.rc:nth-child(3){animation-delay:.12s}.rc:nth-child(4){animation-delay:.18s}.rc:nth-child(5){animation-delay:.24s}.rc:nth-child(6){animation-delay:.3s}
@keyframes fadeUp{from{opacity:0;transform:translateY(11px)}to{opacity:1;transform:translateY(0)}}
.rc-hd{padding:.85rem 1rem .72rem;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:.6rem;}
.rank{font-family:'Bebas Neue',sans-serif;font-size:1.9rem;line-height:1;color:var(--border2);min-width:1.6rem;}
.rank.top{color:var(--accent);}
.nm{flex:1;}
.rc-name{font-weight:600;font-size:.97rem;color:var(--bright);}
.rc-series{font-family:'IBM Plex Mono',monospace;font-size:.62rem;color:var(--blue);margin-top:.1rem;}
.rc-url{font-family:'IBM Plex Mono',monospace;font-size:.55rem;color:var(--muted);margin-top:.15rem;}
.rc-url a{color:var(--muted);text-decoration:none;}
.rc-url a:hover{color:var(--blue);}
.badges{display:flex;flex-direction:column;align-items:flex-end;gap:.26rem;flex-shrink:0;}
.pb{font-family:'IBM Plex Mono',monospace;font-size:.56rem;padding:.15rem .5rem;border-radius:3px;font-weight:600;white-space:nowrap;}
.pb-s{background:rgba(62,207,142,.12);color:var(--green);border:1px solid rgba(62,207,142,.28);}
.pb-p{background:rgba(77,166,255,.12);color:var(--blue);border:1px solid rgba(77,166,255,.28);}
.pb-r{background:rgba(167,139,250,.12);color:var(--purple);border:1px solid rgba(167,139,250,.28);}
.pb-t{background:rgba(245,166,35,.12);color:var(--accent);border:1px solid rgba(245,166,35,.28);}
.pb-o{background:rgba(90,110,138,.12);color:var(--muted);border:1px solid rgba(90,110,138,.28);}
.fitrow{display:flex;align-items:center;gap:.36rem;}
.fbar{width:52px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;}
.ffill{height:100%;border-radius:2px;transition:width .5s ease;}
.fnum{font-family:'IBM Plex Mono',monospace;font-size:.7rem;font-weight:600;min-width:2.3rem;text-align:right;}
.rc-body{padding:.85rem 1rem;}
.reason{font-size:.85rem;color:var(--text);line-height:1.75;margin-bottom:.72rem;}
.tags{display:flex;flex-wrap:wrap;gap:.26rem;margin-bottom:.72rem;}
.tag{font-family:'IBM Plex Mono',monospace;font-size:.57rem;padding:.13rem .45rem;border-radius:3px;border:1px solid var(--border2);color:var(--muted);}
.nbox{border-radius:5px;padding:.55rem .72rem;margin-bottom:.72rem;font-size:.82rem;color:var(--text);line-height:1.65;}
.nbox.rel{background:rgba(245,166,35,.05);border:1px solid rgba(245,166,35,.17);}
.nbox.warn{background:rgba(255,92,115,.04);border:1px solid rgba(255,92,115,.17);}
.nl{font-family:'IBM Plex Mono',monospace;font-size:.55rem;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.15rem;}
.nl-rel{color:var(--accent);}
.nl-warn{color:var(--red);}
.cbox{background:var(--card);border-radius:6px;padding:.6rem .75rem;}
.cname{font-weight:600;color:var(--bright);font-size:.86rem;}
.crole{font-family:'IBM Plex Mono',monospace;font-size:.57rem;color:var(--muted);margin-top:.08rem;}
.cinfo{font-family:'IBM Plex Mono',monospace;font-size:.63rem;color:var(--blue);margin-top:.2rem;}
.cinfo a{color:inherit;text-decoration:none;}
/* CACHE STATUS */
.cache-bar{background:var(--plate);border-bottom:1px solid var(--border);padding:.45rem 2rem;display:flex;align-items:center;gap:1.5rem;font-family:'IBM Plex Mono',monospace;font-size:.6rem;color:var(--muted);flex-shrink:0;}
.cdot{width:5px;height:5px;border-radius:50%;display:inline-block;margin-right:.3rem;}
.cdot-fresh{background:var(--green);}
.cdot-stale{background:var(--accent);}
.cdot-empty{background:var(--muted);}
.refbtn{font-family:'IBM Plex Mono',monospace;font-size:.58rem;background:none;border:1px solid var(--border);color:var(--muted);border-radius:3px;padding:.2rem .55rem;cursor:pointer;transition:all .15s;margin-left:auto;}
.refbtn:hover{border-color:var(--accent);color:var(--accent);}
/* TWO-COL */
.twocol{flex:1;display:grid;grid-template-columns:290px 1fr;overflow:hidden;}
.sidebar{background:var(--plate);border-right:1px solid var(--border);padding:1.05rem;overflow-y:auto;}
.mpane{padding:1.5rem;overflow-y:auto;}
.card{background:var(--panel);border:1px solid var(--border);border-radius:7px;padding:1.05rem;margin-bottom:.85rem;}
.ct{font-family:'Bebas Neue',sans-serif;font-size:.9rem;letter-spacing:.1em;color:var(--accent);margin-bottom:.85rem;}
label{font-family:'IBM Plex Mono',monospace;font-size:.59rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:.27rem;}
input,textarea,select{width:100%;background:var(--steel);border:1px solid var(--border);border-radius:4px;color:var(--bright);font-family:'IBM Plex Sans',sans-serif;font-size:.86rem;padding:.47rem .67rem;outline:none;transition:border-color .2s;}
input:focus,textarea:focus,select:focus{border-color:var(--accent);}
select option{background:var(--steel);}
textarea{resize:vertical;min-height:66px;}
.fr{margin-bottom:.85rem;}
.btn{font-family:'IBM Plex Mono',monospace;font-size:.64rem;letter-spacing:.08em;text-transform:uppercase;padding:.47rem .97rem;border:none;border-radius:4px;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:.37rem;white-space:nowrap;}
.btn-a{background:var(--accent);color:var(--ink);font-weight:700;}
.btn-a:hover{background:#ffc150;}
.btn-a:disabled{opacity:.35;cursor:not-allowed;}
.btn-g{background:var(--green);color:var(--ink);font-weight:700;}
.btn-g:hover{background:#5fffc0;}
.btn-g:disabled{opacity:.35;cursor:not-allowed;}
.btn-gh{background:transparent;color:var(--muted);border:1px solid var(--border);}
.btn-gh:hover{color:var(--bright);border-color:var(--bright);}
.btn-d{background:transparent;color:var(--red);border:1px solid var(--red);}
.btn-d:hover{background:var(--red);color:white;}
.btn-sm{padding:.25rem .6rem;font-size:.57rem;}
.spin{width:13px;height:13px;border:2px solid var(--border2);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;display:inline-block;flex-shrink:0;}
.spin-g{border-top-color:var(--green);}
.mitem{background:var(--steel);border:1px solid var(--border);border-radius:5px;padding:.6rem .75rem;margin-bottom:.45rem;display:flex;align-items:flex-start;justify-content:space-between;gap:.45rem;}
.mn{font-weight:600;color:var(--bright);font-size:.85rem;}
.mm{font-family:'IBM Plex Mono',monospace;font-size:.57rem;color:var(--muted);margin-top:.1rem;}
.dz{border:2px dashed var(--border);border-radius:6px;padding:1.35rem 1rem;text-align:center;cursor:pointer;transition:all .2s;}
.dz:hover,.dz.drag{border-color:var(--accent);background:rgba(245,166,35,.04);}
.dzi{font-size:1.5rem;margin-bottom:.27rem;}
.dzt{font-family:'IBM Plex Mono',monospace;font-size:.62rem;color:var(--muted);}
.pmsg{font-family:'IBM Plex Mono',monospace;font-size:.68rem;color:var(--accent);padding:.72rem;background:var(--plate);border:1px solid var(--border);border-radius:5px;margin-bottom:.85rem;display:flex;align-items:center;gap:.52rem;}
.cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.85rem;}
.ccard{background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:.85rem;}
.ccn{font-weight:600;color:var(--bright);font-size:.92rem;}
.ccm{font-family:'IBM Plex Mono',monospace;font-size:.59rem;color:var(--accent);margin-bottom:.37rem;}
.ccr{font-family:'IBM Plex Mono',monospace;font-size:.62rem;color:var(--muted);margin-top:.15rem;}
.ccr a{color:var(--blue);text-decoration:none;}
/* CHAT */
.chatwrap{flex:1;display:grid;grid-template-columns:240px 1fr;overflow:hidden;}
.chatsb{background:var(--plate);border-right:1px solid var(--border);padding:1.05rem;overflow-y:auto;display:flex;flex-direction:column;gap:.3rem;}
.sbttl{font-family:'Bebas Neue',sans-serif;font-size:.8rem;letter-spacing:.1em;color:var(--muted);margin-bottom:.08rem;}
.cpill{font-family:'IBM Plex Mono',monospace;font-size:.58rem;background:var(--steel);border:1px solid var(--border);border-radius:20px;padding:.3rem .7rem;cursor:pointer;color:var(--muted);transition:all .15s;text-align:left;width:100%;line-height:1.55;}
.cpill:hover{border-color:var(--green);color:var(--green);background:rgba(62,207,142,.05);}
.sbhr{border:none;border-top:1px solid var(--border);margin:.27rem 0;}
.chatbody{display:flex;flex-direction:column;overflow:hidden;}
.chatmsgs{flex:1;overflow-y:auto;padding:1.2rem;display:flex;flex-direction:column;gap:.8rem;}
.chatempty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.8rem;padding:2rem;text-align:center;}
.ceico{font-size:2.8rem;opacity:.12;}
.cettl{font-family:'Bebas Neue',sans-serif;font-size:1.85rem;letter-spacing:.1em;color:var(--bright);}
.cesub{font-family:'IBM Plex Mono',monospace;font-size:.62rem;color:var(--muted);line-height:1.9;max-width:355px;}
.spills{display:flex;flex-wrap:wrap;gap:.37rem;justify-content:center;margin-top:.42rem;}
.spill{font-family:'IBM Plex Mono',monospace;font-size:.57rem;background:var(--panel);border:1px solid var(--border);border-radius:20px;padding:.33rem .78rem;cursor:pointer;color:var(--muted);transition:all .15s;}
.spill:hover{border-color:var(--green);color:var(--green);}
.cmsg{display:flex;gap:.58rem;animation:fadeUp .2s ease;max-width:86%;}
.cmsg.user{align-self:flex-end;flex-direction:row-reverse;}
.cmsg.asst{align-self:flex-start;}
.cav{width:27px;height:27px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:.57rem;flex-shrink:0;font-family:'IBM Plex Mono',monospace;font-weight:700;}
.av-u{background:var(--accent);color:var(--ink);}
.av-b{background:var(--green);color:var(--ink);}
.cbub{padding:.72rem .92rem;border-radius:7px;font-size:.86rem;line-height:1.75;}
.cbub.user{background:var(--accent);color:var(--ink);font-weight:500;border-bottom-right-radius:2px;}
.cbub.asst{background:var(--panel);border:1px solid var(--border);color:var(--text);border-bottom-left-radius:2px;white-space:pre-wrap;}
.cbub.asst strong,.cbub.asst b{color:var(--bright);}
.chatbar{border-top:1px solid var(--border);padding:.82rem 1.15rem;display:flex;gap:.58rem;background:var(--plate);flex-shrink:0;align-items:flex-end;}
.chatta{flex:1;background:var(--steel);border:1px solid var(--border);border-radius:6px;color:var(--bright);font-family:'IBM Plex Sans',sans-serif;font-size:.87rem;padding:.56rem .82rem;outline:none;resize:none;transition:border-color .2s;max-height:100px;line-height:1.5;}
.chatta:focus{border-color:var(--green);}
.tbubs{background:var(--panel);border:1px solid var(--border);border-radius:7px;border-bottom-left-radius:2px;padding:.72rem .92rem;display:flex;gap:5px;align-items:center;}
.tdot{width:5px;height:5px;border-radius:50%;background:var(--green);animation:bounce 1s infinite;}
.tdot:nth-child(2){animation-delay:.15s}.tdot:nth-child(3){animation-delay:.3s}
@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}
.chint{font-family:'IBM Plex Mono',monospace;font-size:.54rem;color:var(--muted);flex-shrink:0;padding-bottom:.07rem;line-height:1.75;}
/* GUIDE */
.guide{flex:1;overflow-y:auto;padding:1.5rem;}
.gstep{margin-bottom:.87rem;padding-left:.87rem;border-left:3px solid var(--green);}
.gsl{font-family:'IBM Plex Mono',monospace;font-size:.61rem;color:var(--green);margin-bottom:.17rem;}
/* STATUS */
.sbar{background:var(--ink);border-top:1px solid var(--border);padding:.3rem 1.75rem;font-family:'IBM Plex Mono',monospace;font-size:.57rem;color:var(--muted);display:flex;gap:1.4rem;flex-shrink:0;}
.sdot{width:5px;height:5px;border-radius:50%;background:var(--green);display:inline-block;margin-right:.27rem;}
::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px;}
`;

function pbcls(s) {
  if (!s) return "pb-o";
  const l = s.toLowerCase();
  if (l.includes("strategic")) return "pb-s";
  if (l.includes("preferred")) return "pb-p";
  if (l.includes("reseller")) return "pb-r";
  if (l.includes("transactional")) return "pb-t";
  return "pb-o";
}
function fitColor(n) { return n>=80?"var(--green)":n>=55?"var(--accent)":"var(--red)"; }
function renderMd(t) { return (t||"").replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\*(.*?)\*/g,"<em>$1</em>"); }

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function ValveMatcher() {
  const [tab, setTab] = useState("home");
  const [specCache, setSpecCache] = useState(() => loadCache());
  const [extraMfrs, setExtraMfrs] = useState([]);
  const [contacts, setContacts] = useState(() =>
    MFR_REGISTRY.flatMap(m => m.contacts.map(c => ({ id: uid(), mfr: m.name, ...c })))
  );

  // Search state
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchStep, setSearchStep] = useState(0); // 0=idle,1=enriching,2=matching
  const [results, setResults] = useState(null);
  const [lastQ, setLastQ] = useState("");
  const [enrichingNames, setEnrichingNames] = useState([]);
  const sboxRef = useRef(null);

  // Chat state
  const [chatHist, setChatHist] = useState([]);
  const [chatIn, setChatIn] = useState("");
  const [chatTyping, setChatTyping] = useState(false);
  const chatBot = useRef(null);

  // Load tab state
  const [mfrName, setMfrName] = useState("");
  const [urlIn, setUrlIn] = useState("");
  const [dragging, setDragging] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [ingestMsg, setIngestMsg] = useState("");
  const fileRef = useRef();

  // Contacts form
  const [cForm, setCForm] = useState({ mfr:"", name:"", role:"", phone:"", email:"" });

  useEffect(() => { chatBot.current?.scrollIntoView({ behavior:"smooth" }); }, [chatHist, chatTyping]);

  // ── Cache helpers ──
  function getCached(mfrId) { return specCache[mfrId]; }
  function setCached(mfrId, data) {
    const next = { ...specCache, [mfrId]: { ...data, cachedAt: new Date().toISOString() } };
    setSpecCache(next); saveCache(next);
    return next;
  }
  function clearCache() { setSpecCache({}); saveCache({}); }

  // ── Enrich one manufacturer — get live specs from website ──
  async function enrichMfr(mfr) {
    const cached = getCached(mfr.id);
    if (cached && isFresh(cached.cachedAt)) return cached;
    try {
      const live = await fetchLiveSpecs(mfr);
      setCached(mfr.id, live);
      return live;
    } catch { return null; }
  }

  // ── MAIN SEARCH ──
  async function runSearch(q) {
    const qr = (q || query).trim();
    if (!qr) return;
    setLastQ(qr); setSearching(true); setResults(null); setSearchStep(1);
    if (tab !== "home") setTab("home");

    // Figure out which manufacturers to enrich based on query keywords
    // First pass: identify likely relevant categories from the query
    const allMfrs = [...MFR_REGISTRY, ...extraMfrs];

    // Quick relevance filter — enrich top candidates first
    const queryLower = qr.toLowerCase();
    const keywords = queryLower.split(/\s+/);

    // Score each manufacturer for relevance to this specific query
    const scored = allMfrs.map(m => {
      let score = 0;
      const cat = (m.category || "").toLowerCase();
      const name = m.name.toLowerCase();
      keywords.forEach(kw => {
        if (cat.includes(kw)) score += 10;
        if (name.includes(kw)) score += 5;
      });
      // Bonus for Strategic/Preferred
      score += (PARTNER_WEIGHT[m.partnerStatus] || 30) * 0.1;
      return { ...m, relevanceScore: score };
    });

    // Always enrich top 8 by relevance + partner weight, minimum all Strategic + Preferred
    const sorted = scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const topRelevant = sorted.slice(0, 8);
    const strategic = allMfrs.filter(m => m.partnerStatus === "Strategic" || m.partnerStatus === "Preferred");
    const toEnrich = [...new Map([...topRelevant, ...strategic].map(m => [m.id, m])).values()];

    setEnrichingNames(toEnrich.map(m => m.name));

    // Enrich (fetch live specs, use cache if fresh)
    const enriched = await Promise.allSettled(
      toEnrich.map(async m => {
        const live = await enrichMfr(m);
        return { ...m, liveSpecs: live };
      })
    );

    const enrichedMfrs = enriched
      .filter(r => r.status === "fulfilled")
      .map(r => r.value);

    setSearchStep(2);

    // Now run the matching query
    try {
      const res = await runMatchQuery(qr, enrichedMfrs);
      setResults(Array.isArray(res) ? res : []);
    } catch {
      // Fallback: simple match from cached/known data
      setResults([]);
    }

    setSearching(false); setSearchStep(0); setEnrichingNames([]);
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runSearch(); }
  }

  function clearSearch() {
    setResults(null); setLastQ(""); setQuery("");
    setTimeout(() => sboxRef.current?.focus(), 50);
  }

  // ── CHAT ──
  function buildChatSys() {
    const ml = MFR_REGISTRY.map(m => {
      const s = getCached(m.id);
      const sp = s ? `Types:${(s.valveTypes||[]).join(",")} Sizes:${s.sizeRange||"?"} Mats:${(s.materials||[]).join(",")}` : m.category;
      return `${m.name}|${m.partnerStatus}|${sp}|${m.contacts.map(c=>`${c.name} ${c.phone}`).join(";")}`;
    }).join("\n");
    return `You are ValveBot, a valve sales assistant. Prioritize Strategic and Preferred partners. Use **bold** for manufacturer names.\n\nVENDORS:\n${ml}`;
  }

  async function sendChat(ov) {
    const msg = (ov || chatIn).trim(); if (!msg) return;
    setChatIn("");
    const nh = [...chatHist, { role:"user", content:msg }];
    setChatHist(nh); setChatTyping(true);
    try {
      const data = await claudeRaw({ model:MODEL, max_tokens:1200, system:buildChatSys(), messages:nh });
      const reply = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
      setChatHist(h=>[...h,{role:"assistant",content:reply}]);
    } catch { setChatHist(h=>[...h,{role:"assistant",content:"Connection error — please try again."}]); }
    setChatTyping(false);
  }

  // ── SPEC LOAD (PDF/URL) ──
  async function ingestPDF(file, name) {
    setIngesting(true); setIngestMsg(`Reading ${file.name}…`);
    try {
      const b64 = await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(file);});
      const data = await claudeRaw({model:MODEL,max_tokens:900,system:"Extract valve product specs as plain text summary (max 350 words): valve types, series, sizes, pressure classes, materials, certifications, Cv data.",messages:[{role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}},{type:"text",text:"Summarize valve product specs."}]}]});
      const specs = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("")||"No specs extracted.";
      const nm = name.trim()||file.name.replace(".pdf","");
      setExtraMfrs(p=>[...p,{id:uid(),name:nm,website:"",partnerStatus:"",category:specs,contacts:[]}]);
      setIngestMsg(`✓ Added ${nm}`); setMfrName(""); setTimeout(()=>setIngestMsg(""),3000);
    } catch { setIngestMsg("Error reading PDF."); }
    setIngesting(false);
  }

  async function ingestURL() {
    if (!urlIn.trim()) return;
    setIngesting(true); setIngestMsg("Fetching specs from URL…");
    try {
      const data = await claudeRaw({model:MODEL,max_tokens:900,system:"Summarize valve product specs (max 350 words): valve types, series, sizes, pressure classes, materials, certs, Cv data. Plain text.",messages:[{role:"user",content:`Summarize valve specs from: ${urlIn}`}]});
      const specs = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("")||"";
      const nm = mfrName.trim()||(()=>{try{return new URL(urlIn).hostname.replace("www.","");}catch{return "Unknown";}})();
      setExtraMfrs(p=>[...p,{id:uid(),name:nm,website:urlIn,partnerStatus:"",category:specs,contacts:[]}]);
      setIngestMsg(`✓ Added ${nm}`); setUrlIn(""); setMfrName(""); setTimeout(()=>setIngestMsg(""),3000);
    } catch { setIngestMsg("Error."); }
    setIngesting(false);
  }

  const onDrop = useCallback(e=>{
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer?.files[0]||e.target.files?.[0];
    if (file?.type==="application/pdf") ingestPDF(file,mfrName);
  },[mfrName]);

  function addContact() {
    if (!cForm.mfr||!cForm.name) return;
    setContacts(p=>[...p,{id:uid(),...cForm}]);
    setCForm({mfr:"",name:"",role:"",phone:"",email:""});
  }

  // ── Cache stats ──
  const allMfrCount = MFR_REGISTRY.length + extraMfrs.length;
  const freshCount = Object.values(specCache).filter(s=>isFresh(s.cachedAt)).length;
  const staleCount = Object.values(specCache).filter(s=>!isFresh(s.cachedAt)).length;
  const emptyCount = allMfrCount - Object.keys(specCache).length;

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>
      <div className="app">

        {/* HEADER */}
        <header className="header">
          <div>
            <div className="logo">Valve<em>Match</em></div>
            <div className="logo-sub">Live Intelligence · Sales Tool</div>
          </div>
          <div className="hdr-right">
            <div><span className="sdot"/>Claude Sonnet 4 · Live web search enabled</div>
            <div>{allMfrCount} vendors · {freshCount} specs cached · {contacts.length} contacts</div>
          </div>
        </header>

        {/* TABS */}
        <nav className="tabs">
          <button className={`tab${tab==="home"?" on":""}`} onClick={()=>setTab("home")}>⌂ Find a Vendor</button>
          <button className={`tab chat${tab==="chat"?" on":""}`} onClick={()=>setTab("chat")}>💬 AI Chat</button>
          <button className={`tab${tab==="load"?" on":""}`} onClick={()=>setTab("load")}>＋ Load Specs</button>
          <button className={`tab${tab==="contacts"?" on":""}`} onClick={()=>setTab("contacts")}>✆ Contacts</button>
          <button className={`tab${tab==="guide"?" on":""}`} onClick={()=>setTab("guide")}>☰ Guide</button>
        </nav>

        {/* CACHE STATUS BAR */}
        <div className="cache-bar">
          <span><span className="cdot cdot-fresh"/>{freshCount} fresh specs (≤7 days)</span>
          {staleCount > 0 && <span><span className="cdot cdot-stale"/>{staleCount} stale</span>}
          <span><span className="cdot cdot-empty"/>{emptyCount} not yet fetched — will auto-fetch on next search</span>
          <button className="refbtn" onClick={clearCache}>↺ Clear Cache</button>
        </div>

        {/* ── HOME ── */}
        {tab==="home" && (
          <div className="page">
            <div className="hero">
              <div className="hero-eye">▸ Live Manufacturer Intelligence</div>
              <div className="hero-h1">Find the Right <em>Vendor</em></div>
              <div className="hero-sub">Enter any valve product request. We search manufacturer websites in real time, then rank results by product fit and your relationship strength.</div>
              <div className="search-wrap">
                <textarea ref={sboxRef} className="sbox" rows={2}
                  placeholder={`Enter what you're looking for… e.g. "1" ball valve, stainless" or "control valve Cv 15, 316SS, made in USA"`}
                  value={query} onChange={e=>setQuery(e.target.value)}
                  onKeyDown={handleKey} disabled={searching}/>
                <button className="sgo" disabled={searching||!query.trim()} onClick={()=>runSearch()}>
                  {searching?<><span className="spin"/>Searching…</>:<>▶ Find Vendors</>}
                </button>
              </div>
              <div className="shint">Enter ↵ to search · Shift+Enter for new line · pulls live data from manufacturer websites</div>
              {!results && !searching && (
                <div className="exrow">
                  {EXAMPLES.map(q=><button key={q} className="exchip" onClick={()=>{setQuery(q);runSearch(q);}}>{q}</button>)}
                </div>
              )}
            </div>

            {/* SEARCHING STATE */}
            {searching && (
              <div className="searching">
                <div className="spin-ring"><div className="so"/><div className="si"/></div>
                <div className="searching-steps">
                  <div className={`sstep ${searchStep>=1?"active":"waiting"}`}>
                    {searchStep>=2?"✓":"◌"} Step 1 — Fetching live specs from {enrichingNames.length} manufacturer websites…
                  </div>
                  <div className={`sstep ${searchStep>=2?"active":"waiting"}`}>
                    {searchStep>2?"✓":"◌"} Step 2 — Matching specs to your request, ranking by relationship…
                  </div>
                </div>
                {enrichingNames.length > 0 && (
                  <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:".59rem",color:"var(--muted)",textAlign:"center",lineHeight:1.9}}>
                    {enrichingNames.slice(0,6).join(" · ")}{enrichingNames.length>6?` + ${enrichingNames.length-6} more`:""}
                  </div>
                )}
              </div>
            )}

            {/* RESULTS */}
            {!searching && results !== null && (
              <div className="results-pane">
                <div className="rhd">
                  <div>
                    <div className="rtitle">{results.length>0?`${results.length} Vendor Match${results.length>1?"es":""}` : "No Matches Found"}</div>
                    <div className="rq">for "{lastQ}"</div>
                  </div>
                  <button className="clrbtn" onClick={clearSearch}>✕ New Search</button>
                </div>
                {results.length===0 && (
                  <div style={{textAlign:"center",padding:"2.5rem",fontFamily:"'IBM Plex Mono',monospace",fontSize:".68rem",color:"var(--muted)",lineHeight:2}}>
                    No strong matches found.<br/>Try a different search, or ask ValveBot in 💬 AI Chat.
                  </div>
                )}
                <div className="rgrid">
                  {results.map((r,i)=>(
                    <div className="rc" key={i}>
                      <div className="rc-hd">
                        <div className={`rank${i===0?" top":""}`}>#{r.rank}</div>
                        <div className="nm">
                          <div className="rc-name">{r.manufacturer}</div>
                          {r.seriesOrProduct && <div className="rc-series">{r.seriesOrProduct}</div>}
                          {r.websiteUrl && <div className="rc-url"><a href={r.websiteUrl} target="_blank" rel="noopener noreferrer">↗ {r.websiteUrl.replace(/^https?:\/\/(www\.)?/,"").split("/")[0]}</a></div>}
                        </div>
                        <div className="badges">
                          {r.partnerStatus && <span className={`pb ${pbcls(r.partnerStatus)}`}>{r.partnerStatus}</span>}
                          <div className="fitrow">
                            <div className="fbar"><div className="ffill" style={{width:`${r.fitScore}%`,background:fitColor(r.fitScore)}}/></div>
                            <div className="fnum" style={{color:fitColor(r.fitScore)}}>{r.fitScore}%</div>
                          </div>
                        </div>
                      </div>
                      <div className="rc-body">
                        <div className="reason">{r.matchReason}</div>
                        {r.keySpecs?.length>0 && <div className="tags">{r.keySpecs.map((s,j)=><span key={j} className="tag">{s}</span>)}</div>}
                        {r.relationshipNote && <div className="nbox rel"><div className="nl nl-rel">⭐ Relationship</div>{r.relationshipNote}</div>}
                        {r.caveat && <div className="nbox warn"><div className="nl nl-warn">⚠ Note</div>{r.caveat}</div>}
                        {r.contact?.name && (
                          <div className="cbox">
                            <div className="cname">{r.contact.name}</div>
                            <div className="crole">{r.contact.role}</div>
                            {r.contact.phone && <div className="cinfo">📞 <a href={`tel:${r.contact.phone}`}>{r.contact.phone}</a></div>}
                            {r.contact.email && <div className="cinfo">✉ <a href={`mailto:${r.contact.email}`}>{r.contact.email}</a></div>}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!searching && results===null && (
              <div style={{padding:"2.5rem",textAlign:"center"}}>
                <div style={{fontSize:"2.5rem",opacity:.07,marginBottom:".5rem"}}>⚙</div>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:".62rem",color:"var(--muted)",lineHeight:2}}>
                  Type your request above and press Enter — or tap any example chip.<br/>
                  First search fetches live specs from manufacturer websites.<br/>
                  Subsequent searches use the 7-day cache for instant results.
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CHAT ── */}
        {tab==="chat" && (
          <div className="chatwrap">
            <div className="chatsb">
              <div className="sbttl">Starter Questions</div>
              {CHAT_STARTERS.map(s=><button key={s} className="cpill" onClick={()=>sendChat(s)}>{s}</button>)}
              <hr className="sbhr"/>
              <div className="sbttl">Vendors ({allMfrCount})</div>
              {MFR_REGISTRY.map(m=>(
                <span key={m.id} style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:".55rem",background:"rgba(77,166,255,.06)",border:"1px solid rgba(77,166,255,.13)",color:"var(--blue)",borderRadius:"3px",padding:".14rem .46rem",marginBottom:".17rem",display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>⚙ {m.name}</span>
              ))}
              <hr className="sbhr"/>
              {chatHist.length>0&&<button className="btn btn-gh btn-sm" style={{width:"100%"}} onClick={()=>setChatHist([])}>🗑 Clear</button>}
            </div>
            <div className="chatbody">
              <div className="chatmsgs">
                {chatHist.length===0&&!chatTyping&&(
                  <div className="chatempty">
                    <div className="ceico">💬</div>
                    <div className="cettl">ValveBot</div>
                    <div className="cesub">Ask me anything about valves, manufacturers, specs, or strategy. I know all {allMfrCount} vendors and always prioritize your strongest relationships.</div>
                    <div className="spills">{CHAT_STARTERS.slice(0,4).map(s=><button key={s} className="spill" onClick={()=>sendChat(s)}>{s}</button>)}</div>
                  </div>
                )}
                {chatHist.map((m,i)=>(
                  <div key={i} className={`cmsg ${m.role==="user"?"user":"asst"}`}>
                    <div className={`cav ${m.role==="user"?"av-u":"av-b"}`}>{m.role==="user"?"YOU":"VM"}</div>
                    <div className={`cbub ${m.role==="user"?"user":"asst"}`} dangerouslySetInnerHTML={{__html:renderMd(m.content)}}/>
                  </div>
                ))}
                {chatTyping&&<div style={{display:"flex",gap:".58rem",alignSelf:"flex-start"}}><div className="cav av-b">VM</div><div className="tbubs"><div className="tdot"/><div className="tdot"/><div className="tdot"/></div></div>}
                <div ref={chatBot}/>
              </div>
              <div className="chatbar">
                <textarea className="chatta" rows={2} placeholder="Ask ValveBot… (Enter to send)" value={chatIn} onChange={e=>setChatIn(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat();}}} disabled={chatTyping}/>
                <button className="btn btn-g" disabled={chatTyping||!chatIn.trim()} onClick={()=>sendChat()}>{chatTyping?<span className="spin spin-g"/>:"Send ▶"}</button>
                <div className="chint">Enter<br/>= send</div>
              </div>
            </div>
          </div>
        )}

        {/* ── LOAD ── */}
        {tab==="load" && (
          <div className="twocol">
            <aside className="sidebar">
              <div className="card">
                <div className="ct">📄 Upload PDF Catalog</div>
                <div className="fr"><label>Manufacturer Name (optional)</label><input value={mfrName} onChange={e=>setMfrName(e.target.value)} placeholder="e.g. Velan"/></div>
                <div className={`dz${dragging?" drag":""}`} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={onDrop} onClick={()=>fileRef.current.click()}>
                  <div className="dzi">📂</div><div className="dzt">Drop PDF or click to browse</div>
                </div>
                <input ref={fileRef} type="file" accept=".pdf" style={{display:"none"}} onChange={onDrop}/>
              </div>
              <div className="card">
                <div className="ct">🔗 Load from URL</div>
                <div className="fr"><label>Manufacturer Name</label><input value={mfrName} onChange={e=>setMfrName(e.target.value)} placeholder="e.g. Emerson"/></div>
                <div className="fr"><label>Product Page URL</label><input value={urlIn} onChange={e=>setUrlIn(e.target.value)} placeholder="https://www.manufacturer.com/valves"/></div>
                <button className="btn btn-a" style={{width:"100%"}} disabled={ingesting||!urlIn.trim()} onClick={ingestURL}>{ingesting?<><span className="spin"/>Loading…</>:"⬇ Fetch & Extract"}</button>
              </div>
              {ingestMsg&&<div className="pmsg">{ingestMsg.startsWith("✓")?"✓":<span className="spin"/>} {ingestMsg}</div>}
            </aside>
            <main className="mpane">
              <div style={{marginBottom:".85rem"}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.05rem",letterSpacing:".1em",color:"var(--bright)"}}>Loaded Manufacturers</div>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:".62rem",color:"var(--muted)",marginTop:".18rem"}}>{allMfrCount} total · {freshCount} with cached live specs · searching fetches fresh data automatically</div>
              </div>
              {[...MFR_REGISTRY,...extraMfrs].map(m=>{
                const s = getCached(m.id);
                return (
                  <div className="card" key={m.id}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <div style={{fontWeight:600,fontSize:".92rem",color:"var(--bright)"}}>{m.name}</div>
                        {m.partnerStatus&&<div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:".57rem",color:"var(--accent)",marginTop:".07rem"}}>{m.partnerStatus}</div>}
                        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:".57rem",color:"var(--muted)",marginBottom:".42rem"}}>
                          {s ? `✓ Specs cached ${new Date(s.cachedAt).toLocaleDateString()} · ${(s.valveTypes||[]).length} valve types` : "◌ Not yet fetched — will auto-fetch on search"}
                        </div>
                      </div>
                      {extraMfrs.find(x=>x.id===m.id)&&<button className="btn btn-d btn-sm" onClick={()=>setExtraMfrs(p=>p.filter(x=>x.id!==m.id))}>Remove</button>}
                    </div>
                    {s&&<div style={{fontSize:".79rem",color:"var(--text)",lineHeight:"1.65",maxHeight:"60px",overflow:"hidden",maskImage:"linear-gradient(to bottom,black 20%,transparent)"}}>{(s.valveTypes||[]).join(", ")}</div>}
                  </div>
                );
              })}
            </main>
          </div>
        )}

        {/* ── CONTACTS ── */}
        {tab==="contacts" && (
          <div className="twocol">
            <aside className="sidebar">
              <div className="card">
                <div className="ct">✚ Add Contact</div>
                <div className="fr"><label>Manufacturer</label>
                  <select value={cForm.mfr} onChange={e=>setCForm(p=>({...p,mfr:e.target.value}))}>
                    <option value="">Select…</option>
                    {MFR_REGISTRY.map(m=><option key={m.id} value={m.name}>{m.name}</option>)}
                  </select>
                </div>
                {["name","role","phone","email"].map(f=>(
                  <div className="fr" key={f}><label>{f}</label><input value={cForm[f]} onChange={e=>setCForm(p=>({...p,[f]:e.target.value}))}/></div>
                ))}
                <button className="btn btn-a" style={{width:"100%"}} onClick={addContact} disabled={!cForm.mfr||!cForm.name}>Add Contact</button>
              </div>
            </aside>
            <main className="mpane">
              <div style={{marginBottom:".85rem"}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.05rem",letterSpacing:".08em",color:"var(--bright)"}}>Contact Directory — {contacts.length} contacts</div></div>
              <div className="cgrid">
                {contacts.map(c=>(
                  <div className="ccard" key={c.id}>
                    <div className="ccn">{c.name}</div>
                    <div className="ccm">{c.mfr}</div>
                    <div className="ccr">{c.role}</div>
                    <div className="ccr"><a href={`tel:${c.phone}`}>📞 {c.phone}</a></div>
                    <div className="ccr"><a href={`mailto:${c.email}`}>✉ {c.email}</a></div>
                    <div style={{marginTop:".52rem"}}><button className="btn btn-d btn-sm" onClick={()=>setContacts(p=>p.filter(x=>x.id!==c.id))}>Remove</button></div>
                  </div>
                ))}
              </div>
            </main>
          </div>
        )}

        {/* ── GUIDE ── */}
        {tab==="guide" && (
          <div className="guide">
            <div style={{maxWidth:"680px",margin:"0 auto"}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.4rem",letterSpacing:".1em",color:"var(--bright)",marginBottom:".18rem"}}>Hosting Guide</div>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:".62rem",color:"var(--accent)",marginBottom:"1.55rem"}}>Deploy so your whole team gets this tool</div>
              <div className="card" style={{background:"rgba(62,207,142,.05)",border:"2px solid var(--green)",marginBottom:"1.05rem"}}>
                <div className="ct" style={{color:"var(--green)"}}>⭐ Recommended: Netlify (free)</div>
                <div style={{fontSize:".85rem",color:"var(--text)",lineHeight:"2"}}>
                  {[["Step 1","Install Node.js. Run: npx create-react-app valvematch. Replace src/App.js with this file."],["Step 2","Create .env: REACT_APP_ANTHROPIC_KEY=sk-ant-your-key-here"],["Step 3","Run npm run build. Drag /build to netlify.com/drop."],["Step 4","Netlify → Identity → Invite Only → invite your team."]].map(([l,b])=>(
                    <div key={l} className="gstep"><div className="gsl">{l}</div><div>{b}</div></div>
                  ))}
                </div>
              </div>
              <div className="card" style={{background:"rgba(245,166,35,.05)",border:"1px solid rgba(245,166,35,.22)"}}>
                <div className="ct">⚡ Note on Live Web Search</div>
                <p style={{fontSize:".85rem",color:"var(--text)",lineHeight:"1.75"}}>The live web search feature calls the Anthropic API with web_search enabled. First searches take ~10-15 seconds per manufacturer as it fetches live data. Results cache for 7 days so repeat searches are instant. Set a monthly spend cap in your Anthropic dashboard.</p>
              </div>
            </div>
          </div>
        )}

        <footer className="sbar">
          <span><span className="sdot"/>Live web search active</span>
          <span>{allMfrCount} Vendors</span>
          <span>{freshCount} specs cached</span>
          <span>ValveMatch v5.0</span>
        </footer>
      </div>
    </>
  );
}
