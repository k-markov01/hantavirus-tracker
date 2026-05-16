const fetch = require('node-fetch');
const cheerio = require('cheerio');
const worldCountries = require('world-countries');

const WHO_EMERGENCIES_URL = 'https://www.who.int/emergencies/emergency-events/1';
const WHO_DON_BASE = 'https://www.who.int/emergencies/disease-outbreak-news/item/';
const WHO_FACT_SHEET = 'https://www.who.int/news-room/fact-sheets/detail/hantavirus';
const KNOWN_DON_FALLBACK_URL = `${WHO_DON_BASE}2026-DON600`;

const COUNTRY_NAME_OVERRIDES = {
  CPV: 'Cabo Verde',
  GBR: 'United Kingdom',
  SHN: 'Saint Helena, Ascension and Tristan da Cunha',
};

const iso3Index = new Map(worldCountries.map((country) => [country.cca3, country]));
const countryIndex = buildCountryIndex();
const countryAliasesByIso3 = buildCountryAliasesByIso3();

const MARKER_COORDS = {
  ZAF: { label: 'Johannesburg, South Africa', lat: -26.2041, lon: 28.0473 },
  NLD: { label: 'Netherlands', lat: 52.3676, lon: 4.9041 },
  CHE: { label: 'Zurich, Switzerland', lat: 47.3769, lon: 8.5417 },
  SHN: { label: 'Tristan da Cunha', lat: -37.1052, lon: -12.2777 },
  ARG: { label: 'Argentina', lat: -34.6037, lon: -58.3816 },
  CHL: { label: 'Chile', lat: -33.4489, lon: -70.6693 },
  URY: { label: 'Uruguay', lat: -34.9011, lon: -56.1645 },
  CPV: { label: 'Cabo Verde', lat: 14.9331, lon: -23.5133 },
  ESP: { label: 'Spain', lat: 28.2916, lon: -16.6291 },
  DEU: { label: 'Germany', lat: 52.52, lon: 13.405 },
  GBR: { label: 'United Kingdom', lat: 51.5072, lon: -0.1276 },
  SHIP_SOUTH_ATLANTIC: { label: 'Cruise ship, South Atlantic (approx.)', lat: -22.5, lon: -18.5 },
  SHIP_CENTRAL_ATLANTIC: { label: 'Cruise ship, Central Atlantic (approx.)', lat: 1.5, lon: -21.5 },
};

function buildCountryIndex() {
  const index = {};

  for (const country of worldCountries) {
    const names = [
      country.name.common,
      country.name.official,
      ...Object.values(country.name.native || {}).map((value) => value.common),
      ...Object.values(country.name.native || {}).map((value) => value.official),
      ...(country.altSpellings || []),
    ];

    for (const name of names) {
      if (!name) continue;
      index[name.toLowerCase().trim()] = {
        name: country.name.common,
        iso3: country.cca3,
        cca2: country.cca2,
      };
    }
  }

  const aliases = {
    usa: 'USA',
    'united states': 'USA',
    us: 'USA',
    uk: 'GBR',
    britain: 'GBR',
    'united kingdom': 'GBR',
    'south korea': 'KOR',
    'north korea': 'PRK',
    'czech republic': 'CZE',
    czechia: 'CZE',
    congo: 'COD',
    drc: 'COD',
    'democratic republic of the congo': 'COD',
    'republic of the congo': 'COG',
    eswatini: 'SWZ',
    swaziland: 'SWZ',
    'cabo verde': 'CPV',
    'cape verde': 'CPV',
    turkey: 'TUR',
    'ivory coast': 'CIV',
    'timor-leste': 'TLS',
    'east timor': 'TLS',
    micronesia: 'FSM',
    'north macedonia': 'MKD',
    macedonia: 'MKD',
    'saint helena': 'SHN',
    'st helena': 'SHN',
    'tristan da cunha': 'SHN',
  };

  for (const [alias, iso3] of Object.entries(aliases)) {
    const country = iso3Index.get(iso3);
    if (!country) continue;
    index[alias] = {
      name: COUNTRY_NAME_OVERRIDES[iso3] || country.name.common,
      iso3: country.cca3,
      cca2: country.cca2,
    };
  }

  return index;
}

function normalizeText(text) {
  return (text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function trimSnippet(text, maxLength = 220) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function parseNumericToken(value) {
  if (value == null) return null;
  if (/^\d+$/.test(value)) return Number(value);

  const words = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };

  return words[String(value).toLowerCase()] ?? null;
}

function parseCount(pattern, text) {
  const match = text.match(pattern);
  return match ? parseNumericToken(match[1]) : null;
}

function extractCountriesFromText(text) {
  const lower = (text || '').toLowerCase();
  const matches = new Map();
  const keys = Object.keys(countryIndex).sort((a, b) => b.length - a.length);

  for (const key of keys) {
    let startIndex = 0;

    while (startIndex < lower.length) {
      const index = lower.indexOf(key, startIndex);
      if (index === -1) break;

      const before = index === 0 ? ' ' : lower[index - 1];
      const after = index + key.length >= lower.length ? ' ' : lower[index + key.length];
      const boundary = /[\s,.()\-;:"'/]/;
      const isBoundary = (value) => boundary.test(value) || value === '';

      if (isBoundary(before) && isBoundary(after)) {
        const country = countryIndex[key];
        matches.set(country.iso3, country);
      }

      startIndex = index + key.length;
    }
  }

  return [...matches.values()];
}

function buildCountryAliasesByIso3() {
  const aliasesByIso3 = new Map();

  for (const [alias, country] of Object.entries(countryIndex)) {
    if (!aliasesByIso3.has(country.iso3)) {
      aliasesByIso3.set(country.iso3, []);
    }

    aliasesByIso3.get(country.iso3).push(alias);
  }

  for (const [iso3, aliases] of aliasesByIso3.entries()) {
    aliasesByIso3.set(
      iso3,
      [...new Set(aliases)].sort((left, right) => right.length - left.length),
    );
  }

  return aliasesByIso3;
}

function splitSentences(text) {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeText(sentence))
    .filter(Boolean);
}

function sentenceMentionsIso3(sentence, iso3) {
  const aliases = countryAliasesByIso3.get(iso3) || [];
  const lowerSentence = sentence.toLowerCase();

  return aliases.some((alias) => {
    let searchIndex = 0;

    while (searchIndex < lowerSentence.length) {
      const index = lowerSentence.indexOf(alias, searchIndex);
      if (index === -1) return false;

      const before = index === 0 ? ' ' : lowerSentence[index - 1];
      const after = index + alias.length >= lowerSentence.length ? ' ' : lowerSentence[index + alias.length];
      const boundary = /[\s,.()\-;:"'/]/;
      const isBoundary = (value) => boundary.test(value) || value === '';
      if (isBoundary(before) && isBoundary(after)) return true;

      searchIndex = index + alias.length;
    }

    return false;
  });
}

function getCountryDisplayName(iso3) {
  const country = iso3Index.get(iso3);
  if (!country) return iso3;
  return COUNTRY_NAME_OVERRIDES[iso3] || country.name.common;
}

function makeCountryEntry(iso3, role, caseCount = null, evidence = []) {
  const country = iso3Index.get(iso3);
  if (!country) return null;

  return {
    name: getCountryDisplayName(iso3),
    iso3,
    cca2: country.cca2,
    role,
    caseCount,
    evidence,
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HantavirusTracker/1.0)' },
    timeout: 20000,
  });

  if (!response.ok) {
    throw new Error(`WHO request returned ${response.status} for ${url}`);
  }

  return response.text();
}

function normalizeWhoUrl(href) {
  if (!href) return null;
  if (href.startsWith('http')) return href;
  if (href.startsWith('/')) return `https://www.who.int${href}`;
  return `https://www.who.int/${href.replace(/^\/+/, '')}`;
}

function extractHantavirusLinks($) {
  const directDonLinks = new Set();
  const eventLinks = new Set();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href') || '';
    const absoluteUrl = normalizeWhoUrl(href);
    const lowerText = normalizeText($(element).text()).toLowerCase();
    const lowerUrl = (absoluteUrl || '').toLowerCase();
    const haystack = `${lowerText} ${lowerUrl}`;

    if (!haystack.includes('hanta')) return;

    if (lowerUrl.includes('/disease-outbreak-news/item/')) {
      directDonLinks.add(absoluteUrl);
      return;
    }

    if (lowerUrl.includes('/emergency-events/item/')) {
      eventLinks.add(absoluteUrl);
    }
  });

  return {
    directDonLinks: [...directDonLinks],
    eventLinks: [...eventLinks],
  };
}

function sortDonUrls(urls) {
  return [...new Set(urls)].sort((left, right) => {
    const leftMatch = left.match(/DON(\d+)/i);
    const rightMatch = right.match(/DON(\d+)/i);
    const leftNumber = leftMatch ? Number(leftMatch[1]) : 0;
    const rightNumber = rightMatch ? Number(rightMatch[1]) : 0;
    return rightNumber - leftNumber;
  });
}

async function discoverLatestArticle() {
  console.log('[discover] fetching WHO emergencies page...');
  const html = await fetchHtml(WHO_EMERGENCIES_URL);
  const $ = cheerio.load(html);
  const { directDonLinks, eventLinks } = extractHantavirusLinks($);

  if (directDonLinks.length > 0) {
    const latest = sortDonUrls(directDonLinks)[0];
    console.log('[discover] found direct DON link:', latest);
    return latest;
  }

  for (const eventUrl of eventLinks) {
    console.log('[discover] inspecting event page:', eventUrl);
    const eventHtml = await fetchHtml(eventUrl);
    const $event = cheerio.load(eventHtml);
    const donLinks = new Set();

    $event('a[href*="/disease-outbreak-news/item/"]').each((_, element) => {
      donLinks.add(normalizeWhoUrl($event(element).attr('href')));
    });

    if (donLinks.size > 0) {
      const latest = sortDonUrls([...donLinks])[0];
      console.log('[discover] found DON link via event page:', latest);
      return latest;
    }
  }

  console.log('[discover] no DON link found, using fallback URL');
  return KNOWN_DON_FALLBACK_URL;
}

function extractPublishDate($) {
  return (
    $('meta[name="dcterms.date"]').attr('content') ||
    $('meta[property="article:published_time"]').attr('content') ||
    normalizeText($('.timestamp').first().text()) ||
    normalizeText($('[class*="date"]').first().text()) ||
    $('time').first().attr('datetime') ||
    normalizeText($('time').first().text()) ||
    null
  );
}

function extractArticleBodyText($) {
  const selectors = [
    'article.sf-detail-body-wrapper.don-revamp',
    'article.sf-detail-body-wrapper',
    '.sf-detail-body-wrapper',
    'article',
  ];

  for (const selector of selectors) {
    let bestText = '';

    $(selector).each((_, element) => {
      const text = normalizeText($(element).text());
      if (text.length > bestText.length) {
        bestText = text;
      }
    });

    if (bestText.length >= 1000 && bestText.includes('Description of the situation')) {
      return bestText;
    }
  }

  return '';
}

function extractSection(bodyText, startHeading, endHeadings) {
  const startIndex = bodyText.indexOf(startHeading);
  if (startIndex === -1) return '';

  const remainder = bodyText.slice(startIndex + startHeading.length).trim();
  let endIndex = remainder.length;

  for (const heading of endHeadings) {
    const nextIndex = remainder.indexOf(heading);
    if (nextIndex !== -1 && nextIndex < endIndex) {
      endIndex = nextIndex;
    }
  }

  return remainder.slice(0, endIndex).trim();
}

function parseSummary(bodyText) {
  const summary = {
    totalCases: parseCount(/a total of ([a-z]+|\d+) cases/i, bodyText),
    confirmedCases: null,
    inconclusiveCases: null,
    probableCases: null,
    deaths: parseCount(/including ([a-z]+|\d+) deaths/i, bodyText),
    confirmedDeaths: null,
    probableDeaths: null,
  };

  const caseBreakdownMatch = bodyText.match(/\(([a-z]+|\d+) confirmed and ([a-z]+|\d+) probable cases\)/i);
  if (caseBreakdownMatch) {
    summary.confirmedCases = parseNumericToken(caseBreakdownMatch[1]);
    summary.probableCases = parseNumericToken(caseBreakdownMatch[2]);
  }

  const expandedCaseBreakdownMatch = bodyText.match(
    /\(([a-z]+|\d+) confirmed,\s*([a-z]+|\d+) inconclusive and\s*([a-z]+|\d+) probable cases\)/i,
  );
  if (expandedCaseBreakdownMatch) {
    summary.confirmedCases = parseNumericToken(expandedCaseBreakdownMatch[1]);
    summary.inconclusiveCases = parseNumericToken(expandedCaseBreakdownMatch[2]);
    summary.probableCases = parseNumericToken(expandedCaseBreakdownMatch[3]);
  }

  const narrativeCaseBreakdownMatch = bodyText.match(
    /([a-z]+|\d+) cases (?:were )?laboratory-confirmed.*?,\s*([a-z]+|\d+) (?:are|were) probable,\s*and\s*([a-z]+|\d+) case(?:s)? (?:remains?|remain) inconclusive/i,
  );
  if (narrativeCaseBreakdownMatch) {
    summary.confirmedCases = parseNumericToken(narrativeCaseBreakdownMatch[1]);
    summary.probableCases = parseNumericToken(narrativeCaseBreakdownMatch[2]);
    summary.inconclusiveCases = parseNumericToken(narrativeCaseBreakdownMatch[3]);
  }

  const deathBreakdownMatch = bodyText.match(/including [a-z0-9]+ deaths \(([a-z]+|\d+) confirmed and ([a-z]+|\d+) probable\)/i);
  if (deathBreakdownMatch) {
    summary.confirmedDeaths = parseNumericToken(deathBreakdownMatch[1]);
    summary.probableDeaths = parseNumericToken(deathBreakdownMatch[2]);
  }

  if (summary.confirmedDeaths != null && summary.probableDeaths != null) {
    summary.deaths = summary.confirmedDeaths + summary.probableDeaths;
  }

  return summary;
}

function detectCaseMarkerCountry(caseText) {
  if (/died onboard/i.test(caseText)) return null;
  if (/post-mortem sample.*netherlands/i.test(caseText)) return null;
  if (/arrival in switzerland|hospitalised and in isolation in switzerland|reported to local public health authorities/i.test(caseText)) {
    return 'CHE';
  }
  if (/johannesburg, south africa|south africa/i.test(caseText)) {
    return 'ZAF';
  }
  if (/medically evacuated to the netherlands|currently stable in isolation/i.test(caseText) && /netherlands/i.test(caseText)) {
    return 'NLD';
  }
  if (/tristan da cunha/i.test(caseText)) {
    return 'SHN';
  }
  if (/saint helena/i.test(caseText) && !/south africa|switzerland/i.test(caseText)) {
    return 'SHN';
  }
  return null;
}

function detectDeathMarkerKey(caseNumber, caseText) {
  if (/johannesburg clinic|johannesburg, south africa/i.test(caseText)) {
    return 'ZAF';
  }
  if (caseNumber === 1 || /died onboard on 11 april/i.test(caseText)) {
    return 'SHIP_SOUTH_ATLANTIC';
  }
  if (caseNumber === 4 || /post-mortem sample/i.test(caseText)) {
    return 'SHIP_CENTRAL_ATLANTIC';
  }
  return null;
}

function parseCaseRecords(descriptionText) {
  const caseMatches =
    descriptionText.match(
      /Case\s+\d+:\s.*?(?=Case\s+\d+:|One case previously reported as suspected|Table 1\.|Operational outbreak case definitions|Based on currently available information|$)/gis,
    ) || [];

  return caseMatches.map((rawCaseText) => {
    const caseText = normalizeText(rawCaseText);
    const numberMatch = caseText.match(/^Case\s+(\d+):/i);
    const countries = extractCountriesFromText(caseText);

    return {
      caseNumber: numberMatch ? Number(numberMatch[1]) : null,
      text: caseText,
      countries,
      markerIso3: detectCaseMarkerCountry(caseText),
      status: /probable case|considered a probable case/i.test(caseText) ? 'probable' : 'confirmed',
      outcome: /died\b/i.test(caseText) ? 'death' : 'active',
      deathMarkerKey: /died\b/i.test(caseText)
        ? detectDeathMarkerKey(numberMatch ? Number(numberMatch[1]) : null, caseText)
        : null,
    };
  });
}

function buildSummaryCaseMentions(descriptionText) {
  const mentions = new Map();
  const sentences = splitSentences(descriptionText);

  const addMention = (iso3, evidence, count = 1) => {
    if (!iso3) return;
    const entry = mentions.get(iso3) || { count: 0, evidence: [] };
    entry.count += count;

    const snippet = trimSnippet(evidence, 240);
    if (snippet && !entry.evidence.includes(snippet) && entry.evidence.length < 3) {
      entry.evidence.push(snippet);
    }

    mentions.set(iso3, entry);
  };

  const addMentionsFromPattern = (sentence, pattern) => {
    const matches = sentence.matchAll(pattern);
    for (const match of matches) {
      const fragment = normalizeText(match[1]);
      const country = extractCountriesFromText(fragment)[0];
      if (country) {
        addMention(country.iso3, sentence);
      }
    }
  };

  for (const sentence of sentences) {
    addMentionsFromPattern(sentence, /\bconfirmed case(?:s)? from ([^,.;]+?)(?=,| who\b| tested\b| and\b|$)/gi);
    addMentionsFromPattern(sentence, /\bprobable case(?:s)? from ([^,.;]+?)(?=,| who\b| tested\b| and\b|$)/gi);
    addMentionsFromPattern(sentence, /\binconclusive result for a case in (?:the )?([^,.;]+?)(?=,|\.| is\b| and\b|$)/gi);

    if (/inconclusive laboratory results|case remains inconclusive|case considered inconclusive/i.test(sentence)) {
      addMentionsFromPattern(sentence, /\brepatriated to (?:the )?([^,.;]+?)(?=,|\.| is\b| and\b|$)/gi);
    }
  }

  return mentions;
}

function buildCountryEvidence(descriptionText, caseRecords) {
  const evidenceByIso3 = new Map();
  const allSentences = splitSentences(descriptionText);

  const addEvidence = (iso3, snippet) => {
    if (!iso3 || !snippet) return;
    if (!evidenceByIso3.has(iso3)) {
      evidenceByIso3.set(iso3, []);
    }

    const snippets = evidenceByIso3.get(iso3);
    const normalizedSnippet = trimSnippet(snippet, 240);
    if (!normalizedSnippet || snippets.includes(normalizedSnippet)) return;
    if (snippets.length >= 3) return;
    snippets.push(normalizedSnippet);
  };

  for (const record of caseRecords) {
    for (const country of record.countries) {
      addEvidence(country.iso3, record.text);
    }

    if (record.markerIso3) {
      addEvidence(record.markerIso3, record.text);
    }
  }

  for (const sentence of allSentences) {
    const countries = extractCountriesFromText(sentence);
    for (const country of countries) {
      addEvidence(country.iso3, sentence);
    }
  }

  return evidenceByIso3;
}

function buildMarkerRollups(caseRecords) {
  const caseMarkerRollups = new Map();
  const deathMarkerRollups = new Map();

  const addRollup = (rollups, key, evidence) => {
    if (!key) return;
    const entry = rollups.get(key) || { count: 0, evidence: trimSnippet(evidence, 240) };
    entry.count += 1;
    if (!entry.evidence) {
      entry.evidence = trimSnippet(evidence, 240);
    }
    rollups.set(key, entry);
  };

  for (const record of caseRecords) {
    if (record.outcome !== 'death') {
      addRollup(caseMarkerRollups, record.markerIso3, record.text);
    }
    addRollup(deathMarkerRollups, record.deathMarkerKey, record.text);
  }

  return {
    caseMarkerRollups,
    deathMarkerRollups,
  };
}

function buildCountryData(descriptionText, caseRecords) {
  const { caseMarkerRollups, deathMarkerRollups } = buildMarkerRollups(caseRecords);
  const countryEvidence = buildCountryEvidence(descriptionText, caseRecords);
  const summaryCaseMentions = buildSummaryCaseMentions(descriptionText);

  for (const [iso3, info] of summaryCaseMentions.entries()) {
    const existingEvidence = countryEvidence.get(iso3) || [];
    const mergedEvidence = [...existingEvidence];
    for (const snippet of info.evidence) {
      if (!mergedEvidence.includes(snippet) && mergedEvidence.length < 3) {
        mergedEvidence.push(snippet);
      }
    }
    countryEvidence.set(iso3, mergedEvidence);
  }

  const countries = [];
  const seen = new Set();
  const addCountry = (iso3, role, caseCount = null) => {
    if (!iso3 || seen.has(iso3)) return;
    const country = makeCountryEntry(iso3, role, caseCount, countryEvidence.get(iso3) || []);
    if (!country) return;
    countries.push(country);
    seen.add(iso3);
  };

  for (const [iso3, markerInfo] of caseMarkerRollups.entries()) {
    addCountry(iso3, 'cases', markerInfo.count);
  }

  for (const [iso3, summaryInfo] of summaryCaseMentions.entries()) {
    addCountry(iso3, 'cases', summaryInfo.count);
  }

  for (const iso3 of ['ARG', 'CHL', 'URY']) {
    if (descriptionText.includes(getCountryDisplayName(iso3)) || (iso3 === 'URY' && /uruguay/i.test(descriptionText))) {
      addCountry(iso3, 'exposure');
    }
  }

  if (/cabo verde/i.test(descriptionText)) addCountry('CPV', 'monitoring');
  if (/spain/i.test(descriptionText)) addCountry('ESP', 'monitoring');
  if (/germany/i.test(descriptionText)) addCountry('DEU', 'monitoring');
  if (/united kingdom/i.test(descriptionText)) addCountry('GBR', 'monitoring');

  const roleOrder = { cases: 0, exposure: 1, monitoring: 2, mentioned: 3 };
  countries.sort((left, right) => {
    const roleDelta = roleOrder[left.role] - roleOrder[right.role];
    return roleDelta !== 0 ? roleDelta : left.name.localeCompare(right.name);
  });

  return {
    countries,
    caseMarkerRollups,
    deathMarkerRollups,
  };
}

function getMarkerCoords(key) {
  if (MARKER_COORDS[key]) {
    return MARKER_COORDS[key];
  }

  const country = iso3Index.get(key);
  if (!country) return null;

  const latlng = country.capitalInfo?.latlng || country.latlng;
  if (!Array.isArray(latlng) || latlng.length < 2) return null;

  return {
    label: getCountryDisplayName(key),
    lat: latlng[0],
    lon: latlng[1],
  };
}

function buildMarkers(caseMarkerRollups, deathMarkerRollups = new Map()) {
  const markers = [];

  for (const [key, markerInfo] of caseMarkerRollups.entries()) {
    const coords = getMarkerCoords(key);
    if (!coords) continue;

    markers.push({
      label: coords.label,
      iso3: key,
      lat: coords.lat,
      lon: coords.lon,
      type: 'case',
      count: markerInfo.count,
      evidence: markerInfo.evidence,
    });
  }

  for (const [key, markerInfo] of deathMarkerRollups.entries()) {
    const coords = getMarkerCoords(key);
    if (!coords) continue;

    markers.push({
      label: coords.label,
      iso3: key,
      lat: coords.lat,
      lon: coords.lon,
      type: 'death',
      count: markerInfo.count,
      evidence: markerInfo.evidence,
    });
  }

  return markers;
}

function addFallbackCaseMarkers(countries, markers) {
  const existingCaseMarkers = new Set(markers.filter((marker) => marker.type === 'case').map((marker) => marker.iso3));

  for (const country of countries) {
    if (country.role !== 'cases' || existingCaseMarkers.has(country.iso3)) continue;

    const coords = getMarkerCoords(country.iso3);
    if (!coords) continue;

    markers.push({
      label: coords.label,
      iso3: country.iso3,
      lat: coords.lat,
      lon: coords.lon,
      type: 'case',
      count: country.caseCount || 1,
      evidence: country.evidence?.[0] || '',
    });
  }

  return markers;
}

function getPreviousDonUrl(url) {
  const match = String(url || '').match(/DON(\d+)/i);
  if (!match) return null;

  const donNumber = Number(match[1]);
  if (!Number.isFinite(donNumber) || donNumber <= 1) return null;

  return `${WHO_DON_BASE}2026-DON${donNumber - 1}`;
}

function mergeEvidence(primary = [], secondary = []) {
  return [...new Set([...(primary || []), ...(secondary || [])])].slice(0, 3);
}

function mergeCountries(primaryCountries = [], secondaryCountries = []) {
  const merged = new Map();
  const rolePriority = { cases: 0, exposure: 1, monitoring: 2, mentioned: 3 };

  for (const country of secondaryCountries) {
    merged.set(country.iso3, { ...country, evidence: [...(country.evidence || [])] });
  }

  for (const country of primaryCountries) {
    const existing = merged.get(country.iso3);
    if (!existing) {
      merged.set(country.iso3, { ...country, evidence: [...(country.evidence || [])] });
      continue;
    }

    const nextRole =
      (rolePriority[country.role] ?? Number.MAX_SAFE_INTEGER) <= (rolePriority[existing.role] ?? Number.MAX_SAFE_INTEGER)
        ? country.role
        : existing.role;

    merged.set(country.iso3, {
      ...existing,
      ...country,
      role: nextRole,
      caseCount: country.caseCount != null ? country.caseCount : existing.caseCount,
      evidence: mergeEvidence(country.evidence, existing.evidence),
    });
  }

  return [...merged.values()].sort((left, right) => {
    const roleDelta = (rolePriority[left.role] ?? 99) - (rolePriority[right.role] ?? 99);
    return roleDelta !== 0 ? roleDelta : left.name.localeCompare(right.name);
  });
}

function mergeMarkers(primaryMarkers = [], secondaryMarkers = []) {
  const merged = new Map();

  for (const marker of [...secondaryMarkers, ...primaryMarkers]) {
    const key = `${marker.type}:${marker.iso3}:${marker.lat}:${marker.lon}`;
    if (!merged.has(key)) {
      merged.set(key, marker);
    }
  }

  return [...merged.values()];
}

function mergeOutbreakData(primary, secondary) {
  const countries = mergeCountries(primary.countries, secondary.countries);
  const markers = addFallbackCaseMarkers(countries, mergeMarkers(primary.markers, secondary.markers));

  return {
    ...primary,
    countries,
    markers,
  };
}

function buildFallbackOutbreakData() {
  const summary = {
    totalCases: 8,
    confirmedCases: 6,
    probableCases: 2,
    deaths: 3,
    confirmedDeaths: 2,
    probableDeaths: 1,
  };

  const countries = [
    makeCountryEntry('NLD', 'cases', 2, [
      'Two medical evacuation flights, from Cabo Verde, carrying two symptomatic confirmed patients and one previously suspected case landed in the Netherlands on 6 and 7 May.',
      'As of 8 May, four patients are currently hospitalised, one in intensive care in Johannesburg, South Africa, two in different hospitals in the Netherlands and the other in Zurich, Switzerland.',
    ]),
    makeCountryEntry('SHN', 'cases', 1, [
      'Case 8: An adult male, who disembarked in Tristan da Cunha on 14 April. Onset of symptoms was reported on 28 April with diarrhoea and two days later with fever. He is currently stable and in isolation. He is currently a probable case until laboratory confirmation.',
      'Contact tracing of passengers who disembarked in St Helena is ongoing; passengers have been contacted and advised to self-monitor for symptoms.',
    ]),
    makeCountryEntry('ZAF', 'cases', 2, [
      'Case 2: An adult female, who was a close contact of case 1, who travelled and boarded the ship with him, went ashore at Saint Helena on 24 April with gastrointestinal symptoms. She subsequently deteriorated on a flight to Johannesburg, South Africa, on 25 April. She died on 26 April in a Johannesburg clinic.',
      'Case 3: An adult male who developed symptoms on 24 April. He was disembarked and medically evacuated from Ascension Island on 27 April and is currently hospitalised in an Intensive Care Unit (ICU) in Johannesburg, South Africa.',
    ]),
    makeCountryEntry('CHE', 'cases', 1, [
      'Case 7: An adult male, who disembarked in St Helena on 22 April and flew back to Switzerland on 27-28 April, through South Africa and Qatar. He started experiencing symptoms on 1 May after arrival in Switzerland, where he immediately self-isolated and reported to local public health authorities.',
      'As of 8 May, four patients are currently hospitalised, one in intensive care in Johannesburg, South Africa, two in different hospitals in the Netherlands and the other in Zurich, Switzerland.',
    ]),
    makeCountryEntry('ARG', 'exposure', null, [
      'Case 1: An adult male who boarded the ship on 1 April, after more than three months of travel in Argentina, Chile, and Uruguay.',
      'Based on currently available information, the working hypothesis is that case 1 most probably acquired the infection prior to boarding through environmental exposure during activities he conducted in Argentina.',
    ]),
    makeCountryEntry('CHL', 'exposure', null, [
      'Case 1: An adult male who boarded the ship on 1 April, after more than three months of travel in Argentina, Chile, and Uruguay.',
      'Further investigations into the potential exposure of the first case and the source of the outbreak are ongoing in collaboration with authorities in Argentina and Chile.',
    ]),
    makeCountryEntry('URY', 'exposure', null, [
      'Case 1: An adult male who boarded the ship on 1 April, after more than three months of travel in Argentina, Chile, and Uruguay.',
    ]),
    makeCountryEntry('CPV', 'monitoring', null, [
      'Two medical evacuation flights, from Cabo Verde, carrying two symptomatic confirmed patients and one previously suspected case landed in the Netherlands on 6 and 7 May.',
      'On 6 May, the ship left Cabo Verde, heading to the Canary Islands, Spain where disembarkation is planned.',
    ]),
    makeCountryEntry('DEU', 'monitoring', null, [
      'The previously suspected case was transferred directly to Germany, where she was tested, and both PCR and serology tests were negative for Andes virus, she is therefore no longer considered to be a case.',
    ]),
    makeCountryEntry('ESP', 'monitoring', null, [
      'On 6 May, the ship left Cabo Verde, heading to the Canary Islands, Spain where disembarkation is planned.',
    ]),
    makeCountryEntry('GBR', 'monitoring', null, [
      'On 2 May 2026, WHO received notification from the National IHR Focal Point of the United Kingdom of Great Britain and Northern Ireland regarding a cluster of severe acute respiratory illness aboard a Dutch-flagged cruise ship.',
    ]),
  ].filter(Boolean);

  const markers = buildMarkers(
    new Map([
      ['NLD', { count: 2, evidence: 'Two medical evacuation flights landed in the Netherlands on 6 and 7 May, and two patients are currently in hospitals there.' }],
      ['SHN', { count: 1, evidence: 'Case 8 disembarked in Tristan da Cunha on 14 April and remains a probable case in isolation.' }],
      ['ZAF', { count: 2, evidence: 'One death occurred in a Johannesburg clinic and one additional case is in intensive care in Johannesburg, South Africa.' }],
      ['CHE', { count: 1, evidence: 'Case 7 returned to Switzerland and is currently hospitalised and in isolation there.' }],
    ]),
    new Map([
      ['ZAF', { count: 1, evidence: 'Case 2 died on 26 April in a Johannesburg clinic.' }],
      ['SHIP_SOUTH_ATLANTIC', { count: 1, evidence: 'Case 1 died onboard on 11 April while the ship was in the South Atlantic route.' }],
      ['SHIP_CENTRAL_ATLANTIC', { count: 1, evidence: 'Case 4 died onboard on 2 May before post-mortem sampling was sent to the Netherlands.' }],
    ]),
  );

  return {
    title: 'Hantavirus cluster linked to cruise ship travel, Multi-country',
    articleUrl: KNOWN_DON_FALLBACK_URL,
    publishDate: '2026-05-08',
    factSheetUrl: WHO_FACT_SHEET,
    summary,
    countries,
    markers,
    isFallback: true,
  };
}

async function parseArticle(url) {
  console.log('[parse] fetching article:', url);
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const title =
    normalizeText($('h1').first().text()) ||
    $('meta[property="og:title"]').attr('content') ||
    'Hantavirus Outbreak';

  const publishDate = extractPublishDate($);
  const bodyText = extractArticleBodyText($);

  if (!bodyText || bodyText.length < 1000) {
    throw new Error('Could not extract article body text');
  }

  const descriptionText = extractSection(bodyText, 'Description of the situation', [
    'Public health response',
    'WHO risk assessment',
    'WHO advice',
  ]);

  if (!descriptionText) {
    throw new Error('Could not isolate WHO situation section');
  }

  const summary = parseSummary(descriptionText);
  const caseRecords = parseCaseRecords(descriptionText);
  if (summary.totalCases == null) summary.totalCases = caseRecords.length;
  if (summary.confirmedCases == null) summary.confirmedCases = caseRecords.filter((record) => record.status === 'confirmed').length;
  if (summary.probableCases == null) summary.probableCases = caseRecords.filter((record) => record.status === 'probable').length;
  if (summary.deaths == null) summary.deaths = caseRecords.filter((record) => record.outcome === 'death').length;
  if (summary.confirmedDeaths == null) {
    summary.confirmedDeaths = caseRecords.filter(
      (record) => record.outcome === 'death' && record.status === 'confirmed',
    ).length;
  }
  if (summary.probableDeaths == null) {
    summary.probableDeaths = caseRecords.filter(
      (record) => record.outcome === 'death' && record.status === 'probable',
    ).length;
  }
  const { countries, caseMarkerRollups, deathMarkerRollups } = buildCountryData(descriptionText, caseRecords);
  const markers = addFallbackCaseMarkers(countries, buildMarkers(caseMarkerRollups, deathMarkerRollups));

  console.log(
    `[parse] cases=${summary.totalCases || 'n/a'} countries=${countries.length} mappedMarkers=${markers.length}`,
  );

  return {
    title,
    articleUrl: url,
    publishDate,
    factSheetUrl: WHO_FACT_SHEET,
    summary,
    countries,
    markers,
  };
}

async function fetchOutbreakData() {
  const articleUrl = await discoverLatestArticle();
  const latest = await parseArticle(articleUrl);
  const needsHistoricalContext =
    latest.markers.length === 0 ||
    (Number(latest.summary?.deaths || 0) > 0 && !latest.markers.some((marker) => marker.type === 'death'));

  if (!needsHistoricalContext) {
    return latest;
  }

  const previousUrl = getPreviousDonUrl(articleUrl);
  if (!previousUrl) {
    return latest;
  }

  try {
    const previousDetailed = await parseArticle(previousUrl);
    return mergeOutbreakData(latest, previousDetailed);
  } catch (error) {
    console.warn('[parse] failed to enrich with previous DON:', error.message);
    return latest;
  }
}

module.exports = {
  buildFallbackOutbreakData,
  fetchOutbreakData,
};
