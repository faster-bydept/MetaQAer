window.setFileLabel = function (input, label) {
  if (!input || !label) return;
  const file = input.files && input.files[0];
  label.textContent = file ? file.name : "No file selected";
  label.classList.toggle("has-file", Boolean(file));
  label.title = file ? file.name : "";
};

(function () {
  "use strict";

  const OFF_VALUES = new Set([
    "", "no", "inactive", "disabled", "empty", "off", "blank", "blanck", "none", "null", "nan", "(blank)"
  ]);
  const EMPTY_LABEL = "(blank)";

  // Meta Header Aliases
  const HEADER_ALIASES = {
    campaign: ["campaign name", "campaign"],
    adSet: ["ad set name", "adset name", "ad set", "ad group name", "ad group"],
    ad: ["ad name", "advertisement name"],
    buildStatus: ["build status", "ad status", "status"],
    metaStatus: ["ad status", "delivery info", "delivery status", "status"],
    bodyPrimary: ["body primary text", "primary text", "body copy", "text"],
    body: ["body", "primary text", "text"],
    headline: ["copy headline", "headline", "title"],
    title: ["title", "headline"],
    description: ["copy description", "description", "link description"],
    linkDescription: ["link description", "description"],
    cta: ["call to action", "cta"],
    baseUrl: ["url without utms included use for meta", "url without utm included use for meta", "web url", "destination url", "website url"],
    link: ["link", "website url", "destination url", "web url"],
    utm: ["utm for meta", "utm", "url parameters", "tracking parameters"],
    urlTags: ["url tags", "url parameters", "tracking parameters", "utm"],
    optimizeText: ["optimize text per person", "optimize text"],
    degreesFreedom: ["degrees of freedom type", "degree of freedom type"]
  };

  const REQUIRED_HEADER_GROUPS = [HEADER_ALIASES.campaign, HEADER_ALIASES.adSet, HEADER_ALIASES.ad];

  // Meta Field Definitions (Country/Location and Creative Asset File Name EXCLUDED)
  const FIELD_DEFINITIONS = [
    { id: "campaign", label: "Campaign Name", traffic: ["campaign"], meta: ["campaign"], type: "name" },
    { id: "adSet", label: "Ad Set Name", traffic: ["adSet"], meta: ["adSet"], type: "name" },
    { id: "ad", label: "Ad Name", traffic: ["ad"], meta: ["ad"], type: "name" },
    { id: "status", label: "Build Status / Ad Status", traffic: ["buildStatus"], meta: ["metaStatus"], type: "statusMapping" },
    { id: "body", label: "Body (Primary text)", traffic: ["bodyPrimary"], meta: ["body"], type: "adCopyText" },
    { id: "headline", label: "Copy (Headline)", traffic: ["headline"], meta: ["title"], type: "adCopyText" },
    { id: "description", label: "Copy (Description)", traffic: ["description"], meta: ["linkDescription"], type: "adCopyText" },
    { id: "cta", label: "Call to Action", traffic: ["cta"], meta: ["cta"], type: "cta" },
    { id: "url", label: "Destination URL", traffic: ["baseUrl"], meta: ["link"], type: "url" },
    { id: "utm", label: "UTM / URL Tags", traffic: ["utm"], meta: ["urlTags"], type: "utm" },
    { id: "optimizeText", label: "Optimize text per person", traffic: ["optimizeText"], meta: ["optimizeText"], type: "offState" },
    { id: "degreesFreedom", label: "Degrees of Freedom Type", traffic: ["degreesFreedom"], meta: ["degreesFreedom"], type: "offState" }
  ];

  let currentAnalysis = null;
  let isCompactView = false;

  function hasCopyOf(value) {
    if (value === null || value === undefined) return false;
    return /^(copy\s+of\s+)+/i.test(String(value).trim());
  }

  function stripCopyOf(value) {
    if (value === null || value === undefined) return "";
    let text = String(value).trim().replace(/^(copy\s+of\s+)+/i, "");
    return normalizeWhitespace(text).toLowerCase();
  }

  function normalizeAdCopyText(value) {
    if (value === null || value === undefined) return "";
    let text = String(value).replace(/[\[\]]/g, "").trim();
    return normalizeWhitespace(text);
  }

  function jaroWinkler(s1, s2) {
    if (s1 === s2) return 1;
    if (!s1 || !s2) return 0;

    let m = 0;
    let range = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
    let s1Matches = new Array(s1.length);
    let s2Matches = new Array(s2.length);

    for (let i = 0; i < s1.length; i++) {
      let low = i >= range ? i - range : 0;
      let high = i + range <= s2.length - 1 ? i + range : s2.length - 1;
      for (let j = low; j <= high; j++) {
        if (!s1Matches[i] && !s2Matches[j] && s1[i] === s2[j]) {
          m++;
          s1Matches[i] = true;
          s2Matches[j] = true;
          break;
        }
      }
    }

    if (m === 0) return 0;

    let k = 0, numTrans = 0;
    for (let i = 0; i < s1.length; i++) {
      if (s1Matches[i]) {
        while (!s2Matches[k]) k++;
        if (s1[i] !== s2[k]) numTrans++;
        k++;
      }
    }

    let weight = (m / s1.length + m / s2.length + (m - numTrans / 2) / m) / 3;
    let l = 0, p = 0.1;

    if (weight > 0.7) {
      while (s1[l] === s2[l] && l < 4) l++;
      weight = weight + l * p * (1 - weight);
    }
    return weight;
  }

  function normalizeHeader(value) {
    const text = String(value == null ? "" : value).trim();
    if (/\bid\b/i.test(text) && !/name/i.test(text)) return "__ignore_id__";
    
    return text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function headerMatches(value, aliases) {
    const normalized = normalizeHeader(value);
    if (normalized === "__ignore_id__") return false;

    for (let i = 0; i < aliases.length; i++) {
      if (normalized === normalizeHeader(aliases[i])) return true;
    }

    return aliases.some(function (alias) {
      const candidate = normalizeHeader(alias);
      return candidate.length >= 5 && normalized.includes(candidate);
    });
  }

  function rowHeaderScore(row) {
    if (!Array.isArray(row)) return 0;
    let score = 0;
    REQUIRED_HEADER_GROUPS.forEach(function (aliases) {
      if (row.some(function (cell) { return headerMatches(cell, aliases); })) score += 8;
    });
    const allAliases = Object.keys(HEADER_ALIASES).reduce(function (items, key) {
      return items.concat(HEADER_ALIASES[key]);
    }, []);
    row.forEach(function (cell) {
      if (headerMatches(cell, allAliases)) score += 1;
    });
    return score;
  }

  function detectHeaderRow(rows) {
    let bestIndex = -1;
    let bestScore = -1;
    const searchLimit = Math.min(rows.length, 80);
    for (let index = 0; index < searchLimit; index += 1) {
      const score = rowHeaderScore(rows[index]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex < 0 || bestScore < 8) {
      throw new Error("Could not find a header row containing Campaign Name, Ad Set Name, and Ad Name.");
    }
    return bestIndex;
  }

  function selectWorksheet(workbook) {
    let best = null;
    workbook.SheetNames.forEach(function (sheetName) {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet || !worksheet["!ref"]) return;
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: true, blankrows: true });
      let headerIndex = -1;
      let score = -1;
      try {
        headerIndex = detectHeaderRow(rows);
        score = rowHeaderScore(rows[headerIndex]);
      } catch (error) {
        score = -1;
      }
      if (!best || score > best.score) {
        best = { name: sheetName, worksheet: worksheet, rows: rows, headerIndex: headerIndex, score: score };
      }
    });
    if (!best || best.headerIndex < 0) {
      throw new Error("No worksheet in the uploaded file has the required Meta headers.");
    }
    best.range = XLSX.utils.decode_range(best.worksheet["!ref"]);
    return best;
  }

  function readWorkbook(file) {
    return file.arrayBuffer().then(function (buffer) {
      try {
        return XLSX.read(buffer, { type: "array", cellStyles: true, cellDates: true, dense: false });
      } catch (error) {
        throw new Error("Unable to read “" + file.name + "”. Confirm it is a valid Excel or CSV file.");
      }
    });
  }

  function createColumnMap(headerRow) {
    const map = {};
    Object.keys(HEADER_ALIASES).forEach(function (key) {
      map[key] = [];
      
      headerRow.forEach(function (cell, columnIndex) {
        const normCell = normalizeHeader(cell);
        const exactMatch = HEADER_ALIASES[key].some(a => normalizeHeader(a) === normCell);
        if (exactMatch) map[key].push(columnIndex);
      });

      if (map[key].length === 0) {
        headerRow.forEach(function (cell, columnIndex) {
          if (headerMatches(cell, HEADER_ALIASES[key])) map[key].push(columnIndex);
        });
      }
    });
    return map;
  }

  function uniqueNumbers(values) {
    return values.filter(function (value, index, array) {
      return Number.isInteger(value) && array.indexOf(value) === index;
    });
  }

  function indicesForKeys(columnMap, keys) {
    return uniqueNumbers(keys.reduce(function (indices, key) {
      return indices.concat(columnMap[key] || []);
    }, []));
  }

  function firstMeaningfulValue(row, indices) {
    for (let index = 0; index < indices.length; index += 1) {
      const value = row[indices[index]];
      if (value !== null && value !== undefined && String(value).trim() !== "") return value;
    }
    return indices.length ? row[indices[0]] : "";
  }

  function meaningfulIndices(row, indices) {
    const populated = indices.filter(function (columnIndex) {
      const value = row[columnIndex];
      return value !== null && value !== undefined && String(value).trim() !== "";
    });
    return populated.length ? populated : indices.slice(0, 1);
  }

  function normalizeWhitespace(value) {
    return String(value == null ? "" : value)
      .replace(/\r\n/g, "\n")
      .replace(/[\t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim();
  }

  function normalizeKeyPart(value) {
    return normalizeWhitespace(value).toLocaleLowerCase();
  }

  function normalizeOffState(value) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    return OFF_VALUES.has(normalized) ? "__off__" : normalized;
  }

  function normalizeCta(value) {
    return normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function normalizeUrl(value) {
    const text = normalizeWhitespace(value);
    if (!text) return "";
    try {
      const parsed = new URL(text);
      parsed.hostname = parsed.hostname.toLowerCase();
      if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
      return parsed.toString().replace(/\/$/, "");
    } catch (e) {
      return text.replace(/\/+$/, "");
    }
  }

  function isStatusMatch(trafficStatus, metaStatus) {
    const tNorm = normalizeWhitespace(trafficStatus).toLowerCase();
    const mNorm = normalizeWhitespace(metaStatus).toLowerCase();

    if (tNorm === "live" || tNorm === "on") {
      return mNorm === "active" || mNorm === "on";
    } else {
      return mNorm === "paused" || mNorm === "pause" || mNorm === "off" || OFF_VALUES.has(mNorm);
    }
  }

  function valuesMatch(type, trafficValue, metaValue) {
    if (OFF_VALUES.has(normalizeWhitespace(trafficValue).toLowerCase()) && 
        OFF_VALUES.has(normalizeWhitespace(metaValue).toLowerCase())) {
      return true;
    }

    if (type === "statusMapping") return isStatusMatch(trafficValue, metaValue);
    if (type === "offState") return normalizeOffState(trafficValue) === normalizeOffState(metaValue);
    if (type === "cta") return normalizeCta(trafficValue) === normalizeCta(metaValue);
    if (type === "url") return normalizeUrl(trafficValue) === normalizeUrl(metaValue);
    if (type === "adCopyText") return normalizeAdCopyText(trafficValue) === normalizeAdCopyText(metaValue);

    return normalizeWhitespace(trafficValue) === normalizeWhitespace(metaValue);
  }

  function displayValue(value) {
    const text = normalizeWhitespace(value);
    return text || EMPTY_LABEL;
  }

  function isRowEmpty(row) {
    return !row.some(function (cell) { return normalizeWhitespace(cell) !== ""; });
  }

  function recordName(row, columnMap, key) {
    return displayValue(firstMeaningfulValue(row, columnMap[key] || []));
  }

  // Splits multiple values in a single cell (e.g. campaigns or ad sets separated by newlines, pipes, or semicolons)
  function splitMultiValues(value) {
    if (value === null || value === undefined) return [EMPTY_LABEL];
    const text = String(value).trim();
    if (!text) return [EMPTY_LABEL];
    const parts = text.split(/[\r\n|;]+/).map(p => p.trim()).filter(Boolean);
    return parts.length ? parts : [EMPTY_LABEL];
  }

  function buildRecords(sheetData, columnMap) {
    const records = [];
    for (let rowIndex = sheetData.headerIndex + 1; rowIndex < sheetData.rows.length; rowIndex += 1) {
      const row = sheetData.rows[rowIndex];
      if (!row || isRowEmpty(row)) continue;
      const campaignRaw = firstMeaningfulValue(row, columnMap["campaign"] || []);
      const adSetRaw = firstMeaningfulValue(row, columnMap["adSet"] || []);
      const ad = recordName(row, columnMap, "ad");
      if (campaignRaw === "" && adSetRaw === "" && ad === EMPTY_LABEL) continue;

      const campaigns = splitMultiValues(campaignRaw);
      const adSets = splitMultiValues(adSetRaw);

      campaigns.forEach(function (campaignSingle) {
        adSets.forEach(function (adSetSingle) {
          records.push({
            row: row,
            arrayRowIndex: rowIndex,
            sourceRow0: sheetData.range.s.r + rowIndex,
            campaign: displayValue(campaignSingle),
            adSet: displayValue(adSetSingle),
            ad: ad
          });
        });
      });
    }
    return records;
  }

  // Multi-pass Ad Matching Engine (Requires EXACT String Equality on Ad Set Name)
  function findBestMetaMatch(trafficRecord, metaRecords, matchedMetaIndices) {
    const tAdRaw = normalizeWhitespace(trafficRecord.ad).toLowerCase();
    const tAdStripped = stripCopyOf(trafficRecord.ad);
    const tSet = normalizeKeyPart(trafficRecord.adSet);
    const tCamp = normalizeKeyPart(trafficRecord.campaign);

    // Pass 1: Exact Ad Name & EXACT Ad Set Name & EXACT Campaign Name
    for (let idx = 0; idx < metaRecords.length; idx++) {
      if (matchedMetaIndices.has(idx)) continue;
      const m = metaRecords[idx];
      const mAdRaw = normalizeWhitespace(m.ad).toLowerCase();
      const mAdStripped = stripCopyOf(m.ad);
      const mSet = normalizeKeyPart(m.adSet);
      const mCamp = normalizeKeyPart(m.campaign);

      const adMatched = (tAdRaw === mAdRaw || tAdStripped === mAdStripped);
      if (adMatched && tSet === mSet && tCamp === mCamp) {
        return { match: m, index: idx };
      }
    }

    // Pass 2: Exact Ad Name & EXACT Ad Set Name & Contained/Similar Campaign Name
    for (let idx = 0; idx < metaRecords.length; idx++) {
      if (matchedMetaIndices.has(idx)) continue;
      const m = metaRecords[idx];
      const mAdRaw = normalizeWhitespace(m.ad).toLowerCase();
      const mAdStripped = stripCopyOf(m.ad);
      const mSet = normalizeKeyPart(m.adSet);
      const mCamp = normalizeKeyPart(m.campaign);

      const adMatched = (tAdRaw === mAdRaw || tAdStripped === mAdStripped);
      if (adMatched && tSet === mSet && (tCamp.includes(mCamp) || mCamp.includes(tCamp) || jaroWinkler(tCamp, mCamp) >= 0.85)) {
        return { match: m, index: idx };
      }
    }

    // Pass 3: Exact Ad Name & Similar Campaign & Contained Ad Set Name (Strict substring containment only, max length diff <= 15)
    for (let idx = 0; idx < metaRecords.length; idx++) {
      if (matchedMetaIndices.has(idx)) continue;
      const m = metaRecords[idx];
      const mAdRaw = normalizeWhitespace(m.ad).toLowerCase();
      const mAdStripped = stripCopyOf(m.ad);
      const mSet = normalizeKeyPart(m.adSet);
      const mCamp = normalizeKeyPart(m.campaign);

      const adMatched = (tAdRaw === mAdRaw || tAdStripped === mAdStripped);
      const campMatched = (tCamp === mCamp || tCamp.includes(mCamp) || mCamp.includes(tCamp) || jaroWinkler(tCamp, mCamp) >= 0.85);
      const setContained = (tSet.includes(mSet) || mSet.includes(tSet)) && Math.abs(tSet.length - mSet.length) <= 15;

      if (adMatched && campMatched && setContained) {
        return { match: m, index: idx };
      }
    }

    // Strictly isolated - Do NOT cross-match an ad to a completely different Ad Set or Campaign
    return { match: null, index: -1 };
  }

  function compareSheets(trafficData, metaData) {
    const trafficColumns = createColumnMap(trafficData.rows[trafficData.headerIndex]);
    const metaColumns = createColumnMap(metaData.rows[metaData.headerIndex]);
    const trafficRecords = buildRecords(trafficData, trafficColumns);
    const metaRecords = buildRecords(metaData, metaColumns);
    const matchedMetaIndices = new Set();
    const notices = [];

    const resolvedFields = FIELD_DEFINITIONS.map(function (field) {
      return Object.assign({}, field, {
        trafficIndices: indicesForKeys(trafficColumns, field.traffic),
        metaIndices: indicesForKeys(metaColumns, field.meta)
      });
    });

    resolvedFields.forEach(function (field) {
      if (!field.trafficIndices.length) notices.push("Trafficking column not found: " + field.label + ". Check skipped.");
    });

    const flagged = [];

    trafficRecords.forEach(function (trafficRecord) {
      const matchResult = findBestMetaMatch(trafficRecord, metaRecords, matchedMetaIndices);
      const bestMatch = matchResult.match;

      const issues = [];
      const highlightColumns = new Set();

      if (!bestMatch) {
        issues.push({ field: "Record match", traffic: "Present", meta: "Ad not found in Meta export" });
        ["campaign", "adSet", "ad"].forEach(function (key) {
          indicesForKeys(trafficColumns, [key]).forEach(function (column) { highlightColumns.add(column); });
        });
      } else {
        if (matchResult.index >= 0) {
          matchedMetaIndices.add(matchResult.index);
        }

        resolvedFields.forEach(function (field) {
          if (!field.trafficIndices.length && field.id !== "adSet" && field.id !== "campaign" && field.id !== "ad") return;

          let trafficValue, metaValue;

          if (field.id === "adSet") {
            trafficValue = trafficRecord.adSet;
            metaValue = bestMatch.adSet || firstMeaningfulValue(bestMatch.row, field.metaIndices);
          } else if (field.id === "campaign") {
            trafficValue = trafficRecord.campaign;
            metaValue = bestMatch.campaign || firstMeaningfulValue(bestMatch.row, field.metaIndices);
          } else if (field.id === "ad") {
            trafficValue = trafficRecord.ad;
            metaValue = bestMatch.ad || firstMeaningfulValue(bestMatch.row, field.metaIndices);
          } else {
            trafficValue = firstMeaningfulValue(trafficRecord.row, field.trafficIndices);
            metaValue = firstMeaningfulValue(bestMatch.row, field.metaIndices);
          }

          if (!field.metaIndices.length && field.id !== "adSet" && field.id !== "campaign" && field.id !== "ad") {
            const trafficIsOff = OFF_VALUES.has(normalizeWhitespace(trafficValue).toLowerCase());
            if (!trafficIsOff) {
              issues.push({ field: field.label, traffic: displayValue(trafficValue), meta: "(column not found)" });
              meaningfulIndices(trafficRecord.row, field.trafficIndices).forEach(function (column) { highlightColumns.add(column); });
            }
            return;
          }

          if (!valuesMatch(field.type, trafficValue, metaValue)) {
            issues.push({ field: field.label, traffic: displayValue(trafficValue), meta: displayValue(metaValue) });
            meaningfulIndices(trafficRecord.row, field.trafficIndices).forEach(function (column) { highlightColumns.add(column); });
          }
        });
      }

      if (issues.length) {
        flagged.push({
          record: trafficRecord,
          campaign: trafficRecord.campaign,
          adSet: trafficRecord.adSet,
          ad: trafficRecord.ad,
          issues: issues,
          highlightColumns: Array.from(highlightColumns)
        });
      }
    });

    const metaOnly = metaRecords.filter(function (record, idx) { return !matchedMetaIndices.has(idx); });
    metaOnly.forEach(function (record) {
      flagged.push({
        record: null,
        campaign: record.campaign,
        adSet: record.adSet,
        ad: record.ad,
        issues: [{ field: "Record match", traffic: "Ad not found in trafficking sheet", meta: "Present" }],
        highlightColumns: [],
        metaOnly: true
      });
    });

    return {
      trafficData: trafficData,
      trafficColumns: trafficColumns,
      metaColumns: metaColumns,
      trafficRecords: trafficRecords,
      metaRecords: metaRecords,
      resolvedFields: resolvedFields,
      flagged: flagged,
      reportRows: flagged.filter(function (item) { return Boolean(item.record); }),
      metaOnlyCount: metaOnly.length,
      notices: notices
    };
  }

  function groupFlaggedRows(flagged) {
    const campaigns = new Map();
    flagged.forEach(function (item) {
      if (!campaigns.has(item.campaign)) campaigns.set(item.campaign, new Map());
      const adSets = campaigns.get(item.campaign);
      if (!adSets.has(item.adSet)) adSets.set(item.adSet, []);
      adSets.get(item.adSet).push(item);
    });
    return campaigns;
  }

  function issueTotal(items) {
    return items.reduce(function (total, item) { return total + item.issues.length; }, 0);
  }

  function el(tagName, className, textValue) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (textValue !== undefined) element.textContent = textValue;
    return element;
  }

  function detailsGroup(className, label, count) {
    const details = el("details", className);
    details.open = true;
    const summary = el("summary");
    summary.appendChild(el("span", "summary-name", label));
    summary.appendChild(el("span", "summary-count", count + (count === 1 ? " issue" : " issues")));
    details.appendChild(summary);
    return details;
  }

  function renderIssue(issue) {
    const item = el("li", "mismatch-item");
    item.appendChild(el("span", "mismatch-field", issue.field));

    const trafficBlock = el("span", "value-block");
    trafficBlock.appendChild(el("span", "value-source", "Trafficking"));
    trafficBlock.appendChild(el("span", "value-text", issue.traffic));
    item.appendChild(trafficBlock);

    const arrow = el("span", "value-arrow");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    item.appendChild(arrow);

    const metaBlock = el("span", "value-block");
    metaBlock.appendChild(el("span", "value-source", "Meta export"));
    metaBlock.appendChild(el("span", "value-text", issue.meta));
    item.appendChild(metaBlock);
    return item;
  }

  function renderResults(analysis) {
    const resultsList = document.getElementById("resultsList");
    resultsList.replaceChildren();
    const issueCount = issueTotal(analysis.flagged);

    // Calculate accuracy percentage
    let totalEvaluatedChecks = 0;
    analysis.trafficRecords.forEach(function (record) {
      let bestMatch = null;
      let highestScore = 0;

      analysis.metaRecords.forEach(function (metaRecord) {
        let cScore = jaroWinkler(normalizeKeyPart(record.campaign), normalizeKeyPart(metaRecord.campaign));
        let gScore = jaroWinkler(normalizeKeyPart(record.adSet), normalizeKeyPart(metaRecord.adSet));
        let aScore = jaroWinkler(stripCopyOf(record.ad), stripCopyOf(metaRecord.ad));
        let score = (cScore * 0.20) + (gScore * 0.20) + (aScore * 0.60);
        if (score > highestScore) {
          highestScore = score;
          bestMatch = metaRecord;
        }
      });

      analysis.resolvedFields.forEach(function (field) {
        if (!field.trafficIndices.length) return;
        totalEvaluatedChecks += 1;
      });
    });

    let scorePct = 100;
    if (totalEvaluatedChecks > 0) {
      scorePct = Math.max(0, Math.round(((totalEvaluatedChecks - issueCount) / totalEvaluatedChecks) * 100));
    }

    const scoreCircle = document.getElementById("scoreCircle");
    const scoreValueEl = document.getElementById("scoreValue");
    const scoreIconEl = document.getElementById("scoreIcon");
    const scoreLabelEl = document.getElementById("scoreLabel");
    const successStage = document.getElementById("successStage");
    const resultsControls = document.getElementById("resultsControls");

    if (scorePct === 100 && issueCount === 0) {
      // 100% Accuracy Achieved Layout
      if (scoreCircle) scoreCircle.hidden = true;
      if (resultsControls) resultsControls.hidden = true;
      if (successStage) successStage.hidden = false;
    } else {
      // Discrepancies Found Layout
      if (successStage) successStage.hidden = true;
      if (scoreCircle) {
        scoreCircle.hidden = false;
        scoreCircle.className = "score-circle is-lower";
        if (scoreValueEl) scoreValueEl.textContent = scorePct + "%";
        if (scoreIconEl) scoreIconEl.innerHTML = '<i data-lucide="x-circle" aria-hidden="true"></i>';
        if (scoreLabelEl) scoreLabelEl.textContent = issueCount + (issueCount === 1 ? " ISSUE" : " ISSUES");
      }
      if (resultsControls) resultsControls.hidden = false;
    }

    document.getElementById("adsChecked").textContent = String(analysis.trafficRecords.length);
    document.getElementById("adsFlagged").textContent = String(analysis.flagged.length);
    document.getElementById("issueCount").textContent = String(issueCount);

    const notice = document.getElementById("analysisNotice");
    const noticeParts = analysis.notices.slice();
    if (analysis.metaOnlyCount) noticeParts.push(analysis.metaOnlyCount + " Meta-only ad" + (analysis.metaOnlyCount === 1 ? " was" : "s were") + " found.");
    notice.hidden = noticeParts.length === 0;
    notice.textContent = noticeParts.join(" ");

    if (analysis.flagged.length > 0) {
      const campaigns = groupFlaggedRows(analysis.flagged);
      campaigns.forEach(function (adSets, campaignName) {
        const campaignItems = Array.from(adSets.values()).reduce(function (items, rows) { return items.concat(rows); }, []);
        const campaignGroup = detailsGroup("campaign-group", campaignName, issueTotal(campaignItems));
        const campaignBody = el("div", "group-body");

        adSets.forEach(function (ads, adSetName) {
          const adSetGroup = detailsGroup("adgroup-group", adSetName, issueTotal(ads));
          const adSetBody = el("div", "group-body");

          ads.forEach(function (adItem) {
            const adGroup = detailsGroup("ad-group", adItem.ad, adItem.issues.length);
            const list = el("ul", "mismatch-list");
            adItem.issues.forEach(function (issue) { list.appendChild(renderIssue(issue)); });
            adGroup.appendChild(list);
            adSetBody.appendChild(adGroup);
          });

          adSetGroup.appendChild(adSetBody);
          campaignBody.appendChild(adSetGroup);
        });

        campaignGroup.appendChild(campaignBody);
        resultsList.appendChild(campaignGroup);
      });
    }

    if (window.lucide && typeof window.lucide.createIcons === "function") {
      try { window.lucide.createIcons(); } catch (e) {}
    }
  }

  function toggleDetailsView() {
    const resultsList = document.getElementById("resultsList");
    const toggleBtnText = document.getElementById("toggleDetailsText");
    const toggleBtnIcon = document.querySelector("#toggleDetailsBtn i");

    isCompactView = !isCompactView;

    if (isCompactView) {
      resultsList.classList.add("compact-mode");
      if (toggleBtnText) toggleBtnText.textContent = "Expand";
      if (toggleBtnIcon) toggleBtnIcon.setAttribute("data-lucide", "maximize-2");
    } else {
      resultsList.classList.remove("compact-mode");
      if (toggleBtnText) toggleBtnText.textContent = "Compact";
      if (toggleBtnIcon) toggleBtnIcon.setAttribute("data-lucide", "minimize-2");
    }

    if (window.lucide && typeof window.lucide.createIcons === "function") {
      try { window.lucide.createIcons(); } catch (e) {}
    }
  }

  function cloneObject(value) {
    if (!value) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function copySourceCell(sourceSheet, sourceRow0, columnIndex) {
    const sourceAddress = XLSX.utils.encode_cell({ r: sourceRow0, c: columnIndex });
    const sourceCell = sourceSheet[sourceAddress];
    if (!sourceCell) return { t: "s", v: "" };
    const copied = {};
    ["t", "v", "w", "z", "s", "l"].forEach(function (key) {
      if (sourceCell[key] !== undefined) copied[key] = key === "s" || key === "l" ? cloneObject(sourceCell[key]) : sourceCell[key];
    });
    if (copied.v === undefined) copied.v = "";
    if (!copied.t) copied.t = typeof copied.v === "number" ? "n" : "s";
    return copied;
  }

  function mergeStyle(base, addition) {
    const merged = cloneObject(base) || {};
    Object.keys(addition).forEach(function (key) {
      if (typeof addition[key] === "object" && addition[key] !== null && !Array.isArray(addition[key])) {
        merged[key] = Object.assign({}, merged[key] || {}, addition[key]);
      } else {
        merged[key] = addition[key];
      }
    });
    return merged;
  }

  function buildReportWorkbook(analysis) {
    const source = analysis.trafficData.worksheet;
    const headerRow = analysis.trafficData.rows[analysis.trafficData.headerIndex];
    const columnCount = headerRow.length;
    const reportSheet = {};
    const sourceHeaderRow0 = analysis.trafficData.range.s.r + analysis.trafficData.headerIndex;

    const headerStyle = {
      fill: { patternType: "solid", fgColor: { rgb: "1877F2" } },
      font: { bold: true, color: { rgb: "FFFFFF" } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true }
    };

    const mismatchStyle = {
      fill: { patternType: "solid", fgColor: { rgb: "FFC7CE" } },
      font: { color: { rgb: "9C0006" }, bold: true }
    };

    for (let column = 0; column < columnCount; column += 1) {
      const targetAddress = XLSX.utils.encode_cell({ r: 0, c: column });
      const cell = copySourceCell(source, sourceHeaderRow0, column);
      cell.s = mergeStyle(cell.s, headerStyle);
      reportSheet[targetAddress] = cell;
    }

    analysis.reportRows.forEach(function (flaggedRow, reportIndex) {
      const targetRow0 = reportIndex + 1;
      for (let column = 0; column < columnCount; column += 1) {
        const targetAddress = XLSX.utils.encode_cell({ r: targetRow0, c: column });
        const cell = copySourceCell(source, flaggedRow.record.sourceRow0, column);

        if (flaggedRow.highlightColumns.includes(column)) {
          cell.s = mergeStyle(cell.s, mismatchStyle);
        }
        reportSheet[targetAddress] = cell;
      }
    });

    reportSheet["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, analysis.reportRows.length), c: Math.max(0, columnCount - 1) } });
    if (source["!cols"]) reportSheet["!cols"] = cloneObject(source["!cols"]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, reportSheet, "Meta QA Discrepancies");
    return workbook;
  }

  function downloadReport() {
    try {
      if (!currentAnalysis) throw new Error("Run an analysis before downloading the report.");
      if (typeof XLSX === "undefined") throw new Error("The Excel library did not load.");
      const workbook = buildReportWorkbook(currentAnalysis);
      XLSX.writeFile(workbook, "Report_QA_Meta.xlsx", { compression: true, cellStyles: true });
    } catch (error) {
      window.alert("Download failed: " + (error && error.message ? error.message : "Unknown error"));
    }
  }

  function switchView(from, to) {
    from.classList.add("is-leaving");
    window.setTimeout(function () {
      from.hidden = true;
      from.classList.remove("is-leaving");
      to.hidden = false;
      to.classList.add("is-entering");
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () { to.classList.remove("is-entering"); });
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 320);
  }

  function restart() {
    const mainView = document.getElementById("mainView");
    const resultsView = document.getElementById("resultsView");
    
    const trafficInput = document.getElementById("trafficFile");
    const metaInput = document.getElementById("metaFile");
    const trafficLabel = document.getElementById("trafficFileName");
    const metaLabel = document.getElementById("metaFileName");
    
    if (trafficInput) trafficInput.value = "";
    if (metaInput) metaInput.value = "";
    
    window.setFileLabel(trafficInput, trafficLabel);
    window.setFileLabel(metaInput, metaLabel);
    
    document.getElementById("progressRegion").hidden = true;
    document.getElementById("analyzeButton").disabled = false;
    currentAnalysis = null;
    isCompactView = false;
    
    const resultsList = document.getElementById("resultsList");
    if (resultsList) resultsList.classList.remove("compact-mode");

    switchView(resultsView, mainView);
  }

  function analyze() {
    const trafficInput = document.getElementById("trafficFile");
    const metaInput = document.getElementById("metaFile");
    const analyzeButton = document.getElementById("analyzeButton");
    const progress = document.getElementById("progressRegion");
    const trafficFile = trafficInput.files && trafficInput.files[0];
    const metaFile = metaInput.files && metaInput.files[0];

    if (!trafficFile || !metaFile) {
      window.alert("Please select both the Trafficking Sheet and Exported Meta Sheet.");
      return;
    }

    analyzeButton.disabled = true;
    progress.hidden = false;

    window.setTimeout(function () {
      Promise.all([readWorkbook(trafficFile), readWorkbook(metaFile)])
        .then(function (workbooks) {
          try {
            const trafficData = selectWorksheet(workbooks[0]);
            const metaData = selectWorksheet(workbooks[1]);
            currentAnalysis = compareSheets(trafficData, metaData);
            renderResults(currentAnalysis);
            switchView(document.getElementById("mainView"), document.getElementById("resultsView"));
          } catch (error) {
            window.alert("Analysis Error: " + (error && error.message ? error.message : "Unknown error"));
          }
        })
        .catch(function (error) {
          window.alert("File Read Failed: " + (error && error.message ? error.message : "Unknown error"));
        })
        .finally(function () {
          analyzeButton.disabled = false;
          progress.hidden = true;
        });
    }, 80);
  }

  document.addEventListener("DOMContentLoaded", function () {
    const trafficInput = document.getElementById("trafficFile");
    const metaInput = document.getElementById("metaFile");
    const trafficLabel = document.getElementById("trafficFileName");
    const metaLabel = document.getElementById("metaFileName");

    function bindFileInput(input, label) {
      if (!input || !label) return;
      ["change", "input"].forEach(function (eventType) {
        input.addEventListener(eventType, function () {
          window.setFileLabel(input, label);
        });
      });
      input.addEventListener("click", function () {
        this.value = "";
      });
    }

    bindFileInput(trafficInput, trafficLabel);
    bindFileInput(metaInput, metaLabel);
    
    const btnAnalyze = document.getElementById("analyzeButton");
    if (btnAnalyze) btnAnalyze.addEventListener("click", analyze);
    
    const btnToggleDetails = document.getElementById("toggleDetailsBtn");
    if (btnToggleDetails) btnToggleDetails.addEventListener("click", toggleDetailsView);

    const btnDownload = document.getElementById("downloadButton");
    if (btnDownload) btnDownload.addEventListener("click", downloadReport);
    
    const btnRestart = document.getElementById("restartButton");
    if (btnRestart) btnRestart.addEventListener("click", restart);

    if (window.lucide && typeof window.lucide.createIcons === "function") {
      try { window.lucide.createIcons(); } catch (e) {}
    }
  });
})();
